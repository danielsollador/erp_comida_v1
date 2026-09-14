"""Migraciones minimas para bases que ya estan en produccion.

`Base.metadata.create_all` crea tablas nuevas pero NO agrega columnas a una
tabla que ya existe. Un local que lleva meses vendiendo no puede perder su
historico por una columna nueva, asi que las columnas agregadas despues del
primer despliegue se anaden aca, de forma idempotente.

Cada paso pregunta primero si la columna ya esta: correr esto mil veces es
inofensivo.

Tampoco puede RELAJAR un NOT NULL: SQLite no tiene ALTER COLUMN, hace falta
reconstruir la tabla. Eso vive en `RELAJAR_NOT_NULL` y salio de un fallo real:
la venta libre guarda `pedido_items.variante_id` en NULL, y en una base que ya
venia de antes la columna seguia siendo NOT NULL, asi que el endpoint reventaba
con IntegrityError aunque los tests -que crean las tablas de cero- pasaran.
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
    ("categorias", "activo", "BOOLEAN DEFAULT 1"),
    ("cierres_caja", "anulado", "BOOLEAN DEFAULT 0"),
    ("cierres_caja", "fecha_anulacion", "DATETIME"),
    ("cierres_caja", "motivo_anulacion", "VARCHAR DEFAULT ''"),
    ("cierres_caja", "divisas_esperado", "FLOAT DEFAULT 0"),
    ("cierres_caja", "divisas_contado", "FLOAT DEFAULT 0"),
    ("cierres_caja", "divisas_diferencia", "FLOAT DEFAULT 0"),
    ("pedidos", "descuento", "FLOAT DEFAULT 0"),
    ("pedidos", "motivo_descuento", "VARCHAR DEFAULT ''"),
    ("pedidos", "propina", "FLOAT DEFAULT 0"),
    ("pedidos", "cliente", "VARCHAR DEFAULT ''"),
    ("pedidos", "fiado_saldado", "BOOLEAN DEFAULT 0"),
    ("pedidos", "fecha_cobro_fiado", "DATETIME"),
    ("pagos_pedido", "recibido", "FLOAT"),
    ("pagos_pedido", "vuelto_metodo", "VARCHAR"),
    ("pagos_pedido", "vuelto_monto", "FLOAT DEFAULT 0"),
    # Trazabilidad: quien hizo que. Nullable a proposito - todo lo cargado
    # antes de que existieran los operadores no tiene a quien atribuirse, y
    # inventarle un autor seria peor que dejarlo en blanco.
    ("pedidos", "operador_id", "INTEGER"),
    ("pedidos", "punto_venta_id", "INTEGER"),
    ("pedidos", "anulado_por_id", "INTEGER"),
    ("cierres_caja", "operador_id", "INTEGER"),
    ("cierres_caja", "punto_venta_id", "INTEGER"),
    ("retiros_propietario", "operador_id", "INTEGER"),
    ("mermas", "operador_id", "INTEGER"),
    ("gastos", "operador_id", "INTEGER"),
]


# (tabla, columna) que dejaron de ser obligatorias. Se reconstruye la tabla
# copiando los datos: es el unico camino en SQLite.
RELAJAR_NOT_NULL = [
    ("pedido_items", "variante_id"),
]


def _es_not_null(con, tabla: str, columna: str) -> bool:
    for fila in con.execute(text(f"PRAGMA table_info({tabla})")):
        if fila[1] == columna:
            return bool(fila[3])
    return False


def _relajar_not_null(tabla: str, columna: str) -> None:
    """Reconstruye la tabla para que esa columna acepte NULL.

    SQLite no tiene ALTER COLUMN: hay que copiar a una tabla nueva. Es el
    procedimiento que recomienda la documentacion de SQLite, con dos detalles
    que costaron sangre en pruebas:

      - El RENAME se lleva los indices con su nombre original, asi que al
        recrear la tabla chocan. Hay que soltarlos antes.
      - Todo va en UNA transaccion. En un intento anterior el rebuild fallo a
        mitad y dejo la tabla viva vacia con 1.014 filas en la copia: la
        transaccion unica es lo que hace que un fallo no cueste datos.

    Las claves foraneas se apagan mientras dura: con foreign_keys=ON el DROP de
    la tabla vieja rompe lo que la referencia.
    """
    # Importar `models` es lo que puebla Base.metadata. Sin esto la tabla no
    # aparece y la migracion se saltaba en silencio, que es peor que fallar:
    # el endpoint revienta despues con IntegrityError.
    from . import models  # noqa: F401
    from .database import Base

    modelo = Base.metadata.tables.get(tabla)
    if modelo is None:
        raise RuntimeError(
            f"No se puede reconstruir {tabla}: no esta en el metadata de SQLAlchemy"
        )

    columnas = ", ".join(c.name for c in modelo.columns)
    vieja = f"{tabla}_migrando"

    with engine.connect() as con:
        con.exec_driver_sql("PRAGMA foreign_keys=OFF")
        con.commit()

    try:
        with engine.begin() as con:
            con.execute(text(f"DROP TABLE IF EXISTS {vieja}"))
            con.execute(text(f"ALTER TABLE {tabla} RENAME TO {vieja}"))
            for (indice,) in con.execute(
                text(
                    "SELECT name FROM sqlite_master WHERE type='index' "
                    "AND tbl_name = :t AND sql IS NOT NULL"
                ),
                {"t": vieja},
            ).fetchall():
                con.execute(text(f"DROP INDEX {indice}"))
            modelo.create(bind=con)
            con.execute(
                text(f"INSERT INTO {tabla} ({columnas}) SELECT {columnas} FROM {vieja}")
            )
            con.execute(text(f"DROP TABLE {vieja}"))
    finally:
        with engine.connect() as con:
            con.exec_driver_sql("PRAGMA foreign_keys=ON")
            con.commit()

    log.info("Tabla reconstruida: %s.%s ahora acepta NULL", tabla, columna)

    # Si el rebuild dejo alguna referencia rota es mejor saberlo ahora que
    # descubrirlo con un reporte mal sumado dentro de tres meses.
    with engine.connect() as con:
        rotas = list(con.execute(text("PRAGMA foreign_key_check")))
        if rotas:
            log.error("Reconstruccion de %s dejo %d fila(s) huerfanas", tabla, len(rotas))


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

    for tabla, columna in RELAJAR_NOT_NULL:
        if tabla not in tablas:
            continue
        with engine.connect() as con:
            hace_falta = _es_not_null(con, tabla, columna)
        if hace_falta:
            _relajar_not_null(tabla, columna)
