"""Pagarle al proveedor tambien es aplicar un pago.

Misma regla que al cobrar (contabilidad.METODOS_CON_REFERENCIA): lo que no
sale en billetes deja un numero en alguna parte. Sin anotarlo, el negocio se
queda sin con que demostrar un pago que el proveedor dice no haber recibido,
que es el reclamo de siempre pero al reves.
"""

from app import models

FACTURA = {
    "numero_factura": "FC-001",
    "proveedor_nombre": "Distribuidora X",
    "proveedor_rif": "J123456789",
    "categoria": "Servicios",
    "base_imponible": 100.0,
    "iva": 16.0,
}


def crear(client, **extra):
    return client.post("/api/compras/facturas", json={**FACTURA, **extra})


# ── Al cargar una factura ya pagada ─────────────────────────────────────────


def test_cargar_una_factura_pagada_por_banco_sin_referencia_se_rechaza(client):
    r = crear(client, forma_pago="Banco")
    assert r.status_code == 400, r.text
    assert "referencia" in r.json()["detail"].lower()


def test_en_efectivo_no_se_pide(client):
    r = crear(client, forma_pago="Efectivo", numero_factura="FC-002")
    assert r.status_code == 200, r.text


def test_a_credito_no_se_pide_porque_todavia_no_salio_plata(client):
    r = crear(client, forma_pago="Credito", numero_factura="FC-003")
    assert r.status_code == 200, r.text
    assert r.json()["referencia_pago"] == ""


def test_la_referencia_queda_guardada(client):
    r = crear(client, forma_pago="Banco", numero_factura="FC-004", referencia_pago=" TRF-9912 ")
    assert r.status_code == 200, r.text
    assert r.json()["referencia_pago"] == "TRF-9912"


def test_una_factura_rechazada_no_carga_nada(client, db, insumo):
    """El rechazo pasa antes de tocar stock ni costos: no puede quedar media
    factura cargada ni el inventario movido."""
    antes = db.query(models.Ingrediente).filter_by(id=insumo.id).first().stock_actual
    r = client.post("/api/compras/facturas", json={
        **FACTURA,
        "numero_factura": "FC-005",
        "forma_pago": "Banco",
        "base_imponible": None,
        "items": [{"ingrediente_id": insumo.id, "cantidad": 5, "costo_unitario": 8.0}],
    })
    assert r.status_code == 400, r.text
    assert db.query(models.FacturaCompra).filter_by(numero_factura="FC-005").count() == 0
    db.expire_all()
    assert db.query(models.Ingrediente).filter_by(id=insumo.id).first().stock_actual == antes


# ── Al saldar una factura a credito ─────────────────────────────────────────


def a_credito(client, numero="FC-100"):
    r = crear(client, forma_pago="Credito", numero_factura=numero)
    assert r.status_code == 200, r.text
    return r.json()


def test_saldar_por_banco_sin_referencia_se_rechaza(client):
    f = a_credito(client)
    r = client.post(f"/api/compras/facturas/{f['id']}/pagar", json={"forma_pago": "Banco"})
    assert r.status_code == 400, r.text
    assert "referencia" in r.json()["detail"].lower()
    # Y la factura sigue pendiente.
    assert client.get(f"/api/compras/facturas").json()[0]["pagada"] is False


def test_una_referencia_en_blanco_no_cuenta(client):
    f = a_credito(client, "FC-101")
    r = client.post(
        f"/api/compras/facturas/{f['id']}/pagar",
        json={"forma_pago": "Banco", "referencia": "  "},
    )
    assert r.status_code == 400, r.text


def test_saldar_en_efectivo_no_pide_referencia(client):
    f = a_credito(client, "FC-102")
    r = client.post(f"/api/compras/facturas/{f['id']}/pagar", json={"forma_pago": "Efectivo"})
    assert r.status_code == 200, r.text
    assert r.json()["pagada"] is True


def test_la_referencia_del_pago_queda_en_la_factura(client):
    f = a_credito(client, "FC-103")
    r = client.post(
        f"/api/compras/facturas/{f['id']}/pagar",
        json={"forma_pago": "Banco", "referencia": "PM-5501"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["referencia_pago"] == "PM-5501"
