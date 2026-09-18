"""Tier 2: las puertas de un solo sentido.

Cada operacion que mueve los libros necesita marcha atras. El criterio en todos
los casos es el mismo que ya usaban merma y devolucion: no se borra el hecho,
se le hace un contra-asiento y queda el rastro de que hubo un error.
"""

import datetime

import pytest

from app import models


def saldo(db, codigo):
    cuenta = db.query(models.CuentaContable).filter_by(codigo=codigo).first()
    movs = db.query(models.MovimientoContable).filter_by(cuenta_id=cuenta.id).all()
    total = sum(m.debe - m.haber for m in movs)
    return round(total if cuenta.naturaleza == "deudora" else -total, 2)


def vender(client, variante, cantidad=1, **extra):
    p = client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": cantidad}], "nota": ""},
    ).json()
    cuerpo = {"metodo_pago": "Efectivo"}
    cuerpo.update(extra)
    return client.post(f"/api/pedidos/{p['id']}/cobrar", json=cuerpo).json()


# ------------------------------------------------- H96: cierre de caja
def test_el_cierre_mal_tecleado_se_puede_anular(client, db, variante):
    """Un digito de mas metia un sobrante ficticio en los libros para siempre:
    no existia borrar y volver a cerrar devolvia 409."""
    vender(client, variante, cantidad=2)  # $10
    caja_antes = saldo(db, "1010")

    cierre = client.post(
        "/api/caja/cerrar", json={"efectivo_contado": 1000.0, "nota": "dedo gordo"}
    ).json()
    assert cierre["diferencia"] == 990.0
    assert saldo(db, "1010") == 1000.0

    r = client.post(f"/api/caja/cierres/{cierre['id']}/anular", json={"motivo": "mal tecleado"})
    assert r.status_code == 200
    assert r.json()["anulado"] is True
    assert saldo(db, "1010") == caja_antes, "la caja vuelve a lo que decian las ventas"
    assert saldo(db, "6030") == 0.0, "el sobrante ficticio desaparecio del resultado"


def test_tras_anular_se_puede_cerrar_otra_vez_el_mismo_dia(client, variante):
    vender(client, variante, cantidad=2)
    primero = client.post("/api/caja/cerrar", json={"efectivo_contado": 1000.0}).json()
    assert client.post("/api/caja/cerrar", json={"efectivo_contado": 10.0}).status_code == 409

    client.post(f"/api/caja/cierres/{primero['id']}/anular", json={"motivo": "error"})
    segundo = client.post("/api/caja/cerrar", json={"efectivo_contado": 10.0})
    assert segundo.status_code == 200
    assert segundo.json()["diferencia"] == 0.0


def test_el_cierre_anulado_no_se_borra_queda_el_rastro(client, db, variante):
    vender(client, variante, cantidad=2)
    cierre = client.post("/api/caja/cerrar", json={"efectivo_contado": 1000.0}).json()
    client.post(f"/api/caja/cierres/{cierre['id']}/anular", json={"motivo": "conte mal"})

    cierres = client.get("/api/caja/cierres").json()
    anulado = next(c for c in cierres if c["id"] == cierre["id"])
    assert anulado["anulado"] is True
    assert anulado["motivo_anulacion"] == "conte mal"
    assert anulado["efectivo_contado"] == 1000.0, "queda lo que se tecleo, para poder auditarlo"


def test_no_se_anula_dos_veces_el_mismo_cierre(client, variante):
    vender(client, variante, cantidad=2)
    cierre = client.post("/api/caja/cerrar", json={"efectivo_contado": 50.0}).json()
    assert client.post(f"/api/caja/cierres/{cierre['id']}/anular", json={}).status_code == 200
    assert client.post(f"/api/caja/cierres/{cierre['id']}/anular", json={}).status_code == 409


# ------------------------------------------- H97: ajuste de inventario hacia arriba
def test_el_conteo_mal_tecleado_hacia_arriba_se_puede_revertir(client, db, insumo):
    """El faltante siempre tuvo vuelta atras (queda como merma); el sobrante no,
    aunque es el mismo dedo en el mismo formulario."""
    inventario_antes = saldo(db, "1040")
    client.post(
        f"/api/inventario/ingredientes/{insumo.id}/ajustar",
        json={"stock_real": 500.0, "motivo": "Conteo fisico"},  # queria 50
    )
    db.expire_all()
    assert insumo.stock_actual == 500.0

    sobrantes = client.get("/api/inventario/sobrantes").json()
    assert len(sobrantes) == 1
    assert sobrantes[0]["cantidad"] == 490.0
    assert sobrantes[0]["revertido"] is False

    r = client.post(f"/api/inventario/sobrantes/{sobrantes[0]['id']}/revertir")
    assert r.status_code == 200
    db.expire_all()
    assert insumo.stock_actual == 10.0
    assert saldo(db, "1040") == inventario_antes


def test_dos_sobrantes_del_mismo_insumo_no_comparten_referencia(client, db, insumo):
    """El asiento referenciaba `ingrediente_id`: dos sobrantes del mismo insumo
    apuntaban al mismo sitio y no se podian distinguir."""
    for objetivo in (20.0, 30.0):
        client.post(
            f"/api/inventario/ingredientes/{insumo.id}/ajustar",
            json={"stock_real": objetivo, "motivo": "Conteo"},
        )
    sobrantes = client.get("/api/inventario/sobrantes").json()
    assert len(sobrantes) == 2
    referencias = {
        a.referencia_id
        for a in db.query(models.AsientoContable).filter_by(origen="sobrante_inventario").all()
    }
    assert len(referencias) == 2


def test_no_se_revierte_dos_veces_el_mismo_sobrante(client, insumo):
    client.post(
        f"/api/inventario/ingredientes/{insumo.id}/ajustar",
        json={"stock_real": 50.0, "motivo": "Conteo"},
    )
    sid = client.get("/api/inventario/sobrantes").json()[0]["id"]
    assert client.post(f"/api/inventario/sobrantes/{sid}/revertir").status_code == 200
    assert client.post(f"/api/inventario/sobrantes/{sid}/revertir").status_code == 409


# ------------------------------------------------- H98: baja de activo
@pytest.fixture()
def activo(client):
    client.post(
        "/api/compras/facturas",
        json={
            "numero_factura": "A-1", "proveedor_nombre": "X", "proveedor_rif": "J123456789", "categoria": "Activos",
            "forma_pago": "Efectivo", "base_imponible": 600, "iva": 0,
            "descripcion": "Nevera", "vida_util_meses": 60, "items": [],
        },
    )
    return client.get("/api/contabilidad/activos").json()[0]


def test_el_activo_dado_de_baja_por_error_revive(client, db, activo):
    """Marcar la nevera equivocada lo sacaba de los libros para siempre."""
    equipos_antes = saldo(db, "1050")
    client.post(f"/api/contabilidad/activos/{activo['id']}/baja", json={"motivo": "se daño"})
    assert saldo(db, "1050") == 0.0

    r = client.post(f"/api/contabilidad/activos/{activo['id']}/reactivar")
    assert r.status_code == 200
    assert r.json()["dado_de_baja"] is False
    assert r.json()["motivo_baja"] == ""
    assert saldo(db, "1050") == equipos_antes


def test_reactivar_conserva_la_depreciacion_que_llevaba(client, db, activo):
    """No vuelve como un equipo nuevo: vuelve como estaba."""
    acumulada_antes = client.get("/api/contabilidad/activos").json()[0]["depreciacion_acumulada"]
    client.post(f"/api/contabilidad/activos/{activo['id']}/baja", json={"motivo": "error"})
    client.post(f"/api/contabilidad/activos/{activo['id']}/reactivar")

    vivo = client.get("/api/contabilidad/activos").json()[0]
    assert vivo["depreciacion_acumulada"] == acumulada_antes
    assert vivo["valor"] == 600.0


def test_no_se_reactiva_un_activo_que_esta_vivo(client, activo):
    assert client.post(f"/api/contabilidad/activos/{activo['id']}/reactivar").status_code == 409


# ------------------------------------------------- H99: declaracion de IVA
def _venta_en(client, db, variante, anio, mes, numero):
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


def test_la_declaracion_mal_hecha_se_puede_anular(client, db, variante):
    """No existia borrar y re-declarar el mismo mes devolvia 409."""
    hoy = datetime.date.today()
    mes_pasado = (hoy.replace(day=1) - datetime.timedelta(days=1))
    _venta_en(client, db, variante, mes_pasado.year, mes_pasado.month, "00-1")

    dec = client.post(
        "/api/impuestos/declaraciones", json={"anio": mes_pasado.year, "mes": mes_pasado.month}
    ).json()
    assert dec["iva_debito"] > 0
    debito_declarado = saldo(db, "2030")

    r = client.post(f"/api/impuestos/declaraciones/{dec['id']}/anular")
    assert r.status_code == 200
    assert saldo(db, "2030") != debito_declarado, "el IVA volvio a su cuenta"

    # y el periodo vuelve a estar disponible
    pendientes = client.get("/api/impuestos/periodos-pendientes").json()
    assert any(p["mes"] == mes_pasado.month and p["anio"] == mes_pasado.year for p in pendientes)
    otra = client.post(
        "/api/impuestos/declaraciones", json={"anio": mes_pasado.year, "mes": mes_pasado.month}
    )
    assert otra.status_code == 200


def test_no_se_anula_un_mes_si_hay_meses_posteriores_declarados(client, db, variante):
    """El credito fiscal se arrastra en cadena: anular uno del medio dejaria
    mal el arrastre de todos los siguientes."""
    hoy = datetime.date.today()
    fin_mes_pasado = hoy.replace(day=1) - datetime.timedelta(days=1)
    fin_mes_anterior = fin_mes_pasado.replace(day=1) - datetime.timedelta(days=1)

    _venta_en(client, db, variante, fin_mes_anterior.year, fin_mes_anterior.month, "00-1")
    _venta_en(client, db, variante, fin_mes_pasado.year, fin_mes_pasado.month, "00-2")

    viejo = client.post(
        "/api/impuestos/declaraciones",
        json={"anio": fin_mes_anterior.year, "mes": fin_mes_anterior.month},
    ).json()
    client.post(
        "/api/impuestos/declaraciones",
        json={"anio": fin_mes_pasado.year, "mes": fin_mes_pasado.month},
    )

    r = client.post(f"/api/impuestos/declaraciones/{viejo['id']}/anular")
    assert r.status_code == 409
    assert "arrastra" in r.json()["detail"]


def test_anular_una_declaracion_pagada_devuelve_la_plata(client, db, variante):
    hoy = datetime.date.today()
    mes_pasado = hoy.replace(day=1) - datetime.timedelta(days=1)
    _venta_en(client, db, variante, mes_pasado.year, mes_pasado.month, "00-1")

    dec = client.post(
        "/api/impuestos/declaraciones", json={"anio": mes_pasado.year, "mes": mes_pasado.month}
    ).json()
    banco_antes = saldo(db, "1020")
    client.post(f"/api/impuestos/declaraciones/{dec['id']}/pagar", json={"forma_pago": "Banco"})
    assert saldo(db, "1020") < banco_antes

    client.post(f"/api/impuestos/declaraciones/{dec['id']}/anular")
    assert saldo(db, "1020") == banco_antes
