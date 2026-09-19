"""Cobrar un credito es aplicar un pago, y aplica la misma regla que el POS.

Al cobrar en el punto de venta, todo lo que no es efectivo exige su numero de
confirmacion: sin eso, un reclamo de "yo pague por pago movil" es la palabra
del cliente contra la del negocio. Cobrar o abonar una cuenta a credito entra
exactamente la misma plata por la misma gaveta, pero este endpoint la aceptaba
sin comprobante.
"""

from app import models


def fiada(client, variante, cantidad=2):
    p = client.post("/api/pedidos", json={
        "items": [{"variante_id": variante.id, "cantidad": cantidad}], "nota": "",
    }).json()
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={
        "metodo_pago": "Fiado", "cliente": "Dona Rosa",
    })
    assert r.status_code == 200, r.text
    return r.json()


def test_cobrar_por_pago_movil_sin_referencia_se_rechaza(client, variante):
    v = fiada(client, variante)
    r = client.post(f"/api/caja/fiado/{v['id']}/cobrar", json={"metodo_pago": "Pago movil"})
    assert r.status_code == 400, r.text
    assert "referencia" in r.json()["detail"].lower()


def test_una_referencia_en_blanco_no_cuenta_como_referencia(client, variante):
    v = fiada(client, variante)
    r = client.post(
        f"/api/caja/fiado/{v['id']}/cobrar",
        json={"metodo_pago": "Transferencia", "referencia": "   "},
    )
    assert r.status_code == 400, r.text


def test_cobrar_en_efectivo_no_pide_referencia(client, variante):
    """Un billete no trae comprobante: exigirlo seria trabarle el cobro mas
    comun al cajero."""
    v = fiada(client, variante)
    r = client.post(f"/api/caja/fiado/{v['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})
    assert r.status_code == 200, r.text
    assert r.json()["saldado"] is True


def test_la_referencia_queda_guardada_en_el_abono(client, variante, db):
    v = fiada(client, variante)
    r = client.post(
        f"/api/caja/fiado/{v['id']}/cobrar",
        json={"metodo_pago": "Zelle", "monto": 1.0, "referencia": "  ZL-4417 "},
    )
    assert r.status_code == 200, r.text

    abono = db.query(models.AbonoFiado).filter_by(pedido_id=v["id"]).first()
    assert abono is not None
    assert abono.referencia == "ZL-4417"


def test_un_abono_rechazado_no_deja_nada_a_medias(client, variante, db):
    """El rechazo pasa antes de tocar nada: ni abono, ni asiento, ni saldo."""
    v = fiada(client, variante)
    saldo_antes = client.get("/api/caja/fiado").json()
    client.post(f"/api/caja/fiado/{v['id']}/cobrar", json={"metodo_pago": "Tarjeta", "monto": 1.0})
    assert db.query(models.AbonoFiado).filter_by(pedido_id=v["id"]).count() == 0
    assert client.get("/api/caja/fiado").json() == saldo_antes
