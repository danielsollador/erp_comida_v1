"""El cierre de caja es el cuadre del dia (26-oct).

Una factura quedo "en Efectivo Bs" porque venia marcado de entrada, y el
cierre esperaba -$78 en una gaveta que tenia $3,95. Lo que el dueño paga con
su plata no toca ninguna gaveta; el fiado que se cobra ese dia si entra.
"""
from tests.conftest import caja_esperado, saldo


def factura(client, ing_id, forma):
    return client.post("/api/compras/facturas", json={
        "numero_factura": "F-1", "proveedor_nombre": "Prov", "proveedor_rif": "J123456789",
        "categoria": "Insumos", "forma_pago": forma,
        "items": [{"ingrediente_id": ing_id, "cantidad": 1, "costo_unitario": 50.0}],
    })


def test_una_factura_con_plata_del_dueno_no_toca_la_caja(client, db, libros, insumo):
    antes = caja_esperado(client, "Efectivo Bs")
    capital = saldo(db, "3010")
    r = factura(client, insumo.id, "Plata del dueño")
    assert r.status_code == 200, r.text
    assert caja_esperado(client, "Efectivo Bs") == antes
    db.expire_all()
    assert saldo(db, "3010") > capital, "la puso el dueño"


def test_una_factura_con_billetes_de_la_caja_si_sale_en_el_cierre(client, libros, insumo):
    antes = caja_esperado(client, "Efectivo Bs")
    assert factura(client, insumo.id, "Efectivo").status_code == 200
    assert caja_esperado(client, "Efectivo Bs") < antes


def test_el_fiado_cobrado_por_el_punto_entra_en_la_fila_del_punto(client, variante):
    p = client.post(
        "/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 2}], "nota": "", "permitir_sin_stock": True},
    ).json()
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Fiado", "cliente": "Sra. Carmen"})
    antes = caja_esperado(client, "Punto de venta")
    r = client.post(f"/api/caja/fiado/{p['id']}/cobrar", json={"metodo_pago": "Punto de venta", "referencia": "lote 1"})
    assert r.status_code == 200, r.text
    assert round(caja_esperado(client, "Punto de venta") - antes, 2) == 10.0
    d = client.get("/api/caja/resumen").json()
    assert d["otros_movimientos"] == [], "no se cuenta dos veces"


def test_el_fiado_cobrado_en_efectivo_entra_en_la_gaveta(client, variante):
    p = client.post(
        "/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 2}], "nota": "", "permitir_sin_stock": True},
    ).json()
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Fiado", "cliente": "Sra. Carmen"})
    antes = caja_esperado(client, "Efectivo Bs")
    client.post(f"/api/caja/fiado/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})
    assert round(caja_esperado(client, "Efectivo Bs") - antes, 2) == 10.0
