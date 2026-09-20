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


def test_renombrar_la_categoria_no_la_duplica_en_el_siguiente_arranque(client, db):
    """El dueño renombra "Envios" a "Envíos", que es como se escribe bien.

    Con la busqueda por cadena exacta, el arranque siguiente no la encontraba
    y creaba otra: el menu quedaba con las dos, una con las ventas y otra
    recien nacida. Se busca sin tildes y sin mayusculas justo por esto.
    """
    from app.seed import asegurar_categoria_envios

    envios = buscar_envios(client)
    r = client.put(
        f"/api/menu/categorias/{envios['id']}",
        json={"nombre": "Envíos", "orden": 99, "activo": True},
    )
    assert r.status_code == 200, r.text

    asegurar_categoria_envios(db)

    cats = client.get("/api/menu/categorias").json()
    de_envios = [c for c in cats if c["nombre"] in ("Envios", "Envíos")]
    assert len(de_envios) == 1, [c["nombre"] for c in cats]
    assert de_envios[0]["id"] == envios["id"]
    assert len(de_envios[0]["productos"]) == 2


def test_el_delivery_renombrado_sigue_siendo_un_servicio(client, db):
    """Si deja de reconocerse, la salud contable vuelve a pedir "cargale la
    receta al delivery" para siempre -- un aviso que no se puede resolver."""
    from app.seed import variantes_de_servicio

    envios = buscar_envios(client)
    antes = variantes_de_servicio(db)
    assert antes, "los delivery deberian contar como servicio desde el arranque"

    client.put(
        f"/api/menu/categorias/{envios['id']}",
        json={"nombre": "ENVÍOS", "orden": 99, "activo": True},
    )
    db.expire_all()

    assert variantes_de_servicio(db) == antes
