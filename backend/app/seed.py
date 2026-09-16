from . import contabilidad
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

# nombre, unidad, stock_actual, stock_minimo, stock_objetivo, costo por unidad
# de medida, % que rinde util despues de preparar (100 = sin merma de cocina)
# Las cantidades son las de un local que abre con una semana de inventario: el
# stock inicial se consume de verdad con cada venta, asi que arrancar con medio
# kilo de cafe dejaria el inventario en negativo el primer dia.
INGREDIENTES_DEMO = [
    ("Harina", "kg", 30.0, 6.0, 35.0, 1.20, 100),
    ("Queso", "kg", 8.0, 2.0, 10.0, 6.50, 100),
    ("Carne molida", "kg", 12.0, 3.0, 15.0, 7.00, 92),  # pierde grasa al cocinar
    ("Pollo", "kg", 12.0, 3.0, 15.0, 4.50, 88),  # hueso, piel, cocina
    ("Cafe molido", "kg", 4.0, 1.0, 5.0, 12.00, 100),
    ("Azucar", "kg", 8.0, 2.0, 10.0, 1.10, 100),
    ("Naranja", "kg", 40.0, 10.0, 50.0, 1.50, 45),  # la cascara y la pulpa no rinden jugo
    ("Refresco concentrado", "lt", 30.0, 8.0, 35.0, 1.80, 100),
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
            from . import kardex

            for nombre, unidad, actual, minimo, objetivo, costo, rendimiento in INGREDIENTES_DEMO:
                ing = Ingrediente(
                    nombre=nombre,
                    unidad=unidad,
                    stock_actual=0,
                    stock_minimo=minimo,
                    stock_objetivo=objetivo,
                    costo_unitario=costo,
                    rendimiento_pct=rendimiento,
                )
                db.add(ing)
                db.flush()
                # La existencia entra POR EL LIBRO, no escribiendo el numero.
                # Sembrar el stock a mano dejaba el kardex arrancando en cero
                # contra un deposito lleno: el extracto de cada insumo nacia
                # descuadrado y el primer conteo mostraba un sobrante enorme
                # que nadie podia explicar.
                if actual:
                    kardex.anotar(
                        db, ing, actual, kardex.AJUSTE,
                        origen="apertura_kardex",
                        nota="Existencia al empezar a llevar el libro",
                    )
            db.commit()
            # El negocio arranca con mercancia que vale plata; si los libros
            # arrancan en cero, la cuenta de inventario se va a negativo apenas
            # se venda de ese stock inicial y el balance queda mintiendo.
            contabilidad.asiento_de_apertura(db)

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
