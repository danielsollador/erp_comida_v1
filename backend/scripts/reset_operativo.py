"""Reset operativo: borra ventas, inventario, menu y recetas de PRUEBA.

QUE HACE. Vacia todo lo transaccional para que el local arranque de cero
manana: pedidos, pagos, consumo de inventario, movimientos, mermas, cierres
de caja, aperturas, gastos, retiros, compras de insumos y los asientos
contables que todo eso genero. Tambien vacia el menu (categorias, productos,
variantes, recetas) y los insumos, para volver a cargarlos limpios.

QUE NO TOCA. El PLAN DE CUENTAS (`DIM610_CON_CUENTA` / `CuentaContable`) se
queda intacto: son las cuentas en si, no los asientos. Con los asientos
vacios cada cuenta queda en saldo cero, que es exactamente el "arranca de
cero" que se pidio -- sin inventarse ni borrar la estructura contable.
Tampoco toca usuarios, roles, puntos de venta, ni la tasa de cambio.

COMO SE CORRE. Una sola vez, a mano, con el contenedor del backend:

    docker compose exec backend python -m scripts.reset_operativo --si

Sin `--si` solo muestra que borraria, sin tocar nada. Es irreversible sin un
respaldo -- se saca uno ANTES de correr esto con `--si`.
"""

import sys

from app.database import SessionLocal
from app import models


# Orden de borrado: primero lo que depende (FK) de otra tabla, al final lo
# que la sostiene. Cada tupla es (modelo, descripcion para el reporte).
ORDEN = [
    (models.SolicitudAutorizacion, "solicitudes de autorización"),
    (models.AbonoFiado, "abonos de fiado"),
    (models.PedidoEdicion, "ediciones de pedido"),
    (models.PedidoConsumo, "consumo de inventario por pedido"),
    (models.PedidoItem, "renglones de pedido"),
    (models.PagoPedido, "pagos"),
    (models.Pedido, "pedidos"),

    (models.CierreCajaLinea, "líneas de cierre de caja"),
    (models.CierreCaja, "cierres de caja"),
    (models.AperturaCaja, "aperturas de caja"),

    (models.Gasto, "gastos"),
    (models.RetiroPropietario, "retiros del dueño"),

    (models.MovimientoContable, "movimientos contables (asientos)"),
    (models.AsientoContable, "asientos contables"),

    (models.CambioPrecio, "historial de precios"),
    (models.CambioReceta, "historial de recetas"),
    (models.RecetaItem, "líneas de receta"),

    (models.NotaCreditoCompraItem, "renglones de nota de crédito"),
    (models.NotaCreditoCompra, "notas de crédito de compra"),
    # Nace SOLO de una factura de categoria "Activos" (una nevera, la
    # tablet): sin la factura no queda base para seguir depreciandolo, asi
    # que se va con ella.
    (models.ActivoFijo, "activos fijos"),
    (models.FacturaCompraItem, "renglones de factura de compra"),
    (models.FacturaCompra, "facturas de compra"),
    (models.CompraSuelta, "compras sueltas"),

    (models.MovimientoInventario, "movimientos de inventario"),
    (models.Merma, "mermas"),
    (models.SobranteInventario, "sobrantes de inventario"),
    (models.ConteoLinea, "líneas de conteo"),
    (models.Conteo, "conteos de inventario"),

    (models.Ingrediente, "insumos"),

    (models.Variante, "variantes de producto"),
    (models.Producto, "productos"),
    (models.Categoria, "categorías"),
]


def main() -> int:
    seco = "--si" not in sys.argv
    db = SessionLocal()
    try:
        print("Conteo antes de borrar:")
        total = 0
        for modelo, etiqueta in ORDEN:
            n = db.query(modelo).count()
            if n:
                total += n
                print(f"  {etiqueta} ({modelo.__tablename__}): {n}")

        if total == 0:
            print("\nNo hay nada que borrar.")
            return 0

        if seco:
            print(
                f"\n{total} fila(s) en total se borrarían. Nada se tocó "
                "(modo seco). Corre de nuevo con --si para aplicarlo -- "
                "saca un respaldo antes."
            )
            return 0

        for modelo, etiqueta in ORDEN:
            borrados = db.query(modelo).delete(synchronize_session=False)
            if borrados:
                print(f"Borrado: {borrados} de {etiqueta}")

        cuentas = db.query(models.CuentaContable).count()
        print(f"\nSe conserva el plan de cuentas intacto: {cuentas} cuenta(s), en cero.")

        db.commit()
        print("\nListo. Reset operativo aplicado.")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
