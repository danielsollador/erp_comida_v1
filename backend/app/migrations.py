"""Migraciones minimas para bases que ya estan en produccion.

`Base.metadata.create_all` crea tablas nuevas pero NO agrega columnas a una
tabla que ya existe. Un local que lleva meses vendiendo no puede perder su
historico por una columna nueva, asi que las columnas agregadas despues del
primer despliegue se anaden aca, de forma idempotente.

Cada paso pregunta primero si la columna ya esta: correr esto mil veces es
inofensivo.
"""

import logging

from sqlalchemy import inspect, text

from .database import engine

log = logging.getLogger("erp.migrations")

# (tabla, columna, tipo SQL) - se agregan si faltan.
COLUMNAS = [
    ("pedidos", "tasa_bcv", "FLOAT"),
    ("pedidos", "facturado", "BOOLEAN DEFAULT 0"),
    ("pedidos", "numero_factura", "VARCHAR"),
    ("pedidos", "tasa_iva", "FLOAT"),
    ("ingredientes", "rendimiento_pct", "FLOAT DEFAULT 100"),
    ("facturas_compra", "pagada", "BOOLEAN DEFAULT 1"),
    ("facturas_compra", "fecha_vencimiento", "DATETIME"),
    ("facturas_compra", "fecha_pago", "DATETIME"),
    ("gastos", "metodo_pago", "VARCHAR DEFAULT 'Efectivo'"),
    ("mermas", "revertida", "BOOLEAN DEFAULT 0"),
    ("pedidos", "devuelto", "BOOLEAN DEFAULT 0"),
    ("pedidos", "fecha_devolucion", "DATETIME"),
    ("pedidos", "nota_credito", "VARCHAR"),
    ("pedidos", "motivo_devolucion", "VARCHAR DEFAULT ''"),
]


def aplicar():
    inspector = inspect(engine)
    tablas = set(inspector.get_table_names())

    with engine.begin() as con:
        for tabla, columna, tipo in COLUMNAS:
            if tabla not in tablas:
                continue  # la crea create_all con la columna ya incluida
            existentes = {c["name"] for c in inspector.get_columns(tabla)}
            if columna in existentes:
                continue
            con.execute(text(f"ALTER TABLE {tabla} ADD COLUMN {columna} {tipo}"))
            log.info("Columna agregada: %s.%s", tabla, columna)
            if tabla == "facturas_compra" and columna == "pagada":
                # El DEFAULT 1 de arriba es correcto para Efectivo/Banco, pero
                # una factura a credito que ya existia antes de esta migracion
                # todavia se debe - no se puede asumir pagada solo por default.
                con.execute(
                    text("UPDATE facturas_compra SET pagada = 0 WHERE forma_pago = 'Credito'")
                )
