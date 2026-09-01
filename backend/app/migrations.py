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
