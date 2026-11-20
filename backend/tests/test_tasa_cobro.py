"""Tasa de cobro (bloque 1.11, specs/tasa.md).

El caso real del 16-nov: un pastelito de $2,90 vale 2.650,66 Bs al dolar BCV
(914,0218) y 2.930,62 Bs al euro BCV (1.010,56). Yeimer lo lograba pegando el
euro en la casilla del dolar; ahora se elige la tasa de cobro y el dolar y el
euro del BCV no se tocan.
"""

from __future__ import annotations

import datetime

import pytest

from app import models, tasas
from app.timeutils import hoy
from tests.conftest import caja_cerrar

DOLAR = 914.0218
EURO = 1010.56


def test_vista_euro_conserva_ultimo_euro_si_hoy_no_llego(client, db):
    """Yeimer ve puntos en todos los montos si hoy llegó dólar pero no euro."""
    db.add_all([
        models.TasaCambio(fecha=hoy() - datetime.timedelta(days=1), bcv=DOLAR, eur=EURO, origen="auto"),
        models.TasaCambio(fecha=hoy(), bcv=DOLAR + 1, eur=None, origen="auto"),
        models.TasaCambio(fecha=hoy() + datetime.timedelta(days=1), bcv=DOLAR + 2, eur=EURO + 20, origen="auto"),
    ])
    db.commit()
    e = client.get('/api/tasas').json()
    assert e['bcv'] == pytest.approx(DOLAR + 1)
    assert e['eur'] == pytest.approx(EURO)
    assert db.query(models.TasaCambio).filter_by(fecha=hoy()).one().eur is None


def test_vista_euro_no_inventa_tasa_si_nunca_hubo_euro(client, db):
    db.add(models.TasaCambio(fecha=hoy(), bcv=DOLAR, eur=None, origen="auto"))
    db.commit()
    assert client.get('/api/tasas').json()['eur'] is None


@pytest.fixture()
def bcv_de_hoy(db):
    db.add(models.TasaCambio(fecha=hoy(), bcv=DOLAR, eur=EURO, paralelo=1068.4, origen="auto"))
    db.commit()


def pastelito(client, metodo="Efectivo Bs", facturado=True, n=[0]):
    n[0] += 1
    p = client.post("/api/pedidos", json={"items": [{"nombre_libre": "Pastelito", "precio_libre": 2.9, "cantidad": 1}]}).json()
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": metodo, "facturado": facturado, "numero_factura": f"T-{n[0]}"})
    assert r.status_code == 200, r.text
    return r.json()


def elegir(client, fuente, tasa=None, **kw):
    cuerpo = {"fuente": fuente}
    if tasa is not None:
        cuerpo["tasa"] = tasa
    return client.put("/api/tasas/cobro", json=cuerpo, **kw)


def total_bs(client, numero):
    filas = client.get("/api/ventas").json()["filas"]
    return next(f for f in filas if f["numero"] == numero)


def test_por_defecto_se_cobra_al_dolar_bcv(client, bcv_de_hoy):
    e = client.get("/api/tasas").json()
    assert e["cobro"]["fuente"] == "bcv"
    assert e["cobro"]["tasa"] == pytest.approx(DOLAR)
    v = pastelito(client)
    assert v["tasa_bcv"] == pytest.approx(DOLAR)
    assert total_bs(client, v["numero"])["total_bs"] == pytest.approx(2650.66)


def test_el_pastelito_de_2_90_a_tasa_euro_son_2930_62_bs_y_lo_cobrado_antes_no_cambia(client, bcv_de_hoy):
    antes = pastelito(client)
    r = elegir(client, "eur")
    assert r.status_code == 200, r.text
    despues = pastelito(client)
    assert despues["tasa_bcv"] == pytest.approx(EURO)
    assert total_bs(client, despues["numero"])["total_bs"] == pytest.approx(2930.62)
    # Lo ya cobrado conserva su tasa.
    assert total_bs(client, antes["numero"])["total_bs"] == pytest.approx(2650.66)
    assert total_bs(client, antes["numero"])["tasa_bcv"] == pytest.approx(DOLAR)


def test_elegir_euro_no_toca_el_dolar_ni_el_euro_del_bcv(client, bcv_de_hoy):
    elegir(client, "eur")
    e = client.get("/api/tasas").json()
    assert e["bcv"] == pytest.approx(DOLAR), "el dolar oficial sigue como lo publica el BCV"
    assert e["eur"] == pytest.approx(EURO)
    assert e["cobro"]["fuente"] == "eur" and e["cobro"]["tasa"] == pytest.approx(EURO)


def test_el_libro_de_ventas_lleva_los_bs_cobrados_a_cada_tasa(client, bcv_de_hoy):
    pastelito(client)
    elegir(client, "eur")
    pastelito(client)
    filas = client.get("/api/impuestos/libro-ventas").json()["filas"]
    assert sorted(f["total_bs"] for f in filas) == [2650.66, 2930.62]
    assert sorted(f["tasa_bcv"] for f in filas) == [pytest.approx(DOLAR), pytest.approx(EURO)]


def test_la_tasa_manual_no_se_guarda_en_la_casilla_del_dolar(client, bcv_de_hoy):
    """El parche de Yeimer: fijar 1.010,56 a mano ponia 'Dolares BCV 1.010,56'."""
    r = elegir(client, "manual", 1010.56)
    assert r.status_code == 200, r.text
    e = client.get("/api/tasas").json()
    assert e["bcv"] == pytest.approx(DOLAR)
    assert e["cobro"] == {**e["cobro"], "fuente": "manual", "tasa": pytest.approx(1010.56)}
    assert pastelito(client)["tasa_bcv"] == pytest.approx(1010.56)


def test_el_refresco_no_pisa_la_tasa_manual_ni_deja_mal_el_euro(client, db, bcv_de_hoy):
    from app import rates

    elegir(client, "manual", 1010.56)
    rates._cache.update({"at": datetime.datetime.now(), "ok_at": datetime.datetime.now(),
                         "anclas": {"bcv": DOLAR, "eur": EURO, "paralelo": 1070.0, "actualizado": None}})
    tasas.refrescar(db)
    e = client.get("/api/tasas").json()
    assert e["bcv"] == pytest.approx(DOLAR) and e["eur"] == pytest.approx(EURO)
    assert e["cobro"]["tasa"] == pytest.approx(1010.56)


def test_el_parche_viejo_se_pasa_solo_a_tasa_de_cobro(client, db):
    """En produccion hoy: la fila del dia dice bcv=1.010,56 origen manual. Al
    refrescar, ese valor pasa a ser la tasa de cobro manual y el dolar vuelve
    al oficial."""
    from app import rates

    db.add(models.TasaCambio(fecha=hoy(), bcv=1010.56, eur=10.56, paralelo=1068.4, origen="manual"))
    db.commit()
    rates._cache.update({"at": datetime.datetime.now(), "ok_at": datetime.datetime.now(),
                         "anclas": {"bcv": DOLAR, "eur": EURO, "paralelo": 1070.0, "actualizado": None}})
    tasas.refrescar(db)
    e = client.get("/api/tasas").json()
    assert e["bcv"] == pytest.approx(DOLAR) and e["eur"] == pytest.approx(EURO) and e["origen"] == "auto"
    assert e["cobro"]["fuente"] == "manual" and e["cobro"]["tasa"] == pytest.approx(1010.56), "se sigue cobrando igual"


def test_sin_euro_del_dia_no_se_puede_elegir_euro(client, db):
    db.add(models.TasaCambio(fecha=hoy(), bcv=DOLAR, eur=None, origen="auto"))
    db.commit()
    r = elegir(client, "eur")
    assert r.status_code == 409 and "euro" in r.json()["detail"].lower()


def test_una_manual_con_salto_de_mas_de_30_por_ciento_pide_confirmar(client, bcv_de_hoy):
    r = elegir(client, "manual", 10.56)
    assert r.status_code == 428 and r.json()["detail"]["clave"] == "tasa_salto"
    assert elegir(client, "manual", 10.56, headers={"X-Confirmado": "tasa_salto"}).status_code == 200


def test_cambiar_la_tasa_de_cobro_pide_la_firma_de_quien_autoriza(db, bcv_de_hoy):
    """La cajera no la cambia sola (R5): sin PIN de quien autoriza, 428."""
    from fastapi.testclient import TestClient

    from app.acceso import usuarios
    from app.database import get_db
    from app.main import app
    from app import settings
    from tests.conftest import entrar

    try:
        usuarios.crear("cajera_tasa", "clave-de-la-cajera-larga", rol="caja", locales=[settings.LOCAL_SLUG])
    except usuarios.ErrorUsuarios:
        pass
    app.dependency_overrides[get_db] = lambda: db
    try:
        with TestClient(app) as c:
            entrar(c, "cajera_tasa", "clave-de-la-cajera-larga")
            r = c.put("/api/tasas/cobro", json={"fuente": "eur"})
            assert r.status_code in (403, 428), r.text
    finally:
        app.dependency_overrides.pop(get_db, None)
        usuarios.borrar("cajera_tasa")


def test_el_pago_en_bs_sin_tasa_usa_la_de_cobro(client, bcv_de_hoy):
    """Un pago en bolivares hoy sale a la tasa de cobro; la diferencia con el
    dolar oficial va a la 6160 como ya hacia (QA nov, hallazgo 16)."""
    elegir(client, "eur")
    r = client.post("/api/egresos", json={
        "beneficiario": "Proveedor", "concepto": "Servicios publicos", "monto": 1010.56, "moneda": "Bs", "metodo_pago": "Efectivo Bs",
    })
    assert r.status_code in (200, 201), r.text
    [p] = [x for x in client.get("/api/egresos").json() if x["beneficiario"] == "Proveedor"]
    assert p["tasa"] == pytest.approx(EURO) and p["monto"] == pytest.approx(1.0)


def test_el_cierre_con_dos_tasas_el_mismo_dia_y_la_gaveta_exacta_no_marca_diferencia(client, bcv_de_hoy):
    """Caso real del 16-nov: $2,90 a 914,02 y $2,90 a 1.010,56 son 5.581,28 Bs en
    la gaveta. Convertidos a una sola tasa daban un faltante falso de $0,28."""
    pastelito(client)
    elegir(client, "eur")
    pastelito(client)
    linea = next(l for l in client.get("/api/caja/resumen").json()["desglose"] if l["metodo"] == "Efectivo Bs")
    assert linea["esperado"] == pytest.approx(5.8)
    assert linea["tasa_cobros"] == pytest.approx(5581.28 / 5.8, rel=1e-3)
    contado = round(5581.28 / linea["tasa_cobros"], 2)
    assert contado == pytest.approx(5.8)
    r = caja_cerrar(client, efectivo=contado)
    assert r.status_code == 200, r.text
    assert r.json()["diferencia"] == pytest.approx(0, abs=0.005)


def test_con_una_sola_tasa_todo_el_dia_la_tasa_de_los_cobros_es_esa(client, bcv_de_hoy):
    elegir(client, "eur")
    pastelito(client)
    linea = next(l for l in client.get("/api/caja/resumen").json()["desglose"] if l["metodo"] == "Efectivo Bs")
    assert linea["tasa_cobros"] == pytest.approx(EURO)
