from .database import SessionLocal
from .models import Ingrediente, Producto, RecetaItem

PRODUCTOS_DEMO = [
    ("Empanada de carne", "comida", 1.5),
    ("Empanada de pollo", "comida", 1.5),
    ("Empanada de queso", "comida", 1.3),
    ("Pastelito de carne", "comida", 1.2),
    ("Pastelito de queso", "comida", 1.2),
    ("Cafe", "bebida", 1.0),
    ("Jugo natural", "bebida", 1.5),
    ("Refresco", "bebida", 1.0),
]

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

# nombre producto -> [(nombre ingrediente, cantidad por unidad vendida)]
RECETAS_DEMO = {
    "Empanada de carne": [("Harina", 0.06), ("Carne molida", 0.04)],
    "Empanada de pollo": [("Harina", 0.06), ("Pollo", 0.04)],
    "Empanada de queso": [("Harina", 0.06), ("Queso", 0.05)],
    "Pastelito de carne": [("Harina", 0.03), ("Carne molida", 0.02)],
    "Pastelito de queso": [("Harina", 0.03), ("Queso", 0.03)],
    "Cafe": [("Cafe molido", 0.02), ("Azucar", 0.01)],
    "Jugo natural": [("Naranja", 0.3)],
    "Refresco": [("Refresco concentrado", 0.35)],
}


def seed_if_empty():
    db = SessionLocal()
    try:
        if db.query(Producto).count() == 0:
            for nombre, categoria, precio in PRODUCTOS_DEMO:
                db.add(Producto(nombre=nombre, categoria=categoria, precio=precio))
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
            productos = {p.nombre: p for p in db.query(Producto).all()}
            ingredientes = {i.nombre: i for i in db.query(Ingrediente).all()}
            for producto_nombre, items in RECETAS_DEMO.items():
                producto = productos.get(producto_nombre)
                if not producto:
                    continue
                for ingrediente_nombre, cantidad in items:
                    ingrediente = ingredientes.get(ingrediente_nombre)
                    if not ingrediente:
                        continue
                    db.add(
                        RecetaItem(
                            producto_id=producto.id,
                            ingrediente_id=ingrediente.id,
                            cantidad_por_unidad=cantidad,
                        )
                    )
            db.commit()
    finally:
        db.close()
