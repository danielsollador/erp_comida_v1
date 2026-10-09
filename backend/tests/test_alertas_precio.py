"""Alertas de precio: que llego mas caro en una factura y que le hace al menu.

Se generan despues de guardar la factura por el camino de siempre, y quedan
para quien no estaba cuando se cargo. La comparacion es primero contra el
mismo proveedor: el historial de un insumo puede tener precios en unidades
distintas, y el mismo proveedor casi siempre vende la misma presentacion.
"""
from app import models

MONTANA = ("Distribuidora La Montaña", "J401234567")
ANDES = ("Lácteos Andes", "J501234567")


def comprar(client, insumo, costo, proveedor=MONTANA, numero=None):
    nombre, rif = proveedor
    comprar.n = getattr(comprar, "n", 0) + 1
    r = client.post("/api/compras/facturas", json={
        "numero_factura": numero or f"F-{comprar.n}", "proveedor_nombre": nombre, "proveedor_rif": rif,
        "categoria": "Insumos", "forma_pago": "Efectivo",
        "items": [{"ingrediente_id": insumo.id, "cantidad": 1, "costo_unitario": costo}],
    })
    assert r.status_code == 200, r.text
    return r.json()["id"]


def alertas(client, factura_id):
    r = client.post(f"/api/compras/facturas/{factura_id}/alertas")
    assert r.status_code == 200, r.text
    return r.json()


def test_la_primera_compra_no_tiene_contra_que_compararse(client, insumo):
    assert alertas(client, comprar(client, insumo, 10.0)) == []


def test_una_subida_del_mismo_proveedor(client, insumo):
    comprar(client, insumo, 10.0)
    [a] = alertas(client, comprar(client, insumo, 12.0))
    assert a["tipo"] == "subida" and a["base"] == "proveedor"
    assert a["costo_anterior"] == 10.0 and a["costo_nuevo"] == 12.0
    assert a["variacion_pct"] == 20.0
    assert a["ingrediente_nombre"] == "Carne molida" and a["proveedor_nombre"] == MONTANA[0]
    assert a["visto"] is False


def test_por_debajo_del_quince_por_ciento_es_ruido(client, insumo):
    comprar(client, insumo, 10.0)
    assert alertas(client, comprar(client, insumo, 11.4)) == []


def test_una_bajada_no_es_alerta(client, insumo):
    comprar(client, insumo, 10.0)
    assert alertas(client, comprar(client, insumo, 7.0)) == []


def test_se_compara_contra_el_mismo_proveedor_no_contra_la_mezcla(client, insumo):
    """Otro proveedor lo vende en otra presentacion (a $4 la unidad chica).
    Contra la mediana de todo, $11 pareceria una subida enorme; contra lo que
    este mismo proveedor cobraba ($10), es un 10%: ruido."""
    comprar(client, insumo, 4.0, proveedor=ANDES)
    comprar(client, insumo, 4.0, proveedor=ANDES)
    comprar(client, insumo, 10.0)
    assert alertas(client, comprar(client, insumo, 11.0)) == []


def test_proveedor_nuevo_contra_las_ultimas_compras(client, insumo):
    for costo in (10.0, 10.0, 11.0):
        comprar(client, insumo, costo)
    [a] = alertas(client, comprar(client, insumo, 13.0, proveedor=ANDES))
    assert a["base"] == "compras" and a["costo_anterior"] == 10.0


def test_otro_proveedor_lo_vendio_mas_barato(client, insumo):
    comprar(client, insumo, 9.0, proveedor=ANDES)
    comprar(client, insumo, 10.0)
    [a] = alertas(client, comprar(client, insumo, 13.0))
    assert a["alternativa_proveedor"] == ANDES[0] and a["alternativa_costo"] == 9.0


def test_un_salto_de_otra_unidad_no_se_cuenta_como_subida(client, insumo):
    comprar(client, insumo, 10.0)
    [a] = alertas(client, comprar(client, insumo, 500.0))
    assert a["tipo"] == "unidad" and a["productos"] == []
    comprar(client, insumo, 10.0, numero="F-X")
    [b] = alertas(client, comprar(client, insumo, 0.2))
    assert b["tipo"] == "unidad", "el mismo error al reves"


def test_dice_que_platos_quedan_flacos_o_a_perdida(client, insumo, variante):
    """La empanada de $5 lleva 0.1 kg utiles de carne (rinde 80%). A $20/kg
    cuesta $2.50 (50% de margen); a $45/kg cuesta $5.63: pierde plata."""
    comprar(client, insumo, 20.0)
    [a] = alertas(client, comprar(client, insumo, 45.0))
    [p] = a["productos"]
    assert p["nombre"] == "Empanada" and p["a_perdida"] is True
    assert p["margen_despues_pct"] < 0 < p["margen_antes_pct"]


def test_un_plato_que_sigue_bien_no_es_noticia(client, insumo, variante):
    comprar(client, insumo, 10.0)
    [a] = alertas(client, comprar(client, insumo, 12.0))
    assert a["productos"] == []


def test_pedirlas_dos_veces_no_las_duplica(client, insumo, db):
    comprar(client, insumo, 10.0)
    fid = comprar(client, insumo, 12.0)
    primera = alertas(client, fid)
    assert alertas(client, fid) == primera
    assert db.query(models.AlertaPrecio).count() == 1
    assert client.post("/api/compras/facturas/9999/alertas").status_code == 404


def test_quedan_pendientes_hasta_que_alguien_las_ve(client, insumo):
    comprar(client, insumo, 10.0)
    [a] = alertas(client, comprar(client, insumo, 12.0))
    assert [x["id"] for x in client.get("/api/compras/alertas?pendientes=true").json()] == [a["id"]]

    r = client.post(f"/api/compras/alertas/{a['id']}/visto")
    assert r.status_code == 200
    assert r.json()["visto"] is True and r.json()["visto_por"] == "admin"
    assert client.get("/api/compras/alertas?pendientes=true").json() == []
    assert len(client.get("/api/compras/alertas").json()) == 1, "vista no es borrada"
    assert client.post("/api/compras/alertas/9999/visto").status_code == 404
