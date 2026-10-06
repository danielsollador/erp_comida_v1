"""La declaracion de IVA en bolivares, y las notas de credito de compras en
el mes en que se emiten.

Lo que se declara al SENIAT es en Bs y sale de los mismos libros que se
imprimen: el debito del Libro de Ventas y el credito del Libro de Compras de
ese mes, en Bs. El excedente de credito se arrastra en Bs. La nota de
credito de un proveedor entra en el mes de la nota, no en el de su factura.
"""

import datetime

import pytest

from app import models
from app.timeutils import hoy

TASA = 50.0


@pytest.fixture(autouse=True)
def tasa(db):
    db.merge(models.TasaCambio(fecha=datetime.date(2000, 1, 1), bcv=TASA, origen="auto"))
    db.commit()


def mes_pasado():
    primero = hoy().replace(day=1)
    anterior = primero - datetime.timedelta(days=1)
    return anterior.year, anterior.month, datetime.datetime(anterior.year, anterior.month, 10, 12)


def comprar(client, db, insumo, cuando, costo=100.0, numero="F-1"):
    r = client.post("/api/compras/facturas", json={
        "numero_factura": numero, "proveedor_nombre": "Proveedor", "proveedor_rif": "J402235135",
        "fecha_emision": cuando.date().isoformat(),
        "items": [{"ingrediente_id": insumo.id, "cantidad": 1, "costo_unitario": costo, "exento": False}],
    })
    assert r.status_code == 200, r.text
    f = db.get(models.FacturaCompra, r.json()["id"])
    f.fecha = cuando  # registrada ese mes
    db.commit()
    return f


def libro(client, anio, mes):
    return client.get(f"/api/impuestos/libro-compras?anio={anio}&mes={mes}").json()


def test_la_nota_de_credito_va_en_el_mes_en_que_se_emitio(client, db, insumo):
    anio, mes, cuando = mes_pasado()
    f = comprar(client, db, insumo, cuando)
    r = client.post(f"/api/compras/facturas/{f.id}/notas-credito", json={
        "numero": "NC-1", "tipo": "descuento", "base_imponible": 10.0,
    })
    assert r.status_code == 200, r.text

    antes = libro(client, anio, mes)
    assert [x["tipo"] for x in antes["filas"]] == ["FAC"], "la nota no reescribe el mes de su factura"
    assert antes["total_iva"] == 16.0

    ahora_ = libro(client, hoy().year, hoy().month)
    [nc] = [x for x in ahora_["filas"] if x["tipo"] == "NC"]
    assert (nc["numero_nota"], nc["factura_afectada"], nc["iva"]) == ("NC-1", "F-1", -1.6)
    assert nc["iva_bs"] == -1.6 * TASA


def test_se_declara_en_bolivares_lo_que_dicen_los_libros(client, db, insumo):
    anio, mes, cuando = mes_pasado()
    comprar(client, db, insumo, cuando)

    [p] = [x for x in client.get("/api/impuestos/periodos-pendientes").json() if (x["anio"], x["mes"]) == (anio, mes)]
    assert p["iva_credito_bs"] == 16.0 * TASA and p["sin_tasa"] == 0

    d = client.post("/api/impuestos/declaraciones", json={"anio": anio, "mes": mes}).json()
    # Solo compras: todo el credito sobra y se arrastra, en Bs.
    assert d["iva_credito_bs"] == libro(client, anio, mes)["total_iva_bs"] == 800.0
    assert (d["iva_a_pagar_bs"], d["credito_excedente_bs"]) == (0, 800.0)
    # El libro mayor sigue en dolares.
    assert (d["iva_credito"], d["credito_excedente"]) == (16.0, 16.0)


def test_sin_tasa_no_se_declara(client, db, insumo):
    anio, mes, cuando = mes_pasado()
    f = comprar(client, db, insumo, cuando)
    f.tasa_bcv = f.gravado_bs = f.exento_bs = f.iva_bs = None
    db.query(models.TasaCambio).delete()
    db.commit()

    r = client.post("/api/impuestos/declaraciones", json={"anio": anio, "mes": mes})
    assert r.status_code == 409 and "sin tasa" in r.json()["detail"]


# ------------------------------------------------ la tasa de un documento

def test_una_factura_sin_tasa_se_le_carga_y_el_mes_se_puede_declarar(client, db, insumo):
    anio, mes, cuando = mes_pasado()
    f = comprar(client, db, insumo, cuando)
    f.tasa_bcv = f.gravado_bs = f.exento_bs = f.iva_bs = None
    db.query(models.TasaCambio).delete()
    db.commit()
    assert libro(client, anio, mes)["sin_tasa"] == 1

    r = client.put(f"/api/impuestos/compras/{f.id}/tasa", json={"tasa_bcv": 60.0})
    assert r.status_code == 200, r.text
    assert (r.json()["gravado_bs"], r.json()["iva_bs"]) == (6000.0, 960.0)
    assert libro(client, anio, mes)["sin_tasa"] == 0
    assert client.post("/api/impuestos/declaraciones", json={"anio": anio, "mes": mes}).status_code == 200


def test_en_un_mes_declarado_la_tasa_ya_no_se_cambia(client, db, insumo):
    anio, mes, cuando = mes_pasado()
    f = comprar(client, db, insumo, cuando)
    client.post("/api/impuestos/declaraciones", json={"anio": anio, "mes": mes})
    r = client.put(f"/api/impuestos/compras/{f.id}/tasa", json={"tasa_bcv": 60.0})
    assert r.status_code == 409 and "declarado" in r.json()["detail"]


def test_a_una_factura_en_bolivares_no_se_le_cambia_la_tasa(client, db, insumo):
    r = client.post("/api/compras/facturas", json={
        "numero_factura": "F-B", "proveedor_nombre": "P", "proveedor_rif": "J402235135", "moneda": "Bs",
        "tasa_bcv": 50.0, "items": [{"ingrediente_id": insumo.id, "cantidad": 1, "costo_unitario": 2.0}],
    })
    r = client.put(f"/api/impuestos/compras/{r.json()['id']}/tasa", json={"tasa_bcv": 60.0})
    assert r.status_code == 409 and "Bs del papel" in r.json()["detail"]


def test_la_tasa_de_una_venta_facturada_se_puede_cargar(client, db, variante):
    p = client.post("/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 1}], "nota": ""}).json()
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs", "facturado": True, "numero_factura": "V-1"})
    assert client.put(f"/api/impuestos/ventas/{p['id']}/tasa", json={"tasa_bcv": 70.0}).status_code == 200
    [f] = client.get("/api/impuestos/libro-ventas").json()["filas"]
    assert f["tasa_bcv"] == 70.0
    assert client.put(f"/api/impuestos/ventas/{p['id']}/tasa", json={"tasa_bcv": 0}).status_code == 400
