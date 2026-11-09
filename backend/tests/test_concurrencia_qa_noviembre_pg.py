"""QA de noviembre (R2) en PostgreSQL: dos personas pagando lo mismo a la vez.

En SQLite no hay bloqueo de fila, asi que estas cerraduras solo se prueban
aqui. La primera persona paga y se queda sin confirmar; la segunda llega en
ese momento y tiene que esperar y ver el pago de la primera.

    ERP_TEST_PG_URL=postgresql+psycopg://postgres:clave@localhost:55432/postgres
"""
import datetime
import os
import threading
import time

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import contabilidad, models, schemas
from app.database import Base
from app.routers import compras, egresos
from app.seed import asegurar_categoria_envios

URL = os.getenv("ERP_TEST_PG_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin ERP_TEST_PG_URL: esta prueba necesita PostgreSQL")


class _Pedido:
    """Lo minimo de un Request para las salvaguardas: sin cabeceras."""
    headers: dict = {}

    class state:
        sesion = {"usuario": "admin", "rol": "admin"}


@pytest.fixture()
def Sesion():
    engine = create_engine(URL)
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    fabrica = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    s = fabrica()
    contabilidad.seed_plan_de_cuentas(s)
    asegurar_categoria_envios(s)
    contabilidad.crear_asiento(s, "Aporte", [("1020", 5000.0, 0.0), ("3010", 0.0, 5000.0)], origen="manual",
                               fecha=datetime.datetime.now() - datetime.timedelta(days=2))
    s.commit()
    s.close()
    abiertas = []

    def nueva():
        sesion = fabrica()
        abiertas.append(sesion)
        return sesion

    yield nueva
    for sesion in abiertas:
        sesion.close()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def _a_la_vez(Sesion, accion):
    """La primera hace la accion y espera un segundo antes de confirmar; la
    segunda la intenta en ese momento. Devuelve que le paso a la segunda."""
    hecho = threading.Event()
    r = {}

    def uno():
        s = Sesion()
        try:
            accion(s)
            hecho.set()
            time.sleep(1.0)
            s.commit()
        finally:
            s.close()

    def dos():
        hecho.wait(10)
        s = Sesion()
        try:
            accion(s)
            s.commit()
            r["paso"] = True
        except HTTPException as e:
            s.rollback()
            r["rechazo"] = e.status_code
        finally:
            s.close()

    hilos = [threading.Thread(target=uno), threading.Thread(target=dos)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join(30)
    return r


def test_dos_personas_pagando_la_misma_factura_pagan_una_vez(Sesion):
    """QA nov: «Pagar» dos veces en una factura a crédito la pagaba dos veces."""
    s = Sesion()
    fid = compras._crear_factura(schemas.FacturaCompraCreate.model_validate({
        "numero_factura": "PG-1", "proveedor_nombre": "Prov", "proveedor_rif": "J-40000011-0", "forma_pago": "Credito",
        "gastos": [{"concepto": "Servicio", "monto": 50}], "iva": 8,
    }), s).id
    s.close()

    r = _a_la_vez(Sesion, lambda s: compras.pagar_factura(fid, schemas.PagoFacturaRequest(forma_pago="Transferencia", referencia="T1"), s))
    assert r.get("rechazo") == 409, f"la segunda tenía que ver la factura ya pagada: {r}"
    s = Sesion()
    pagos = s.query(models.AsientoContable).filter_by(origen="pago_factura", referencia_id=fid).count()
    assert pagos == 1


def test_dos_personas_pagando_el_mismo_alquiler_preguntan_antes_del_segundo(Sesion):
    """QA nov: el alquiler de $300 se pagaba dos veces con dos toques."""
    s = Sesion()
    fijo = models.PagoFijo(beneficiario="Casero", concepto="Alquiler", monto=300, moneda="USD", metodo_pago="Transferencia",
                           frecuencia="mensual", proximo=datetime.date.today(), activo=True)
    s.add(fijo)
    s.commit()
    fid = fijo.id
    s.close()

    r = _a_la_vez(Sesion, lambda s: egresos.pagar_fijo(fid, schemas.PagarFijo(referencia="A1"), _Pedido(), s))
    assert r.get("rechazo") == 428, f"la segunda tenía que ver el pago de la primera y preguntar: {r}"
    s = Sesion()
    assert s.query(models.PagoSinFactura).filter_by(pago_fijo_id=fid).count() == 1
