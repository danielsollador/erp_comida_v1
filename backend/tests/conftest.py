"""Base de datos limpia y aislada por test.

Se monta SQLite en memoria y se sobreescribe la dependencia `get_db`, asi los
tests nunca tocan `comida.db` ni dependen del historico del local.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import contabilidad, models
from app.database import Base, get_db
from app.main import app


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Sesion = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    sesion = Sesion()
    contabilidad.seed_plan_de_cuentas(sesion)
    try:
        yield sesion
    finally:
        sesion.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as c:
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
