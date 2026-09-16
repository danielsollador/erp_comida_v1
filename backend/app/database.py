"""La conexion a la base.

PRODUCCION: PostgreSQL, un esquema por local. El `search_path` de cada
conexion lleva SOLO el esquema de este local (y `public`, que esta vacio), asi
que `SELECT * FROM pedidos` es siempre `savora.pedidos` y nunca el de otro
cliente. `create_all` y las migraciones trabajan dentro del mismo esquema sin
que el resto del codigo tenga que saberlo.

DESARROLLO SIN DOCKER Y PRUEBAS: SQLite, con las claves foraneas encendidas
(SQLite las ignora salvo que se le pida).
"""
import re

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import declarative_base, sessionmaker

from .settings import DATABASE_URL, DB_SCHEMA, ES_POSTGRES

if ES_POSTGRES:
    # El nombre del esquema va dentro de SQL sin parametros (CREATE SCHEMA no
    # los admite), asi que se valida antes: solo lo que puede ser un
    # identificador de PostgreSQL sin comillas raras.
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", DB_SCHEMA):
        raise SystemExit(
            f"ERP_DB_SCHEMA={DB_SCHEMA!r} no es un nombre de esquema valido "
            f"(minusculas, digitos y guion bajo, empezando por letra).")
    connect_args = {
        # Lo que hace que este proceso vea SOLO su esquema.
        "options": f"-c search_path={DB_SCHEMA},public",
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
Base = declarative_base()


def preparar_esquema() -> None:
    """Crea el esquema de este local si no existe. Va ANTES de `create_all`:
    con el search_path apuntando a un esquema inexistente, PostgreSQL crearia
    las tablas en `public` sin avisar -- y ahi se mezclarian los locales."""
    if not ES_POSTGRES:
        return
    with engine.begin() as con:
        con.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{DB_SCHEMA}"'))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
