"""Pagos sin factura: nomina, honorarios, alquiler.

Lo que importa: cada concepto en su cuenta de gasto (la nomina deja de
perderse en "Gastos operativos"), sin IVA porque no hay factura, la retencion
de ISLR debiendose al SENIAT, y la caja del dia sabiendo que esa plata salio.
"""
import datetime

from app import models
from app.acceso import permisos
from app.routers.egresos import siguiente_fecha
from app.timeutils import hoy
from tests.conftest import caja_esperado, libros_cuadrados, saldo


def pagar(client, **datos):
    base = {"beneficiario": "Ana Pérez", "concepto": "Sueldos", "monto": 100.0,
            "metodo_pago": "Pago movil", "referencia": "777"}
    return client.post("/api/egresos", json={**base, **datos})


def test_un_sueldo_va_a_su_cuenta_y_sale_del_banco(client, db, libros):
    banco = saldo(db, "1020")
    r = pagar(client)
    assert r.status_code == 200, r.text
    db.expire_all()
    assert saldo(db, "6080") == 100.0
    assert round(banco - saldo(db, "1020"), 2) == 100.0
    assert saldo(db, "1030") == 0.0, "sin factura no hay credito fiscal"
    libros_cuadrados(client, db)


def test_honorarios_con_retencion_de_islr(client, db, libros):
    banco = saldo(db, "1020")
    r = pagar(client, beneficiario="Vertigo", concepto="Honorarios", monto=50.0, retencion_islr_pct=3)
    assert r.status_code == 200, r.text
    assert r.json()["neto"] == 48.5
    db.expire_all()
    assert saldo(db, "6090") == 50.0, "el gasto es el honorario entero"
    assert round(banco - saldo(db, "1020"), 2) == 48.5, "sale lo que se le entrega"
    assert saldo(db, "2060") == 1.5, "lo retenido se le debe al SENIAT"
    assert client.get("/api/egresos/resumen").json()["islr_por_enterar"] == 1.5


def test_en_bolivares_se_pasa_a_dolares_con_la_tasa_del_dia(client, db, libros):
    db.add(models.TasaCambio(fecha=hoy(), bcv=40.0))
    db.commit()
    r = pagar(client, concepto="Alquiler", monto=8000.0, moneda="Bs", metodo_pago="Transferencia")
    assert r.status_code == 200, r.text
    assert r.json()["monto"] == 200.0 and r.json()["monto_bs"] == 8000.0 and r.json()["tasa"] == 40.0
    db.expire_all()
    assert saldo(db, "6100") == 200.0


def test_en_bolivares_sin_tasa_no_se_inventa(client):
    assert pagar(client, monto=8000.0, moneda="Bs").status_code == 409


def test_bolivares_no_salen_de_zelle(client, db):
    db.add(models.TasaCambio(fecha=hoy(), bcv=40.0))
    db.commit()
    assert pagar(client, monto=800.0, moneda="Bs", metodo_pago="Zelle").status_code == 400


def test_por_banco_pide_referencia(client):
    assert pagar(client, referencia="").status_code == 400


def test_en_efectivo_baja_lo_que_debe_haber_en_la_gaveta(client, db, libros):
    antes = caja_esperado(client, "Efectivo Bs")
    assert pagar(client, monto=20.0, metodo_pago="Efectivo Bs", referencia="").status_code == 200
    assert round(antes - caja_esperado(client, "Efectivo Bs"), 2) == 20.0


def test_anular_deja_los_libros_como_antes(client, db, libros):
    banco = saldo(db, "1020")
    pago = pagar(client).json()
    r = client.post(f"/api/egresos/{pago['id']}/anular")
    assert r.status_code == 200, r.text
    db.expire_all()
    assert saldo(db, "6080") == 0.0
    assert saldo(db, "1020") == banco
    assert client.post(f"/api/egresos/{pago['id']}/anular").status_code == 409
    libros_cuadrados(client, db)


def test_no_se_anula_un_pago_cuyo_islr_ya_se_entero(client, db, libros):
    pago = pagar(client, concepto="Honorarios", monto=50.0, retencion_islr_pct=3).json()
    r = client.post("/api/egresos/islr/enterar", json={"metodo_pago": "Transferencia", "referencia": "PL-1"})
    assert r.status_code == 200, r.text
    assert client.post(f"/api/egresos/{pago['id']}/anular").status_code == 409
    assert client.get("/api/egresos/resumen").json()["islr_por_enterar"] == 0.0
    libros_cuadrados(client, db)


def test_pago_fijo_se_confirma_y_pasa_a_la_proxima_fecha(client, db, libros):
    f = client.post("/api/egresos/fijos", json={
        "beneficiario": "Ana Pérez", "concepto": "Sueldos", "monto": 150.0,
        "metodo_pago": "Pago movil", "frecuencia": "quincenal", "proximo": hoy().isoformat(),
    }).json()
    assert f["toca"] is True
    r = client.post(f"/api/egresos/fijos/{f['id']}/pagar", json={"referencia": "55"})
    assert r.status_code == 200, r.text
    assert r.json()["pago_fijo_id"] == f["id"]
    fijo = next(x for x in client.get("/api/egresos/fijos").json() if x["id"] == f["id"])
    assert fijo["toca"] is False
    assert fijo["proximo"] == (hoy() + datetime.timedelta(days=15)).isoformat()


def test_mensual_no_se_sale_del_mes():
    assert siguiente_fecha(datetime.date(2026, 1, 31), "mensual") == datetime.date(2026, 2, 28)
    assert siguiente_fecha(datetime.date(2026, 12, 5), "mensual") == datetime.date(2027, 1, 5)


def test_la_caja_no_ve_la_nomina():
    assert not permisos.permitido("caja", "GET", "/api/egresos")
    assert permisos.permitido("caja", "POST", "/api/cobranzas/cobros")
    assert permisos.permitido("dueno", "POST", "/api/egresos")
