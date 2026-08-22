from .database import SessionLocal
from .models import Producto

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


def seed_if_empty():
    db = SessionLocal()
    try:
        if db.query(Producto).count() == 0:
            for nombre, categoria, precio in PRODUCTOS_DEMO:
                db.add(Producto(nombre=nombre, categoria=categoria, precio=precio))
            db.commit()
    finally:
        db.close()
