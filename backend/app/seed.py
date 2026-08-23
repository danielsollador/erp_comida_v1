from .database import SessionLocal
from .models import Categoria, Ingrediente, Producto, RecetaItem, Variante

# nombre categoria -> [(nombre producto, [(nombre variante, precio), ...])]
MENU_DEMO = {
    "Bebidas": [
        ("Cafe", [("Pequeno", 0.8), ("Grande", 1.2)]),
        ("Jugo natural", [("Regular", 1.5)]),
        ("Refresco", [("Regular", 1.0)]),
    ],
    "Comida": [
        ("Empanada", [("Carne", 1.5), ("Pollo", 1.5), ("Queso", 1.3)]),
        ("Pastelito", [("Carne", 1.2), ("Queso", 1.2)]),
    ],
}

# nombre, unidad, stock_actual, stock_minimo, stock_objetivo
INGREDIENTES_DEMO = [
    ("Harina", "kg", 5.0, 2.0, 10.0),
    ("Queso", "kg", 1.0, 1.0, 3.0),
    ("Carne molida", "kg", 2.0, 1.0, 4.0),
    ("Pollo", "kg", 2.0, 1.0, 4.0),
    ("Cafe molido", "kg", 0.5, 0.3, 1.0),
    ("Azucar", "kg", 2.0, 0.5, 3.0),
    ("Naranja", "kg", 3.0, 1.0, 5.0),
    ("Refresco concentrado", "litro", 4.0, 2.0, 6.0),
]

# (producto, variante) -> [(nombre ingrediente, cantidad por unidad vendida)]
RECETAS_DEMO = {
    ("Empanada", "Carne"): [("Harina", 0.06), ("Carne molida", 0.04)],
    ("Empanada", "Pollo"): [("Harina", 0.06), ("Pollo", 0.04)],
    ("Empanada", "Queso"): [("Harina", 0.06), ("Queso", 0.05)],
    ("Pastelito", "Carne"): [("Harina", 0.03), ("Carne molida", 0.02)],
    ("Pastelito", "Queso"): [("Harina", 0.03), ("Queso", 0.03)],
    ("Cafe", "Pequeno"): [("Cafe molido", 0.015), ("Azucar", 0.008)],
    ("Cafe", "Grande"): [("Cafe molido", 0.025), ("Azucar", 0.012)],
    ("Jugo natural", "Regular"): [("Naranja", 0.3)],
    ("Refresco", "Regular"): [("Refresco concentrado", 0.35)],
}


def seed_if_empty():
    db = SessionLocal()
    try:
        if db.query(Categoria).count() == 0:
            for orden, (categoria_nombre, productos) in enumerate(MENU_DEMO.items()):
                categoria = Categoria(nombre=categoria_nombre, orden=orden)
                db.add(categoria)
                db.flush()
                for producto_nombre, variantes in productos:
                    producto = Producto(categoria_id=categoria.id, nombre=producto_nombre)
                    db.add(producto)
                    db.flush()
                    for variante_nombre, precio in variantes:
                        db.add(Variante(producto_id=producto.id, nombre=variante_nombre, precio=precio))
            db.commit()

        if db.query(Ingrediente).count() == 0:
            for nombre, unidad, actual, minimo, objetivo in INGREDIENTES_DEMO:
                db.add(
                    Ingrediente(
                        nombre=nombre,
                        unidad=unidad,
                        stock_actual=actual,
                        stock_minimo=minimo,
                        stock_objetivo=objetivo,
                    )
                )
            db.commit()

        if db.query(RecetaItem).count() == 0:
            variantes = {
                (v.producto.nombre, v.nombre): v
                for v in db.query(Variante).all()
            }
            ingredientes = {i.nombre: i for i in db.query(Ingrediente).all()}
            for (producto_nombre, variante_nombre), items in RECETAS_DEMO.items():
                variante = variantes.get((producto_nombre, variante_nombre))
                if not variante:
                    continue
                for ingrediente_nombre, cantidad in items:
                    ingrediente = ingredientes.get(ingrediente_nombre)
                    if not ingrediente:
                        continue
                    db.add(
                        RecetaItem(
                            variante_id=variante.id,
                            ingrediente_id=ingrediente.id,
                            cantidad_por_unidad=cantidad,
                        )
                    )
            db.commit()
    finally:
        db.close()
