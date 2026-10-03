"""Las retenciones de IVA que le hacen a la empresa sus clientes.

Siendo contribuyente ordinario, cuando le vende a un contribuyente especial
este le retiene el 75 % del IVA y le entrega un comprobante. Ese monto va en
el Libro de Ventas (Y-AA) del mes del comprobante y se descuenta del IVA a
pagar en la declaracion; lo que sobra se arrastra.
"""

import datetime
import io

import pytest
from openpyxl import load_workbook

from app import impuestos, models
from app.timeutils import hoy

TASA = 100.0


@pytest.fixture(autouse=True)
def tasa(db):
    db.merge(models.TasaCambio(fecha=datetime.date(2000, 1, 1), bcv=TASA, origen="auto"))
    db.commit()


def vender(client, variante, numero="V-1"):
    p = client.post("/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 10}], "nota": ""}).json()
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={
        "metodo_pago": "Efectivo Bs", "facturado": True, "numero_factura": numero,
        "rif_cliente": "J300215938", "razon_social_cliente": "Diageo Venezuela, C.A.",
    })
    assert r.status_code == 200, r.text
    return r.json()


def comprobante(fecha):
    return f"{fecha.year:04d}{fecha.month:02d}00001234"


def iva_bs(db, pedido_id):
    p = db.get(models.Pedido, pedido_id)
    return impuestos.desglosar(round(p.total * TASA, 2), 16)[1]


def test_por_defecto_se_registra_el_75_del_iva(client, db, variante):
    v = vender(client, variante)
    r = client.post(f"/api/impuestos/ventas/{v['id']}/retencion", json={
        "comprobante": comprobante(hoy()), "fecha": hoy().isoformat(),
    })
    assert r.status_code == 200, r.text
    assert r.json()["iva_retenido_bs"] == round(iva_bs(db, v["id"]) * 0.75, 2)

    [f] = client.get("/api/impuestos/libro-ventas").json()["filas"]
    assert (f["comprobante_retencion"], f["iva_retenido_bs"]) == (comprobante(hoy()), r.json()["iva_retenido_bs"])


def test_el_comprobante_se_valida(client, variante):
    v = vender(client, variante)
    url = f"/api/impuestos/ventas/{v['id']}/retencion"
    assert client.post(url, json={"comprobante": "123", "fecha": hoy().isoformat()}).status_code == 400
    manana = (hoy() + datetime.timedelta(days=1)).isoformat()
    assert client.post(url, json={"comprobante": comprobante(hoy()), "fecha": manana}).status_code == 400
    assert client.post(url, json={"comprobante": comprobante(hoy()), "fecha": hoy().isoformat(), "monto_bs": 10**9}).status_code == 400


def test_la_declaracion_descuenta_lo_retenido(client, db, variante):
    v = vender(client, variante)
    # Venta y comprobante del mes pasado, para poder declararlo.
    p = db.get(models.Pedido, v["id"])
    p.cerrado_en = p.cerrado_en.replace(day=1) - datetime.timedelta(days=20)
    db.commit()
    fecha = p.cerrado_en.date()
    client.post(f"/api/impuestos/ventas/{v['id']}/retencion", json={"comprobante": comprobante(fecha), "fecha": fecha.isoformat()})

    d = client.post("/api/impuestos/declaraciones", json={"anio": fecha.year, "mes": fecha.month}).json()
    iva = iva_bs(db, v["id"])
    retenido = round(iva * 0.75, 2)
    assert d["iva_debito_bs"] == iva
    assert d["retenciones_usadas_bs"] == retenido
    assert d["iva_a_pagar_bs"] == round(iva - retenido, 2)


def test_un_comprobante_de_otro_mes_va_en_el_libro_de_ese_mes(client, db, variante):
    v = vender(client, variante)
    p = db.get(models.Pedido, v["id"])
    p.cerrado_en = p.cerrado_en.replace(day=1) - datetime.timedelta(days=20)
    db.commit()
    client.post(f"/api/impuestos/ventas/{v['id']}/retencion", json={
        "comprobante": comprobante(hoy()), "fecha": hoy().isoformat(),
    })
    filas = client.get("/api/impuestos/libro-ventas").json()["filas"]
    [ret] = [f for f in filas if f["tipo"] == "RET"]
    assert ret["factura_afectada"] == "V-1" and ret["iva_retenido_bs"] > 0 and ret["total_bs"] == 0

    ws = load_workbook(io.BytesIO(client.get("/api/impuestos/libro-ventas/seniat").content)).active
    assert (ws["Z8"].value, ws["AA8"].value) == (comprobante(hoy()), ret["iva_retenido_bs"])


def test_se_puede_quitar_si_el_mes_no_esta_declarado(client, variante):
    v = vender(client, variante)
    url = f"/api/impuestos/ventas/{v['id']}/retencion"
    client.post(url, json={"comprobante": comprobante(hoy()), "fecha": hoy().isoformat()})
    assert client.delete(url).status_code == 200
    [f] = client.get("/api/impuestos/libro-ventas").json()["filas"]
    assert f["iva_retenido_bs"] is None
