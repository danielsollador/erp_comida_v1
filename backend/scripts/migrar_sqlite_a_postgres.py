"""Copia una base SQLite de este ERP a un esquema de PostgreSQL.

Para el local que venia vendiendo con `comida.db` y pasa a produccion: se
lleva TODO el historico --ventas, inventario, asientos, cierres-- tabla por
tabla, en el orden que dictan las claves foraneas, y deja las secuencias de
PostgreSQL apuntando al siguiente id libre.

Uso (dentro del contenedor del backend, que ya tiene la URL y el esquema):

    docker compose exec backend python -m scripts.migrar_sqlite_a_postgres /data/comida.db

o desde fuera, con las variables a mano:

    ERP_DATABASE_URL=postgresql+psycopg://... ERP_DB_SCHEMA=savora \
        python -m scripts.migrar_sqlite_a_postgres ./comida.db

Se niega a copiar sobre un esquema que ya tenga pedidos, salvo `--forzar`:
migrar dos veces duplicaria todo.
"""
from __future__ import annotations

import argparse
import sys

from sqlalchemy import create_engine, event, inspect, select, text

from app import models  # noqa: F401  (registra las tablas en Base)
from app.database import Base, engine as destino, preparar_esquema
from app.settings import DB_SCHEMA, ES_POSTGRES


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("sqlite", help="ruta al comida.db de origen")
    parser.add_argument("--forzar", action="store_true",
                        help="copiar aunque el esquema de destino ya tenga pedidos")
    args = parser.parse_args()

    if not ES_POSTGRES:
        print("ERP_DATABASE_URL no apunta a PostgreSQL: no hay a donde migrar.")
        return 2

    origen = create_engine(f"sqlite:///{args.sqlite}")

    @event.listens_for(origen, "connect")
    def _fk(con, _):
        con.execute("PRAGMA foreign_keys=OFF")

    preparar_esquema()
    Base.metadata.create_all(bind=destino)

    with destino.connect() as con:
        ya = con.execute(text("SELECT COUNT(*) FROM pedidos")).scalar()
    if ya and not args.forzar:
        print(f"El esquema '{DB_SCHEMA}' ya tiene {ya} pedidos. Usa --forzar si de "
              f"verdad quieres copiar encima (duplicaria todo).")
        return 3

    tablas_origen = set(inspect(origen).get_table_names())
    copiadas = 0
    # `sorted_tables` respeta las claves foraneas: padres antes que hijos.
    with destino.begin() as con:
        # Sin disparar las FKs mientras se copia: el orden ya es el correcto,
        # pero una fila huerfana del SQLite (que nunca comprobo FKs hasta hace
        # poco) no puede tumbar la migracion entera a mitad.
        con.execute(text("SET CONSTRAINTS ALL DEFERRED"))
        for tabla in Base.metadata.sorted_tables:
            if tabla.name not in tablas_origen:
                continue
            columnas_origen = {c["name"] for c in inspect(origen).get_columns(tabla.name)}
            columnas = [c for c in tabla.columns if c.name in columnas_origen]
            with origen.connect() as o:
                filas = o.execute(select(*columnas)).mappings().all()
            if not filas:
                continue
            con.execute(tabla.insert(), [dict(f) for f in filas])
            copiadas += len(filas)
            print(f"  {tabla.name:<24} {len(filas):>7} filas")

        # Las secuencias de los ids: PostgreSQL no sabe que ya repartimos hasta
        # el 1.014, y el siguiente INSERT chocaria con una clave existente.
        for tabla in Base.metadata.sorted_tables:
            if tabla.name not in tablas_origen:
                continue
            for col in tabla.primary_key.columns:
                if col.autoincrement is False or col.type.python_type is not int:
                    continue
                con.execute(text(
                    f"SELECT setval(pg_get_serial_sequence('{DB_SCHEMA}.{tabla.name}', '{col.name}'), "
                    f"COALESCE((SELECT MAX({col.name}) FROM {tabla.name}), 0) + 1, false)"))

    print(f"Listo: {copiadas} filas copiadas al esquema '{DB_SCHEMA}'.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
