"""Pagar antes de cocinar no puede sacar el pedido de la cola de cocina.

Pagar primero y comer despues es el flujo normal de un mostrador. Antes,
`cobrar()` ponia `estado='pagado'` sin mirar si la comida ya estaba lista, y
la pantalla de cocina solo pedia `estado='pendiente'`: el pedido pagado
desaparecia de cocina aunque nadie hubiera tocado la comida.

El segundo bug era mas serio: `marcar_pedido_listo` pisaba `estado` a "listo"
sin preguntar si ya era "pagado". Con eso, terminar de cocinar un pedido ya
cobrado lo hacia desaparecer de los 17 sitios que cuentan ingresos por
`estado == "pagado"` -caja, contabilidad, reportes, impuestos-, corrompiendo
esos numeros en silencio.
"""


def comanda(client, variante, cantidad=1):
    return client.post("/api/pedidos", json={
        "items": [{"variante_id": variante.id, "cantidad": cantidad}], "nota": "",
    }).json()


def en_cocina(client):
    return {p["id"] for p in client.get("/api/pedidos?en_cocina=true").json()}


def test_cobrar_antes_de_cocinar_no_saca_el_pedido_de_cocina(client, variante):
    p = comanda(client, variante)
    assert p["id"] in en_cocina(client)

    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})

    assert p["id"] in en_cocina(client), "se pago pero la comida sigue sin salir: cocina lo tiene que ver"


def test_terminar_de_cocinar_lo_saca_de_la_cola(client, variante):
    p = comanda(client, variante)
    client.post(f"/api/pedidos/{p['id']}/marcar-listo")
    assert p["id"] not in en_cocina(client)


def test_cobrar_y_despues_terminar_de_cocinar_tambien_lo_saca(client, variante):
    p = comanda(client, variante)
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})
    assert p["id"] in en_cocina(client)

    client.post(f"/api/pedidos/{p['id']}/marcar-listo")
    assert p["id"] not in en_cocina(client)


def test_terminar_de_cocinar_un_pedido_pagado_no_le_quita_el_pagado(client, db, variante):
    """El bug que de verdad importa: si esto regresa a 'listo', el pedido deja
    de contar como venta en caja, contabilidad, reportes e impuestos."""
    from app import models

    p = comanda(client, variante)
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})

    r = client.post(f"/api/pedidos/{p['id']}/marcar-listo")
    assert r.json()["estado"] == "pagado", "marcar listo no puede retroceder un pedido ya cobrado"

    fila = db.query(models.Pedido).filter_by(id=p["id"]).first()
    assert fila.estado == "pagado"


def test_marcar_un_item_no_retrocede_un_pedido_pagado(client, variante):
    """Mismo riesgo por la otra puerta: terminar de marcar items uno por uno
    en vez del boton de todo."""
    p = comanda(client, variante, cantidad=1)
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})

    item_id = p["items"][0]["id"]
    r = client.post(f"/api/pedidos/items/{item_id}/preparado")
    assert r.json()["estado"] == "pagado"


def test_un_pedido_normal_sigue_pasando_a_listo_al_terminar(client, variante):
    """El caso de siempre -nadie pago todavia- no puede cambiar."""
    p = comanda(client, variante)
    r = client.post(f"/api/pedidos/{p['id']}/marcar-listo")
    assert r.json()["estado"] == "listo"


def test_anulado_no_aparece_en_cocina_aunque_falte_preparar(client, variante):
    p = comanda(client, variante)
    client.post(f"/api/pedidos/{p['id']}/anular", json={"comida_preparada": False})
    assert p["id"] not in en_cocina(client)
