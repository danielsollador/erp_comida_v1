"""El dueño ordena los productos de cada categoria y asi salen en el mostrador."""
from app import models


def categoria_con(db, nombres):
    cat = models.Categoria(nombre="Bebidas", orden=0)
    db.add(cat)
    db.flush()
    ids = []
    for n in nombres:
        p = models.Producto(categoria_id=cat.id, nombre=n)
        db.add(p)
        db.flush()
        db.add(models.Variante(producto_id=p.id, nombre="Regular", precio=1.0))
        ids.append(p.id)
    db.commit()
    return cat, ids


def nombres_en_el_menu(client, cat_id):
    cat = next(c for c in client.get("/api/menu/categorias").json() if c["id"] == cat_id)
    return [p["nombre"] for p in cat["productos"]]


def test_sin_ordenar_salen_como_se_crearon(client, db):
    cat, _ = categoria_con(db, ["Jugo", "Cafe", "Te"])
    assert nombres_en_el_menu(client, cat.id) == ["Jugo", "Cafe", "Te"]


def test_el_orden_elegido_es_el_del_menu(client, db):
    cat, (jugo, cafe, te) = categoria_con(db, ["Jugo", "Cafe", "Te"])
    r = client.put(f"/api/menu/categorias/{cat.id}/orden-productos", json={"ids": [cafe, te, jugo]})
    assert r.status_code == 200, r.text
    assert nombres_en_el_menu(client, cat.id) == ["Cafe", "Te", "Jugo"]


def test_lo_nuevo_va_al_final(client, db):
    cat, (jugo, cafe) = categoria_con(db, ["Jugo", "Cafe"])
    client.put(f"/api/menu/categorias/{cat.id}/orden-productos", json={"ids": [cafe, jugo]})
    r = client.post("/api/menu/productos", json={
        "categoria_id": cat.id, "nombre": "Capuchino", "variantes": [{"nombre": "Regular", "precio": 2}],
    })
    assert r.status_code == 200, r.text
    assert nombres_en_el_menu(client, cat.id) == ["Cafe", "Jugo", "Capuchino"]


def test_no_se_ordenan_productos_de_otra_categoria(client, db):
    cat, (jugo,) = categoria_con(db, ["Jugo"])
    otra, (pan,) = categoria_con(db, ["Pan"])
    r = client.put(f"/api/menu/categorias/{cat.id}/orden-productos", json={"ids": [pan, jugo]})
    assert r.status_code == 400
