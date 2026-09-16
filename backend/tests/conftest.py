"""Base de datos limpia y aislada por test, y una sesion abierta.

Se monta SQLite en memoria y se sobreescribe la dependencia `get_db`, asi los
tests nunca tocan `comida.db` ni dependen del historico del local.

EL ERP ESTA DETRAS DE UN LOGIN. El middleware de `main.py` cierra todas las
rutas salvo las del propio acceso, asi que el cliente de pruebas entra primero,
igual que un navegador. Se llama al endpoint de login en vez de parchear la
comprobacion: si se parcheara, el dia que el middleware se rompa los tests
seguirian verdes y el ERP quedaria abierto sin que nada avise.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import contabilidad, models, settings
from app.acceso import auth, roles, sesion, usuarios
from app.database import Base, get_db
from app.main import app

USUARIO_TEST = "admin"
CLAVE_TEST = "clave-de-prueba-larga"


@pytest.fixture(scope="session", autouse=True)
def _almacen_aislado(tmp_path_factory):
    """Los usuarios de prueba van a un directorio temporal: correr la suite en
    la maquina de alguien no puede crearle cuentas ni pisarle las suyas.

    De alcance `session` a proposito: un almacen recreado en cada test le
    borraria el usuario al cliente que ya habia entrado.
    """
    d = tmp_path_factory.mktemp("compartido")
    usuarios.SHARED_DIR = d
    usuarios.USERS_FILE = d / "users.json"
    # Los roles a medida viven al lado de los usuarios, en el mismo volumen.
    roles.RUTA = d / "roles.json"
    # Secreto fijo y de prueba: sin esto cada ejecucion crea uno en el
    # directorio compartido de verdad.
    sesion._CLAVE = b"secreto-de-pruebas-no-usar-en-produccion"
    settings.ES_HUB = False
    usuarios.crear(USUARIO_TEST, CLAVE_TEST, rol="admin")
    yield


@pytest.fixture(autouse=True)
def _sin_limite_de_intentos():
    """El limite del login cuenta por IP y en memoria. Entre tests la IP es
    siempre la misma; sin esto empezarian a fallar por 429."""
    auth._hits.clear()
    yield
    auth._hits.clear()


def entrar(cliente, usuario: str = USUARIO_TEST, clave: str = CLAVE_TEST):
    """Abre sesion sobre un cliente ya creado y lo devuelve."""
    r = cliente.post("/api/acceso/login", json={"usuario": usuario, "clave": clave})
    assert r.status_code == 200, f"el login de los tests fallo: {r.text}"
    return cliente


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    # Misma configuracion que produccion (ver database.py): sin esto los tests
    # correrian sin claves foraneas y no verian los errores que la app si
    # atraparia al correr de verdad.
    @event.listens_for(engine, "connect")
    def _activar_claves_foraneas(conexion, _registro):
        cursor = conexion.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(bind=engine)
    Sesion = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    sesion_db = Sesion()
    contabilidad.seed_plan_de_cuentas(sesion_db)
    try:
        yield sesion_db
    finally:
        sesion_db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def fuera(db):
    """Cliente SIN sesion, con los usuarios ya creados."""
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def client(db):
    """El habitual: con sesion de administrador. Es lo que necesita casi toda
    la suite, que prueba datos y no la puerta."""
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as c:
        entrar(c)
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def insumo(db):
    """Un insumo con merma de cocina, que es donde se esconden los errores."""
    ingrediente = models.Ingrediente(
        nombre="Carne molida",
        unidad="kg",
        stock_actual=10.0,
        stock_minimo=1.0,
        stock_objetivo=15.0,
        costo_unitario=8.0,
        rendimiento_pct=80.0,  # de 1 kg comprado quedan 800 g utilizables
    )
    db.add(ingrediente)
    db.commit()
    db.refresh(ingrediente)
    return ingrediente


@pytest.fixture()
def variante(db, insumo):
    """Un producto de $5 que lleva 0.1 kg utilizables de ese insumo."""
    categoria = models.Categoria(nombre="Comida", orden=0)
    db.add(categoria)
    db.flush()
    producto = models.Producto(categoria_id=categoria.id, nombre="Empanada")
    db.add(producto)
    db.flush()
    v = models.Variante(producto_id=producto.id, nombre="Carne", precio=5.0)
    db.add(v)
    db.flush()
    db.add(
        models.RecetaItem(
            variante_id=v.id, ingrediente_id=insumo.id, cantidad_por_unidad=0.1
        )
    )
    db.commit()
    db.refresh(v)
    return v


def saldo(db, codigo):
    """Saldo de una cuenta contable, con el signo de su naturaleza."""
    cuenta = db.query(models.CuentaContable).filter_by(codigo=codigo).first()
    movimientos = db.query(models.MovimientoContable).filter_by(cuenta_id=cuenta.id).all()
    total = sum(m.debe - m.haber for m in movimientos)
    return round(total if cuenta.naturaleza == "deudora" else -total, 2)


# ── Auditoria contable, compartida ──────────────────────────────────────────
# Vivian dentro de test_contabilidad_auditoria.py. Se subieron aca cuando una
# segunda tanda de pruebas (abonos de fiado) necesito revisar los mismos
# libros: duplicar una auditoria contable es garantizar que las dos copias
# terminen diciendo cosas distintas.

LOCAL_TOLERANCIA = 0.02


def inventario_fisico(db) -> float:
    return round(
        sum((i.stock_actual or 0) * (i.costo_unitario or 0) for i in db.query(models.Ingrediente).all()),
        2,
    )


def libros_cuadrados(client, db):
    """Lo que un contador revisa antes de firmar. Falla con el motivo."""
    filas = client.get("/api/contabilidad/balance-comprobacion").json()
    debe = round(sum(f["debe"] for f in filas), 2)
    haber = round(sum(f["haber"] for f in filas), 2)
    assert abs(debe - haber) < LOCAL_TOLERANCIA, f"balance de comprobacion: debe {debe} != haber {haber}"

    bg = client.get("/api/contabilidad/balance-general").json()
    assert bg["cuadra"], bg
    for f in bg["activos"]:
        if f["codigo"] in contabilidad.CUENTAS_CONTRA:
            continue
        assert f["saldo"] >= -LOCAL_TOLERANCIA, f"activo {f['codigo']} {f['nombre']} en negativo: {f['saldo']}"
    for f in bg["pasivos"]:
        assert f["saldo"] >= -LOCAL_TOLERANCIA, f"pasivo {f['codigo']} {f['nombre']} en negativo: {f['saldo']}"

    contable = saldo(db, "1040")
    fisico = inventario_fisico(db)
    assert abs(contable - fisico) < LOCAL_TOLERANCIA, f"inventario: libros {contable} vs fisico {fisico}"

    # Cada asiento cuadra por si solo (no solo la suma de todos).
    for a in db.query(models.AsientoContable).all():
        d = round(sum(m.debe for m in a.movimientos), 2)
        h = round(sum(m.haber for m in a.movimientos), 2)
        assert abs(d - h) < 0.011, f"asiento #{a.id} '{a.descripcion}' descuadrado: {d} vs {h}"


@pytest.fixture()
def libros(db, insumo, variante):
    """Los libros arrancan como en un local real: con el inventario reconocido
    y con plata en las gavetas y en el banco (el aporte inicial del dueño).
    Sin eso, la primera compra en efectivo dejaria la caja en negativo, y el
    negativo seria de la prueba, no del sistema."""
    contabilidad.asiento_de_apertura(db)
    contabilidad.crear_asiento(
        db,
        "Aporte inicial del dueño: caja chica y banco",
        [("1010", 100.0, 0.0), ("1011", 20.0, 0.0), ("1020", 100.0, 0.0), ("3010", 0.0, 220.0)],
        origen="manual",
    )
    db.commit()
    return db
