"""Que se ofrece para acompañar la comida, y quien lo decide.

POR QUE. "Es bebida" se adivinaba buscando la palabra "bebida" en el nombre
de la categoria. Funcionaba mientras la categoria se llamara "Bebidas", pero
un local que la llame "Jugos", "Refrescos" o "Tragos" dejaba de recibir la
sugerencia de acompañamiento en el mostrador y el reporte de oportunidad
perdida le daba cero -- sin que nada explicara por que.

Ahora es una marca de la categoria que pone el dueño.
"""


def crear_categoria(client, nombre, bebida=False):
    r = client.post("/api/menu/categorias", json={"nombre": nombre, "orden": 0, "bebida": bebida})
    assert r.status_code == 200, r.text
    return r.json()


def test_una_categoria_nace_sin_ser_bebida(client):
    cat = crear_categoria(client, "Postres")
    assert cat["bebida"] is False


def test_el_dueno_la_marca_aunque_se_llame_jugos(client):
    """El caso que la regla vieja no podia ver."""
    cat = crear_categoria(client, "Jugos")
    r = client.put(f"/api/menu/categorias/{cat['id']}", json={"bebida": True})
    assert r.status_code == 200, r.text
    assert r.json()["bebida"] is True
    assert r.json()["nombre"] == "Jugos"


def test_el_nombre_ya_no_decide(client):
    """Llamarse "Bebidas" no la marca sola: la marca es del dueño."""
    cat = crear_categoria(client, "Bebidas frias")
    assert cat["bebida"] is False


def test_desmarcarla_se_respeta(client):
    cat = crear_categoria(client, "Bebidas", bebida=True)
    r = client.put(f"/api/menu/categorias/{cat['id']}", json={"bebida": False})
    assert r.json()["bebida"] is False


def test_renombrar_no_pierde_la_marca(client):
    """El PUT aplica solo lo que se manda. Con el objeto entero por defecto,
    renombrar le borraba la marca."""
    cat = crear_categoria(client, "Jugos", bebida=True)
    r = client.put(f"/api/menu/categorias/{cat['id']}", json={"nombre": "Jugos naturales"})
    assert r.status_code == 200, r.text
    assert r.json()["nombre"] == "Jugos naturales"
    assert r.json()["bebida"] is True


def test_renombrar_no_devuelve_al_menu_una_categoria_retirada(client):
    """Mismo problema, y este ya existia antes de la marca: `activo` tiene
    default True en el esquema, asi que un PUT sin ese campo la reactivaba."""
    cat = crear_categoria(client, "Temporada navideña")
    client.delete(f"/api/menu/categorias/{cat['id']}")

    r = client.put(f"/api/menu/categorias/{cat['id']}", json={"nombre": "Temporada"})
    assert r.status_code == 200, r.text
    assert r.json()["activo"] is False


def test_la_sugerencia_usa_la_marca_y_no_el_nombre(client, db):
    """La prueba de verdad: el mostrador ofrece de tomar lo que el dueño marco."""
    from app import combos

    cat = crear_categoria(client, "Refrescos", bebida=True)
    r = client.post(
        "/api/menu/productos",
        json={"categoria_id": cat["id"], "nombre": "Malta", "variantes": [{"nombre": "Regular", "precio": 1.0}]},
    )
    assert r.status_code == 200, r.text
    variante_id = r.json()["variantes"][0]["id"]

    mapa = combos._mapa_variantes(db)
    assert mapa[variante_id]["es_bebida"] is True
