"""La tasa que el BCV publica en la tarde rige desde su Fecha Valor (7-oct).

En producción el refresco guardaba la tasa del día siguiente en la fila de
hoy, así que lo que se cobraba y facturaba esa tarde salía a la tasa de
mañana. Ahora va a su fecha y hoy conserva la suya.
"""

import datetime

from app import models, rates, tasas
from app.timeutils import hoy


def _anclas(monkeypatch, bcv, actualizado, paralelo=900.0):
    monkeypatch.setattr(
        rates, "obtener_anclas", lambda forzar=False: {"bcv": bcv, "eur": bcv * 1.1, "paralelo": paralelo, "actualizado": actualizado}
    )


def _fila(db, fecha):
    db.expire_all()
    return db.query(models.TasaCambio).filter(models.TasaCambio.fecha == fecha).first()


def _texto(fecha: datetime.date) -> str:
    meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
    return f"{fecha.day:02d} {meses[fecha.month - 1].capitalize()} {fecha.year}"


def test_la_tasa_de_manana_no_pisa_la_de_hoy(db, monkeypatch):
    manana = hoy() + datetime.timedelta(days=1)
    db.add(models.TasaCambio(fecha=hoy(), bcv=870.0, origen="auto"))
    db.commit()

    _anclas(monkeypatch, 880.0, _texto(manana), paralelo=950.0)
    assert tasas.refrescar(db)

    assert _fila(db, hoy()).bcv == 870.0, "hoy se sigue cobrando a la de hoy"
    assert _fila(db, hoy()).paralelo == 950.0, "el paralelo es del mercado: si se actualiza"
    assert _fila(db, manana).bcv == 880.0
    assert tasas.tasa_vigente(db).bcv == 870.0
    assert tasas.tasa_al(db, manana).bcv == 880.0


def test_un_sabado_sin_fila_toma_la_ultima_publicada(db, monkeypatch):
    lunes = hoy() + datetime.timedelta(days=2)
    db.add(models.TasaCambio(fecha=hoy() - datetime.timedelta(days=1), bcv=860.0, origen="auto"))
    db.commit()

    _anclas(monkeypatch, 885.0, _texto(lunes))
    assert tasas.refrescar(db)

    assert _fila(db, hoy()).bcv == 860.0
    assert _fila(db, lunes).bcv == 885.0


def test_la_de_hoy_se_sigue_guardando_hoy(db, monkeypatch):
    _anclas(monkeypatch, 875.0, _texto(hoy()))
    assert tasas.refrescar(db)
    assert _fila(db, hoy()).bcv == 875.0


def test_fecha_valor_se_lee_del_texto_del_bcv():
    assert tasas.fecha_valor("08 Octubre 2026") == datetime.date(2026, 10, 8)
    assert tasas.fecha_valor("1 septiembre 2026") == datetime.date(2026, 9, 1)
    assert tasas.fecha_valor("") is None
    assert tasas.fecha_valor("31 Febrero 2026") is None
