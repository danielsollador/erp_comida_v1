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

from . import models


def consumo_bruto(receta: models.RecetaItem, unidades: float) -> float:
    """Cuanto sale del inventario para producir `unidades` de esa variante.

    La receta guarda la cantidad UTILIZABLE por unidad vendida (es lo que pide
    el editor de recetas). Si el insumo rinde menos del 100% hay que sacar mas
    del inventario para obtener esa cantidad util: 0.04 kg de carne utilizable
    con 92% de rendimiento consumen 0.0435 kg de los comprados.

    Antes se descontaba la cantidad util tal cual mientras el costo si usaba
    `costo_efectivo`, y esa asimetria hacia que el inventario contable y el
    fisico se separaran solos.
    """
    rendimiento = (receta.ingrediente.rendimiento_pct or 100) / 100
    if rendimiento <= 0:
        rendimiento = 1
    return receta.cantidad_por_unidad * unidades / rendimiento


def registrar_entrada(ingrediente: models.Ingrediente, cantidad: float, costo_unitario: float) -> None:
    """Suma stock y recalcula el costo promedio ponderado. No hace commit."""
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
    ingrediente.stock_actual = nuevo_stock
