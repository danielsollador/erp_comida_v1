"""Costeo promedio ponderado movil.

Cada vez que entra stock (por una compra, con o sin factura), el costo del
insumo se recalcula mezclando lo que ya habia con lo que acaba de entrar -
no se reemplaza. Es el metodo estandar para negocios que compran el mismo
insumo repetidas veces a precios distintos: evita que el costo (y por lo
tanto el margen mostrado) salte de golpe cada vez que sube un proveedor.

Formula: nuevo_costo = (stock_previo * costo_previo + cantidad * costo_compra)
                        / (stock_previo + cantidad)

Se usa desde dos lugares que antes no se hablaban entre si: "Registrar
compra" en Inventario (compra suelta, sin factura) y las lineas de una
Factura de compra. Vivir en un solo lugar es lo que garantiza que ambos
caminos calculen el costo exactamente igual.
"""

import threading
from contextlib import contextmanager

from . import models

# Tocar el stock es leer-calcular-escribir, y eso no es atomico. FastAPI corre
# los endpoints sincronos en un threadpool, asi que dos compras simultaneas del
# mismo insumo leian el mismo stock y la ultima pisaba a la anterior: de 10
# compras de 1 kg entraba 1 sola, mientras la contabilidad registraba las 10.
#
# Este candado sirve mientras la app corra en un proceso, que es el caso hoy.
# Con varios procesos (o varias instancias en la nube) haria falta ademas
# bloqueo a nivel de base: por eso los SELECT usan `with_for_update()`, que
# SQLite ignora pero Postgres si respeta.
_candado_inventario = threading.Lock()


@contextmanager
def bloqueo_inventario():
    """Serializa las modificaciones de stock dentro de este proceso."""
    with _candado_inventario:
        yield


def consumo_bruto(receta: models.RecetaItem, unidades: float) -> float:
    """Cuanto sale del inventario para producir `unidades` de esa variante.

    La receta guarda la cantidad UTILIZABLE por unidad vendida (es lo que pide
    el editor de recetas). Si el insumo rinde menos del 100% hay que sacar mas
    del inventario para obtener esa cantidad util: 0.04 kg de carne utilizable
    con 92% de rendimiento consumen 0.0435 kg de los comprados.

    Antes se descontaba la cantidad util tal cual mientras el costo si usaba
    `costo_efectivo`, y esa asimetria hacia que el inventario contable y el
    fisico se separaran solos.

    Una PREPARACION rinde 100 % a nivel de ficha: su merma de cocina ya vive
    en `rinde` (1 kg de pollo rinde 0,8 kg de guiso) y `explotar` la aplica
    al bajar por la receta. Dividir ademas por un `rendimiento_pct` la
    contaba dos veces.
    """
    if receta.ingrediente.tipo == "preparacion":
        return receta.cantidad_por_unidad * unidades
    rendimiento = (receta.ingrediente.rendimiento_pct or 100) / 100
    if rendimiento <= 0:
        rendimiento = 1
    return receta.cantidad_por_unidad * unidades / rendimiento


# Como se baja una preparacion hasta lo que de verdad se mueve en el deposito
# (ver `explotar`):
#   venta       lo producido primero y el resto por la receta (backflush)
#   receta      siempre por la receta, sin mirar lo producido
#   devolucion  una preparacion que se PRODUCE vuelve (o se pierde) como ella
#               misma; una que se descuenta, por la receta
MODOS_EXPLOTAR = ("venta", "receta", "devolucion")


def explotar(ingrediente: models.Ingrediente, cantidad: float, modo: str = "venta", _visitados=frozenset()):
    """Lo que de verdad sale del deposito por `cantidad` de algo.

    Lo comprado sale tal cual. Una PREPARACION se baja por su receta hasta la
    materia prima: 50 g de guiso de pollo que rinde 0,85 kg por cada 1 kg de
    pollo son 58,8 g de pollo, mas su cebolla y su pimenton. Una preparacion
    que se PRODUCE sale primero de lo producido y, si no alcanza, el resto
    del crudo (lo que en la industria se llama *backflush*): la venta nunca
    se traba porque la cocina no anoto la tanda. Ese es el modo "venta".

    "receta" baja siempre por la receta, sin mirar lo producido: es lo que
    usan la disponibilidad y la sugerencia de compra, que preguntan por el
    crudo que hace falta y no por lo que hay hecho.

    "devolucion" es el camino de vuelta: lo que se quita de una comanda. Una
    preparacion que se produce NO se explota: el guiso vuelve a la olla (o se
    bota como guiso), no vuelve como pollo crudo. Una que se descuenta del
    crudo si baja por la receta, porque nunca tuvo existencia propia.
    """
    if modo not in MODOS_EXPLOTAR:
        raise ValueError(f"modo de explotar desconocido: {modo!r}")
    if (
        ingrediente.tipo != "preparacion"
        or not ingrediente.lineas_preparacion
        or not ingrediente.rinde_real
        or ingrediente.rinde_real <= 0
        or ingrediente.id in _visitados
        or (modo == "devolucion" and ingrediente.modo_produccion == "producir")
    ):
        return {ingrediente: cantidad}
    resultado = {}
    resto = cantidad
    if modo == "venta" and ingrediente.modo_produccion == "producir":
        de_lo_hecho = min(max(ingrediente.stock_actual or 0, 0), cantidad)
        if de_lo_hecho > 0:
            resultado[ingrediente] = de_lo_hecho
            resto = cantidad - de_lo_hecho
        if resto <= 1e-9:
            return resultado
    dentro = _visitados | {ingrediente.id}
    for linea in ingrediente.lineas_preparacion:
        parte = resto * linea.cantidad / ingrediente.rinde_real
        for hoja, q in explotar(linea.ingrediente, parte, modo, dentro).items():
            resultado[hoja] = resultado.get(hoja, 0) + q
    return resultado


def explotar_consumo(consumo: dict, modo: str = "venta") -> dict:
    """`explotar` sobre un consumo ya sumado por insumo. Se suma ANTES de
    explotar para que dos renglones con el mismo guiso no cuenten dos veces
    lo que ya esta producido."""
    resultado = {}
    for ingrediente, cantidad in consumo.items():
        for hoja, q in explotar(ingrediente, cantidad, modo).items():
            resultado[hoja] = resultado.get(hoja, 0) + q
    if modo in ("venta", "devolucion") and resultado:
        resultado = _sustituir(resultado)
    return resultado


def diferencia_por_sustitucion(ingrediente: models.Ingrediente, bruto: float) -> float:
    """Cuanto cambia el costo de `bruto` de algo por los cambios de hoy: el
    pavo bruto que sale en lugar del pollo, a su costo, menos el pollo."""
    hojas = explotar(ingrediente, bruto, "venta")
    if not hojas:
        return 0.0
    cambiado = _sustituir(dict(hojas))
    antes = sum(q * (h.costo_unitario or 0) for h, q in hojas.items())
    despues = sum(q * (h.costo_unitario or 0) for h, q in cambiado.items())
    return despues - antes


def _sustituir(consumo: dict) -> dict:
    """Los cambios de hoy: lo que sale del pollo sale del pavo.

    La cantidad que se cambia es la UTIL (lo que el plato lleva): el pollo
    bruto se pasa a util con su rendimiento y de ahi a pavo bruto con el del
    pavo, por el factor que se dijo.
    """
    from sqlalchemy.orm import object_session

    from .timeutils import ahora

    db = object_session(next(iter(consumo)))
    if db is None:
        return consumo
    momento = ahora()
    vigentes = {
        s.original_id: s
        for s in db.query(models.Sustitucion).filter(
            models.Sustitucion.activa.is_(True),
            models.Sustitucion.desde <= momento,
            models.Sustitucion.hasta > momento,
        )
    }
    if not vigentes:
        return consumo
    resultado = {}
    for ing, q in consumo.items():
        s = vigentes.get(ing.id)
        if s is None or s.sustituto is None:
            resultado[ing] = resultado.get(ing, 0) + q
            continue
        util = q * (ing.rendimiento_pct or 100) / 100
        bruto = util * (s.factor or 1) * 100 / (s.sustituto.rendimiento_pct or 100)
        resultado[s.sustituto] = resultado.get(s.sustituto, 0) + bruto
    return resultado


def registrar_entrada(
    ingrediente: models.Ingrediente,
    cantidad: float,
    costo_unitario: float,
    db=None,
    *,
    origen: str = "",
    referencia_id=None,
    nota: str = "",
    tipo: str = "",
) -> None:
    """Suma stock y recalcula el costo promedio ponderado. No hace commit.

    Con `db` ademas anota el movimiento en el kardex. Es opcional y no por
    comodidad: `registrar_entrada` tambien se usa para deshacer entradas (una
    factura que se elimina), y ahi el movimiento lo anota quien llama, con su
    propio tipo y su motivo.
    """
    stock_previo = ingrediente.stock_actual or 0
    costo_previo = ingrediente.costo_unitario or 0

    # Un stock previo negativo no puede entrar en la formula: la existencia
    # negativa no tiene costo que promediar y, al restarle valor al numerador,
    # dispara el resultado por encima de cualquier precio realmente pagado
    # (con -9.9 kg previos, comprar a $2 daba $101/kg). Para promediar se parte
    # de cero; el stock negativo si se arrastra, porque representa consumo real
    # que todavia hay que reponer.
    base_para_promedio = max(stock_previo, 0)
    nuevo_stock = stock_previo + cantidad
    volumen = base_para_promedio + cantidad

    if volumen <= 0:
        ingrediente.costo_unitario = round(costo_unitario, 4)
    else:
        ingrediente.costo_unitario = round(
            (base_para_promedio * costo_previo + cantidad * costo_unitario) / volumen, 4
        )

    if db is None:
        ingrediente.stock_actual = nuevo_stock
        return

    # El kardex mueve el stock el mismo; se anota con el costo DE ESTA COMPRA,
    # no con el promedio recien calculado: el libro tiene que decir a como
    # entro, no a como quedo la mezcla.
    from . import kardex

    kardex.anotar(
        db,
        ingrediente,
        cantidad,
        tipo or kardex.COMPRA,
        costo_unitario=costo_unitario,
        origen=origen,
        referencia_id=referencia_id,
        nota=nota,
    )
