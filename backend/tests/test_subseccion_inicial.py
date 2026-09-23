"""La subseccion "Regular" que nace con el producto no se ve ni se duplica.

Leider (23-sep): "no quiero ninguna -Regular, solo la seccion y ya". Al
agregarle la primera subseccion real a un producto, la inicial se convierte en
esa en vez de quedarse al lado como un renglon fantasma en el mostrador.
"""
from app import models

from tests.test_menu_retirar import categoria, presentacion, producto


def subsecciones(client, producto_id):
    for c in client.get("/api/menu/categorias").json():
        for p in c["productos"]:
            if p["id"] == producto_id:
                return [(v["nombre"], v["precio"], v["activo"]) for v in p["variantes"]]
    return None


def test_la_primera_subseccion_real_ocupa_el_lugar_de_la_inicial(client, db):
    cat = categoria(db)
    jugo = producto(db, cat, "Jugo natural")
    inicial = presentacion(db, jugo, "Regular", 2.0)

    r = client.post(f"/api/menu/productos/{jugo.id}/variantes", json={"nombre": "Parchita", "precio": 2.5})
    assert r.status_code == 200, r.text
    assert r.json()["id"] == inicial.id  # mismo renglon: las ventas viejas siguen apuntando ahi
    assert subsecciones(client, jugo.id) == [("Parchita", 2.5, True)]
    # Y el cambio de precio deja rastro, como cualquier otro.
    cambio = db.query(models.CambioPrecio).filter_by(variante_id=inicial.id).one()
    assert (cambio.precio_anterior, cambio.precio_nuevo) == (2.0, 2.5)


def test_la_segunda_ya_se_agrega_al_lado(client, db):
    cat = categoria(db)
    jugo = producto(db, cat, "Jugo natural")
    presentacion(db, jugo, "Regular", 2.0)
    client.post(f"/api/menu/productos/{jugo.id}/variantes", json={"nombre": "Parchita", "precio": 2.5})
    r = client.post(f"/api/menu/productos/{jugo.id}/variantes", json={"nombre": "Fresa", "precio": 2.5})
    assert r.status_code == 200, r.text
    assert sorted(subsecciones(client, jugo.id)) == [("Fresa", 2.5, True), ("Parchita", 2.5, True)]


def test_una_regular_que_el_dueno_puso_a_proposito_se_respeta(client, db):
    """Si ya hay dos ("Regular" y "Grande"), la nueva se agrega y no toca nada."""
    cat = categoria(db)
    cafe = producto(db, cat, "Cafe")
    presentacion(db, cafe, "Regular", 1.0)
    presentacion(db, cafe, "Grande", 1.5)
    r = client.post(f"/api/menu/productos/{cafe.id}/variantes", json={"nombre": "Doble", "precio": 2.0})
    assert r.status_code == 200, r.text
    assert sorted(subsecciones(client, cafe.id)) == [("Doble", 2.0, True), ("Grande", 1.5, True), ("Regular", 1.0, True)]


def test_una_inicial_retirada_no_cuenta(client, db):
    cat = categoria(db)
    p = producto(db, cat, "Torta")
    presentacion(db, p, "Regular", 3.0, activo=False)
    presentacion(db, p, "Chocolate", 3.0)
    r = client.post(f"/api/menu/productos/{p.id}/variantes", json={"nombre": "Vainilla", "precio": 3.0})
    assert r.status_code == 200, r.text
    assert sorted(subsecciones(client, p.id)) == [("Chocolate", 3.0, True), ("Regular", 3.0, False), ("Vainilla", 3.0, True)]
