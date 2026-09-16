"""Auditoria de la contabilidad con casos practicos de un dia real del local.

Cinco sombreros, y cada prueba dice cual lleva puesto:

  CONTADOR   partida doble: cada asiento cuadra, el balance de comprobacion
             suma igual a los dos lados, el balance general cierra, y ningun
             activo real queda en negativo.
  AUDITOR    lo hecho no se borra: un ejercicio cerrado es inamovible y todo
             lo que se deshace deja rastro.
  SENIAT     el IVA se calcula sobre lo cobrado, los libros fiscales cuadran
             con los asientos y un periodo declarado no se reescribe.
  CAJERO     lo que dice el sistema que hay en cada gaveta es lo que hay:
             bolivares y divisas por separado, vuelto, propinas, fiado.
  DUEÑO      los reportes responden lo que el dueño pregunta, con las fechas
             que el dueño pregunta, y no le cambian el pasado.

La primera prueba es la mas importante: un dia entero de operaciones --ventas
de todos los tipos, devolucion, anulacion, compras, gastos, retiro, propinas,
fiado y cierre-- y al final los libros tienen que estar cuadrados y el
inventario contable tiene que valer lo mismo que el fisico. Todo lo demas son
los huecos concretos que aparecieron al armar ese dia.
"""
from __future__ import annotations

import datetime

import pytest

from app import contabilidad, models
from tests.conftest import saldo

LOCAL_TOLERANCIA = 0.02


# ── ayudantes ────────────────────────────────────────────────────────────────

def comanda(client, variante, cantidad=1):
    r = client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": cantidad}], "nota": ""},
    )
    assert r.status_code == 200, r.text
    return r.json()


def cobrar(client, pedido_id, **cuerpo):
    cuerpo.setdefault("metodo_pago", "Efectivo Bs")
    r = client.post(f"/api/pedidos/{pedido_id}/cobrar", json=cuerpo)
    assert r.status_code == 200, r.text
    return r.json()


def vender(client, variante, cantidad=1, **cuerpo):
    return cobrar(client, comanda(client, variante, cantidad)["id"], **cuerpo)


def gaveta(client, codigo):
    resumen = client.get("/api/caja/resumen").json()
    return next(g for g in resumen["gavetas"] if g["codigo"] == codigo)


def inventario_fisico(db) -> float:
    return round(
        sum((i.stock_actual or 0) * (i.costo_unitario or 0) for i in db.query(models.Ingrediente).all()),
        2,
    )


def libros_cuadrados(client, db):
    """Lo que un contador revisa antes de firmar. Falla con el motivo."""
    filas = client.get("/api/contabilidad/balance-comprobacion").json()
    debe = round(sum(f["debe"] for f in filas), 2)
    haber = round(sum(f["haber"] for f in filas), 2)
    assert abs(debe - haber) < LOCAL_TOLERANCIA, f"balance de comprobacion: debe {debe} != haber {haber}"

    bg = client.get("/api/contabilidad/balance-general").json()
    assert bg["cuadra"], bg
    for f in bg["activos"]:
        if f["codigo"] in contabilidad.CUENTAS_CONTRA:
            continue
        assert f["saldo"] >= -LOCAL_TOLERANCIA, f"activo {f['codigo']} {f['nombre']} en negativo: {f['saldo']}"
    for f in bg["pasivos"]:
        assert f["saldo"] >= -LOCAL_TOLERANCIA, f"pasivo {f['codigo']} {f['nombre']} en negativo: {f['saldo']}"

    contable = saldo(db, "1040")
    fisico = inventario_fisico(db)
    assert abs(contable - fisico) < LOCAL_TOLERANCIA, f"inventario: libros {contable} vs fisico {fisico}"

    # Cada asiento cuadra por si solo (no solo la suma de todos).
    for a in db.query(models.AsientoContable).all():
        d = round(sum(m.debe for m in a.movimientos), 2)
        h = round(sum(m.haber for m in a.movimientos), 2)
        assert abs(d - h) < 0.011, f"asiento #{a.id} '{a.descripcion}' descuadrado: {d} vs {h}"


@pytest.fixture()
def libros(db, insumo, variante):
    """Los libros arrancan como en un local real: con el inventario reconocido
    y con plata en las gavetas y en el banco (el aporte inicial del dueño).
    Sin eso, la primera compra en efectivo dejaria la caja en negativo, y el
    negativo seria de la prueba, no del sistema."""
    contabilidad.asiento_de_apertura(db)
    contabilidad.crear_asiento(
        db,
        "Aporte inicial del dueño: caja chica y banco",
        [("1010", 100.0, 0.0), ("1011", 20.0, 0.0), ("1020", 100.0, 0.0), ("3010", 0.0, 220.0)],
        origen="manual",
    )
    db.commit()
    return db


def _a_2025(db, gasto_id: int, cuando=datetime.datetime(2025, 6, 15, 12, 0)):
    """Mueve un gasto y su asiento al año pasado, para poder cerrarlo."""
    gasto = db.query(models.Gasto).filter_by(id=gasto_id).first()
    gasto.fecha = cuando
    for a in db.query(models.AsientoContable).filter_by(origen="gasto", referencia_id=gasto_id).all():
        a.fecha = cuando
    db.commit()


# ══════════════════════════════════════════════════════════════════════════════
# CONTADOR: un dia entero y los libros cuadran
# ══════════════════════════════════════════════════════════════════════════════

def test_un_dia_completo_deja_los_libros_cuadrados(client, libros, variante, insumo):
    """Ventas de todos los tipos, una devolucion, una anulacion, compras con y
    sin factura, gasto, retiro, propinas, fiado y cierre con diferencias en
    las dos gavetas. Es el dia mas enredado que puede tener el local."""
    db = libros

    # Venta A: billete grande, vuelto en la misma gaveta.
    vender(client, variante, 2, pagos=[{"metodo": "Efectivo Bs", "monto": 10.0, "recibido": 20.0}])
    # Venta B: facturada y mixta, pago en divisas con vuelto en bolivares.
    vender(client, variante, 1, facturado=True, numero_factura="00-1",
           pagos=[{"metodo": "Efectivo $", "monto": 3.0, "recibido": 5.0, "vuelto_metodo": "Efectivo Bs"},
                  {"metodo": "Pago movil", "monto": 2.0}])
    # Venta C: facturada, con descuento y propina.
    vender(client, variante, 3, facturado=True, numero_factura="00-2", descuento=1.0,
           motivo_descuento="cliente frecuente", propina=2.0,
           pagos=[{"metodo": "Efectivo Bs", "monto": 16.0}])
    # Venta D: fiada y luego cobrada por pago movil.
    fiada = vender(client, variante, 1, metodo_pago="Fiado", cliente="Pedro")
    r = client.post(f"/api/caja/fiado/{fiada['id']}/cobrar", json={"metodo_pago": "Pago movil"})
    assert r.status_code == 200, r.text
    # Venta E: con propina, y el cliente devuelve la comida (se puede revender).
    e = vender(client, variante, 1, propina=1.0, pagos=[{"metodo": "Efectivo Bs", "monto": 6.0}])
    r = client.post(f"/api/pedidos/{e['id']}/devolver", json={"recuperable": True, "motivo": "no le gusto"})
    assert r.status_code == 200, r.text
    # Comanda F: preparada y anulada -> merma.
    f = comanda(client, variante, 1)
    client.post(f"/api/pedidos/{f['id']}/marcar-listo")
    assert client.post(f"/api/pedidos/{f['id']}/anular", json={"comida_preparada": True}).status_code == 200

    # Compras: una suelta en efectivo y una factura a credito que luego se paga.
    assert client.post(f"/api/inventario/ingredientes/{insumo.id}/comprar",
                       json={"cantidad": 5, "costo_total": 45}).status_code == 200
    fac = client.post("/api/compras/facturas", json={
        "numero_factura": "F-1", "proveedor_nombre": "Carnes SA", "categoria": "Insumos",
        "forma_pago": "Credito", "iva": 2.88,
        "items": [{"ingrediente_id": insumo.id, "cantidad": 2, "costo_unitario": 9.0}],
    })
    assert fac.status_code == 200, fac.text
    assert client.post(f"/api/compras/facturas/{fac.json()['id']}/pagar", json={"forma_pago": "Banco"}).status_code == 200

    # Gasto por banco, retiro del dueño, entrega de propinas.
    assert client.post("/api/caja/gastos", json={"descripcion": "Gas", "categoria": "Servicios",
                                                "monto": 3, "metodo_pago": "Banco"}).status_code == 200
    assert client.post("/api/caja/retiros", json={"monto": 4, "metodo_pago": "Efectivo"}).status_code == 200
    assert client.post("/api/caja/propinas/entregar", json={"monto": 2, "metodo_pago": "Efectivo Bs"}).status_code == 200

    # Cierre: falta $1 en bolivares y sobran $0.50 en divisas.
    bs, usd = gaveta(client, "1010"), gaveta(client, "1011")
    cierre = client.post("/api/caja/cerrar", json={
        "efectivo_contado": round(bs["esperado"] - 1.0, 2),
        "divisas_contado": round(usd["esperado"] + 0.5, 2),
    })
    assert cierre.status_code == 200, cierre.text
    assert cierre.json()["diferencia"] == -1.0
    assert cierre.json()["divisas_diferencia"] == 0.5

    libros_cuadrados(client, db)

    # Y las gavetas dicen lo que los libros dicen (CAJERO).
    assert gaveta(client, "1010")["esperado"] == saldo(db, "1010")
    assert gaveta(client, "1011")["esperado"] == saldo(db, "1011")
    # Nadie debe nada: el fiado se cobro y las propinas se entregaron (E se
    # devolvio con su propina).
    assert saldo(db, "1015") == 0.0
    assert saldo(db, "2040") == 0.0
    # Lo que el fisco tiene que ver: IVA debito de las dos facturadas.
    resumen = client.get("/api/impuestos/resumen?periodo=mes").json()
    assert resumen["iva_debito"] == round(saldo(db, "2030"), 2)
    assert resumen["iva_credito"] == 2.88


# ══════════════════════════════════════════════════════════════════════════════
# CAJERO / CONTADOR: devoluciones
# ══════════════════════════════════════════════════════════════════════════════

def test_devolver_una_venta_con_propina_no_revienta_y_cancela_la_propina(client, libros, variante):
    """La plata vuelve por donde entro, incluida la propina que el cliente
    habia dejado: si no, el asiento no cuadra (500) o el negocio se queda
    debiendole al empleado una propina que ya se devolvio."""
    db = libros
    p = vender(client, variante, 1, propina=1.0, pagos=[{"metodo": "Efectivo Bs", "monto": 6.0}])
    assert saldo(db, "2040") == 1.0
    caja_antes = saldo(db, "1010")

    r = client.post(f"/api/pedidos/{p['id']}/devolver", json={"recuperable": True})
    assert r.status_code == 200, r.text

    assert saldo(db, "2040") == 0.0, "la propina devuelta no puede seguir como deuda con el empleado"
    assert round(caja_antes - saldo(db, "1010"), 2) == 6.0, "salieron los $6 que habian entrado"
    libros_cuadrados(client, db)


def test_devolver_una_venta_con_descuento_limpia_tambien_el_descuento(client, libros, variante):
    """Se devuelve una venta con rebaja: 'Descuentos concedidos' no puede
    seguir diciendo que se regalo algo en una venta que no existio."""
    db = libros
    p = vender(client, variante, 2, descuento=2.0, pagos=[{"metodo": "Efectivo Bs", "monto": 8.0}])
    assert saldo(db, "4020") == -2.0  # contra-cuenta: negativa mientras hay descuento
    client.post(f"/api/pedidos/{p['id']}/devolver", json={"recuperable": True})
    assert saldo(db, "4020") == 0.0
    assert saldo(db, "4010") == 0.0
    libros_cuadrados(client, db)


def test_devolver_una_venta_facturada_con_descuento_y_propina(client, libros, variante):
    db = libros
    banco_antes = saldo(db, "1020")
    p = vender(client, variante, 2, facturado=True, numero_factura="00-9", descuento=1.0, propina=0.5,
               pagos=[{"metodo": "Pago movil", "monto": 9.5}])
    r = client.post(f"/api/pedidos/{p['id']}/devolver", json={"recuperable": False, "nota_credito": "NC-1"})
    assert r.status_code == 200, r.text
    for cuenta in ("4010", "4020", "2030", "2040"):
        assert saldo(db, cuenta) == 0.0, cuenta
    assert saldo(db, "1020") == banco_antes
    # La comida se boto: el costo paso a merma, no volvio al inventario.
    assert saldo(db, "6020") > 0
    libros_cuadrados(client, db)


def test_devolver_un_fiado_ya_cobrado_devuelve_plata_y_no_una_deuda(client, libros, variante):
    """Pedro fio, pago por pago movil, y despues trajo la comida. La plata se
    le devuelve; lo que NO puede pasar es que 'Cuentas por cobrar' quede en
    negativo como si Pedro ahora nos debiera menos que nada."""
    db = libros
    banco_antes = saldo(db, "1020")
    p = vender(client, variante, 1, metodo_pago="Fiado", cliente="Pedro")
    client.post(f"/api/caja/fiado/{p['id']}/cobrar", json={"metodo_pago": "Pago movil"})
    assert saldo(db, "1015") == 0.0 and saldo(db, "1020") == banco_antes + 5.0

    r = client.post(f"/api/pedidos/{p['id']}/devolver", json={"recuperable": True})
    assert r.status_code == 200, r.text
    assert saldo(db, "1015") == 0.0, "la cuenta por cobrar no puede quedar en negativo"
    assert saldo(db, "1020") == banco_antes, "la plata salio de donde habia entrado al cobrar el fiado"
    libros_cuadrados(client, db)


def test_devolver_un_fiado_pendiente_cancela_la_deuda(client, libros, variante):
    db = libros
    p = vender(client, variante, 1, metodo_pago="Fiado", cliente="Ana")
    assert saldo(db, "1015") == 5.0
    assert client.post(f"/api/pedidos/{p['id']}/devolver", json={"recuperable": True}).status_code == 200
    assert saldo(db, "1015") == 0.0
    assert client.get("/api/caja/fiado").json() == []
    libros_cuadrados(client, db)


# ══════════════════════════════════════════════════════════════════════════════
# CAJERO: las dos gavetas
# ══════════════════════════════════════════════════════════════════════════════

def test_la_diferencia_de_divisas_del_cierre_tambien_va_a_los_libros(client, libros, variante):
    """Se contaban las dos gavetas pero solo la de bolivares se conciliaba:
    un faltante en dolares quedaba anotado en el cierre y la cuenta 1011
    seguia diciendo que la plata estaba."""
    db = libros
    vender(client, variante, 2, pagos=[{"metodo": "Efectivo $", "monto": 10.0}])
    assert saldo(db, "1011") == 30.0  # 20 del aporte inicial + 10 de la venta

    bs = gaveta(client, "1010")["esperado"]
    cierre = client.post("/api/caja/cerrar", json={"efectivo_contado": bs, "divisas_contado": 28.0}).json()
    assert cierre["divisas_diferencia"] == -2.0
    assert saldo(db, "1011") == 28.0, "los libros tienen que decir lo que hay en la gaveta"
    assert saldo(db, "6030") == 2.0
    libros_cuadrados(client, db)

    # Y anular el cierre lo devuelve, para las dos gavetas.
    client.post(f"/api/caja/cierres/{cierre['id']}/anular", json={"motivo": "conte mal"})
    assert saldo(db, "1011") == 30.0
    assert saldo(db, "6030") == 0.0


def test_las_divisas_tambien_pagan(client, libros, variante, insumo):
    """En Venezuela al proveedor se le paga con los verdes de la gaveta. Si el
    sistema solo sabe sacar bolivares o banco, la gaveta de dolares crece sin
    parar y la de bolivares muestra faltantes que no existen."""
    db = libros
    vender(client, variante, 4, pagos=[{"metodo": "Efectivo $", "monto": 20.0}])
    bs_antes = saldo(db, "1010")

    r = client.post("/api/caja/gastos", json={"descripcion": "Hielo", "categoria": "Insumos",
                                              "monto": 2, "metodo_pago": "Efectivo $"})
    assert r.status_code == 200, r.text
    r = client.post("/api/caja/retiros", json={"monto": 3, "metodo_pago": "Efectivo $"})
    assert r.status_code == 200, r.text
    fac = client.post("/api/compras/facturas", json={
        "numero_factura": "F-2", "proveedor_nombre": "Carnes SA", "categoria": "Insumos",
        "forma_pago": "Credito", "iva": 0,
        "items": [{"ingrediente_id": insumo.id, "cantidad": 1, "costo_unitario": 4.0}],
    }).json()
    r = client.post(f"/api/compras/facturas/{fac['id']}/pagar", json={"forma_pago": "Efectivo $"})
    assert r.status_code == 200, r.text
    r = client.post(f"/api/inventario/ingredientes/{insumo.id}/comprar",
                    json={"cantidad": 1, "costo_total": 5, "metodo_pago": "Efectivo $"})
    assert r.status_code == 200, r.text

    assert saldo(db, "1011") == 20 + 20 - 2 - 3 - 4 - 5  # aporte + venta - lo que salio
    assert saldo(db, "1010") == bs_antes, "los bolivares no se tocaron"
    assert gaveta(client, "1011")["esperado"] == saldo(db, "1011")
    libros_cuadrados(client, db)


def test_la_compra_suelta_puede_salir_del_banco(client, libros, insumo):
    """La compra sin factura salia SIEMPRE de la gaveta de bolivares, aunque se
    hubiera pagado por transferencia: el cierre del dia mostraba un faltante."""
    db = libros
    bs_antes = saldo(db, "1010")
    r = client.post(f"/api/inventario/ingredientes/{insumo.id}/comprar",
                    json={"cantidad": 2, "costo_total": 16, "metodo_pago": "Banco"})
    assert r.status_code == 200, r.text
    assert saldo(db, "1010") == bs_antes
    assert saldo(db, "1020") == 100.0 - 16.0
    libros_cuadrados(client, db)


def test_el_resumen_de_caja_no_cuenta_como_venta_lo_devuelto(client, libros, variante):
    db = libros
    vender(client, variante, 1)
    p = vender(client, variante, 1)
    client.post(f"/api/pedidos/{p['id']}/devolver", json={"recuperable": True})
    resumen = client.get("/api/caja/resumen").json()
    assert resumen["total_ventas"] == 5.0, "la venta devuelta no es una venta"
    assert resumen["cantidad_pedidos"] == 1
    # Pero la gaveta si refleja que la plata entro y salio.
    assert resumen["efectivo_esperado"] == saldo(db, "1010")


# ══════════════════════════════════════════════════════════════════════════════
# AUDITOR: un ejercicio cerrado es inamovible
# ══════════════════════════════════════════════════════════════════════════════

def test_no_se_borra_un_gasto_de_un_ejercicio_cerrado(client, libros):
    """Borrar un gasto del año pasado cambiaria el resultado que ya se cerro y
    se llevo a Utilidades retenidas, sin que ningun asiento lo cuente."""
    db = libros
    g = client.post("/api/caja/gastos", json={"descripcion": "Luz 2025", "categoria": "Servicios",
                                              "monto": 30, "metodo_pago": "Banco"}).json()
    _a_2025(db, g["id"])
    r = client.post("/api/contabilidad/cerrar-ejercicio", json={"anio": 2025})
    assert r.status_code == 200, r.text
    retenidas = saldo(db, "3020")

    r = client.delete(f"/api/caja/gastos/{g['id']}")
    assert r.status_code == 409, "un gasto de un año cerrado no se puede borrar"
    assert saldo(db, "3020") == retenidas
    assert "2025" in r.json()["detail"]


def test_lo_que_se_asienta_con_fecha_de_un_año_cerrado_cae_en_el_abierto(client, libros, insumo):
    """Cargar hoy una factura con fecha del año pasado (o la depreciacion
    atrasada de un equipo) no puede reescribir un ejercicio ya cerrado. Va al
    primer dia del ejercicio abierto, y el asiento dice de que fecha era."""
    db = libros
    g = client.post("/api/caja/gastos", json={"descripcion": "Luz 2025", "categoria": "Servicios",
                                              "monto": 30, "metodo_pago": "Banco"}).json()
    _a_2025(db, g["id"])
    client.post("/api/contabilidad/cerrar-ejercicio", json={"anio": 2025})
    resultado_2025 = client.get("/api/contabilidad/estado-resultados?anio=2025&mes=6").json()["utilidad_neta"]

    fac = client.post("/api/compras/facturas", json={
        "numero_factura": "F-viejo", "proveedor_nombre": "Gas SA", "categoria": "Servicios",
        "forma_pago": "Banco", "iva": 0, "base_imponible": 12.0, "fecha": "2025-05-10T10:00:00",
    })
    assert fac.status_code == 200, fac.text
    asiento = db.query(models.AsientoContable).filter_by(origen="factura_compra",
                                                         referencia_id=fac.json()["id"]).first()
    assert asiento.fecha >= datetime.datetime(2026, 1, 1), asiento.fecha
    assert "2025-05-10" in asiento.descripcion

    # Junio de 2025 sigue diciendo lo mismo que cuando se cerro.
    assert client.get("/api/contabilidad/estado-resultados?anio=2025&mes=6").json()["utilidad_neta"] == resultado_2025
    libros_cuadrados(client, db)


def test_borrar_la_factura_de_un_activo_no_deja_el_equipo_depreciandose(client, libros):
    """La factura de categoria Activos crea el bien. Borrarla borraba el
    asiento y dejaba la nevera viva, depreciandose contra nada."""
    db = libros
    fac = client.post("/api/compras/facturas", json={
        "numero_factura": "F-nev", "proveedor_nombre": "Frio SA", "categoria": "Activos",
        "forma_pago": "Banco", "iva": 0, "base_imponible": 600.0, "descripcion": "Nevera",
        "vida_util_meses": 60,
    }).json()
    assert db.query(models.ActivoFijo).filter_by(factura_id=fac["id"]).count() == 1
    r = client.delete(f"/api/compras/facturas/{fac['id']}")
    assert r.status_code == 200, r.text
    assert db.query(models.ActivoFijo).filter_by(factura_id=fac["id"]).count() == 0
    assert saldo(db, "1050") == 0.0
    libros_cuadrados(client, db)


# ══════════════════════════════════════════════════════════════════════════════
# DUEÑO: los reportes responden con las fechas que el dueño pregunta
# ══════════════════════════════════════════════════════════════════════════════

def test_el_estado_de_resultados_de_un_mes_pasado(client, libros):
    """'Cuanto gane en junio' no se podia responder: el estado de resultados
    solo sabia dia, semana y mes en curso, aunque Reportes y los libros
    fiscales ya aceptaban año y mes."""
    db = libros
    g = client.post("/api/caja/gastos", json={"descripcion": "Luz", "categoria": "Servicios",
                                              "monto": 30, "metodo_pago": "Banco"}).json()
    _a_2025(db, g["id"])
    junio = client.get("/api/contabilidad/estado-resultados?anio=2025&mes=6").json()
    assert junio["etiqueta"] == "Junio 2025"
    assert junio["gastos"] == 30.0
    assert junio["utilidad_neta"] == -30.0
    actual = client.get("/api/contabilidad/estado-resultados?periodo=mes").json()
    assert actual["gastos"] == 0.0


def test_reportes_libros_fiscales_y_estado_de_resultados_cuentan_la_misma_venta(client, libros, variante):
    """Tres pantallas, un solo numero."""
    db = libros
    vender(client, variante, 2, facturado=True, numero_factura="00-3", descuento=1.0,
           pagos=[{"metodo": "Efectivo Bs", "monto": 9.0}])
    r = client.get("/api/reportes/resumen?periodo=mes").json()
    e = client.get("/api/contabilidad/estado-resultados?periodo=mes").json()
    v = client.get("/api/impuestos/libro-ventas?periodo=mes").json()
    assert r["ingresos_netos"] == e["ingresos"]
    assert r["ganancia_neta"] == e["utilidad_neta"]
    # El libro de ventas lleva lo cobrado con su IVA adentro; los libros
    # contables, la base sin IVA y neta de descuento.
    assert v["total_general"] == 9.0
    assert round(v["total_base"], 2) == round(e["ingresos"], 2)
    assert round(v["total_iva"], 2) == saldo(db, "2030")
