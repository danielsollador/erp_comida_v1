"""Migraciones minimas para bases que ya estan en produccion.

`Base.metadata.create_all` crea tablas nuevas pero NO agrega columnas a una
tabla que ya existe. Un local que lleva meses vendiendo no puede perder su
historico por una columna nueva, asi que las columnas agregadas despues del
primer despliegue se anaden aca, de forma idempotente.

Cada paso pregunta primero si la columna ya esta: correr esto mil veces es
inofensivo.

DOS MOTORES. En produccion la base es PostgreSQL; en desarrollo sin Docker y
en las pruebas, SQLite. Los tipos de la lista estan escritos en el dialecto de
SQLite (que es el que existia) y se traducen al de PostgreSQL al aplicar:
`DATETIME` -> `TIMESTAMP`, `BOOLEAN DEFAULT 1` -> `DEFAULT TRUE`.

Relajar un NOT NULL tambien depende del motor: PostgreSQL tiene `ALTER COLUMN
... DROP NOT NULL`; SQLite no tiene ALTER COLUMN y hay que reconstruir la
tabla. Eso vive en `RELAJAR_NOT_NULL` y salio de un fallo real: la venta libre
guarda `pedido_items.variante_id` en NULL, y en una base que ya venia de antes
la columna seguia siendo NOT NULL, asi que el endpoint reventaba con
IntegrityError aunque los tests -que crean las tablas de cero- pasaran.
"""

import logging
import re

from sqlalchemy import inspect, text

from .database import engine
from .settings import ES_POSTGRES

log = logging.getLogger("erp.migrations")

# (tabla, columna, tipo SQL) - se agregan si faltan.
COLUMNAS = [
    ("TRX110_VEN_PEDIDO", "tasa_bcv", "FLOAT"),
    ("TRX110_VEN_PEDIDO", "facturado", "BOOLEAN DEFAULT 0"),
    ("TRX110_VEN_PEDIDO", "numero_factura", "VARCHAR"),
    ("TRX110_VEN_PEDIDO", "tasa_iva", "FLOAT"),
    ("DIM310_INV_INGREDIENTE", "rendimiento_pct", "FLOAT DEFAULT 100"),
    ("DIM310_INV_INGREDIENTE", "tipo", "VARCHAR DEFAULT 'insumo'"),
    ("DIM310_INV_INGREDIENTE", "activo", "BOOLEAN DEFAULT 1"),
    ("TRX410_COM_FACTURA", "pagada", "BOOLEAN DEFAULT 1"),
    ("TRX410_COM_FACTURA", "fecha_vencimiento", "DATETIME"),
    ("TRX410_COM_FACTURA", "fecha_pago", "DATETIME"),
    ("TRX620_CON_GASTO", "metodo_pago", "VARCHAR DEFAULT 'Efectivo'"),
    ("TRX320_INV_MERMA", "revertida", "BOOLEAN DEFAULT 0"),
    ("TRX110_VEN_PEDIDO", "devuelto", "BOOLEAN DEFAULT 0"),
    ("TRX110_VEN_PEDIDO", "fecha_devolucion", "DATETIME"),
    ("TRX110_VEN_PEDIDO", "nota_credito", "VARCHAR"),
    ("TRX110_VEN_PEDIDO", "motivo_devolucion", "VARCHAR DEFAULT ''"),
    ("DIM210_MEN_CATEGORIA", "activo", "BOOLEAN DEFAULT 1"),
    ("TRX510_CAJ_CIERRE", "anulado", "BOOLEAN DEFAULT 0"),
    ("TRX510_CAJ_CIERRE", "fecha_anulacion", "DATETIME"),
    ("TRX510_CAJ_CIERRE", "motivo_anulacion", "VARCHAR DEFAULT ''"),
    ("TRX510_CAJ_CIERRE", "divisas_esperado", "FLOAT DEFAULT 0"),
    ("TRX510_CAJ_CIERRE", "divisas_contado", "FLOAT DEFAULT 0"),
    ("TRX510_CAJ_CIERRE", "divisas_diferencia", "FLOAT DEFAULT 0"),
    ("TRX110_VEN_PEDIDO", "descuento", "FLOAT DEFAULT 0"),
    ("TRX110_VEN_PEDIDO", "motivo_descuento", "VARCHAR DEFAULT ''"),
    ("TRX110_VEN_PEDIDO", "propina", "FLOAT DEFAULT 0"),
    ("TRX110_VEN_PEDIDO", "cliente", "VARCHAR DEFAULT ''"),
    ("TRX110_VEN_PEDIDO", "fiado_saldado", "BOOLEAN DEFAULT 0"),
    ("TRX110_VEN_PEDIDO", "fecha_cobro_fiado", "DATETIME"),
    ("TRX120_VEN_PAGO", "recibido", "FLOAT"),
    ("TRX120_VEN_PAGO", "vuelto_metodo", "VARCHAR"),
    ("TRX120_VEN_PAGO", "vuelto_monto", "FLOAT DEFAULT 0"),
    # Trazabilidad: quien hizo que. Nullable a proposito - todo lo cargado
    # antes de que existieran los operadores no tiene a quien atribuirse, y
    # inventarle un autor seria peor que dejarlo en blanco.
    ("TRX110_VEN_PEDIDO", "operador_id", "INTEGER"),
    ("TRX110_VEN_PEDIDO", "punto_venta_id", "INTEGER"),
    ("TRX110_VEN_PEDIDO", "anulado_por_id", "INTEGER"),
    ("TRX510_CAJ_CIERRE", "operador_id", "INTEGER"),
    ("TRX510_CAJ_CIERRE", "punto_venta_id", "INTEGER"),
    ("TRX630_CON_RETIRO_PROPIETARIO", "operador_id", "INTEGER"),
    ("TRX320_INV_MERMA", "operador_id", "INTEGER"),
    ("TRX620_CON_GASTO", "operador_id", "INTEGER"),
    ("TRX110_VEN_PEDIDO", "clave_cliente", "VARCHAR"),
    ("TRX320_INV_MERMA", "por_conteo", "BOOLEAN DEFAULT 0"),
    ("TRX340_INV_MOVIMIENTO", "costo_promedio", "FLOAT DEFAULT 0"),
    ("DIM310_INV_INGREDIENTE", "exento", "BOOLEAN DEFAULT 0"),
    ("TRX120_VEN_PAGO", "referencia", "VARCHAR DEFAULT ''"),
]


# Indices que no vienen con la columna. El UNIQUE de `clave_cliente` es lo
# que hace que la idempotencia aguante dos reintentos simultaneos: sin el,
# el chequeo "existe?" y el INSERT dejan una rendija por donde entran dos
# comandas iguales. `IF NOT EXISTS` funciona igual en SQLite y PostgreSQL.
# (tabla, nombre, sql). La tabla va delante porque cada indice solo se puede
# crear si LA SUYA existe: antes se miraba siempre la de pedidos, que servia
# cuando habia un solo indice en la lista y dejaba de servir al segundo.
INDICES = [
    ("TRX110_VEN_PEDIDO", "UQ_TRX110_VEN_PEDIDO_clave_cliente",
     'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_TRX110_VEN_PEDIDO_clave_cliente" '
     'ON "TRX110_VEN_PEDIDO" (clave_cliente)'),
    # Dos proveedores con el mismo RIF son el mismo proveedor, y el directorio
    # existe justamente para que no se dupliquen. El router avisa con palabras
    # (409); esto es la red por debajo, para lo que entre por otro camino.
    # Los RIF vacios no estorban: un indice unico admite todos los NULL que
    # quiera, tanto en PostgreSQL como en SQLite.
    ("DIM410_COM_PROVEEDOR", "UQ_DIM410_COM_PROVEEDOR_rif",
     'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_DIM410_COM_PROVEEDOR_rif" '
     'ON "DIM410_COM_PROVEEDOR" (rif)'),
]


# Valores que cambiaron de nombre: (tabla, columna, viejo, nuevo). La unidad
# se imprime en cada fila del inventario, en las recetas y en cada merma, y
# "litro" ocupa el triple que el resto ("kg", "ml"): en la tabla del inventario
# desalineaba la columna entera. Se renombra el dato y no solo lo que se
# muestra, para que no haya dos verdades sobre la misma fila.
VALORES = [
    ("DIM310_INV_INGREDIENTE", "unidad", "litro", "lt"),
    ("DIM310_INV_INGREDIENTE", "unidad", "litros", "lt"),
]


# (tabla, columna) que dejaron de ser obligatorias.
RELAJAR_NOT_NULL = [
    ("TRX111_VEN_PEDIDO_DET", "variante_id"),
]


# ── Nomenclatura CAPA###_MOD_ENTIDAD (ver la cabecera de models.py) ─────────
# Como se llamaba cada tabla antes. Una base que todavia tenga estos nombres
# se renombra al arrancar, ANTES de `create_all` (ver main.py). Los datos no
# se tocan: en PostgreSQL las claves foraneas apuntan por OID y en SQLite el
# RENAME reescribe las referencias.
RENOMBRES = {
    "operadores": "DIM910_USU_OPERADOR",
    "puntos_venta": "DIM110_VEN_PUNTO_VENTA",
    "categorias": "DIM210_MEN_CATEGORIA",
    "productos": "DIM220_MEN_PRODUCTO",
    "variantes": "DIM230_MEN_VARIANTE",
    "ingredientes": "DIM310_INV_INGREDIENTE",
    "receta_items": "REL250_REC_PRODUCTO_INGREDIENTE",
    "cambios_receta": "HIS250_REC_RECETA",
    "cambios_precio": "HIS220_MEN_PRECIO",
    "tasas_cambio": "TRX810_TAS_TASA",
    "configuracion": "CFG910_ADM_PARAMETRO",
    "configuracion_fiscal": "CFG710_IMP_FISCAL",
    "pedidos": "TRX110_VEN_PEDIDO",
    "pedido_items": "TRX111_VEN_PEDIDO_DET",
    "pagos_pedido": "TRX120_VEN_PAGO",
    "pedido_consumos": "TRX310_INV_CONSUMO",
    "mermas": "TRX320_INV_MERMA",
    "sobrantes_inventario": "TRX330_INV_SOBRANTE",
    "facturas_compra": "TRX410_COM_FACTURA",
    "factura_compra_items": "TRX411_COM_FACTURA_DET",
    "notas_credito_compra": "TRX420_COM_NOTA_CREDITO",
    "nota_credito_compra_items": "TRX421_COM_NOTA_CREDITO_DET",
    "compras_sueltas": "TRX430_COM_COMPRA_SUELTA",
    "cierres_caja": "TRX510_CAJ_CIERRE",
    "gastos": "TRX620_CON_GASTO",
    "retiros_propietario": "TRX630_CON_RETIRO_PROPIETARIO",
    "cuentas_contables": "DIM610_CON_CUENTA",
    "asientos_contables": "TRX610_CON_ASIENTO",
    "movimientos_contables": "TRX611_CON_ASIENTO_DET",
    "declaraciones_iva": "TRX710_IMP_DECLARACION_IVA",
    "activos_fijos": "DIM620_ACT_ACTIVO_FIJO",
    # Nacieron ya con la nomenclatura: solo estan aqui por si alguna base de
    # desarrollo alcanzo a crearlas con el nombre suelto.
    "movimientos_inventario": "TRX340_INV_MOVIMIENTO",
    "abonos_fiado": "TRX130_VEN_ABONO_FIADO",
    "proveedores": "DIM410_COM_PROVEEDOR",
}


def indexar_claves_foraneas(motor=None) -> list:
    """Le pone indice a toda clave foranea que no lo tenga. Devuelve los que creo.

    PostgreSQL indexa sola la clave PRIMARIA, nunca las foraneas. Sin indice,
    cada `JOIN` por esa columna y cada borrado del padre -que obliga a revisar
    si algun hijo lo apunta- recorren la tabla hija entera. Con 15 pedidos no
    se nota; con un anio de ventas es la diferencia entre abrir un reporte al
    instante y esperar segundos, y va empeorando sin que nadie lo vea venir.

    Se deduce del metadata en vez de escribir la lista a mano: asi una tabla
    nueva queda cubierta sola, sin que nadie tenga que acordarse.

    No lleva CONCURRENTLY a proposito: eso no puede ir dentro de una
    transaccion y estas tablas son chicas. Si algun dia una crece de verdad,
    ese indice se crea aparte y aqui ya lo encuentra hecho.
    """
    from . import models  # noqa: F401  (puebla Base.metadata)
    from .database import Base

    motor = motor or engine
    inspector = inspect(motor)
    tablas = set(inspector.get_table_names())
    creados = []

    for nombre, tabla in Base.metadata.tables.items():
        if nombre not in tablas:
            continue
        # Lo que ya esta cubierto por la izquierda: un indice compuesto sirve
        # para su PRIMERA columna, no para las del medio.
        cubiertas = {i["column_names"][0] for i in inspector.get_indexes(nombre)
                     if i.get("column_names")}
        pk = inspector.get_pk_constraint(nombre).get("constrained_columns") or []
        if pk:
            cubiertas.add(pk[0])

        for fk in tabla.foreign_key_constraints:
            columnas = [c.name for c in fk.columns]
            if len(columnas) != 1 or columnas[0] in cubiertas:
                continue
            columna = columnas[0]
            indice = f"IX_{nombre}_{columna}"
            if len(indice) > 63:  # limite de identificador de PostgreSQL
                log.warning("Indice %s demasiado largo, se omite", indice)
                continue
            with motor.begin() as con:
                con.execute(text(
                    f'CREATE INDEX IF NOT EXISTS "{indice}" ON "{nombre}" ("{columna}")'))
            cubiertas.add(columna)
            creados.append(indice)

    if creados:
        log.info("Indices de claves foraneas creados: %d", len(creados))
    return creados


def renombrar_tablas(motor=None) -> list:
    """Pone los nombres nuevos a las tablas que aun tengan el viejo. Devuelve
    las que renombro. Idempotente: en una base ya al dia no hace nada.

    Si conviven el nombre viejo y el nuevo no adivina cual manda: para; es la
    unica situacion en la que renombrar podria costar datos."""
    motor = motor or engine
    tablas = set(inspect(motor).get_table_names())
    hechas = []
    with motor.begin() as con:
        for viejo, nuevo in RENOMBRES.items():
            if viejo not in tablas:
                continue
            if nuevo in tablas:
                raise RuntimeError(
                    f"Existen {viejo} y {nuevo} a la vez: hay que decidir a mano cual se queda")
            con.execute(text(f'ALTER TABLE "{viejo}" RENAME TO "{nuevo}"'))
            hechas.append(nuevo)
            log.info("Tabla renombrada: %s -> %s", viejo, nuevo)
    if hechas and ES_POSTGRES:
        nombrar_restricciones(motor)
    return hechas


def nombrar_restricciones(motor=None) -> int:
    """Pone a las restricciones e indices de PostgreSQL los nombres de la norma
    (PK_, FK_, UQ_, IX_; `database.NOMBRES`), que es lo que SQLAlchemy usa para
    las tablas que crea de cero. Devuelve cuantos renombro.

    Solo PostgreSQL: SQLite no renombra restricciones y ahi no hay produccion.
    Los indices sueltos sobre `id` se borran en vez de renombrarse: la clave
    primaria ya tiene el suyo y el segundo solo ocupaba espacio."""
    motor = motor or engine
    if not ES_POSTGRES:
        return 0
    tipo_prefijo = {"p": "PK", "f": "FK", "u": "UQ"}
    cambios = 0
    with motor.begin() as con:
        filas = con.execute(text("""
            SELECT cl.relname, c.conname, c.contype, a.attname
            FROM pg_constraint c
            JOIN pg_class cl ON cl.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = cl.relnamespace
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
            WHERE n.nspname = current_schema()
              AND c.contype IN ('p', 'f', 'u')
              AND array_length(c.conkey, 1) = 1
        """)).fetchall()
        for tabla, nombre, tipo, columna in filas:
            prefijo = tipo_prefijo[tipo]
            nuevo = f"{prefijo}_{tabla}" if tipo == "p" else f"{prefijo}_{tabla}_{columna}"
            if nombre == nuevo:
                continue
            con.execute(text(f'ALTER TABLE "{tabla}" RENAME CONSTRAINT "{nombre}" TO "{nuevo}"'))
            cambios += 1

        # Indices que no respaldan una restriccion (los de `index=True`).
        filas = con.execute(text("""
            SELECT cl.relname, ic.relname, a.attname
            FROM pg_index i
            JOIN pg_class cl ON cl.oid = i.indrelid
            JOIN pg_class ic ON ic.oid = i.indexrelid
            JOIN pg_namespace n ON n.oid = cl.relnamespace
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
            WHERE n.nspname = current_schema()
              AND NOT i.indisprimary AND NOT i.indisunique
              AND i.indnkeyatts = 1
              AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)
        """)).fetchall()
        for tabla, indice, columna in filas:
            if columna == "id":
                con.execute(text(f'DROP INDEX "{indice}"'))
                cambios += 1
                continue
            nuevo = f"IX_{tabla}_{columna}"
            if indice == nuevo:
                continue
            con.execute(text(f'ALTER INDEX "{indice}" RENAME TO "{nuevo}"'))
            cambios += 1
    if cambios:
        log.info("Restricciones e indices puestos al dia: %d", cambios)
    return cambios


def _tipo_sql(tipo: str) -> str:
    """El tipo de la lista, en el dialecto del motor que toca."""
    if not ES_POSTGRES:
        return tipo
    t = tipo.replace("DATETIME", "TIMESTAMP")
    t = re.sub(r"\bFLOAT\b", "DOUBLE PRECISION", t)
    t = re.sub(r"BOOLEAN DEFAULT 1\b", "BOOLEAN DEFAULT TRUE", t)
    t = re.sub(r"BOOLEAN DEFAULT 0\b", "BOOLEAN DEFAULT FALSE", t)
    return t


def _es_not_null(inspector, tabla: str, columna: str) -> bool:
    for col in inspector.get_columns(tabla):
        if col["name"] == columna:
            return not col.get("nullable", True)
    return False


def _relajar_not_null_postgres(tabla: str, columna: str) -> None:
    with engine.begin() as con:
        con.execute(text(f'ALTER TABLE "{tabla}" ALTER COLUMN "{columna}" DROP NOT NULL'))
    log.info("Columna %s.%s ahora acepta NULL", tabla, columna)


def _relajar_not_null_sqlite(tabla: str, columna: str) -> None:
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
            con.execute(text(f'DROP TABLE IF EXISTS "{vieja}"'))
            con.execute(text(f'ALTER TABLE "{tabla}" RENAME TO "{vieja}"'))
            for (indice,) in con.execute(
                text(
                    "SELECT name FROM sqlite_master WHERE type='index' "
                    "AND tbl_name = :t AND sql IS NOT NULL"
                ),
                {"t": vieja},
            ).fetchall():
                con.execute(text(f'DROP INDEX "{indice}"'))
            modelo.create(bind=con)
            con.execute(
                text(f'INSERT INTO "{tabla}" ({columnas}) SELECT {columnas} FROM "{vieja}"')
            )
            con.execute(text(f'DROP TABLE "{vieja}"'))
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


def _relajar_not_null(tabla: str, columna: str) -> None:
    """Segun el motor. Las pruebas la llaman con un engine de SQLite de
    mentira, asi que la decision se toma por la configuracion y no por el
    engine que haya en ese momento."""
    if ES_POSTGRES:
        _relajar_not_null_postgres(tabla, columna)
    else:
        _relajar_not_null_sqlite(tabla, columna)


def _abrir_kardex() -> None:
    """Saldo inicial del libro de movimientos, una sola vez.

    El kardex nace vacio, pero el deposito del local no: hay insumos con
    existencia que entro antes de que este libro existiera. Sin una fila de
    apertura, el extracto de cada insumo arrancaria en cero y no cuadraria con
    su stock, y el primer conteo mostraria un sobrante enorme que nadie
    entiende.

    Es el mismo gesto que el asiento de apertura de la contabilidad: no se
    inventa historia, se declara el punto de partida. No toca el stock ni
    genera asiento -la existencia ya esta reconocida en 1040-, solo deja
    escrito de donde viene el saldo.
    """
    from . import models  # puebla Base.metadata
    from .database import SessionLocal
    from .timeutils import ahora

    db = SessionLocal()
    try:
        if db.query(models.MovimientoInventario).first() is not None:
            return  # ya se abrio: correr esto mil veces es inofensivo
        abiertos = 0
        for ing in db.query(models.Ingrediente).all():
            saldo = ing.stock_actual or 0
            if saldo == 0:
                continue
            db.add(models.MovimientoInventario(
                ingrediente_id=ing.id,
                fecha=ahora(),
                tipo="ajuste",
                cantidad=round(saldo, 4),
                costo_unitario=round(ing.costo_unitario or 0, 4),
                costo_promedio=round(ing.costo_unitario or 0, 4),
                valor=round(saldo * (ing.costo_unitario or 0), 2),
                saldo=round(saldo, 4),
                origen="apertura_kardex",
                nota="Existencia al empezar a llevar el libro de movimientos",
            ))
            abiertos += 1
        if abiertos:
            db.commit()
            log.info("Kardex abierto con %d insumo(s) con existencia", abiertos)
    finally:
        db.close()


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
            con.execute(text(f'ALTER TABLE "{tabla}" ADD COLUMN "{columna}" {_tipo_sql(tipo)}'))
            log.info("Columna agregada: %s.%s", tabla, columna)
            if tabla == "TRX410_COM_FACTURA" and columna == "pagada":
                # El DEFAULT 1 de arriba es correcto para Efectivo/Banco, pero
                # una factura a credito que ya existia antes de esta migracion
                # todavia se debe - no se puede asumir pagada solo por default.
                falso = "FALSE" if ES_POSTGRES else "0"
                con.execute(
                    text(f"""UPDATE "TRX410_COM_FACTURA" SET pagada = {falso} WHERE forma_pago = 'Credito'""")
                )

        for tabla, columna, viejo, nuevo in VALORES:
            if tabla not in tablas:
                continue
            resultado = con.execute(
                text(f'UPDATE "{tabla}" SET "{columna}" = :nuevo WHERE "{columna}" = :viejo'),
                {"nuevo": nuevo, "viejo": viejo},
            )
            if resultado.rowcount:
                log.info("%s.%s: %s filas de '%s' a '%s'", tabla, columna, resultado.rowcount, viejo, nuevo)

    # El inspector cachea lo que leyo; para lo que sigue hace falta uno nuevo.
    inspector = inspect(engine)
    with engine.begin() as con:
        for tabla, nombre, sql in INDICES:
            if tabla not in tablas:
                continue
            con.execute(text(sql))
            log.debug("Indice asegurado: %s", nombre)

    for tabla, columna in RELAJAR_NOT_NULL:
        if tabla not in tablas:
            continue
        if not _es_not_null(inspector, tabla, columna):
            continue
        _relajar_not_null(tabla, columna)

    # Va antes del kardex: le deja las restricciones con su nombre definitivo.
    # Idempotente y barato: no hace nada en una base ya al dia.
    nombrar_restricciones()
    indexar_claves_foraneas()

    # Va de ultimo: necesita que la tabla exista (la crea `create_all`) y que
    # las columnas nuevas ya esten puestas.
    _abrir_kardex()
