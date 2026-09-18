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


def test_cualquier_producto_sin_receta_nace_ya_preparado(client):
    """No es un caso especial de "Envios" por nombre: es cualquier producto
    de reventa (una gaseosa embotellada, por ejemplo) que no tiene receta
    cargada. La regla es "sin receta = nada que cocinar", no "se llama X"."""
    cat = client.post("/api/menu/categorias", json={"nombre": "Reventa", "orden": 50}).json()
    prod = client.post("/api/menu/productos", json={
        "categoria_id": cat["id"], "nombre": "Refresco embotellado",
        "variantes": [{"nombre": "Regular", "precio": 1.0}],
    }).json()
    variante_id = prod["variantes"][0]["id"]

    p = client.post("/api/pedidos", json={
        "items": [{"variante_id": variante_id, "cantidad": 1}], "nota": "",
    }).json()
    assert p["items"][0]["preparado"] is True
    assert p["id"] not in en_cocina(client)


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
