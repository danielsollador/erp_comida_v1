"""Categorias del deposito: no es lo mismo el azucar que la carne.

Leider (24-sep): "Los inventarios tendrian que tener categorias, no es lo
mismo azucar que carne". Y despues, sobre el primer intento --un texto libre
dentro de cada insumo--: "no hay lugar donde agregar otra categoria, ni donde
pasar un producto de una a otra".

Tenia razon: una categoria guardada solo dentro de sus insumos no existe
mientras no tenga ninguno. Ahora es una tabla propia. Lo que se prueba aqui es
lo que esa decision tiene que garantizar:

  - se puede crear una categoria VACIA y despues llenarla;
  - mover mercancia de un cajon a otro es cambiar un id, no reescribir texto;
  - renombrar se hace en UN sitio y se ve en toda la mercancia;
  - dos cajones no se pueden llamar igual, aunque se teclee distinto;
  - borrar un cajon no borra la mercancia que habia dentro.
"""

from app import models


def crear_cat(client, nombre):
    r = client.post("/api/inventario/categorias", json={"nombre": nombre})
    assert r.status_code == 200, r.text
    return r.json()


def crear_ing(client, nombre, categoria_id=None, unidad="kg"):
    r = client.post(
        "/api/inventario/ingredientes",
        json={"nombre": nombre, "unidad": unidad, "categoria_id": categoria_id},
    )
    assert r.status_code == 200, r.text
    return r.json()


def categorias(client):
    return client.get("/api/inventario/categorias").json()


def ingrediente(client, ing_id):
    return next(i for i in client.get("/api/inventario/ingredientes").json() if i["id"] == ing_id)


# ── Existir por su cuenta ──────────────────────────────────────────────────


def test_una_categoria_vacia_existe_y_se_puede_elegir(client):
    """Lo que el modelo de texto libre no permitia: crearla antes de llenarla."""
    cat = crear_cat(client, "Empaques")
    assert cat["usos"] == 0
    assert [c["nombre"] for c in categorias(client)] == ["Empaques"]


def test_crear_una_que_ya_existe_devuelve_la_misma(client):
    a = crear_cat(client, "Carnes")
    b = crear_cat(client, "  cárnes ")
    assert a["id"] == b["id"], "no pueden quedar dos cajones para lo mismo"
    assert len(categorias(client)) == 1


def test_sin_nombre_no_se_crea(client):
    assert client.post("/api/inventario/categorias", json={"nombre": "   "}).status_code == 400


# ── Poner y mover mercancia ───────────────────────────────────────────────


def test_cargar_mercancia_dentro_de_una_categoria(client):
    cat = crear_cat(client, "Carnes")
    ing = crear_ing(client, "Carne molida", cat["id"])
    assert ing["categoria_id"] == cat["id"]
    assert ing["categoria"] == "Carnes", "el nombre viaja resuelto para la pantalla"
    assert categorias(client)[0]["usos"] == 1


def test_mover_mercancia_de_una_categoria_a_otra(client):
    carnes = crear_cat(client, "Carnes")
    secos = crear_cat(client, "Secos")
    ing = crear_ing(client, "Harina", carnes["id"])

    r = client.put(
        f"/api/inventario/ingredientes/{ing['id']}",
        json={"nombre": "Harina", "unidad": "kg", "categoria_id": secos["id"]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["categoria"] == "Secos"
    porNombre = {c["nombre"]: c["usos"] for c in categorias(client)}
    assert porNombre == {"Carnes": 0, "Secos": 1}


def test_sacar_la_mercancia_de_toda_categoria(client):
    cat = crear_cat(client, "Carnes")
    ing = crear_ing(client, "Pollo", cat["id"])
    r = client.put(
        f"/api/inventario/ingredientes/{ing['id']}",
        json={"nombre": "Pollo", "unidad": "kg", "categoria_id": None},
    )
    assert r.status_code == 200
    assert r.json()["categoria"] == "" and r.json()["categoria_id"] is None


def test_cargar_sin_categoria_es_normal(client):
    """Cargar mercancia no puede depender de haber pensado su cajon."""
    ing = crear_ing(client, "Azucar")
    assert ing["categoria_id"] is None and ing["categoria"] == ""


# ── Renombrar en un solo sitio ────────────────────────────────────────────


def test_renombrar_se_ve_en_toda_su_mercancia(client):
    cat = crear_cat(client, "Carne")
    a = crear_ing(client, "Carne molida", cat["id"])
    b = crear_ing(client, "Pollo", cat["id"])

    r = client.put(f"/api/inventario/categorias/{cat['id']}", json={"nombre": "Carnes"})
    assert r.status_code == 200, r.text
    assert r.json()["nombre"] == "Carnes"
    assert ingrediente(client, a["id"])["categoria"] == "Carnes"
    assert ingrediente(client, b["id"])["categoria"] == "Carnes"


def test_renombrar_a_una_que_ya_existe_las_funde(client):
    """Decir "esto era lo mismo" no puede dejar dos cajones iguales."""
    carne = crear_cat(client, "Carne")
    carnes = crear_cat(client, "Carnes")
    ing = crear_ing(client, "Pollo", carne["id"])

    r = client.put(f"/api/inventario/categorias/{carne['id']}", json={"nombre": "Carnes"})
    assert r.status_code == 200, r.text
    assert r.json()["id"] == carnes["id"], "se queda la que ya existia"
    assert r.json()["usos"] == 1
    assert [c["nombre"] for c in categorias(client)] == ["Carnes"]
    assert ingrediente(client, ing["id"])["categoria"] == "Carnes"


# ── Borrar sin llevarse la mercancia ──────────────────────────────────────


def test_borrar_la_categoria_deja_la_mercancia_sin_clasificar(client, db):
    cat = crear_cat(client, "Carnes")
    ing = crear_ing(client, "Carne molida", cat["id"])

    r = client.delete(f"/api/inventario/categorias/{cat['id']}")
    assert r.status_code == 200, r.text
    assert r.json()["sin_categoria"] == 1
    assert categorias(client) == []

    vivo = ingrediente(client, ing["id"])
    assert vivo["categoria"] == "" and vivo["categoria_id"] is None
    assert db.query(models.Ingrediente).filter_by(id=ing["id"]).first() is not None


def test_borrar_una_que_no_existe_es_404(client):
    assert client.delete("/api/inventario/categorias/9999").status_code == 404


def test_lo_cargado_antes_no_se_rompe(client, db):
    """Mercancia anterior a las categorias: sigue listandose, sin cajon."""
    db.add(models.Ingrediente(nombre="Sal", unidad="kg"))
    db.commit()
    fila = next(i for i in client.get("/api/inventario/ingredientes").json() if i["nombre"] == "Sal")
    assert fila["categoria"] == "" and fila["categoria_id"] is None
