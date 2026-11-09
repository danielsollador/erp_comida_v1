"""QA de noviembre (specs/qa.md y specs/caja.md): los casos reales que se
reprodujeron en la copia de produccion, convertidos en reglas.

  R2  nada que mueva plata se registra dos veces por un doble toque;
  R3  un mes con el IVA declarado queda congelado;
  R4  lo que se sale de lo normal pide confirmar;
  R5  anular, dar de baja, corregir un cierre y cambiar la tasa piden firma;
  1.10 el cierre cuenta y cuadra: la diferencia va a los libros al aprobarla.
"""
from __future__ import annotations

import datetime

import pytest
from fastapi.testclient import TestClient

from app import models, rates, settings
from app.acceso import usuarios
from app.database import get_db
from app.main import app
from tests.conftest import entrar, libros, saldo  # noqa: F401

LOCAL = settings.LOCAL_SLUG
CAJERA = ("cajera_qa_nov", "clave-de-la-cajera-larga")
DUENA = ("duena_qa_nov", "clave-de-la-duena-larga")


@pytest.fixture(scope="module", autouse=True)
def _gente():
    for (u, c), rol in ((CAJERA, "caja"), (DUENA, "dueno")):
        try:
            usuarios.crear(u, c, rol=rol, locales=[LOCAL])
        except usuarios.ErrorUsuarios:
            pass
    usuarios.poner_pin(DUENA[0], "8642")
    yield
    for u, _ in (CAJERA, DUENA):
        try:
            usuarios.borrar(u)
        except usuarios.ErrorUsuarios:
            pass


@pytest.fixture()
def cajera(db):
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as c:
        entrar(c, *CAJERA)
        yield c
    app.dependency_overrides.pop(get_db, None)


def con_libros(db, bs=200.0, usd=200.0, banco=2000.0):
    from app import contabilidad

    contabilidad.crear_asiento(
        db, "Aporte inicial", [("1010", bs, 0.0), ("1011", usd, 0.0), ("1020", banco, 0.0), ("3010", 0.0, bs + usd + banco)],
        origen="manual", fecha=datetime.datetime.now() - datetime.timedelta(days=3),
    )
    db.commit()


# ── R2 · un solo envio ──────────────────────────────────────────────────────


def test_un_retiro_repetido_a_los_segundos_pide_confirmar(client, db):
    """QA nov: dos toques en «Registrar retiro» dejaban dos retiros de $15."""
    con_libros(db)
    cuerpo = {"monto": 15, "metodo_pago": "Efectivo $", "nota": "doble toque"}
    assert client.post("/api/caja/retiros", json=cuerpo).status_code == 200
    r = client.post("/api/caja/retiros", json=cuerpo)
    assert r.status_code == 428 and r.json()["detail"]["clave"] == "repetido"
    assert db.query(models.RetiroPropietario).count() == 1
    r = client.post("/api/caja/retiros", json=cuerpo, headers={"X-Confirmado": "repetido"})
    assert r.status_code == 200, "si de verdad es otro, confirmado entra"


def test_el_alquiler_no_se_paga_dos_veces_el_mismo_mes(client, db):
    """QA nov: «Pagar» dos veces en el alquiler de $300 registraba dos pagos."""
    con_libros(db)
    fijo = client.post("/api/egresos/fijos", json={
        "beneficiario": "Casero", "concepto": "Alquiler", "monto": 300, "metodo_pago": "Transferencia",
        "frecuencia": "mensual", "proximo": datetime.date.today().isoformat(),
    }).json()
    assert client.post(f"/api/egresos/fijos/{fijo['id']}/pagar", json={"referencia": "A1"}).status_code == 200
    r = client.post(f"/api/egresos/fijos/{fijo['id']}/pagar", json={"referencia": "A2"})
    assert r.status_code == 428 and r.json()["detail"]["clave"] == "fijo_repetido"
    assert db.query(models.PagoSinFactura).count() == 1


def test_una_factura_a_credito_no_se_paga_dos_veces(client, db):
    con_libros(db)
    f = client.post("/api/compras/facturas", json={
        "numero_factura": "DT-1", "proveedor_nombre": "Prov", "proveedor_rif": "J-40000011-0", "forma_pago": "Credito",
        "gastos": [{"concepto": "Servicio", "monto": 50}], "iva": 8,
    }).json()
    pago = {"forma_pago": "Transferencia", "referencia": "P1"}
    assert client.post(f"/api/compras/facturas/{f['id']}/pagar", json=pago).status_code == 200
    r = client.post(f"/api/compras/facturas/{f['id']}/pagar", json=pago, headers={"X-Confirmado": "repetido"})
    assert r.status_code == 409


# ── R3 · mes declarado congelado ────────────────────────────────────────────


def _declarar_mes_pasado(db) -> datetime.date:
    hoy = datetime.date.today()
    pasado = (hoy.replace(day=1) - datetime.timedelta(days=1)).replace(day=15)
    db.add(models.DeclaracionIva(anio=pasado.year, mes=pasado.month))
    db.commit()
    return pasado


def test_con_el_mes_declarado_no_entra_una_factura_de_ese_mes(client, db):
    """QA nov: con octubre declarado, una factura registrada en octubre entró al
    libro de compras ya declarado."""
    pasado = _declarar_mes_pasado(db)
    r = client.post("/api/compras/facturas", json={
        "numero_factura": "OCT-1", "proveedor_nombre": "Prov", "proveedor_rif": "J-40000009-0",
        "forma_pago": "Transferencia", "referencia_pago": "O1", "fecha": f"{pasado.isoformat()}T10:00:00",
        "gastos": [{"concepto": "Servicio", "monto": 100}], "iva": 16,
    })
    assert r.status_code == 409 and "ya se declaró" in r.json()["detail"]


def test_con_el_mes_declarado_no_entra_un_pago_de_ese_mes(client, db):
    pasado = _declarar_mes_pasado(db)
    r = client.post("/api/egresos", json={
        "beneficiario": "Gas", "concepto": "Servicios publicos", "monto": 15, "metodo_pago": "Transferencia",
        "referencia": "G1", "fecha": pasado.isoformat(),
    }, headers={"X-Confirmado": "fecha_vieja"})
    assert r.status_code == 409 and "ya se declaró" in r.json()["detail"]


# ── R4 · lo raro pide confirmar ─────────────────────────────────────────────


def test_un_alquiler_con_un_cero_de_mas_pide_confirmar(client, db):
    con_libros(db)
    base = {"beneficiario": "Casero", "concepto": "Alquiler", "metodo_pago": "Transferencia"}
    assert client.post("/api/egresos", json={**base, "monto": 300, "referencia": "R1"}).status_code == 200
    r = client.post("/api/egresos", json={**base, "monto": 3000, "referencia": "R2"})
    assert r.status_code == 428 and r.json()["detail"]["clave"] == "monto_alto"
    assert client.post("/api/egresos", json={**base, "monto": 3000, "referencia": "R2"},
                       headers={"X-Confirmado": "monto_alto"}).status_code == 200


def test_un_pago_fechado_hace_un_anio_pide_confirmar(client, db):
    con_libros(db)
    hace_un_anio = (datetime.date.today() - datetime.timedelta(days=365)).isoformat()
    r = client.post("/api/egresos", json={
        "beneficiario": "Gas", "concepto": "Servicios publicos", "monto": 10, "metodo_pago": "Transferencia",
        "referencia": "F1", "fecha": hace_un_anio,
    })
    assert r.status_code == 428 and r.json()["detail"]["clave"] == "fecha_vieja"


def test_no_se_saca_de_la_gaveta_mas_de_lo_que_hay(client, db):
    """QA nov: un retiro de $5.000 con $133 en la gaveta la dejó en −$4.900."""
    con_libros(db, usd=133)
    r = client.post("/api/caja/retiros", json={"monto": 5000, "metodo_pago": "Efectivo $", "nota": ""})
    assert r.status_code == 400 and "hay" in r.json()["detail"]
    r = client.post("/api/caja/gastos", json={"descripcion": "Hielo", "monto": 300, "categoria": "Otros",
                                              "metodo_pago": "Efectivo $"})
    assert r.status_code == 400


# ── R5 · firma ──────────────────────────────────────────────────────────────


def test_la_cajera_no_cambia_la_tasa_sin_firma(cajera, db):
    """QA nov: la cajera puso la tasa en 1 Bs por dólar."""
    db.add(models.TasaCambio(fecha=datetime.date.today(), bcv=897.54, origen="auto"))
    db.commit()
    r = cajera.put("/api/tasas", json={"bcv": 900})
    assert r.status_code == 428 and r.json()["detail"]["codigo"] == "firma"
    r = cajera.put("/api/tasas", json={"bcv": 900}, headers={"X-Autorizacion": '{"pin": "8642"}'})
    assert r.status_code == 200, r.text
    r = cajera.put("/api/tasas", json={"bcv": 1}, headers={"X-Autorizacion": '{"pin": "8642"}'})
    assert r.status_code == 428 and r.json()["detail"]["clave"] == "tasa_salto"


def test_la_cajera_no_anula_un_cierre_sin_firma(cajera, db):
    con_libros(db)
    c = cajera.post("/api/caja/cerrar", json={"conteos": [{"metodo": "Efectivo $", "contado": 200}]}).json()
    r = cajera.post(f"/api/caja/cierres/{c['id']}/anular", json={"motivo": "mal contado"})
    assert r.status_code == 428 and r.json()["detail"]["accion"] == "anular_cierre"
    r = cajera.post(f"/api/caja/cierres/{c['id']}/anular", json={"motivo": "mal contado"},
                    headers={"X-Autorizacion": '{"pin": "8642"}'})
    assert r.status_code == 200 and r.json()["autorizado_por"]


def test_el_bcv_con_punto_de_miles_se_lee_completo():
    """QA nov: el BCV publica el euro «1.001,18» y se guardaba 1,18."""
    import re

    html = '<div id="euro"><strong> 1.001,18245 </strong></div><div id="dolar"><strong> 897,54 </strong></div>'
    patron = r'id="euro".{0,600}?([0-9]{1,3}(?:\.[0-9]{3})+,[0-9]{2,10}|[0-9]{1,6},[0-9]{2,10})'
    assert rates._num_ve(re.search(patron, html, re.S).group(1)) == pytest.approx(1001.18245)


# ── 1.10 · el cierre como cuadre ────────────────────────────────────────────


def test_cerrar_con_un_faltante_no_toca_los_libros_hasta_aprobarlo(client, db):
    """El cierre se anulaba casi a diario porque cada tecleo entraba a los
    libros. Ahora el faltante queda por aprobar y la ganancia no cambia."""
    con_libros(db, usd=100)
    r = client.post("/api/caja/cerrar", json={"conteos": [{"metodo": "Efectivo $", "contado": 95}]})
    assert r.status_code == 200, r.text
    cierre = r.json()
    assert cierre["estado_diferencia"] == "por_aprobar"
    assert saldo(db, "6030") == 0
    pendientes = client.get("/api/caja/diferencias").json()
    assert pendientes["total"] == -5
    r = client.post("/api/caja/diferencias/aprobar", json={"tipo": "cierre", "id": cierre["id"], "motivo": "Vuelto mal dado"})
    assert r.status_code == 200, r.text
    db.expire_all()
    assert saldo(db, "6030") == pytest.approx(5)
    assert client.get("/api/caja/diferencias").json()["total"] == 0


def test_cerrar_sin_abrir_no_manda_la_gaveta_a_perdida(client, db):
    """QA nov: sin declarar el fondo, la gaveta se daba por abierta en cero y
    los $133 que habia pasaban a faltante."""
    con_libros(db, usd=133)
    r = client.post("/api/caja/cerrar", json={"conteos": [{"metodo": "Efectivo $", "contado": 133}]})
    assert r.status_code == 200, r.text
    assert r.json()["estado_diferencia"] == "sin_diferencia"
    db.expire_all()
    assert saldo(db, "6030") == 0


def test_una_diferencia_de_centavos_se_aprueba_sola(client, db):
    con_libros(db, usd=100)
    r = client.post("/api/caja/cerrar", json={"conteos": [{"metodo": "Efectivo $", "contado": 99.95}]})
    assert r.json()["estado_diferencia"] == "sola"
    db.expire_all()
    assert saldo(db, "6030") == pytest.approx(0.05)


def test_un_gasto_despues_de_cerrar_marca_el_cierre_por_revisar(client, db):
    con_libros(db, usd=100)
    c = client.post("/api/caja/cerrar", json={"conteos": [{"metodo": "Efectivo $", "contado": 100}]}).json()
    assert client.post("/api/caja/gastos", json={"descripcion": "Hielo", "monto": 3, "categoria": "Otros",
                                                 "metodo_pago": "Efectivo $"}).status_code == 200
    cierre = next(x for x in client.get("/api/caja/cierres").json() if x["id"] == c["id"])
    assert cierre["por_revisar"] is True and "Hielo" in cierre["cambios_despues"]


# ── Dona (hallazgos 13, 14 y 27) ────────────────────────────────────────────


def test_dona_tiene_las_cifras_que_le_faltaban(client, db, variante):
    """Examen de Dona: 15 de 40 respuestas fueron "no tengo ese dato". Cada
    herramienta nueva responde con lo mismo que su pantalla."""
    from app.asistente import herramientas as h

    con_libros(db)
    client.post("/api/egresos", json={"beneficiario": "Casero", "concepto": "Alquiler", "monto": 300,
                                      "metodo_pago": "Transferencia", "referencia": "A1"})
    er = client.get("/api/contabilidad/estado-resultados").json()
    assert h.gastos(db)["gastos_usd"] == round(er["gastos"], 2), "los gastos son los del Estado de resultados"
    assert h.saldos(db)["gaveta_dolares_usd"] == 200
    assert "me_deben_usd" in h.cuentas(db)
    assert h.iva(db)["declarado"] is False
    assert h.cierres(db)["por_aprobar"] == 0
    assert h.producto(db, variante.producto.nombre[:4])["productos"]


def test_dona_le_da_las_ventas_a_la_cajera_sin_la_ganancia():
    """Hallazgo 27: Dona le negaba a la cajera las ventas que Reportes le
    mostraba. Ahora ve las ventas, como en la pantalla, pero no la ganancia."""
    from app.acceso import permisos
    from app.asistente import herramientas as h

    if not permisos.puede_modulo("caja", "reportes"):
        pytest.skip("en este local la cajera no entra a Reportes")
    assert "ventas" in h.disponibles("caja")
    assert "gastos" not in h.disponibles("caja")


def test_un_pago_en_bs_a_la_paralela_saca_del_banco_lo_que_vale_a_la_bcv(client, db):
    """Hallazgo 16: 10.357 Bs a la paralela se anotaban como $10 de banco; a la
    BCV son $11,56. El banco se lleva en Bs: sale lo que valen a la BCV y la
    diferencia va a diferencial cambiario."""
    con_libros(db)
    db.add(models.TasaCambio(fecha=datetime.date.today(), bcv=896.0, paralelo=1035.7, origen="auto"))
    db.commit()
    banco = saldo(db, "1020")
    r = client.post("/api/egresos", json={"beneficiario": "Gas", "concepto": "Servicios publicos", "monto": 10357,
                                          "moneda": "Bs", "tasa": 1035.7, "metodo_pago": "Pago movil", "referencia": "P1"})
    assert r.status_code == 200, r.text
    db.expire_all()
    assert round(banco - saldo(db, "1020"), 2) == round(10357 / 896.0, 2)
    assert saldo(db, "6110") == 10.0
    assert saldo(db, "6160") == pytest.approx(round(10357 / 896.0, 2) - 10.0, abs=0.01)


def test_una_factura_mal_cargada_se_anula_entera(client, db, insumo, libros):
    """Hallazgo 17: una factura con mercancía no se podía deshacer; el mensaje
    mandaba a un ajuste de inventario, que no devuelve ni el IVA ni la plata.
    Si la mercancía sigue ahí y nadie la volvió a comprar, se anula entera."""
    from tests.conftest import libros_cuadrados

    costo_antes, stock_antes, banco = insumo.costo_unitario, insumo.stock_actual, saldo(db, "1020")
    f = client.post("/api/compras/facturas", json={
        "numero_factura": "MAL-1", "proveedor_nombre": "Carnicería", "proveedor_rif": "J-40000011-0",
        "forma_pago": "Transferencia", "referencia_pago": "T1",
        "items": [{"ingrediente_id": insumo.id, "cantidad": 10, "costo_unitario": 0.002}], "iva": 0,
    })
    assert f.status_code == 200, f.text
    r = client.delete(f"/api/compras/facturas/{f.json()['id']}")
    assert r.status_code == 200, r.text
    db.expire_all()
    assert insumo.stock_actual == pytest.approx(stock_antes)
    assert insumo.costo_unitario == pytest.approx(costo_antes, abs=1e-4), "el costo vuelve al de antes"
    assert saldo(db, "1020") == pytest.approx(banco)
    libros_cuadrados(client, db)


def test_un_proveedor_nuevo_entra_a_proveedores_al_cargar_su_factura(client, db):
    """Hallazgo 18: la factura de «Carnicería QA» no lo creaba en Proveedores."""
    con_libros(db)
    client.post("/api/compras/facturas", json={
        "numero_factura": "P-1", "proveedor_nombre": "Carnicería QA", "proveedor_rif": "J-40000022-0",
        "forma_pago": "Transferencia", "referencia_pago": "X1", "gastos": [{"concepto": "Servicio", "monto": 10}], "iva": 0,
    })
    assert db.query(models.Proveedor).filter_by(nombre="Carnicería QA").count() == 1


def test_una_referencia_ya_usada_pide_confirmar_al_cobrar(client, db, variante):
    """Hallazgo 23: la referencia 123456 ya estaba en dos ventas y se cobró
    sin decir nada; el aviso salía después, en la portada."""
    def cobrar(ref, **kw):
        p = client.post("/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 1}]}).json()
        return client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Pago movil", "referencia": ref}, **kw)

    assert cobrar("123456").status_code == 200
    r = cobrar("123456")
    assert r.status_code == 428 and r.json()["detail"]["clave"] == "referencia_repetida"


def test_un_sueldo_no_entra_como_pago_menor(client, db):
    con_libros(db)
    r = client.post("/api/caja/gastos", json={"descripcion": "Sueldo de Richard", "monto": 87.5, "categoria": "Otros",
                                              "metodo_pago": "Efectivo $"})
    assert r.status_code == 400 and "Pagos" in r.json()["detail"]



def test_un_dia_del_mart_que_no_cuadra_se_rehace_de_noche(client, db):
    """Hallazgo 6: el Balance leía un resumen del 21 y 24-oct que no coincidía
    con los asientos (datos corregidos directo en la base)."""
    from app import consolidacion

    con_libros(db)
    hace_3 = datetime.date.today() - datetime.timedelta(days=3)
    consolidacion.consolidar_dia(db, hace_3)
    assert hace_3 not in consolidacion.dias_pendientes(db)
    fila = db.query(models.DmCuentaDia).filter_by(fecha=hace_3).first()
    fila.debe = (fila.debe or 0) + 87.42  # alguien tocó la base a mano
    db.commit()
    assert hace_3 in consolidacion.dias_pendientes(db)


def test_historial_pagos_y_diario_se_exportan(client, db):
    """Hallazgo 29: solo se exportaba en Compras e Impuestos."""
    con_libros(db)
    client.post("/api/egresos", json={"beneficiario": "Casero", "concepto": "Alquiler", "monto": 300,
                                      "metodo_pago": "Transferencia", "referencia": "A1"})
    client.post("/api/caja/gastos", json={"descripcion": "Hielo", "monto": 3, "categoria": "Otros", "metodo_pago": "Efectivo $"})
    for ruta in ("/api/egresos/exportar", "/api/caja/historial/exportar", "/api/contabilidad/asientos/exportar"):
        for formato in ("csv", "xlsx"):
            r = client.post(ruta, json={"formato": formato})
            assert r.status_code == 200 and len(r.content) > 50, (ruta, formato, r.text[:200])


def test_el_vuelto_en_dolares_con_centavos_da_los_centavos_en_bolivares(client, db, variante, libros):
    """Hallazgo 22: el sistema pedía dar $3,08 en billetes de dólar; la cajera
    da $3 y la gaveta de dólares quedaba con $0,08 de diferencia. Ahora salen
    $3 de la gaveta de $ y los $0,08 en bolívares de la de Bs."""
    from tests.conftest import libros_cuadrados

    usd, bs = saldo(db, "1011"), saldo(db, "1010")
    p = client.post("/api/pedidos", json={"items": [{"nombre_libre": "Combo QA", "precio_libre": 16.92, "cantidad": 1}],
                                          "permitir_sin_stock": True}).json()
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={
        "metodo_pago": "Efectivo $",
        "pagos": [{"metodo": "Efectivo $", "monto": 16.92, "recibido": 20, "vuelto_metodo": "Efectivo $", "vuelto_centavos_bs": True}],
    })
    assert r.status_code == 200, r.text
    db.expire_all()
    assert round(saldo(db, "1011") - usd, 2) == 17.0, "entró el billete de 20 y salieron 3 en billetes"
    assert round(saldo(db, "1010") - bs, 2) == -0.08, "los centavos salieron en bolívares"
    libros_cuadrados(client, db)


def test_un_salto_de_tasa_descartado_se_avisa_y_el_euro_malo_no_bloquea_el_bueno(client, db):
    """Regresión del QA: con el euro guardado mal (1,18 con el dólar en 897),
    el freno de saltos rechazaba para siempre el euro bueno; y un salto del
    BCV descartado no se le decía a nadie."""
    from app import rates, tasas

    ayer = datetime.date.today() - datetime.timedelta(days=1)
    db.add(models.TasaCambio(fecha=ayer, bcv=897.54, eur=1.18, origen="auto"))
    db.commit()
    rates._cache.update({"at": datetime.datetime.now(), "ok_at": datetime.datetime.now(),
                         "anclas": {"bcv": 1300.0, "eur": 1001.18, "paralelo": 1100.0, "actualizado": None}})
    tasas.refrescar(db)
    hoy_ = db.query(models.TasaCambio).filter_by(fecha=datetime.date.today()).first()
    assert hoy_.eur == pytest.approx(1001.18), "el euro bueno entra aunque el de ayer estuviera mal"
    assert hoy_.bcv == pytest.approx(897.54), "un salto de 45 % no se toma solo"
    assert client.get("/api/tasas").json()["salto_rechazado"]
    assert any(a["id"] == "tasa-salto" for a in client.get("/api/reportes/avisos").json())
    tasas.saltos_rechazados.clear()


def test_anular_un_cierre_hecho_sin_abrir_deja_abrir_con_el_fondo_real(client, db):
    """Regresión E3c: tras anular, la caja decía «ya se abrió» y no dejaba
    declarar el fondo real."""
    con_libros(db, usd=100)
    c = client.post("/api/caja/cerrar", json={"conteos": [{"metodo": "Efectivo $", "contado": 100}]}).json()
    client.post(f"/api/caja/cierres/{c['id']}/anular", json={"motivo": "rehacer"})
    assert client.get("/api/caja/estado-apertura").json()["puede_abrir"] is True
