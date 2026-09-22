"""Un envio no se cocina: no puede quedarse para siempre en la cola de cocina.

Este es el cruce entre dos cosas de esta misma tanda: `en_cocina` (caso 1)
muestra cualquier pedido con un item sin marcar `preparado`, y "Delivery
corto/largo" (caso 8) son productos sin receta que nadie en la cocina va a
marcar como preparados -no hay nada que cocinar-. Sin arreglarlo, un pedido
que solo lleva delivery se queda parpadeando en la pantalla de cocina para
siempre.
"""


def buscar_envios(client):
    cats = client.get("/api/menu/categorias").json()
    return next(c for c in cats if c["nombre"] == "Envios")


def en_cocina(client):
    return {p["id"] for p in client.get("/api/pedidos?en_cocina=true").json()}


def test_un_pedido_de_solo_delivery_no_se_queda_pegado_en_cocina(client):
    envios = buscar_envios(client)
    corto = next(p for p in envios["productos"] if p["nombre"] == "Delivery corto")
    variante_id = corto["variantes"][0]["id"]

    p = client.post("/api/pedidos", json={
        "items": [{"variante_id": variante_id, "cantidad": 1}], "nota": "",
    }).json()

    assert p["id"] not in en_cocina(client), (
        "un envio no tiene nada que preparar: no puede aparecer en la cola de cocina"
    )


def test_un_producto_sin_receta_va_a_cocina(client):
    """La regla vieja era "sin receta = nada que cocinar". En un local que
    arranca sin recetas --como arranca todo local-- eso volvia TODA comanda
    algo que no se cocina, y el pastelito no llegaba nunca a la cocina
    (Leider, 21-sep). Sin receta se va a cocina: un toque de mas es mas
    barato que una comanda que nadie ve."""
    cat = client.post("/api/menu/categorias", json={"nombre": "Horno", "orden": 50}).json()
    prod = client.post("/api/menu/productos", json={
        "categoria_id": cat["id"], "nombre": "Pastelito",
        "variantes": [{"nombre": "Regular", "precio": 1.0}],
    }).json()
    variante_id = prod["variantes"][0]["id"]

    p = client.post("/api/pedidos", json={
        "items": [{"variante_id": variante_id, "cantidad": 1}], "nota": "",
    }).json()
    assert p["items"][0]["preparado"] is False
    assert p["estado"] == "pendiente"
    assert p["id"] in en_cocina(client)


def test_la_reventa_con_receta_de_reventa_no_pasa_por_cocina(client, db):
    """La gaseosa embotellada si nace preparada, pero porque su receta dice
    que es mercancia de reventa, no porque no tenga receta."""
    from app import models
    lata = models.Ingrediente(nombre="Refresco lata", unidad="und", stock_actual=50,
                              stock_minimo=1, stock_objetivo=100, costo_unitario=0.6,
                              rendimiento_pct=100, tipo="reventa")
    db.add(lata)
    db.flush()
    cat = client.post("/api/menu/categorias", json={"nombre": "Reventa", "orden": 51}).json()
    prod = client.post("/api/menu/productos", json={
        "categoria_id": cat["id"], "nombre": "Refresco embotellado",
        "variantes": [{"nombre": "Regular", "precio": 1.0}],
    }).json()
    variante_id = prod["variantes"][0]["id"]
    db.add(models.RecetaItem(variante_id=variante_id, ingrediente_id=lata.id, cantidad_por_unidad=1))
    db.commit()

    p = client.post("/api/pedidos", json={
        "items": [{"variante_id": variante_id, "cantidad": 1}], "nota": "",
    }).json()
    assert p["items"][0]["preparado"] is True
    assert p["id"] not in en_cocina(client)


def test_lo_que_nace_todo_preparado_nace_listo_y_el_mostrador_lo_ve(client):
    """El agujero de verdad: una comanda con todo preparado quedaba en
    "pendiente", y ninguna pantalla pide eso. El POST devolvia 200 y la
    comanda no estaba en ningun lado. Ahora nace "listo": el mostrador la
    muestra como "cocina termino, falta cobrar"."""
    envios = buscar_envios(client)
    corto = next(p for p in envios["productos"] if p["nombre"] == "Delivery corto")
    variante_id = corto["variantes"][0]["id"]
    p = client.post("/api/pedidos", json={
        "items": [{"variante_id": variante_id, "cantidad": 1}], "nota": "",
    }).json()
    assert p["estado"] == "listo"
    assert p["listo_en"] is not None
    listos = {x["id"] for x in client.get("/api/pedidos?estado=listo").json()}
    assert p["id"] in listos


def test_comida_mas_delivery_si_aparece_hasta_que_la_comida_este_lista(client, variante):
    envios = buscar_envios(client)
    largo = next(p for p in envios["productos"] if p["nombre"] == "Delivery largo")
    variante_envio = largo["variantes"][0]["id"]

    p = client.post("/api/pedidos", json={
        "items": [
            {"variante_id": variante.id, "cantidad": 1},
            {"variante_id": variante_envio, "cantidad": 1},
        ],
        "nota": "",
    }).json()

    assert p["id"] in en_cocina(client), "la comida de verdad si tiene que aparecer"

    client.post(f"/api/pedidos/{p['id']}/marcar-listo")
    assert p["id"] not in en_cocina(client), "al terminar de cocinar, ya no hay nada pendiente"
