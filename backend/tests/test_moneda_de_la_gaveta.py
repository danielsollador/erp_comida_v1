"""Cada moneda en su moneda: lo que sale de una gaveta en bolivares se anota en
bolivares y lo de dolares en dolares (Savora, 16-nov: un retiro de 1.000 Bs se
escribio en la casilla de dolares y la caja mostro $1.000 retirados)."""

from app import models
from app.timeutils import hoy

from test_qa_noviembre import con_libros

TASA = 1010.56


def tasa_de_hoy(db):
    db.add(models.TasaCambio(fecha=hoy(), bcv=TASA, eur=1180.0, paralelo=1068.4, origen="auto"))
    db.commit()


def test_un_retiro_de_la_gaveta_de_bolivares_se_anota_en_bolivares(client, db):
    tasa_de_hoy(db)
    con_libros(db, bs=5.0)
    r = client.post("/api/caja/retiros", json={"monto_bs": 1000, "metodo_pago": "Efectivo Bs", "nota": "vueltos"})
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["monto_bs"] == 1000 and cuerpo["tasa"] == TASA and cuerpo["monto"] == round(1000 / TASA, 2)
    # El libro sigue en dolares: salio $0,99 de la cuenta de bolivares.
    asiento = db.query(models.AsientoContable).filter_by(origen="retiro", referencia_id=cuerpo["id"]).one()
    assert round(sum(m.haber for m in asiento.movimientos), 2) == 0.99


def test_en_bolivares_no_se_acepta_un_monto_en_dolares(client, db):
    """Lo que paso: 1.000 escrito como dolares. Ahora se rechaza y lo dice."""
    tasa_de_hoy(db)
    con_libros(db, bs=5.0)
    r = client.post("/api/caja/retiros", json={"monto": 1000, "metodo_pago": "Efectivo Bs", "nota": ""})
    assert r.status_code == 400 and "bolívares" in r.json()["detail"]
    assert db.query(models.RetiroPropietario).count() == 0


def test_en_dolares_no_se_aceptan_bolivares(client, db):
    tasa_de_hoy(db)
    con_libros(db)
    r = client.post("/api/caja/gastos", json={"descripcion": "Hielo", "categoria": "Otros", "monto_bs": 500,
                                              "metodo_pago": "Efectivo $"})
    assert r.status_code == 400 and "dólares" in r.json()["detail"]
    r = client.post("/api/caja/gastos", json={"descripcion": "Hielo", "categoria": "Otros", "monto": 5,
                                              "metodo_pago": "Efectivo $"})
    assert r.status_code == 200 and r.json()["monto_bs"] is None


def test_el_aviso_de_la_gaveta_habla_en_bolivares(client, db):
    tasa_de_hoy(db)
    con_libros(db, bs=1.0)  # un dolar en bolivares: ~1.010 Bs
    r = client.post("/api/caja/gastos", json={"descripcion": "Hielo", "categoria": "Otros", "monto_bs": 3000,
                                              "metodo_pago": "Efectivo Bs"})
    assert r.status_code == 400, r.text
    assert "Bs 3.000,00" in r.json()["detail"] and "$" not in r.json()["detail"]
