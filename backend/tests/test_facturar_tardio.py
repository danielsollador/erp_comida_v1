"""Facturar despues de cobrar, no solo al cobrar.

El dueno no siempre sabe al momento de la venta si la va a facturar: a veces
lo decide al final de la semana, viendo el historico, con el talonario en la
mano. Antes la unica ventana para marcar `facturado` era el propio cobro.
"""

from app import contabilidad


def comanda_cobrada(client, variante, cantidad=1, facturado=False):
    p = client.post("/api/pedidos", json={
        "items": [{"variante_id": variante.id, "cantidad": cantidad}], "nota": "",
    }).json()
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={
        "metodo_pago": "Efectivo Bs", "facturado": facturado,
        "numero_factura": "F-YA-000" if facturado else None,
    })
    assert r.status_code == 200, r.text
    return r.json()


def test_facturar_despues_marca_el_pedido(client, variante):
    v = comanda_cobrada(client, variante)
    assert v["facturado"] is False

    r = client.post(f"/api/pedidos/{v['id']}/facturar", json={"numero_factura": "F-001"})
    assert r.status_code == 200, r.text
    assert r.json()["facturado"] is True
    assert r.json()["numero_factura"] == "F-001"


def test_facturar_despues_entra_al_libro_de_ventas(client, variante):
    v = comanda_cobrada(client, variante)
    client.post(f"/api/pedidos/{v['id']}/facturar", json={"numero_factura": "F-002"})

    libro = client.get("/api/impuestos/libro-ventas").json()
    filas = [f for f in libro["filas"] if f["pedido_id"] == v["id"]]
    assert len(filas) == 1
    assert filas[0]["numero_factura"] == "F-002"
    assert filas[0]["iva"] > 0


def test_no_se_puede_repetir_numero_de_factura(client, variante):
    v1 = comanda_cobrada(client, variante)
    v2 = comanda_cobrada(client, variante)
    r1 = client.post(f"/api/pedidos/{v1['id']}/facturar", json={"numero_factura": "F-003"})
    assert r1.status_code == 200

    r2 = client.post(f"/api/pedidos/{v2['id']}/facturar", json={"numero_factura": "F-003"})
    assert r2.status_code == 409
    assert "F-003" in r2.json()["detail"]


def test_no_se_puede_facturar_dos_veces(client, variante):
    v = comanda_cobrada(client, variante, facturado=True)
    r = client.post(f"/api/pedidos/{v['id']}/facturar", json={"numero_factura": "F-004"})
    assert r.status_code == 409


def test_no_se_puede_facturar_lo_que_no_esta_cobrado(client, variante):
    p = client.post("/api/pedidos", json={
        "items": [{"variante_id": variante.id, "cantidad": 1}], "nota": "",
    }).json()
    r = client.post(f"/api/pedidos/{p['id']}/facturar", json={"numero_factura": "F-005"})
    assert r.status_code == 409


def test_no_se_puede_facturar_sin_numero(client, variante):
    v = comanda_cobrada(client, variante)
    r = client.post(f"/api/pedidos/{v['id']}/facturar", json={"numero_factura": "  "})
    assert r.status_code == 400


def test_una_venta_devuelta_no_se_puede_facturar(client, variante):
    v = comanda_cobrada(client, variante)
    r = client.post(f"/api/pedidos/{v['id']}/devolver", json={"recuperable": True, "motivo": "no le gusto"})
    assert r.status_code == 200
    r2 = client.post(f"/api/pedidos/{v['id']}/facturar", json={"numero_factura": "F-006"})
    assert r2.status_code == 409


def test_el_asiento_de_ajuste_queda_cuadrado(client, variante, db):
    """La comprobacion fuerte: crear_asiento() revienta solo si debe != haber,
    asi que si esto no explota, el ajuste esta bien armado."""
    v = comanda_cobrada(client, variante, cantidad=3)
    r = client.post(f"/api/pedidos/{v['id']}/facturar", json={"numero_factura": "F-007"})
    assert r.status_code == 200

    asiento = (
        db.query(contabilidad.models.AsientoContable)
        .filter_by(origen="factura_tardia", referencia_id=v["id"])
        .first()
    )
    assert asiento is not None
    total_debe = round(sum(m.debe for m in asiento.movimientos), 2)
    total_haber = round(sum(m.haber for m in asiento.movimientos), 2)
    assert total_debe == total_haber
    assert total_debe > 0


def test_facturar_no_toca_la_plata_ya_contada_en_caja(client, variante, db):
    """Facturar despues mueve ingreso a IVA por pagar, pero no puede cambiar
    cuanto entro a la gaveta: eso ya paso, el asiento del cobro no se toca."""
    v = comanda_cobrada(client, variante)
    saldo_caja_antes = contabilidad.saldo_de_cuenta(db, "1010")
    client.post(f"/api/pedidos/{v['id']}/facturar", json={"numero_factura": "F-008"})
    saldo_caja_despues = contabilidad.saldo_de_cuenta(db, "1010")
    assert saldo_caja_antes == saldo_caja_despues
