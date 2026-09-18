"""La conexion a la base.

PRODUCCION: PostgreSQL, un esquema por local. El `search_path` de cada
conexion lleva SOLO el esquema de este local (y `public`, que esta vacio), asi
que `SELECT * FROM "TRX110_VEN_PEDIDO"` es siempre `"SAVORA"."TRX110_VEN_PEDIDO"`
y nunca el de otro cliente. `create_all` y las migraciones trabajan dentro del mismo esquema sin
que el resto del codigo tenga que saberlo.

DESARROLLO SIN DOCKER Y PRUEBAS: SQLite, con las claves foraneas encendidas
(SQLite las ignora salvo que se le pida).
"""
import re

from sqlalchemy import MetaData, create_engine, event, text
from sqlalchemy.orm import declarative_base, sessionmaker

from .settings import DATABASE_URL, DB_SCHEMA, ES_POSTGRES

if ES_POSTGRES:
    # El nombre del esquema va dentro de SQL sin parametros (CREATE SCHEMA no
    # los admite), asi que se valida antes: solo lo que puede ser un
    # identificador de PostgreSQL sin comillas raras.
    if not re.fullmatch(r"[A-Z_][A-Z0-9_]{0,62}", DB_SCHEMA):
        raise SystemExit(
            f"ERP_DB_SCHEMA={DB_SCHEMA!r} no es un nombre de esquema valido "
            f"(mayusculas, digitos y guion bajo, empezando por letra).")
    connect_args = {
        # Para saber en `pg_stat_activity` que proceso es cada conexion.
        "application_name": f"erp-{DB_SCHEMA}",
    }
    engine = create_engine(
        DATABASE_URL,
        connect_args=connect_args,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
        pool_recycle=1800,
    )

    @event.listens_for(engine, "connect")
    def _fijar_search_path(conexion, _registro):
        """Lo que hace que este proceso vea SOLO su esquema.

        Va como SET al conectar y no en `options=-c search_path=...` porque el
        nombre lleva mayusculas y necesita comillas, y las comillas dentro de
        la cadena de opciones de libpq son terreno pantanoso. En autocommit a
        proposito: SET es transaccional en PostgreSQL, y el ROLLBACK con que el
        pool limpia cada conexion al devolverla lo desharia.
        """
        conexion.autocommit = True
        try:
            with conexion.cursor() as cur:
                cur.execute(f'SET search_path TO "{DB_SCHEMA}", public')
        finally:
            conexion.autocommit = False
else:
    connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
    engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)

    if DATABASE_URL.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def _activar_claves_foraneas(conexion, _registro):
            """SQLite ignora las claves foraneas salvo que se le pida lo contrario.

            Sin esto un borrado podia dejar filas apuntando a registros que ya no
            existen y la base no se quejaba: borrar una categoria se llevaba sus
            variantes por cascade y dejaba 419 lineas de venta huerfanas.
            """
            cursor = conexion.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Como se llaman las restricciones y los indices que crea SQLAlchemy. Sin esto
# PostgreSQL les pone `pedidos_pkey`, `ix_pedidos_id`, `pedidos_variante_id_fkey`
# y cada motor lo suyo; asi todos siguen la misma norma que las tablas (ver la
# cabecera de `models.py`). Los que ya existian se renombran al arrancar
# (`migrations.nombrar_restricciones`).
NOMBRES = {
    "pk": "PK_%(table_name)s",
    "fk": "FK_%(table_name)s_%(column_0_name)s",
    "ix": "IX_%(table_name)s_%(column_0_name)s",
    "uq": "UQ_%(table_name)s_%(column_0_name)s",
    "ck": "CK_%(table_name)s_%(constraint_name)s",
}
Base = declarative_base(metadata=MetaData(naming_convention=NOMBRES))


def preparar_esquema() -> None:
    """Crea el esquema de este local si no existe. Va ANTES de `create_all`:
    con el search_path apuntando a un esquema inexistente, PostgreSQL crearia
    las tablas en `public` sin avisar -- y ahi se mezclarian los locales."""
    if not ES_POSTGRES:
        return
    with engine.begin() as con:
        # Una base de antes de la nomenclatura tiene el esquema en minusculas
        # (`savora`): se renombra en vez de crear uno nuevo vacio al lado.
        viejo = DB_SCHEMA.lower()
        existentes = {
            f[0] for f in con.execute(text(
                "SELECT nspname FROM pg_namespace WHERE nspname IN (:a, :b)"),
                {"a": DB_SCHEMA, "b": viejo})
        }
        if viejo != DB_SCHEMA and viejo in existentes and DB_SCHEMA not in existentes:
            con.execute(text(f'ALTER SCHEMA "{viejo}" RENAME TO "{DB_SCHEMA}"'))
        con.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{DB_SCHEMA}"'))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
