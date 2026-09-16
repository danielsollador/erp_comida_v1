"""Tier 4: los huecos estructurales.

Quien hizo que, dos cajas, meses cerrados, cierre de ejercicio, activos
preexistentes y el ticket impreso.
"""

import datetime

import pytest

from app import models


def saldo(db, codigo):
    cuenta = db.query(models.CuentaContable).filter_by(codigo=codigo).first()
    movs = db.query(models.MovimientoContable).filter_by(cuenta_id=cuenta.id).all()
    total = sum(m.debe - m.haber for m in movs)
    return round(total if cuenta.naturaleza == "deudora" else -total, 2)


@pytest.fixture()
def cajero(client):
    return client.post("/api/operadores", json={"nombre": "Yoli", "rol": "cajero"}).json()


@pytest.fixture()
def piso2(client):
    return client.post("/api/puntos-venta", json={"nombre": "Piso 2"}).json()


def vender(client, variante, cantidad=1, **extra):
    p = client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": cantidad}], "nota": ""},
    ).json()
    cuerpo = {"metodo_pago": "Efectivo Bs"}
    cuerpo.update(extra)
    return client.post(f"/api/pedidos/{p['id']}/cobrar", json=cuerpo).json()


# ------------------------------------------------- H106: quien hizo que
#
# Desde que el ERP tiene login, el operador ya no se elige en la tablet: es
# quien entro con su clave (el `client` de las pruebas entra como "admin"). El
# `operador_id` que mande el cuerpo se ignora cuando hay sesion -- si mandara,
# una cajera podria cargarle sus anulaciones a otra. Ver `operadores.del_turno`.
def test_el_pedido_queda_con_el_nombre_de_quien_cobro(client, variante, cajero, piso2):
    """El sistema era completamente anonimo: ni una tabla de usuarios ni un
    campo de autoria en ninguna de las seis tablas que importan."""
    cobrado = vender(
        client, variante, cantidad=2, operador_id=cajero["id"], punto_venta_id=piso2["id"]
    )
    assert cobrado["operador"] == "admin", "quien cobro es quien entro, no el id de la tablet"
    assert cobrado["punto_venta"] == "Piso 2"


def test_se_registra_quien_anulo_un_pedido(client, variante, cajero):
    """Anular es la via por la que se va comida sin cobrar: es lo que un dueno
    ausente mas necesita poder revisar."""
    p = client.post(
        "/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 1}]}
    ).json()
    anulado = client.post(
        f"/api/pedidos/{p['id']}/anular",
        json={"comida_preparada": False, "operador_id": cajero["id"]},
    ).json()
    assert anulado["anulado_por"] == "admin"


def test_el_cierre_queda_con_el_nombre_de_quien_conto(client, variante, cajero, piso2):
    vender(client, variante, cantidad=2)
    cierre = client.post(
        "/api/caja/cerrar",
        json={"efectivo_contado": 10.0, "operador_id": cajero["id"], "punto_venta_id": piso2["id"]},
    ).json()
    assert cierre["operador"] == "admin"
    assert cierre["punto_venta"] == "Piso 2"


def test_un_operador_desactivado_de_la_tablet_no_manda_sobre_la_sesion(client, variante, cajero):
    """Antes un operador dado de baja bloqueaba el cobro (409). Ahora el id de
    la tablet no decide nada: cobra quien tiene la sesion, y el operador que
    corresponde a esa cuenta se reactiva solo si estaba de baja."""
    client.delete(f"/api/operadores/{cajero['id']}")
    p = client.post(
        "/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 1}]}
    ).json()
    r = client.post(
        f"/api/pedidos/{p['id']}/cobrar",
        json={"metodo_pago": "Efectivo Bs", "operador_id": cajero["id"]},
    )
    assert r.status_code == 200
    assert r.json()["operador"] == "admin"


def test_sin_operador_en_el_cuerpo_el_pedido_igual_tiene_nombre(client, variante):
    """La tablet no tiene que mandar nada: la sesion ya dice quien es."""
    cobrado = vender(client, variante, cantidad=2)
    assert cobrado["estado"] == "pagado"
    assert cobrado["operador"] == "admin"


# ------------------------------------------------- H103/H104: dos cajas
def test_cada_punto_de_venta_cierra_su_propia_gaveta(client, variante, piso2):
    """Con un solo cierre por dia, la caja del piso 2 no podia cuadrar lo
    suyo: el segundo cierre devolvia 409."""
    vender(client, variante, cantidad=2)
    primero = client.post("/api/caja/cerrar", json={"efectivo_contado": 10.0})
    assert primero.status_code == 200

    segundo = client.post(
        "/api/caja/cerrar", json={"efectivo_contado": 0.0, "punto_venta_id": piso2["id"]}
    )
    assert segundo.status_code == 200, "la otra caja tambien cierra"
    assert segundo.json()["punto_venta"] == "Piso 2"


def test_la_misma_caja_no_cierra_dos_veces(client, variante, piso2):
    vender(client, variante, cantidad=2)
    client.post("/api/caja/cerrar", json={"efectivo_contado": 10.0, "punto_venta_id": piso2["id"]})
    r = client.post(
        "/api/caja/cerrar", json={"efectivo_contado": 10.0, "punto_venta_id": piso2["id"]}
    )
    assert r.status_code == 409
    assert "Piso 2" in r.json()["detail"]


# ------------------------------------------------- H88: meses ya cerrados
def _venta_en(client, db, variante, anio, mes, numero="00-1"):
    cobrado = vender(client, variante, cantidad=2, facturado=True, numero_factura=numero)
    pedido = db.query(models.Pedido).filter_by(id=cobrado["id"]).first()
    cuando = datetime.datetime(anio, mes, 15, 12, 0)
    pedido.cerrado_en = cuando
    pedido.creado_en = cuando
    for a in db.query(models.AsientoContable).filter_by(
        origen="venta", referencia_id=pedido.id
    ).all():
        a.fecha = cuando
    db.commit()
    return cobrado


def test_se_puede_re_emitir_el_libro_de_ventas_de_un_mes_cerrado(client, db, variante):
    """Requisito fiscal: el SENIAT lo pide por periodo y el sistema solo sabia
    emitir el mes en curso."""
    _venta_en(client, db, variante, 2025, 12)

    actual = client.get("/api/impuestos/libro-ventas?periodo=mes").json()
    assert len(actual["filas"]) == 0

    diciembre = client.get("/api/impuestos/libro-ventas?anio=2025&mes=12").json()
    assert diciembre["etiqueta"] == "Diciembre 2025"
    assert len(diciembre["filas"]) == 1
    assert diciembre["total_general"] == 10.0


def test_se_puede_ver_el_reporte_de_un_mes_pasado(client, db, variante):
    _venta_en(client, db, variante, 2025, 12)
    r = client.get("/api/reportes/resumen?anio=2025&mes=12").json()
    assert r["etiqueta"] == "Diciembre 2025"
    assert r["ventas"] == 10.0


# ------------------------------------------------- H87: cierre de ejercicio
def test_cerrar_el_ano_manda_el_resultado_a_utilidades_retenidas(client, db, variante):
    """Sin cierre, `utilidad_acumulada` mezclaba el resultado de todos los anos
    y el dueno no podia responder 'cuanto gane el ano pasado'."""
    _venta_en(client, db, variante, 2025, 6)

    r = client.post("/api/contabilidad/cerrar-ejercicio", json={"anio": 2025})
    assert r.status_code == 200
    assert r.json()["resultado"] > 0
    assert saldo(db, "3020") == r.json()["resultado"]
    assert saldo(db, "4010") == 0.0, "las cuentas de resultado quedan en cero"


def test_no_se_cierra_un_ano_dos_veces(client, db, variante):
    _venta_en(client, db, variante, 2025, 6)
    client.post("/api/contabilidad/cerrar-ejercicio", json={"anio": 2025})
    r = client.post("/api/contabilidad/cerrar-ejercicio", json={"anio": 2025})
    assert r.status_code == 409


def test_no_se_cierra_un_ano_que_no_termino(client):
    r = client.post(
        "/api/contabilidad/cerrar-ejercicio", json={"anio": datetime.date.today().year}
    )
    assert r.status_code == 400


# ------------------------------------------------- H89: activo preexistente
def test_se_puede_registrar_un_equipo_que_ya_se_tenia(client, db):
    """Los activos solo nacian de una factura: el horno comprado hace tres
    años no existia contablemente y nunca se depreciaba."""
    r = client.post(
        "/api/contabilidad/activos",
        json={
            "nombre": "Horno viejo",
            "valor": 1200,
            "vida_util_meses": 60,
            "fecha_compra": "2025-07-01T00:00:00",
        },
    )
    assert r.status_code == 200
    activo = r.json()
    assert activo["valor"] == 1200
    assert activo["meses_depreciados"] > 0, "se deprecia desde su fecha de compra"
    assert saldo(db, "1050") == 1200.0
    assert saldo(db, "3010") == 1200.0, "entra contra capital, no contra caja"
    assert saldo(db, "1010") == 0.0


# ------------------------------------------------- H108: el ticket
def test_el_ticket_trae_lo_que_el_cliente_necesita_ver(client, db, variante, cajero):
    """No habia impresion de ninguna clase en todo el repo."""
    cobrado = vender(
        client,
        variante,
        cantidad=2,
        operador_id=cajero["id"],
        descuento=1.0,
        propina=2.0,
        pagos=[{"metodo": "Efectivo Bs", "monto": 11.0, "recibido": 20.0}],
    )
    t = client.get(f"/api/pedidos/{cobrado['id']}/ticket").json()

    assert t["numero"] == cobrado["numero"]
    assert len(t["items"]) == 1
    assert t["subtotal"] == 10.0
    assert t["descuento"] == 1.0
    assert t["propina"] == 2.0
    assert t["total"] == 9.0
    assert t["a_cobrar"] == 11.0
    assert t["operador"] == "admin"
    assert t["pagos"][0]["recibido"] == 20.0
    assert t["pagos"][0]["vuelto_monto"] == 9.0


def test_el_ticket_facturado_desglosa_el_iva(client, variante):
    cobrado = vender(
        client, variante, cantidad=2, facturado=True, numero_factura="00-9"
    )
    t = client.get(f"/api/pedidos/{cobrado['id']}/ticket").json()
    assert t["facturado"] is True
    assert t["numero_factura"] == "00-9"
    assert round(t["base_imponible"] + t["iva"], 2) == t["total"]
