"""El delivery como dos productos del menu, no un modulo aparte.

Un envio no lleva receta -es un servicio, no se cocina-, asi que se cobra con
margen del 100% y sin tocar el inventario. Es exactamente lo que ya hace el
sistema con "sin receta" (ver reportes.py); un envio no es un caso especial,
es el mismo caso de siempre aplicado a algo que nunca tuvo receta a proposito.
"""


def buscar_envios(client):
    cats = client.get("/api/menu/categorias").json()
    return next((c for c in cats if c["nombre"] == "Envios"), None)


def test_la_categoria_de_envios_se_crea_sola(client):
    envios = buscar_envios(client)
    assert envios is not None
    nombres = {p["nombre"] for p in envios["productos"]}
    assert nombres == {"Delivery corto", "Delivery largo"}


def test_correr_el_arranque_dos_veces_no_duplica_nada(client, db):
    """Es lo que hace que un local que ya vende la reciba en su proximo
    despliegue sin que aparezca dos veces."""
    from app.seed import asegurar_categoria_envios

    asegurar_categoria_envios(db)
    asegurar_categoria_envios(db)

    envios = buscar_envios(client)
    assert len(envios["productos"]) == 2


def test_un_envio_se_vende_sin_tocar_inventario(client, db, insumo):
    envios = buscar_envios(client)
    corto = next(p for p in envios["productos"] if p["nombre"] == "Delivery corto")
    variante_id = corto["variantes"][0]["id"]
    stock_antes = insumo.stock_actual

    p = client.post("/api/pedidos", json={
        "items": [{"variante_id": variante_id, "cantidad": 1}], "nota": "",
    }).json()
    assert p["total"] == 1.5

    db.refresh(insumo)
    assert insumo.stock_actual == stock_antes, "un envio no consume ningun insumo"


def test_un_envio_se_puede_agregar_junto_con_comida(client, variante):
    envios = buscar_envios(client)
    largo = next(p for p in envios["productos"] if p["nombre"] == "Delivery largo")
    variante_envio = largo["variantes"][0]["id"]

    p = client.post("/api/pedidos", json={
        "items": [
            {"variante_id": variante.id, "cantidad": 2},
            {"variante_id": variante_envio, "cantidad": 1},
        ],
        "nota": "",
    }).json()
    assert p["total"] == round(variante.precio * 2 + 3.0, 2)
