"""Dos personas cobrando la misma venta a la vez, en PostgreSQL de verdad.

SQLite ignora los bloqueos de fila, asi que esto solo se puede probar aqui.
Caso real (4-nov): al cruzarse dos cobros de una venta de $10 pasaban los dos y
la deuda quedaba en -$10. La primera persona cobra y todavia no confirma; la
segunda llega en ese instante. Tiene que esperar y rechazarse, por el camino
que sea.

Se salta si no hay base:
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

from app import contabilidad, cuentas_por_cobrar as cxc, models, schemas
from app.database import Base
from app.routers import caja
from app.seed import asegurar_categoria_envios

URL = os.getenv("ERP_TEST_PG_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin ERP_TEST_PG_URL: esta prueba necesita PostgreSQL")

ESPERA_ANTES_DE_CONFIRMAR = 1.0


@pytest.fixture()
def Sesion():
    engine = create_engine(URL)
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    fabrica = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    s = fabrica()
    contabilidad.seed_plan_de_cuentas(s)
    asegurar_categoria_envios(s)
    s.commit()
    s.close()
    yield fabrica
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def _venta_fiada(s, numero=1, monto=10.0):
    p = models.Pedido(
        numero=numero, estado="pagado", cliente="Ana",
        creado_en=datetime.datetime(2026, 11, 1, 12), cerrado_en=datetime.datetime(2026, 11, 1, 12),
    )
    s.add(p)
    s.flush()
    s.add(models.PagoPedido(pedido_id=p.id, metodo="Fiado", monto=monto))
    contabilidad.crear_asiento(s, "Venta a credito", [("1015", monto, 0.0), ("3010", 0.0, monto)], origen="manual")
    s.commit()
    return p.id


def _cobrar(s, pid):
    return cxc.cobrar(s, schemas.CobroClienteCreate(pedido_ids=[pid], metodo_pago="Efectivo $"))


def _abonar(s, pid):
    return cxc.abonar_ventas(s, schemas.AbonoAVentas(pedido_ids=[pid], monto=10.0, metodo_pago="Efectivo $"))


def _abonar_a_cuenta(s, pid):
    pedido = s.get(models.Pedido, pid)
    return cxc.abonar_a_cuenta(s, s.get(models.Cliente, pedido.cliente_id),
                               schemas.AbonoACuenta(monto=10.0, metodo_pago="Efectivo $"))


def _desde_ventas(s, pid):
    return caja.cobrar_fiado(pid, schemas.SaldarFiadoRequest(metodo_pago="Efectivo $"), s)


def _cruzar(Sesion, primero, segundo, pid):
    """La primera persona cobra y se queda sin confirmar mientras llega la
    segunda. Devuelve lo que le pasa a la segunda."""
    cobrado = threading.Event()
    resultado = {}

    def uno():
        s = Sesion()
        try:
            primero(s, pid)
            cobrado.set()
            time.sleep(ESPERA_ANTES_DE_CONFIRMAR)
            s.commit()
        finally:
            s.close()

    def dos():
        cobrado.wait(10)
        s = Sesion()
        try:
            segundo(s, pid)
            s.commit()
            resultado["paso"] = True
        except (cxc.ErrorCobro, HTTPException) as e:
            s.rollback()
            resultado["rechazo"] = getattr(e, "status", None) or e.status_code
        finally:
            s.close()

    hilos = [threading.Thread(target=uno), threading.Thread(target=dos)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join(30)
    assert not any(h.is_alive() for h in hilos), "se quedaron trancados"
    return resultado


@pytest.mark.parametrize(
    "segundo",
    [_cobrar, _abonar, _desde_ventas],
    ids=["cobro", "abono", "desde-ventas"],
)
def test_de_dos_cobros_cruzados_pasa_solo_uno(Sesion, segundo):
    s = Sesion()
    pid = _venta_fiada(s)
    s.close()

    resultado = _cruzar(Sesion, _cobrar, segundo, pid)

    assert resultado.get("rechazo") == 409, f"debia rechazarse y paso esto: {resultado}"
    s = Sesion()
    p = s.get(models.Pedido, pid)
    assert p.fiado_abonado == 10.0, "se cobro una sola vez"
    assert contabilidad.saldo_de_cuenta(s, "1015") == 0.0, "la deuda no baja de cero"
    assert s.query(models.AbonoFiado).count() == 1
    s.close()


def test_abonar_a_lo_que_debe_tambien_espera(Sesion):
    s = Sesion()
    pid = _venta_fiada(s)
    cliente = models.Cliente(nombre="Ana")
    s.add(cliente)
    s.flush()
    s.get(models.Pedido, pid).cliente_id = cliente.id
    s.commit()
    s.close()

    resultado = _cruzar(Sesion, _cobrar, _abonar_a_cuenta, pid)

    assert resultado.get("rechazo") == 409, f"debia rechazarse y paso esto: {resultado}"
    s = Sesion()
    assert contabilidad.saldo_de_cuenta(s, "1015") == 0.0
    s.close()


def test_anular_dos_veces_a_la_vez_reversa_una_sola(Sesion):
    s = Sesion()
    pid = _venta_fiada(s)
    cobro_id = _cobrar(s, pid).id
    s.commit()
    s.close()

    def anular(sesion, _pid):
        cxc.anular_cobro(sesion, sesion.get(models.CobroCliente, cobro_id))

    resultado = _cruzar(Sesion, anular, anular, pid)

    assert resultado.get("rechazo") == 409, f"debia rechazarse y paso esto: {resultado}"
    s = Sesion()
    assert contabilidad.saldo_de_cuenta(s, "1015") == 10.0, "vuelve a deberse una sola vez"
    s.close()


def test_dar_de_baja_dos_veces_a_la_vez_pasa_a_gasto_una_sola(Sesion):
    s = Sesion()
    pid = _venta_fiada(s)
    s.close()

    def baja(sesion, _pid):
        cxc.dar_por_perdida(sesion, sesion.get(models.Pedido, pid), "no paga")

    resultado = _cruzar(Sesion, baja, baja, pid)

    assert resultado.get("rechazo") == 409, f"debia rechazarse y paso esto: {resultado}"
    s = Sesion()
    assert contabilidad.saldo_de_cuenta(s, "6140") == 10.0
    s.close()
