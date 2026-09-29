"""Verificar un pago movil contra el banco (Pabilo) antes de cobrar.

Nada de esto toca internet: se reemplaza la llamada HTTP por respuestas con
la forma exacta que documenta Pabilo. Lo que se prueba es lo que decide el
ERP con esas respuestas, que es lo que le importa a la cajera:

  - encontrado y el monto alcanza  -> verificado, y el cobro queda pegado.
  - encontrado pero entro menos    -> monto_distinto, con las dos cifras.
  - el banco no lo tiene           -> no_encontrado.
  - ya cobro otro pedido AQUI      -> ya_usado, sin gastar un credito.
  - el banco esta caido            -> error reintentable, y se cobra igual
                                      anotando la referencia.
  - sin clave                      -> el ERP no menciona la verificacion.
"""

import pytest

from app import models, pabilo, settings
from app.routers import pagos as pagos_router

CUENTA = pabilo.Cuenta(
    id="6ab430720e266eee47af179f", descripcion="Leider BDV", banco="banco_venezuela",
    moneda="VEF", campos=["REFERENCE_NUMBER"], tipo="GENERIC",
)


def encontrado(monto, es_nuevo=True, creditos=38):
    """La respuesta 200 de Pabilo, en sus dos formas documentadas."""
    pago = {"id": "ubp_1", "bank_reference_id": "12345678", "amount": monto,
            "user_bank_id": CUENTA.id, "status": "verified"}
    if es_nuevo:
        return 200, {"user_bank_payment": pago, "is_new": True, "credit_cost": 1,
                     "user_credits_total": creditos}
    return 200, {"data": {"user_bank_payment": pago, "is_new": False, "credit_cost": 0,
                          "user_credits_total": creditos}, "message": "payment confirmed"}


@pytest.fixture()
def con_pabilo(monkeypatch):
    """Clave puesta, cuenta resuelta sin red. La llamada al banco la define
    cada test con `responder`."""
    monkeypatch.setattr(settings, "PABILO_API_KEY", "clave-de-prueba")
    monkeypatch.setattr(settings, "PABILO_USER_BANK_ID", "")
    monkeypatch.setattr(pabilo, "cuentas", lambda forzar=False: [CUENTA])
    llamadas = []

    def responder(status, cuerpo):
        def _post(ruta, body):
            llamadas.append((ruta, body))
            return status, cuerpo
        monkeypatch.setattr(pabilo, "_post", _post)

    responder.llamadas = llamadas
    return responder


def con_tasa(client, bcv=100.0):
    r = client.put("/api/tasas", json={"bcv": bcv})
    assert r.status_code == 200, r.text


def pedido_de(client, variante, cantidad=2):
    """Con cantidad=2 son $10 (la variante de prueba cuesta $5)."""
    return client.post(
        "/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": cantidad}], "nota": ""}
    ).json()


def verificar(client, referencia="12345678", monto=10.0, **extra):
    return client.post("/api/pagos/verificar",
                       json={"referencia": referencia, "monto_usd": monto, "metodo": "Pago movil", **extra})


# ── Estado ──────────────────────────────────────────────────────────────────


def test_sin_clave_no_esta_configurado(client, monkeypatch):
    monkeypatch.setattr(settings, "PABILO_API_KEY", "")
    r = client.get("/api/pagos/estado")
    assert r.status_code == 200
    assert r.json()["configurado"] is False


def test_estado_dice_la_cuenta_y_los_metodos(client, con_pabilo):
    r = client.get("/api/pagos/estado").json()
    assert r["configurado"] is True
    assert r["cuenta"] == "Leider BDV"
    assert r["campos"] == [], "BDV personas solo pide la referencia"
    assert "Pago movil" in r["metodos"] and "Transferencia" in r["metodos"]


def test_sin_clave_verificar_es_409(client, monkeypatch):
    monkeypatch.setattr(settings, "PABILO_API_KEY", "")
    assert verificar(client).status_code == 409


# ── Los cinco resultados ───────────────────────────────────────────────────


def test_encontrado_y_alcanza_es_verificado(client, db, con_pabilo):
    con_tasa(client, 100.0)
    con_pabilo(*encontrado(1000.0))
    r = verificar(client, monto=10.0)
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["resultado"] == "verificado"
    assert v["esperado_bs"] == 1000.0 and v["monto_bs"] == 1000.0
    assert v["creditos_restantes"] == 38
    # Sin monto en el body: el banco dice cuanto entro y se compara aca.
    ruta, body = con_pabilo.llamadas[0]
    assert ruta.endswith(f"/userbankpayment/{CUENTA.id}/betaserio")
    assert body == {"bank_reference": "12345678", "movement_type": "GENERIC"}
    assert db.query(models.VerificacionPago).count() == 1


def test_redondeo_del_cliente_no_es_faltante(client, con_pabilo):
    con_tasa(client, 36.57)
    # $10 son Bs 365,70; el cliente mando 365,50.
    con_pabilo(*encontrado(365.50))
    assert verificar(client, monto=10.0).json()["resultado"] == "verificado"


def test_entro_menos_es_monto_distinto_con_las_dos_cifras(client, con_pabilo):
    con_tasa(client, 100.0)
    con_pabilo(*encontrado(800.0))
    v = verificar(client, monto=10.0).json()
    assert v["resultado"] == "monto_distinto"
    assert v["esperado_bs"] == 1000.0 and v["monto_bs"] == 800.0
    assert "200" in v["mensaje"], "tiene que decir cuanto falta"


def test_no_encontrado(client, con_pabilo):
    con_tasa(client)
    con_pabilo(404, {"error": "PAYMENT_NOT_FOUND",
                     "message": "payment not found: movement not found with bank reference 12345678"})
    v = verificar(client).json()
    assert v["resultado"] == "no_encontrado"
    assert v["reintentable"] is False


def test_banco_caido_es_error_reintentable(client, con_pabilo):
    con_tasa(client)
    con_pabilo(400, {"error": "BANK_NOT_AVAILABLE", "message": "bank error"})
    v = verificar(client).json()
    assert v["resultado"] == "error"
    assert v["reintentable"] is True and v["del_dueno"] is False


def test_sin_creditos_es_cosa_del_dueno(client, con_pabilo):
    con_tasa(client)
    con_pabilo(400, {"error": "NOT_ENOUGH_CREDITS", "message": "no credits"})
    v = verificar(client).json()
    assert v["resultado"] == "error"
    assert v["del_dueno"] is True
    # Los creditos son de Vertigo, no del local: es a Vertigo a quien se avisa,
    # y sin nombrar al proveedor.
    assert "Vertigo" in v["mensaje"] and "Pabilo" not in v["mensaje"]


def test_referencia_que_ya_cobro_aqui_no_gasta_credito(client, variante, con_pabilo):
    con_tasa(client)
    p = pedido_de(client, variante)
    r = client.post(f"/api/pedidos/{p['id']}/cobrar",
                    json={"metodo_pago": "Pago movil", "referencia": "00012345678"})
    assert r.status_code == 200, r.text

    con_pabilo(*encontrado(1000.0))  # no deberia llegar a llamarse
    # El cliente dicta solo los ultimos digitos: es el mismo pago.
    v = verificar(client, referencia="12345678").json()
    assert v["resultado"] == "ya_usado"
    assert v["pedido_numero"] == p["numero"]
    assert con_pabilo.llamadas == [], "ya se sabia sin preguntarle al banco"


def test_sin_tasa_no_aprueba_a_ciegas(client, con_pabilo):
    """El banco confirmo, pero sin tasa no hay con que comparar el monto: se
    muestra lo que entro y decide la cajera, en vez de darlo por bueno."""
    con_pabilo(*encontrado(1000.0))
    v = verificar(client).json()
    assert v["resultado"] == "monto_distinto"
    assert v["monto_bs"] == 1000.0 and v["esperado_bs"] is None
    assert "tasa" in v["mensaje"].lower()


def test_referencia_corta_o_metodo_ajeno_son_400(client, con_pabilo):
    assert verificar(client, referencia="12").status_code == 400
    r = client.post("/api/pagos/verificar",
                    json={"referencia": "12345678", "monto_usd": 10, "metodo": "Efectivo Bs"})
    assert r.status_code == 400


# ── El cobro queda pegado a la verificacion ────────────────────────────────


def test_cobrar_con_verificacion_la_pega_al_pedido(client, db, variante, con_pabilo):
    con_tasa(client, 100.0)
    con_pabilo(*encontrado(1000.0))
    v = verificar(client).json()
    p = pedido_de(client, variante)
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={
        "metodo_pago": "Pago movil",
        "pagos": [{"metodo": "Pago movil", "monto": 10.0, "referencia": "1234-5678",
                   "verificacion_id": v["id"]}],
    })
    assert r.status_code == 200, r.text
    pago = db.query(models.PagoPedido).filter_by(pedido_id=p["id"]).one()
    assert pago.verificacion_id == v["id"]
    assert db.get(models.VerificacionPago, v["id"]).pedido_id == p["id"]
    assert r.json()["pagos"][0]["verificacion_id"] == v["id"]


def test_una_verificacion_no_sirve_para_otra_referencia(client, variante, con_pabilo):
    con_tasa(client)
    con_pabilo(*encontrado(1000.0))
    v = verificar(client, referencia="12345678").json()
    p = pedido_de(client, variante)
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={
        "metodo_pago": "Pago movil",
        "pagos": [{"metodo": "Pago movil", "monto": 10.0, "referencia": "99999999",
                   "verificacion_id": v["id"]}],
    })
    assert r.status_code == 400
    assert "no corresponde" in r.json()["detail"]


def test_una_verificacion_fallida_no_respalda_un_cobro(client, variante, con_pabilo):
    con_tasa(client)
    con_pabilo(404, {"error": "PAYMENT_NOT_FOUND", "message": "nope"})
    v = verificar(client).json()
    p = pedido_de(client, variante)
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={
        "metodo_pago": "Pago movil",
        "pagos": [{"metodo": "Pago movil", "monto": 10.0, "referencia": "12345678",
                   "verificacion_id": v["id"]}],
    })
    assert r.status_code == 400


def test_sin_verificar_se_cobra_como_siempre(client, db, variante, con_pabilo):
    """Banco caido, cliente esperando: la referencia se anota y se cobra."""
    p = pedido_de(client, variante)
    r = client.post(f"/api/pedidos/{p['id']}/cobrar",
                    json={"metodo_pago": "Pago movil", "referencia": "12345678"})
    assert r.status_code == 200, r.text
    pago = db.query(models.PagoPedido).filter_by(pedido_id=p["id"]).one()
    assert pago.verificacion_id is None


# ── El traductor de respuestas, a solas ────────────────────────────────────


def test_armar_cuerpo_solo_manda_lo_que_el_banco_pide():
    mercantil = pabilo.Cuenta(id="x", descripcion="M", banco="mercantil", moneda="VEF",
                              campos=["REFERENCE_NUMBER", "PHONE_ORIGIN", "DNI_ORIGIN", "BANK_CODE_ORIGIN"],
                              tipo="MOVIL_PAY")
    cuerpo = pabilo.armar_cuerpo(mercantil, "123456", monto=100.0, telefono="04141234567",
                                 cedula="V-12.345.678", banco_origen="0102")
    assert cuerpo == {
        "bank_reference": "123456", "movement_type": "MOVIL_PAY", "amount": 100.0,
        "phone_pagador": "04141234567", "dni_pagador": {"dni_type": "V", "dni_number": "12345678"},
        "bank_origin": "0102",
    }
    # BDV personas: nada mas que la referencia, aunque se le pasen datos.
    assert pabilo.armar_cuerpo(CUENTA, "123456", telefono="0414") == {
        "bank_reference": "123456", "movement_type": "GENERIC",
    }


def test_error_de_pabilo_se_decide_por_codigo_no_por_status(monkeypatch):
    monkeypatch.setattr(pabilo, "_post", lambda ruta, body: (400, {"error": "BANK_TOO_MANY_REQUESTS", "message": "x"}))
    r = pabilo.verificar(CUENTA, {"bank_reference": "1"})
    assert not r.ok and r.reintentable
    monkeypatch.setattr(pabilo, "_post", lambda ruta, body: (500, "<html>caido</html>"))
    r = pabilo.verificar(CUENTA, {"bank_reference": "1"})
    assert not r.ok and r.codigo == "HTTP_500"


def test_metodos_verificables_son_los_que_caen_en_el_banco():
    assert set(pagos_router.METODOS_VERIFICABLES) == {"Pago movil", "Transferencia"}
