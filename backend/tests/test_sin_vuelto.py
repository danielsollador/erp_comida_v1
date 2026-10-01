"""El cliente paga en efectivo y no quiere el vuelto: queda como propina.

El POS manda el billete completo como monto (recibido = monto, sin vuelto) y
la diferencia sumada a la propina. Asi la gaveta recibe lo que de verdad
entro, la venta no se infla y lo que sobra se le debe al empleado.
"""


def test_el_vuelto_que_no_se_quiso_queda_como_propina(client, variante):
    p = client.post("/api/pedidos", json={"cliente": "Ana", "items": [
        {"variante_id": variante.id, "cantidad": 1},
    ]}).json()
    total = p["total"]
    billete = round(total + 1.5, 2)
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={
        "metodo_pago": "Efectivo $",
        "propina": 1.5,
        "pagos": [{"metodo": "Efectivo $", "monto": billete, "recibido": billete}],
    })
    assert r.status_code == 200, r.text
    q = r.json()
    assert q["estado"] == "pagado"
    assert q["propina"] == 1.5 and q["total"] == total
    pago = q["pagos"][0]
    assert pago["monto"] == billete and pago["vuelto_monto"] == 0
    assert pago["vuelto_metodo"] in (None, "")
