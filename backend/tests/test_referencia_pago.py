"""Numero de confirmacion en cada pago que no es un billete.

Sin referencia, un reclamo de "pague por pago movil y no me lo registraron" es
la palabra del cliente contra la del negocio. Con un numero de confirmacion
guardado, se puede ir a buscar el comprobante.
"""


def comanda(client, variante, cantidad=1):
    return client.post("/api/pedidos", json={
        "items": [{"variante_id": variante.id, "cantidad": cantidad}], "nota": "",
    }).json()


def test_efectivo_no_pide_referencia(client, variante):
    p = comanda(client, variante)
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})
    assert r.status_code == 200


def test_pago_movil_sin_referencia_se_rechaza(client, variante):
    p = comanda(client, variante)
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Pago movil"})
    assert r.status_code == 400
    assert "referencia" in r.json()["detail"]


def test_pago_movil_con_referencia_se_guarda(client, variante):
    p = comanda(client, variante)
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={
        "metodo_pago": "Pago movil", "referencia": "0123456789",
    })
    assert r.status_code == 200
    assert r.json()["pagos"][0]["referencia"] == "0123456789"


def test_zelle_y_punto_de_venta_tambien_piden_referencia(client, variante):
    for metodo in ("Zelle", "Punto de venta", "Tarjeta", "Transferencia"):
        p = comanda(client, variante)
        r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": metodo})
        assert r.status_code == 400, metodo


def test_fiado_no_pide_referencia(client, variante):
    """No hay comprobante que pedir: no entro plata."""
    p = comanda(client, variante)
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Fiado", "cliente": "Ana"})
    assert r.status_code == 200


def test_un_pago_partido_pide_referencia_solo_en_la_parte_que_la_necesita(client, variante):
    p = comanda(client, variante, cantidad=4)  # $20
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={
        "metodo_pago": "Mixto",
        "pagos": [
            {"metodo": "Efectivo Bs", "monto": 10.0},
            {"metodo": "Transferencia", "monto": 10.0},
        ],
    })
    assert r.status_code == 400
    assert "Transferencia" in r.json()["detail"]

    r2 = client.post(f"/api/pedidos/{p['id']}/cobrar", json={
        "metodo_pago": "Mixto",
        "pagos": [
            {"metodo": "Efectivo Bs", "monto": 10.0},
            {"metodo": "Transferencia", "monto": 10.0, "referencia": "TR-99"},
        ],
    })
    assert r2.status_code == 200
    ref_por_metodo = {pg["metodo"]: pg["referencia"] for pg in r2.json()["pagos"]}
    assert ref_por_metodo["Efectivo Bs"] == ""
    assert ref_por_metodo["Transferencia"] == "TR-99"


def test_la_referencia_se_ve_en_el_ticket(client, variante):
    p = comanda(client, variante)
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Zelle", "referencia": "ZL-42"})
    ticket = client.get(f"/api/pedidos/{p['id']}/ticket").json()
    assert ticket["pagos"][0]["referencia"] == "ZL-42"
