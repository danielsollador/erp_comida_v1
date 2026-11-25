"""El euro no se puede quedar viejo en silencio (25-nov-2026).

El BCV cambio de certificado el 13-nov (de validacion de dominio a validacion
de organizacion) y el servidor solo tenia guardado el intermedio anterior: dejo
de poder leerlo. El dolar siguio llegando por la fuente de respaldo, pero el
euro no tenia respaldo y se quedo en el del 19-nov mientras Savora cobraba en
euro: 1.007,40 en vez de 1.012,22.
"""

from __future__ import annotations

import datetime

import pytest

from app import models, rates, tasas
from app.timeutils import hoy


def test_el_servidor_conoce_el_intermedio_nuevo_del_bcv():
    emisores = {dict(x[0] for x in c["subject"]).get("commonName") for c in rates._contexto_bcv().get_ca_certs()}
    assert "Sectigo Public Server Authentication CA OV R36" in emisores
    assert "Sectigo Public Server Authentication CA DV R36" in emisores


def test_sin_bcv_el_euro_llega_por_el_respaldo(monkeypatch):
    def bcv_caido():
        raise OSError("certificate verify failed")

    monkeypatch.setattr(rates, "_fetch_bcv", bcv_caido)
    monkeypatch.setattr(rates, "_fetch_dolarapi", lambda c: 922.5637)
    monkeypatch.setattr(rates, "_fetch_dolarapi_eur", lambda c: 1012.21844036)
    monkeypatch.setattr(rates, "_fetch_binance", lambda c: 1105.73)
    anclas = rates._fetch()
    assert anclas["bcv"] == pytest.approx(922.5637)
    assert anclas["eur"] == pytest.approx(1012.21844036)


def test_con_bcv_no_se_toca_el_respaldo(monkeypatch):
    def no_llamar(c):
        raise AssertionError("no hacia falta el respaldo")

    monkeypatch.setattr(rates, "_fetch_bcv", lambda: {"bcv": 922.5637, "eur": 1012.21844036, "actualizado": "25 Noviembre 2026"})
    monkeypatch.setattr(rates, "_fetch_dolarapi", no_llamar)
    monkeypatch.setattr(rates, "_fetch_dolarapi_eur", no_llamar)
    monkeypatch.setattr(rates, "_fetch_binance", lambda c: 1105.73)
    assert rates._fetch()["eur"] == pytest.approx(1012.21844036)


def test_cobrar_en_euro_con_un_euro_de_otro_dia_lo_avisa(client, db):
    ayer = hoy() - datetime.timedelta(days=1)
    db.add_all([
        models.TasaCambio(fecha=ayer, bcv=919.8227, eur=1007.3958, origen="auto"),
        models.TasaCambio(fecha=hoy(), bcv=922.5637, eur=None, origen="auto"),
    ])
    db.commit()
    tasas.fijar_cobro(db, "eur")
    c = client.get("/api/tasas").json()["cobro"]
    assert c["fuente"] == "eur" and c["tasa"] == pytest.approx(1007.3958)
    assert ayer.strftime("%d/%m") in c["aviso"]


def test_cobrar_en_euro_con_el_euro_de_hoy_no_avisa(client, db):
    db.add(models.TasaCambio(fecha=hoy(), bcv=922.5637, eur=1012.2184, origen="auto"))
    db.commit()
    tasas.fijar_cobro(db, "eur")
    assert client.get("/api/tasas").json()["cobro"]["aviso"] is None


def test_la_brecha_tambien_se_calcula_contra_el_euro(client, db):
    """Savora, 25-nov: junto al euro se ve cuanto le falta para el paralelo."""
    db.add(models.TasaCambio(fecha=hoy(), bcv=922.5637, eur=1012.2184, paralelo=1105.73, origen="auto"))
    db.commit()
    e = client.get("/api/tasas").json()
    assert e["brecha_pct"] == pytest.approx(19.9)
    assert e["brecha_eur_pct"] == pytest.approx(9.2)


def test_sin_euro_o_sin_paralelo_no_hay_brecha_del_euro(client, db):
    db.add(models.TasaCambio(fecha=hoy(), bcv=922.5637, eur=None, paralelo=1105.73, origen="auto"))
    db.commit()
    assert client.get("/api/tasas").json()["brecha_eur_pct"] is None
