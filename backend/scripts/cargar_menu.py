"""Carga el menu inicial de Savora: categorias, productos y precios.

Pensado para correr UNA VEZ sobre una base con el menu vacio (justo despues
de `reset_operativo.py`). Cada producto nace con una sola variante llamada
"Regular": el dueño todavia no separo tamaños, y el frontend ya sabe mostrar
un producto de una sola variante sin el sufijo (ver lib/menu.ts).

    docker compose exec backend python -m scripts.cargar_menu

Es idempotente por nombre de categoria: si una categoria con ese nombre ya
existe (activa), no la duplica -- pero SI puede duplicar productos si se
corre dos veces, asi que no se corre dos veces sobre la misma base.
"""

from app.database import SessionLocal
from app import models

# categoria -> [(producto, [(variante, precio), ...])]
MENU = {
    "Bebidas": [
        ("Cafe negro", [("Pequeno", 1.50), ("Grande", 2.20)]),
        ("Cafe con leche", [("Pequeno", 2.50), ("Grande", 3.00)]),
        ("Refresco 330ml (7up y pepsi)", [("Regular", 2.00)]),
        ("Malta lata 335ml", [("Regular", 2.00)]),
        ("Gatorade", [("Regular", 2.80)]),
        ("Te lipton", [("Regular", 3.00)]),
        ("Yukery 250ml", [("Regular", 2.00)]),
        ("Agua 330ml", [("Regular", 1.50)]),
        ("Papelon con limon", [("Regular", 2.00)]),
        ("Jugo natural", [("Regular", 2.00)]),
        ("Agua sparkling 500ml", [("Regular", 2.40)]),
    ],
    "Pastelitos": [
        ("Pastelito ranchero", [("Regular", 2.00)]),
        ("Pastelito granjero", [("Regular", 2.00)]),
        ("Pastelito jamon y queso", [("Regular", 2.00)]),
        ("Pastelito queso", [("Regular", 2.00)]),
        ("Pastelito mechada con amarillo", [("Regular", 2.00)]),
        ("Pastelito pollo con amarillo", [("Regular", 2.00)]),
        ("Pastelito pernil", [("Regular", 2.00)]),
        ("Pastelito pizza", [("Regular", 2.00)]),
    ],
    # Vacia a proposito: el dueño la llena despues.
    "Pastelitos Gourmet": [],
    "Empanadas": [
        ("Empanada queso", [("Regular", 2.00)]),
        ("Empanada pollo", [("Regular", 2.00)]),
        ("Empanada mechada", [("Regular", 2.50)]),
        ("Empanada mechada con amarillo", [("Regular", 2.50)]),
        ("Empanada pollo con amarillo", [("Regular", 2.50)]),
    ],
}


def main() -> int:
    db = SessionLocal()
    try:
        existentes = {c.nombre for c in db.query(models.Categoria).filter_by(activo=True).all()}
        chocan = existentes & set(MENU)
        if chocan:
            print(f"Ya existen estas categorías, no se toca nada: {', '.join(sorted(chocan))}")
            return 1

        for orden, (cat_nombre, productos) in enumerate(MENU.items()):
            cat = models.Categoria(nombre=cat_nombre, orden=orden)
            db.add(cat)
            db.flush()
            for prod_nombre, variantes in productos:
                prod = models.Producto(categoria_id=cat.id, nombre=prod_nombre)
                db.add(prod)
                db.flush()
                for var_nombre, precio in variantes:
                    db.add(models.Variante(producto_id=prod.id, nombre=var_nombre, precio=precio))
            print(f"{cat_nombre}: {len(productos)} producto(s)")

        db.commit()
        print("\nMenú cargado.")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
