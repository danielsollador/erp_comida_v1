"""El vuelto por pago movil, mandado desde la cuenta del local (Pabilo C2P).

Solo una cuenta juridica con C2P puede mandarlo; una de persona natural
recibe un 409 que lo dice. Lo que el banco aprobo queda guardado y atado al
pedido al cobrar; lo que rechazo no se puede usar en un cobro.
"""
import pytest

from app import models, pabilo, settings

PERSONAS = pabilo.Cuenta(
    id="6ab430720e266eee47af179f", descripcion="Leider BDV", banco="banco_venezuela",
    moneda="VEF", campos=["REFERENCE_NUMBER"], tipo="GENERIC", proveedor="VE_BAN",
)
JURIDICA = pabilo.Cuenta(
    id="68bf4460342eb73ad4ccfe72", descripcion="Sávora C.A.", banco="banco_venezuela",
    moneda="VEF", campos=["REFERENCE_NUMBER"], tipo="GENERIC", proveedor="VE_BAN_EMP_V2",
)


@pytest.fixture()
def con_cuenta(monkeypatch):
    monkeypatch.setattr(settings, "PABILO_API_KEY", "clave-de-prueba")
    monkeypatch.setattr(settings, "PABILO_USER_BANK_ID", "")
    monkeypatch.setattr(pabilo, "_get", lambda ruta, con_clave=True: (200, {"invoice_number": "INV-000123"}))
    llamadas = []

    def usar(cuenta, status, cuerpo):
        monkeypatch.setattr(pabilo, "cuentas", lambda forzar=False: [cuenta])

        def _post(ruta, body):
            llamadas.append((ruta, body))
            return status, cuerpo

        monkeypatch.setattr(pabilo, "_post", _post)

    usar.llamadas = llamadas
    return usar


APROBADO = (200, {"message": "Transaction change created successfully",
                  "data": {"transaction_changes": {"reference": "123456789012", "authorization_code": "AUTH987", "status": "APPROVED"}}})

CUERPO = {"telefono": "0414-123.45.67", "cedula": "V-12.345.678", "banco": "0102", "monto_bs": 3294.47, "monto_usd": 3.83}


def test_cuenta_de_persona_natural_no_manda_vueltos(client, con_cuenta):
    con_cuenta(PERSONAS, *APROBADO)
    r = client.post("/api/pagos/vuelto", json=CUERPO)
    assert r.status_code == 409, r.text
    assert "jurídica" in r.json()["detail"]
    assert con_cuenta.llamadas == []
    assert client.get("/api/pagos/estado").json()["emite_vueltos"] is False


def test_cuenta_juridica_manda_el_vuelto_y_queda_en_el_pedido(client, db, variante, con_cuenta):
    con_cuenta(JURIDICA, *APROBADO)
    assert client.get("/api/pagos/estado").json()["emite_vueltos"] is True
    r = client.post("/api/pagos/vuelto", json=CUERPO)
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["resultado"] == "enviado"
    assert v["referencia"] == "123456789012"
    ruta, body = con_cuenta.llamadas[-1]
    assert ruta == f"/v1/transactionchange/userbank/{JURIDICA.id}"
    assert body == {
        "dni": {"code": "V", "number": "12345678"},
        "phone_pagador": "04141234567",
        "amount": 3294.47,
        "invoice_number": "INV-000123",
        "destination_bank_code": "0102",
    }

    # El cobro en efectivo con ese vuelto: queda atado al pedido.
    p = client.post("/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 1}], "nota": "", "permitir_sin_stock": True}).json()
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={
        "metodo_pago": "Efectivo $",
        "pagos": [{"metodo": "Efectivo $", "monto": 5.0, "recibido": 10.0, "vuelto_metodo": "Pago movil", "vuelto_id": v["id"]}],
    })
    assert r.status_code == 200, r.text
    pago = db.query(models.PagoPedido).filter_by(pedido_id=p["id"]).one()
    assert pago.vuelto_metodo == "Pago movil"
    assert pago.vuelto_monto == 5.0
    assert pago.vuelto_id == v["id"]
    assert pago.vuelto_referencia == "123456789012"
    assert db.get(models.VueltoPagoMovil, v["id"]).pedido_id == p["id"]
    assert r.json()["pagos"][0]["vuelto_referencia"] == "123456789012"


def test_un_vuelto_rechazado_no_sirve_para_cobrar(client, variante, con_cuenta):
    con_cuenta(JURIDICA, 400, {"error": "INSUFFICIENT_FUNDS", "message": "insufficient funds"})
    r = client.post("/api/pagos/vuelto", json=CUERPO)
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["resultado"] == "rechazado"
    assert "saldo" in v["mensaje"]
    p = client.post("/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 1}], "nota": "", "permitir_sin_stock": True}).json()
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={
        "metodo_pago": "Efectivo $",
        "pagos": [{"metodo": "Efectivo $", "monto": 5.0, "recibido": 10.0, "vuelto_metodo": "Pago movil", "vuelto_id": v["id"]}],
    })
    assert r.status_code == 400


def test_telefono_y_cedula_se_validan_antes_de_llamar(client, con_cuenta):
    con_cuenta(JURIDICA, *APROBADO)
    r = client.post("/api/pagos/vuelto", json={**CUERPO, "telefono": "1234"})
    assert r.status_code == 400 and "04141234567" in r.json()["detail"]
    r = client.post("/api/pagos/vuelto", json={**CUERPO, "cedula": "abc"})
    assert r.status_code == 400
    assert con_cuenta.llamadas == []


def test_vuelto_a_mano_solo_con_referencia(client, db, variante):
    """Sin Pabilo (o con cuenta de persona natural) el vuelto por pago movil
    se hace desde el banco y se anota la referencia."""
    p = client.post("/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 1}], "nota": "", "permitir_sin_stock": True}).json()
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={
        "metodo_pago": "Efectivo $",
        "pagos": [{"metodo": "Efectivo $", "monto": 5.0, "recibido": 10.0, "vuelto_metodo": "Pago movil", "vuelto_referencia": "9988"}],
    })
    assert r.status_code == 200, r.text
    pago = db.query(models.PagoPedido).filter_by(pedido_id=p["id"]).one()
    assert pago.vuelto_referencia == "9988"
    assert pago.vuelto_id is None
