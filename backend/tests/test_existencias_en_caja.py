"""La caja dice cuantas quedan de lo que se vende tal cual (2-nov: los
helados estaban en el congelador y habia que ir a buscarlos para saber)."""
from app import models


def _vendible(db, nombre, receta):
    cat = models.Categoria(nombre="Postres", orden=0)
    db.add(cat)
    db.flush()
    p = models.Producto(categoria_id=cat.id, nombre=nombre)
    db.add(p)
    db.flush()
    v = models.Variante(producto_id=p.id, nombre="Regular", precio=3.0)
    db.add(v)
    db.flush()
    for ing, cantidad in receta:
        db.add(models.RecetaItem(variante_id=v.id, ingrediente_id=ing.id, cantidad_por_unidad=cantidad))
    db.commit()
    return v


def _ing(db, nombre, tipo, stock):
    i = models.Ingrediente(nombre=nombre, unidad="unidad", stock_actual=stock, costo_unitario=1.0, tipo=tipo)
    db.add(i)
    db.flush()
    return i


def test_lo_de_reventa_dice_cuantas_quedan(client, db):
    helado = _ing(db, "Helado de chocolate", "reventa", 3)
    v = _vendible(db, "Helado", [(helado, 1)])
    r = client.get("/api/menu/existencias")
    assert r.status_code == 200, r.text
    assert {"variante_id": v.id, "quedan": 3} in r.json()


def test_agotado_y_negativo_quedan_en_cero(client, db):
    helado = _ing(db, "Helado de fresa", "reventa", -2)
    v = _vendible(db, "Helado", [(helado, 1)])
    assert {"variante_id": v.id, "quedan": 0} in client.get("/api/menu/existencias").json()


def test_lo_cocinado_no_se_marca(client, db):
    masa = _ing(db, "Masa", "insumo", 0)
    v = _vendible(db, "Pastelito", [(masa, 2)])
    assert all(e["variante_id"] != v.id for e in client.get("/api/menu/existencias").json())
