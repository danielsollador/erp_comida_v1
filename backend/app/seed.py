import unicodedata

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


CATEGORIA_ENVIOS = "Envios"


def _sin_tildes(texto: str) -> str:
    """Para COMPARAR nombres, no para guardarlos: sin tildes, sin mayusculas
    y sin espacios de sobra."""
    plano = unicodedata.normalize("NFD", texto or "")
    return "".join(c for c in plano if not unicodedata.combining(c)).strip().casefold()


_ENVIOS_NORMALIZADO = _sin_tildes(CATEGORIA_ENVIOS)


def categoria_envios(db):
    """La categoria de los envios, la escriba el dueño como la escriba.

    Se busca por el nombre SIN TILDES y sin mayusculas, no por la cadena
    exacta. El dueño puede renombrar cualquier categoria desde el menu, y
    "Envíos" --con tilde, que es como se escribe bien-- es lo primero que
    va a corregir. Con la comparacion exacta eso tenia dos consecuencias,
    las dos silenciosas:

      - `asegurar_categoria_envios` no la encontraba y creaba OTRA en el
        siguiente despliegue. El menu quedaba con "Envíos" y "Envios", una
        con las ventas y otra recien nacida.
      - `variantes_de_servicio` dejaba de reconocer los delivery, y la salud
        contable volvia a pedir "cargale la receta al delivery" para siempre
        -- un aviso que no se puede resolver, porque un envio no se cocina.

    Devuelve None si no existe ninguna todavia.
    """
    for c in db.query(Categoria).all():
        if _sin_tildes(c.nombre) == _ENVIOS_NORMALIZADO:
            return c
    return None


def variantes_de_servicio(db) -> set:
    """Las variantes que se venden sin que salga nada del deposito.

    Hoy son los envios. Un servicio no tiene receta POR DISEÑO --no se
    cocina--, asi que su costo cero es correcto y no un dato que falta.
    Sin esta lista, la salud contable y el reporte de productos pedian
    "cargarle la receta" al delivery todos los dias, y un aviso que nunca se
    puede resolver entrena a ignorar la pantalla entera.
    """
    categoria = categoria_envios(db)
    if categoria is None:
        return set()
    filas = (
        db.query(Variante.id)
        .join(Producto, Producto.id == Variante.producto_id)
        .filter(Producto.categoria_id == categoria.id)
        .all()
    )
    return {v_id for (v_id,) in filas}


def asegurar_categoria_envios(db=None):
    """El delivery como dos productos del menu, no un modulo aparte.

    Un envio no lleva receta ni mueve inventario -es un servicio, no algo que
    se cocine- pero por lo demas es exactamente un producto: tiene precio, se
    agrega a la comanda desde el POS y cuenta en el reporte de ventas. Crear un
    modulo de "Envios" completo para esto habria sido reinventar el menu con
    otro nombre.

    Se asegura sola en cada arranque -no solo en una base vacia como
    `seed_if_empty`- para que un local que ya viene vendiendo la reciba en el
    proximo despliegue sin que nadie tenga que crearla a mano.

    Recibe la sesion como parametro, igual que `seed_plan_de_cuentas`: quien
    llama decide si abre una nueva (produccion) o reutiliza la de la prueba
    (los tests aislan su base con `dependency_overrides`, que no alcanza a un
    `SessionLocal()` creado aca adentro).
    """
    propia = db is None
    if propia:
        db = SessionLocal()
    try:
        categoria = categoria_envios(db)
        if categoria is None:
            categoria = Categoria(nombre=CATEGORIA_ENVIOS, orden=99)
            db.add(categoria)
            db.flush()

        existentes = {
            p.nombre
            for p in db.query(Producto).filter_by(categoria_id=categoria.id).all()
        }
        for nombre, precio in (("Delivery corto", 1.5), ("Delivery largo", 3.0)):
            if nombre in existentes:
                continue
            producto = Producto(categoria_id=categoria.id, nombre=nombre, activo=True)
            db.add(producto)
            db.flush()
            # Sin variante no aparece en el POS: el resto del menu funciona
            # igual, "Regular" es el nombre que se usa cuando no hay tamanos.
            db.add(Variante(producto_id=producto.id, nombre="Regular", precio=precio, activo=True))
        db.commit()
    finally:
        if propia:
            db.close()


def seed_if_empty():
    db = SessionLocal()
    try:
        # "Vacia" sin contar los envios: esa categoria la asegura el arranque
        # ANTES de llegar aqui, y con ella sola la base ya no estaba "vacia",
        # asi que el menu de ejemplo no se sembraba nunca y las recetas de
        # ejemplo tampoco (no tenian variantes a las que pegarse).
        envios = categoria_envios(db)
        sin_menu = (
            db.query(Categoria)
            .filter(Categoria.id != (envios.id if envios else -1))
            .count()
            == 0
        )
        if sin_menu:
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
