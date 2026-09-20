"""La nomenclatura de la base: CAPA###_MOD_ENTIDAD en mayusculas, y que una
base con los nombres viejos se pone al dia sin perder una fila."""
import re

import sqlalchemy as sa
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

from app import migrations, models  # noqa: F401  (registra las tablas)
from app.database import NOMBRES, Base

PATRON = re.compile(r"^(TRX|DIM|CFG|HIS|REL|DM_FACT|DM_DIM)(\d{3})_[A-Z]{3}_[A-Z][A-Z_]*[A-Z]$")

# La centena dice el modulo; las tres letras tienen que ser de ese modulo.
MODULO_POR_CENTENA = {
    "1": {"VEN"}, "2": {"MEN", "REC"}, "3": {"INV"}, "4": {"COM"}, "5": {"CAJ"},
    "6": {"CON", "ACT"}, "7": {"IMP"}, "8": {"TAS"}, "9": {"USU", "ADM"},
}


def test_todas_las_tablas_siguen_la_norma():
    nombres = sorted(Base.metadata.tables)
    assert len(nombres) == 41
    for n in nombres:
        m = PATRON.match(n)
        assert m, f"{n!r} no sigue CAPA###_MOD_ENTIDAD"
        capa, numero = m.group(1), m.group(2)
        # El modulo es lo que sigue a la capa y al numero: con `DM_FACT` la
        # capa lleva su propio guion bajo y partir por "_" daba "FACT110".
        modulo = n[len(capa) + len(numero) + 1:].split("_")[0]
        assert modulo in MODULO_POR_CENTENA[numero[0]], (
            f"{n}: la centena {numero[0]} no es del modulo {modulo}")
        assert len(n) <= 63 - len("IX__ingrediente_id"), f"{n}: demasiado largo para sus indices"


def test_el_numero_ordena_y_no_se_repite_dentro_de_una_capa():
    vistos = {}
    for n in Base.metadata.tables:
        capa, numero = PATRON.match(n).group(1, 2)
        assert (capa, numero) not in vistos, f"{n} y {vistos[(capa, numero)]} comparten numero"
        vistos[(capa, numero)] = n
    # El detalle va pegado a su cabecera: numero + 1.
    for cab, det in [("TRX110_VEN_PEDIDO", "TRX111_VEN_PEDIDO_DET"),
                     ("TRX410_COM_FACTURA", "TRX411_COM_FACTURA_DET"),
                     ("TRX420_COM_NOTA_CREDITO", "TRX421_COM_NOTA_CREDITO_DET"),
                     ("TRX610_CON_ASIENTO", "TRX611_CON_ASIENTO_DET")]:
        assert cab in Base.metadata.tables and det in Base.metadata.tables


def test_las_columnas_van_en_minusculas():
    for t in Base.metadata.tables.values():
        for c in t.columns:
            assert c.name == c.name.lower(), f"{t.name}.{c.name}"


def test_restricciones_e_indices_con_la_norma():
    for t in Base.metadata.tables.values():
        pk = t.primary_key
        assert pk.name == f"PK_{t.name}", (t.name, pk.name)
        for fk in t.foreign_key_constraints:
            col = list(fk.columns)[0].name
            assert fk.name == f"FK_{t.name}_{col}", (t.name, fk.name)
        for ix in t.indexes:
            assert ix.name.startswith(f"IX_{t.name}_"), (t.name, ix.name)
    # Sin indice aparte sobre `id`: la clave primaria ya trae el suyo.
    for t in Base.metadata.tables.values():
        assert not any(list(ix.columns)[0].name == "id" for ix in t.indexes), t.name
    assert NOMBRES["pk"] == "PK_%(table_name)s"


def test_renombres_cubre_todas_y_apunta_a_tablas_reales():
    """Cada renombre apunta a una tabla que existe de verdad.

    Lo que NO se pide es que toda tabla este en RENOMBRES: las que nacieron
    despues de la norma nunca tuvieron nombre viejo del que venir, y exigirles
    uno obligaria a inventar una tabla minuscula ficticia por cada tabla nueva.
    Lo que si tiene que cumplirse es al reves --nada en RENOMBRES puede apuntar
    a una tabla que no existe-- porque ese es el error que dejaria una base a
    medio renombrar.
    """
    assert len(migrations.RENOMBRES) == 34
    assert set(migrations.RENOMBRES.values()) <= set(Base.metadata.tables)
    assert all(v == v.lower() for v in migrations.RENOMBRES)


def _motor_viejo():
    """Una base con los nombres de antes y datos adentro."""
    motor = create_engine("sqlite://", connect_args={"check_same_thread": False},
                          poolclass=StaticPool)
    with motor.begin() as con:
        con.execute(text("CREATE TABLE categorias (id INTEGER PRIMARY KEY, nombre VARCHAR)"))
        con.execute(text("CREATE TABLE productos (id INTEGER PRIMARY KEY, nombre VARCHAR, "
                         "categoria_id INTEGER REFERENCES categorias(id))"))
        con.execute(text("INSERT INTO categorias VALUES (1, 'Bebidas')"))
        con.execute(text("INSERT INTO productos VALUES (7, 'Agua', 1)"))
    return motor


def test_una_base_vieja_se_renombra_sin_perder_filas():
    motor = _motor_viejo()
    hechas = migrations.renombrar_tablas(motor)
    assert set(hechas) == {"DIM210_MEN_CATEGORIA", "DIM220_MEN_PRODUCTO"}
    tablas = set(sa.inspect(motor).get_table_names())
    assert "categorias" not in tablas and "productos" not in tablas
    with motor.connect() as con:
        assert con.execute(text('SELECT nombre FROM "DIM220_MEN_PRODUCTO"')).scalar() == "Agua"
        fk = sa.inspect(motor).get_foreign_keys("DIM220_MEN_PRODUCTO")[0]
        assert fk["referred_table"] == "DIM210_MEN_CATEGORIA", "el RENAME tiene que arrastrar la FK"
    # Segunda pasada: ya no hay nada que hacer.
    assert migrations.renombrar_tablas(motor) == []


def test_si_conviven_viejo_y_nuevo_no_adivina():
    motor = _motor_viejo()
    with motor.begin() as con:
        con.execute(text('CREATE TABLE "DIM210_MEN_CATEGORIA" (id INTEGER PRIMARY KEY)'))
    try:
        migrations.renombrar_tablas(motor)
    except RuntimeError as e:
        assert "categorias" in str(e)
    else:
        raise AssertionError("tenia que negarse")


def test_create_all_encima_de_una_base_renombrada_no_duplica():
    motor = _motor_viejo()
    migrations.renombrar_tablas(motor)
    Base.metadata.create_all(bind=motor)
    tablas = set(sa.inspect(motor).get_table_names())
    assert len(tablas) == 41
    with motor.connect() as con:
        assert con.execute(text('SELECT COUNT(*) FROM "DIM220_MEN_PRODUCTO"')).scalar() == 1
