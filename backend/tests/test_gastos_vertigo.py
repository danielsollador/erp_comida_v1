"""Los gastos de Vertigo en el hub: solo Vertigo los ve, viven en el esquema
del hub y el proximo pago se corre solo al registrar uno."""
from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import main, settings
from app.acceso import usuarios
from app.hub_models import GastoVertigo, HubBase
from app.routers import gastos_vertigo as gv
from tests.conftest import entrar

URL = "/api/gastos-vertigo"
DUENO = ("dueno-gastos", "clave-de-dueno-larga")
BASE = {"nombre": "Servidor", "proveedor": "Nube", "categoria": "Infraestructura",
        "monto": 30, "moneda": "USD", "frecuencia": "trimestral",
        "proximo_pago": "2026-01-31"}


@pytest.fixture()
def hub(client, db, monkeypatch):
    """El cliente de Vertigo, parado en el hub, con las tablas del hub."""
    HubBase.metadata.create_all(bind=db.get_bind())
    monkeypatch.setattr(settings, "ES_HUB", True)
    yield client
    HubBase.metadata.drop_all(bind=db.get_bind())


def _crear(hub, **extra) -> dict:
    r = hub.post(URL, json={**BASE, **extra})
    assert r.status_code == 200, r.text
    nombre = extra.get("nombre") or BASE["nombre"]
    return next(g for g in r.json()["gastos"] if g["nombre"] == nombre)


def test_el_arranque_del_hub_siembra_una_sola_vez(monkeypatch):
    motor = create_engine("sqlite://", connect_args={"check_same_thread": False},
                          poolclass=StaticPool)
    Sesion = sessionmaker(bind=motor)
    monkeypatch.setattr(main, "engine", motor)
    monkeypatch.setattr(main, "SessionLocal", Sesion)

    main._arrancar_tablas_del_hub()
    with Sesion() as s:
        assert s.query(GastoVertigo).count() == len(gv.SEMILLA)
        vps = s.query(GastoVertigo).filter_by(nombre="VPS").one()
        # Sin monto inventado.
        assert vps.monto is None and vps.estado == "por_cancelar"
        s.query(GastoVertigo).delete()
        s.commit()

    # Vaciada a proposito: el siguiente arranque no la vuelve a llenar.
    main._arrancar_tablas_del_hub()
    with Sesion() as s:
        assert s.query(GastoVertigo).count() == 0


def test_la_semilla_cuenta_solo_lo_que_se_paga_hoy(hub, db):
    gv.sembrar(db)
    r = hub.get(URL).json()["resumen"]
    # Apple y Google Play estan por contratar: no son costo todavia.
    # Claude es recarga: no es costo mensual. El VPS se va: no se pide su monto.
    # Fijo al mes: la VM (4), Pabilo (10) y el dominio repartido (63,99 / 12).
    assert r["mensual"] == {"USD": 19.33}
    assert r["sin_monto"] == 0


def test_pagado_y_por_pagar_este_mes(hub):
    hoy = date.today()
    pendiente = _crear(hub, nombre="Vence hoy", monto=10, frecuencia="mensual",
                       proximo_pago=hoy.isoformat())
    _crear(hub, nombre="Lejos", monto=99, frecuencia="anual",
           proximo_pago=gv.sumar_meses(hoy, 6).isoformat())
    d = hub.get(URL).json()
    marcas = {g["nombre"]: (g["pagado_mes"], g["por_pagar_mes"]) for g in d["gastos"]}
    assert marcas == {"Vence hoy": (False, True), "Lejos": (False, False)}
    assert d["resumen"]["por_pagar_mes"] == {"USD": 10}

    # Pagado: pasa al mes siguiente y deja de estar por pagar.
    d = hub.post(f"{URL}/{pendiente['id']}/pago", json={}).json()
    g = next(x for x in d["gastos"] if x["id"] == pendiente["id"])
    assert (g["pagado_mes"], g["por_pagar_mes"]) == (True, False)
    assert d["resumen"]["pagado_mes"] == {"USD": 10}
    assert d["resumen"]["por_pagar_mes"] == {}


def test_pabilo_entra_con_su_primer_pago(hub, db):
    gv.sembrar(db)
    g = next(x for x in hub.get(URL).json()["gastos"] if x["proveedor"] == "Pabilo")
    assert (g["monto"], g["frecuencia"], g["proximo_pago"]) == (10, "mensual", "2026-11-05")
    assert [(p["fecha"], p["monto"]) for p in g["pagos"]] == [("2026-10-05", 10)]


def test_recarga_a_demanda_no_es_mensual_ni_deja_fecha(hub):
    g = _crear(hub, nombre="Credito IA", monto=10, frecuencia="a_demanda",
               proximo_pago=None)
    r = hub.post(f"{URL}/{g['id']}/pago", json={"fecha": "2026-03-01"}).json()
    g = next(x for x in r["gastos"] if x["id"] == g["id"])
    assert g["proximo_pago"] is None
    assert r["resumen"]["mensual"] == {}
    assert r["resumen"]["pagado_anio"] == {"USD": 10}


def test_resumen_reparte_por_frecuencia_y_separa_monedas(hub):
    _crear(hub)                                                   # 30 / 3 = 10
    _crear(hub, nombre="Dominio", monto=24, frecuencia="anual")   # 24 / 12 = 2
    _crear(hub, nombre="Licencia", monto=25, frecuencia="unico")  # no entra
    _crear(hub, nombre="Viejo", monto=100, estado="cancelado")    # no entra
    _crear(hub, nombre="Euros", monto=6, moneda="EUR", frecuencia="mensual")
    d = hub.get(URL).json()
    assert d["resumen"]["mensual"] == {"USD": 12.0, "EUR": 6.0}
    assert d["resumen"]["anual"] == {"USD": 144.0, "EUR": 72.0}
    assert d["resumen"]["activos"] == 4
    # Los cancelados al final.
    assert d["gastos"][-1]["nombre"] == "Viejo"


def test_registrar_pago_corre_la_fecha_desde_la_que_tocaba(hub):
    g = _crear(hub, estado="por_contratar")
    r = hub.post(f"{URL}/{g['id']}/pago", json={"fecha": "2026-02-10"})
    assert r.status_code == 200, r.text
    g = next(x for x in r.json()["gastos"] if x["id"] == g["id"])
    # 31-ene + 3 meses = 30-abr (abril no tiene 31), aunque se pago el 10-feb.
    assert g["proximo_pago"] == "2026-04-30"
    assert [(p["fecha"], p["monto"], p["registrado_por"]) for p in g["pagos"]] == [
        ("2026-02-10", 30, "admin")]
    assert g["estado"] == "activo"


def test_pago_unico_no_deja_proxima_fecha_y_sin_monto_lo_pide(hub):
    g = _crear(hub, nombre="Licencia", monto=None, frecuencia="unico")
    assert hub.post(f"{URL}/{g['id']}/pago", json={}).status_code == 422
    r = hub.post(f"{URL}/{g['id']}/pago", json={"monto": 25}).json()
    g = next(x for x in r["gastos"] if x["id"] == g["id"])
    assert g["proximo_pago"] is None
    assert r["resumen"]["pagado_anio"] == {"USD": 25}


def test_anular_un_pago(hub):
    g = _crear(hub)
    r = hub.post(f"{URL}/{g['id']}/pago", json={"fecha": "2026-01-31"}).json()
    pid = next(x for x in r["gastos"] if x["id"] == g["id"])["pagos"][0]["id"]
    assert hub.delete(f"{URL}/{g['id'] + 1}/pago/{pid}").status_code == 404
    r = hub.delete(f"{URL}/{g['id']}/pago/{pid}").json()
    assert next(x for x in r["gastos"] if x["id"] == g["id"])["pagos"] == []


def test_editar_y_borrar_se_lleva_sus_pagos(hub, db):
    g = _crear(hub)
    hub.post(f"{URL}/{g['id']}/pago", json={})
    r = hub.put(f"{URL}/{g['id']}", json={**BASE, "monto": 45})
    assert next(x for x in r.json()["gastos"] if x["id"] == g["id"])["monto"] == 45
    assert hub.delete(f"{URL}/{g['id']}").json()["gastos"] == []
    assert hub.delete(f"{URL}/{g['id']}").status_code == 404


@pytest.mark.parametrize("campo,valor", [
    ("nombre", " "), ("categoria", "Comida"), ("moneda", "BTC"),
    ("frecuencia", "diaria"), ("estado", "pausado"), ("monto", -1),
])
def test_valida(hub, campo, valor):
    assert hub.post(URL, json={**BASE, campo: valor}).status_code == 422


def test_solo_vertigo(fuera, monkeypatch):
    monkeypatch.setattr(settings, "ES_HUB", True)
    assert fuera.get(URL).status_code == 401
    usuarios.crear(*DUENO, rol="dueno", locales=[settings.LOCAL_SLUG])
    try:
        dueno = entrar(fuera, *DUENO)
        # En el hub su sesion de local ni cuenta (401); si contara, permisos
        # lo para (403). Lo que importa: no entra.
        assert dueno.get(URL).status_code in (401, 403)
    finally:
        usuarios.borrar(DUENO[0])


def test_en_un_local_no_existe(client):
    assert client.get(URL).status_code == 404


def test_sumar_meses_al_fin_de_mes():
    assert gv.sumar_meses(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert gv.sumar_meses(date(2027, 11, 15), 3) == date(2028, 2, 15)
    assert gv.sumar_meses(date(2028, 2, 29), 12) == date(2029, 2, 28)
