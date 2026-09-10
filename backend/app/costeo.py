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


def registrar_entrada(ingrediente: models.Ingrediente, cantidad: float, costo_unitario: float) -> None:
    """Suma stock y recalcula el costo promedio ponderado. No hace commit."""
    stock_previo = ingrediente.stock_actual or 0
    costo_previo = ingrediente.costo_unitario or 0
    nuevo_stock = stock_previo + cantidad

    if nuevo_stock <= 0:
        # Stock previo negativo o cero (dato historico inconsistente): no hay
        # base valida para promediar, se toma el costo de esta entrada tal cual.
        ingrediente.costo_unitario = round(costo_unitario, 4)
    else:
        ingrediente.costo_unitario = round(
            (stock_previo * costo_previo + cantidad * costo_unitario) / nuevo_stock, 4
        )
    ingrediente.stock_actual = nuevo_stock
