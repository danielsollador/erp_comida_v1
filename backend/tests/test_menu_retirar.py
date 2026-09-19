"""Quitar algo del menu lo RETIRA, y retirarlo tiene vuelta atras.

Borrar en duro no es una opcion: las ventas ya cobradas nombran esa variante,
y destruirla dejaria el historico apuntando a nada. Por eso "Quitar" pone
`activo = False`.

Lo que faltaba era la otra mitad: volver a activar un producto o una
presentacion sueltos. Solo existia para categorias, asi que quitar un
producto por error era una puerta de una sola direccion -- y como la pantalla
del menu no filtraba lo retirado, ademas parecia que el boton no hacia nada.
"""
from app import models


def categoria(db, nombre="Comida", activo=True):
    c = models.Categoria(nombre=nombre, orden=0, activo=activo)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def producto(db, cat, nombre="Pastelito", activo=True):
    p = models.Producto(categoria_id=cat.id, nombre=nombre, activo=activo)
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def presentacion(db, prod, nombre="Pollo", precio=1.2, activo=True):
    v = models.Variante(producto_id=prod.id, nombre=nombre, precio=precio, activo=activo)
    db.add(v)
    db.commit()
    db.refresh(v)
    return v


def menu(client):
    r = client.get("/api/menu/categorias")
    assert r.status_code == 200, r.text
    return r.json()


def buscar(cats, nombre):
    for c in cats:
        for p in c["productos"]:
            if p["nombre"] == nombre:
                return p
    return None


# ── quitar retira, no destruye ───────────────────────────────────────────────


def test_quitar_un_producto_lo_retira_y_no_lo_borra(client, db):
    cat = categoria(db)
    p = producto(db, cat)
    presentacion(db, p)

    r = client.delete(f"/api/menu/productos/{p.id}")
    assert r.status_code == 200, r.text

    db.expire_all()
    assert db.get(models.Producto, p.id) is not None, "sigue existiendo"
    assert db.get(models.Producto, p.id).activo is False

    # El listado lo sigue trayendo: es de donde la pantalla saca "Fuera del
    # menu". Quien no lo quiera ver lo filtra por `activo`, como hace el POS.
    fila = buscar(menu(client), "Pastelito")
    assert fila is not None and fila["activo"] is False


def test_quitar_una_presentacion_la_retira(client, db):
    cat = categoria(db)
    p = producto(db, cat)
    v = presentacion(db, p)

    assert client.delete(f"/api/menu/variantes/{v.id}").status_code == 200
    db.expire_all()
    assert db.get(models.Variante, v.id).activo is False


# ── volver a activar ─────────────────────────────────────────────────────────


def test_volver_a_activar_un_producto(client, db):
    cat = categoria(db)
    p = producto(db, cat)
    client.delete(f"/api/menu/productos/{p.id}")

    r = client.post(f"/api/menu/productos/{p.id}/reactivar")
    assert r.status_code == 200, r.text
    assert r.json()["activo"] is True
    db.expire_all()
    assert db.get(models.Producto, p.id).activo is True


def test_activar_un_producto_de_una_categoria_retirada_no_revive_a_sus_hermanos(client, db):
    """Si la categoria sigue retirada, el producto no se veria y el boton
    pareceria roto: se activa la categoria. Pero SOLO ella -- los demas
    productos que se quitaron se quedan donde estaban."""
    cat = categoria(db)
    quiero = producto(db, cat, "Pastelito")
    otro = producto(db, cat, "Empanada")

    assert client.delete(f"/api/menu/categorias/{cat.id}").status_code == 200
    db.expire_all()
    assert db.get(models.Categoria, cat.id).activo is False
    assert db.get(models.Producto, otro.id).activo is False, "quitar la categoria retira todo"

    assert client.post(f"/api/menu/productos/{quiero.id}/reactivar").status_code == 200
    db.expire_all()
    assert db.get(models.Producto, quiero.id).activo is True
    assert db.get(models.Categoria, cat.id).activo is True, "si no, seguiria sin verse"
    assert db.get(models.Producto, otro.id).activo is False, "vuelve lo que se pidio, nada mas"


def test_volver_a_activar_una_presentacion_destapa_lo_que_la_tapa(client, db):
    cat = categoria(db, activo=False)
    p = producto(db, cat, activo=False)
    v = presentacion(db, p, activo=False)

    r = client.post(f"/api/menu/variantes/{v.id}/reactivar")
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(models.Variante, v.id).activo is True
    assert db.get(models.Producto, p.id).activo is True
    assert db.get(models.Categoria, cat.id).activo is True


def test_reactivar_algo_que_no_existe_da_404(client):
    assert client.post("/api/menu/productos/9999/reactivar").status_code == 404
    assert client.post("/api/menu/variantes/9999/reactivar").status_code == 404


# ── lo retirado sale del punto de venta, pero la venta vieja sigue ──────────


def test_una_venta_vieja_sigue_nombrando_el_producto_retirado(client, db, variante):
    """La razon de que "Quitar" no borre: el ticket de ayer tiene que seguir
    diciendo que se vendio, y su margen tiene que seguir cuadrando."""
    pedido = client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": 2}]},
    ).json()
    assert client.post(
        f"/api/pedidos/{pedido['id']}/cobrar", json={"metodo_pago": "Efectivo $"}
    ).status_code == 200

    assert client.delete(f"/api/menu/productos/{variante.producto_id}").status_code == 200

    r = client.get("/api/reportes/resumen?periodo=dia").json()
    assert r["ventas"] == 10.0
    assert any(p["nombre"].startswith("Empanada") for p in r["top_productos"])
    # Y el margen sigue siendo el de verdad, no un 100% por costo perdido.
    empanada = next(p for p in r["top_productos"] if p["nombre"].startswith("Empanada"))
    assert empanada["costo"] > 0 and empanada["sin_receta"] is False
