"""Cortesias: el cafe que se le regala al cliente.

No se cobra (precio 0), pero la mercancia salio igual: descuenta inventario
como cualquier renglon y su costo va a "Cortesias a clientes" (6035), no a
costo de ventas. Asi la caja cierra --no entro plata que no entro-- y el
margen del producto no se ensucia con lo regalado.
"""
from app import models

from tests.test_reportes_graficos import cobrar, iso


def test_la_cortesia_no_se_cobra_pero_si_descuenta_inventario(client, db, insumo, variante):
    stock_antes = insumo.stock_actual
    p = client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": 1, "cortesia": True}], "nota": ""},
    ).json()
    assert p["total"] == 0
    item = p["items"][0]
    assert item["cortesia"] is True
    assert item["precio_unitario"] == 0
    assert item["precio_lista"] == 5.0
    db.refresh(insumo)
    assert insumo.stock_actual < stock_antes


def test_un_cafe_cobrado_y_uno_regalado_son_dos_renglones(client, variante):
    p = client.post(
        "/api/pedidos",
        json={
            "items": [
                {"variante_id": variante.id, "cantidad": 2},
                {"variante_id": variante.id, "cantidad": 1, "cortesia": True},
            ],
            "nota": "",
        },
    ).json()
    assert p["total"] == 10.0
    assert sorted((i["cantidad"], i["cortesia"]) for i in p["items"]) == [(1, True), (2, False)]


def test_al_cobrar_el_costo_regalado_va_a_cortesias_y_no_a_costo_de_ventas(client, db, variante):
    p = client.post(
        "/api/pedidos",
        json={
            "items": [
                {"variante_id": variante.id, "cantidad": 1},
                {"variante_id": variante.id, "cantidad": 1, "cortesia": True},
            ],
            "nota": "",
        },
    ).json()
    cobrar(client, p["id"])

    asiento = (
        db.query(models.AsientoContable)
        .filter(models.AsientoContable.origen == "venta", models.AsientoContable.referencia_id == p["id"])
        .one()
    )
    por_cuenta = {}
    for mv in asiento.movimientos:
        cuenta = db.get(models.CuentaContable, mv.cuenta_id)
        por_cuenta[cuenta.codigo] = por_cuenta.get(cuenta.codigo, 0) + round(mv.debe - mv.haber, 2)
    # Un renglon a costo de ventas, el otro a cortesias, los dos contra inventario.
    costo_unitario = p["items"][0]["precio_unitario"] and db.get(models.PedidoItem, p["items"][0]["id"]).costo_unitario
    assert costo_unitario > 0
    assert round(por_cuenta["5010"], 2) == round(costo_unitario, 2)
    assert round(por_cuenta["6035"], 2) == round(costo_unitario, 2)
    assert round(por_cuenta["1040"], 2) == round(-2 * costo_unitario, 2)
    # Y la venta es solo lo cobrado.
    assert round(por_cuenta["4010"], 2) == -5.0


def test_una_comanda_regalada_entera_se_cierra_sin_pagos(client, db, variante):
    p = client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": 1, "cortesia": True}], "nota": ""},
    ).json()
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo $"})
    assert r.status_code == 200, r.text
    cerrado = r.json()
    assert cerrado["estado"] == "pagado"
    assert cerrado["total"] == 0
    assert cerrado["pagos"] == []
    assert cerrado["metodo_pago"] == "Cortesía"
    # La caja no se entera: ninguna forma de pago recibio plata.
    resumen = client.get("/api/caja/resumen").json()
    assert all(l["ventas"] == 0 for l in resumen["desglose"])


def test_lo_regalado_no_entra_al_ranking_de_productos_pero_si_a_perdidas(client, variante):
    p = client.post(
        "/api/pedidos",
        json={
            "items": [
                {"variante_id": variante.id, "cantidad": 1},
                {"variante_id": variante.id, "cantidad": 2, "cortesia": True},
            ],
            "nota": "",
        },
    ).json()
    cobrar(client, p["id"])

    resumen = client.get(f"/api/reportes/resumen?desde={iso(0)}&hasta={iso(0)}").json()
    assert resumen["ventas"] == 5.0
    top = resumen["top_productos"][0]
    assert top["unidades"] == 1
    assert top["ingresos"] == 5.0

    perdidas = client.get(f"/api/reportes/perdidas?desde={iso(0)}&hasta={iso(0)}").json()
    assert perdidas["cortesias"] == 2
    assert perdidas["valor_cortesias"] == 10.0
    assert perdidas["costo_cortesias"] > 0


def test_editar_para_regalar_un_renglon_devuelve_la_diferencia(client, db, variante):
    p = client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": 2}], "nota": ""},
    ).json()
    cobrar(client, p["id"])
    r = client.post(f"/api/pedidos/{p['id']}/edicion")
    assert r.status_code == 200, r.text
    r = client.put(
        f"/api/pedidos/{p['id']}",
        json={
            "items": [
                {"variante_id": variante.id, "cantidad": 1},
                {"variante_id": variante.id, "cantidad": 1, "cortesia": True},
            ],
            "pagos": [{"metodo": "Efectivo $", "monto": 5.0}],
        },
    )
    assert r.status_code == 200, r.text
    editado = r.json()
    assert editado["total"] == 5.0
    assert any(i["cortesia"] for i in editado["items"])
    assert "cortesía" in editado["ediciones"][-1]["detalle"]

    ajuste = (
        db.query(models.AsientoContable)
        .filter(models.AsientoContable.origen == "edicion_pedido", models.AsientoContable.referencia_id == p["id"])
        .one()
    )
    por_cuenta = {}
    for mv in ajuste.movimientos:
        cuenta = db.get(models.CuentaContable, mv.cuenta_id)
        por_cuenta[cuenta.codigo] = por_cuenta.get(cuenta.codigo, 0) + round(mv.debe - mv.haber, 2)
    # El costo del renglon regalado se mueve de costo de ventas a cortesias; el
    # inventario no cambia porque la comida es la misma.
    assert por_cuenta["5010"] < 0
    assert round(por_cuenta["6035"], 2) == round(-por_cuenta["5010"], 2)
    assert "1040" not in por_cuenta or round(por_cuenta["1040"], 2) == 0
    # Y al cliente se le devolvieron $5.
    assert round(por_cuenta["4010"], 2) == 5.0
