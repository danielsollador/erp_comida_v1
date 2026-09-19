"""Cuanto de lo vendido se factura, para el grafico de Reportes.

No todo se factura al momento: el dueno puede decidirlo despues, viendo el
historico. El reporte tiene que reflejar la decision de HOY (facturado o
no), sin importar cuando se tomo.
"""


def comanda_cobrada(client, variante, facturado=False):
    p = client.post("/api/pedidos", json={
        "items": [{"variante_id": variante.id, "cantidad": 1}], "nota": "",
    }).json()
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={
        "metodo_pago": "Efectivo Bs", "facturado": facturado,
        "numero_factura": "F-100" if facturado else None,
    })
    assert r.status_code == 200
    return r.json()


def test_el_reporte_cuenta_lo_facturado_y_lo_que_no(client, variante):
    comanda_cobrada(client, variante, facturado=True)
    comanda_cobrada(client, variante, facturado=False)
    comanda_cobrada(client, variante, facturado=False)

    r = client.get("/api/reportes/resumen")
    assert r.status_code == 200
    datos = r.json()
    assert datos["pedidos"] == 3
    assert datos["facturadas"] == 1
    assert datos["valor_facturado"] > 0
    assert datos["valor_facturado"] < datos["ventas"]


def test_facturar_despues_tambien_cuenta(client, variante):
    v = comanda_cobrada(client, variante, facturado=False)
    client.post(f"/api/pedidos/{v['id']}/facturar", json={"numero_factura": "F-101"})

    r = client.get("/api/reportes/resumen")
    assert r.json()["facturadas"] == 1


def test_una_venta_devuelta_no_cuenta_como_facturada(client, variante):
    v = comanda_cobrada(client, variante, facturado=True)
    client.post(f"/api/pedidos/{v['id']}/devolver", json={
        "recuperable": True, "motivo": "no era eso", "nota_credito": "NC-1",
    })

    r = client.get("/api/reportes/resumen")
    datos = r.json()
    assert datos["facturadas"] == 0
    assert datos["pedidos"] == 0
