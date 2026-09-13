from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base

from .settings import DATABASE_URL

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)

if DATABASE_URL.startswith("sqlite"):

    @event.listens_for(engine, "connect")
    def _activar_claves_foraneas(conexion, _registro):
        """SQLite ignora las claves foraneas salvo que se le pida lo contrario.

        Sin esto un borrado podia dejar filas apuntando a registros que ya no
        existen y la base no se quejaba: borrar una categoria se llevaba sus
        variantes por cascade y dejaba 419 lineas de venta huerfanas. Es la
        proteccion mas barata que hay contra esa familia de errores.
        """
        cursor = conexion.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
