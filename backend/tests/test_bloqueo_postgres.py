"""Los bloqueos de fila tienen que funcionar en Postgres, no solo en SQLite.

La ficha de una mercancia trae su categoria con un LEFT OUTER JOIN (lazy
"joined"). Postgres no deja `SELECT ... FOR UPDATE` sobre el lado que puede
venir vacio de un join externo: en produccion (7-oct) registrar una merma
devolvia 500 con "FOR UPDATE cannot be applied to the nullable side of an
outer join", y lo mismo pasaba al guardar una factura con renglones, contar
o anotar consumo del personal. Las pruebas corren en SQLite, que ignora el
bloqueo, y por eso nunca salto.

La salida es bloquear SOLO la tabla que se va a modificar:
`with_for_update(of=Tabla)` -> `FOR UPDATE OF "TABLA"`.
"""

import pathlib
import re

from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from app import models

APP = pathlib.Path(__file__).resolve().parent.parent / "app"


def test_ningun_bloqueo_sin_decir_que_tabla():
    """Un `with_for_update()` a secas vuelve a romper Postgres el dia que la
    tabla gane una relacion con join."""
    sueltos = []
    for archivo in APP.rglob("*.py"):
        for n, linea in enumerate(archivo.read_text(encoding="utf-8").splitlines(), 1):
            if re.search(r"\.with_for_update\(\s*\)", linea):
                sueltos.append(f"{archivo.name}:{n}")
    assert not sueltos, f"bloqueos sin `of=`: {sueltos}"


def test_el_bloqueo_de_la_mercancia_no_toca_la_categoria():
    q = (
        Session()
        .query(models.Ingrediente)
        .filter(models.Ingrediente.id == 1)
        .with_for_update(of=models.Ingrediente)
        .limit(1)
    )
    sql = str(q.statement.compile(dialect=postgresql.dialect()))
    assert "LEFT OUTER JOIN" in sql, "la categoria sigue viniendo con join"
    assert 'FOR UPDATE OF "DIM310_INV_INGREDIENTE"' in sql
