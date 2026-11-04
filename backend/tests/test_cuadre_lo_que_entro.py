"""El cuadre espera lo que entro, no lo que se debia.

Caso real (4-nov): una deuda de $10 cobrada por pago movil con $2 de comision.
Al banco entraron $8 y la fila de pago movil esperaba $10: la cajera veia un
faltante que no existia. Con efectivo y Zelle ya cuadraba, porque esas filas
salen de los libros; las que comparten la cuenta del banco (pago movil, punto y
transferencia) sumaban lo aplicado a la deuda.

Un dia ya cerrado no cambia: muestra lo que se guardo en su cierre.
"""
import datetime

import pytest

from app import conciliacion, models
from app.timeutils import hoy
from tests.conftest import caja_cerrar, libros_cuadrados
from tests.test_cuentas_por_cobrar import _venta_facturada, fiar


def _fila(client, metodo):
    d = client.get("/api/caja/resumen").json()
    return next(l for l in d["desglose"] if l["metodo"] == metodo)


def _cobrar(client, pedidos, metodo, **extra):
    r = client.post("/api/cobranzas/cobros", json={
        "pedido_ids": [p["id"] for p in pedidos], "metodo_pago": metodo, "referencia": "123456", **extra,
    })
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.parametrize("metodo", ["Pago movil", "Punto de venta", "Transferencia"])
@pytest.mark.parametrize("recibido", [8.0, 12.0], ids=["comision", "de-mas"])
def test_por_banco_espera_lo_que_entro(client, db, variante, libros, metodo, recibido):
    p = fiar(client, variante, cliente="Ana")
    sin_explicar = client.get("/api/caja/resumen").json()["otros_movimientos"]
    _cobrar(client, [p], metodo, recibido=recibido)
    assert _fila(client, metodo)["esperado"] == recibido
    assert client.get("/api/caja/resumen").json()["otros_movimientos"] == sin_explicar, "no queda resto sin explicar"
    libros_cuadrados(client, db)


@pytest.mark.parametrize("metodo", ["Pago movil", "Punto de venta", "Transferencia"])
def test_con_retencion_espera_lo_que_entro(client, db, variante, libros, metodo):
    p = _venta_facturada(client, db, variante)
    _cobrar(client, [p], metodo, retencion_iva_pct=75)
    assert _fila(client, metodo)["esperado"] == 8.96


def test_un_cobro_de_varias_ventas_cuenta_una_vez(client, db, variante, libros):
    a = fiar(client, variante, cliente="Ana")
    b = fiar(client, variante, cliente="Ana")
    _cobrar(client, [a, b], "Pago movil", recibido=16.0)
    assert _fila(client, "Pago movil")["esperado"] == 16.0


def test_abono_y_cobro_venta_por_venta_siguen_sumando_su_monto(client, variante):
    a = fiar(client, variante, cliente="Ana")
    b = fiar(client, variante, cliente="Luis")
    client.post("/api/cobranzas/abonos", json={
        "pedido_ids": [a["id"]], "monto": 3.0, "metodo_pago": "Pago movil", "referencia": "1",
    })
    client.post(f"/api/caja/fiado/{b['id']}/cobrar", json={"metodo_pago": "Pago movil", "monto": 4.0, "referencia": "2"})
    assert _fila(client, "Pago movil")["esperado"] == 7.0


def test_anular_el_cobro_lo_saca_del_cuadre(client, variante):
    p = fiar(client, variante, cliente="Ana")
    c = _cobrar(client, [p], "Pago movil", recibido=8.0)
    client.post(f"/api/cobranzas/cobros/{c['id']}/anular")
    assert _fila(client, "Pago movil")["esperado"] == 0.0


def test_cobros_del_dia_suma_lo_mismo_que_la_fila(client, variante):
    """La lista es el detalle de la fila: un cobro, una linea, con lo que entro."""
    a = fiar(client, variante, cliente="Ana")
    b = fiar(client, variante, cliente="Ana")
    _cobrar(client, [a, b], "Pago movil", recibido=16.0)
    lineas = [c for c in client.get("/api/caja/cobros").json() if c["metodo"] == "Pago movil"]
    assert round(sum(c["monto"] for c in lineas), 2) == 16.0 == _fila(client, "Pago movil")["esperado"]
    assert not any(c["repetida"] for c in lineas), "es un solo deposito, no una referencia repetida"


def test_la_conciliacion_busca_en_el_banco_lo_que_entro(client, db, variante):
    """El banco muestra un deposito de $16, no dos de $10."""
    a = fiar(client, variante, cliente="Ana")
    b = fiar(client, variante, cliente="Ana")
    _cobrar(client, [a, b], "Pago movil", recibido=16.0)
    dia = hoy()
    filas = [c for c in conciliacion._cobros(db, dia - datetime.timedelta(days=1), dia + datetime.timedelta(days=1))
             if c.tipo == "abono"]
    assert [c.monto for c in filas] == [16.0]


def _cierre(db):
    return db.query(models.CierreCaja).filter(models.CierreCaja.anulado.is_(False)).one()


def _guardar_como_antes(db, metodo, esperado):
    """Un cierre hecho con la cuenta vieja, que esperaba lo que se debia."""
    linea = next(l for l in _cierre(db).lineas if l.metodo == metodo)
    linea.esperado = esperado
    linea.diferencia = round(linea.contado - esperado, 2)
    db.commit()


def test_un_dia_cerrado_muestra_lo_que_se_guardo(client, db, variante, libros):
    """Se contaron $8 y el cierre guardo que esperaba $10: faltaban $2. Eso no
    cambia solo por haber corregido la cuenta."""
    p = fiar(client, variante, cliente="Ana")
    _cobrar(client, [p], "Pago movil", recibido=8.0)
    r = client.post("/api/caja/cerrar", json={"conteos": [{"metodo": "Pago movil", "contado": 8.0}]})
    assert r.status_code == 200, r.text
    _guardar_como_antes(db, "Pago movil", 10.0)

    f = _fila(client, "Pago movil")
    assert (f["esperado"], f["contado"], f["diferencia"]) == (10.0, 8.0, -2.0)
    assert round(f["fondo"] + f["ventas"] - f["salidas"] + f["otros"], 2) == f["esperado"], "la fila sigue sumando a la vista"


def test_un_cobro_despues_de_cerrar_no_mueve_el_dia_cerrado(client, db, variante):
    a = fiar(client, variante, cliente="Ana")
    b = fiar(client, variante, cliente="Luis")
    _cobrar(client, [a], "Pago movil")
    assert client.post("/api/caja/cerrar", json={"conteos": [{"metodo": "Pago movil", "contado": 10.0}]}).status_code == 200
    _cobrar(client, [b], "Pago movil")
    assert _fila(client, "Pago movil")["esperado"] == 10.0


def test_las_gavetas_sin_contar_muestran_lo_guardado_en_el_cierre(client, db, variante, libros):
    p = fiar(client, variante, cliente="Ana")
    assert client.post("/api/caja/cerrar", json={"conteos": [{"metodo": "Pago movil", "contado": 0.0}]}).status_code == 200
    guardado = _cierre(db).divisas_esperado
    client.post("/api/cobranzas/cobros", json={"pedido_ids": [p["id"]], "metodo_pago": "Efectivo $"})
    assert _fila(client, "Efectivo $")["esperado"] == guardado


def test_una_forma_sin_contar_en_un_dia_cerrado_sigue_con_la_cuenta_de_antes(client, db, variante):
    """No hay nada guardado de esa fila: no se recalcula con la cuenta nueva."""
    p = fiar(client, variante, cliente="Ana")
    _cobrar(client, [p], "Pago movil", recibido=8.0)
    assert caja_cerrar(client, efectivo=0.0).status_code == 200
    assert _fila(client, "Pago movil")["esperado"] == 10.0
    lineas = [c for c in client.get("/api/caja/cobros").json() if c["metodo"] == "Pago movil"]
    assert [c["monto"] for c in lineas] == [10.0]


def test_al_reabrir_el_dia_vuelve_a_la_cuenta_nueva(client, db, variante):
    p = fiar(client, variante, cliente="Ana")
    _cobrar(client, [p], "Pago movil", recibido=8.0)
    assert client.post("/api/caja/cerrar", json={"conteos": [{"metodo": "Pago movil", "contado": 8.0}]}).status_code == 200
    _guardar_como_antes(db, "Pago movil", 10.0)
    _cierre(db).anulado = True
    db.commit()
    assert _fila(client, "Pago movil")["esperado"] == 8.0
