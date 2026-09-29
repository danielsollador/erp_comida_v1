"""Configuracion > Pago movil: la clave y las cuentas de Pabilo desde la pantalla.

Nada toca internet: se reemplazan las llamadas HTTP por respuestas con la
forma que documenta Pabilo (docs/user, docs/bank-accounts). Lo que se prueba
es lo que decide el ERP:

  - la clave se PRUEBA antes de guardarse; una mala no se queda puesta.
  - guardada, el cobro la usa aunque el servidor no tenga PABILO_API_KEY.
  - con una sola cuenta conectada, esa queda elegida sola.
  - dar de alta una cuenta manda exactamente lo que ese banco pide.
  - el monto corregido por la cajera es contra lo que se compara.
  - caja y cocina no tocan nada de esto.
"""

import pytest

from app import models, pabilo, settings
from app.acceso import usuarios
from tests.conftest import entrar

LOCAL = settings.LOCAL_SLUG
CAJERA = ("cajera-pabilo", "clave-de-caja-larga")
DUENA = ("duena-pabilo", "clave-de-duena-larga")

PERFIL = {"id": "685725869e6febc736848bf1", "username": "savora", "email": "x@y.z",
          "full_name": "Sávora C.A.", "company_name": "Sávora C.A.", "credits": 38,
          "plan_id": "b2b", "plan_is_active": True}

CUENTA_BDV = {
    "id": "6ab430720e266eee47af179f", "description": "Leider BDV", "provider": "VE_BAN",
    "platform": "banco_venezuela", "currency": "VEF", "to_trash": False, "is_disabled": False,
    "default_bank_account": {"account_number": "01020656110100004041", "account_type": "AHORRO"},
    "user_bank_phone": {"countryCode": "58", "number": "4141234567"},
    "verifications_types_available": [{"id": "GENERIC", "fields_required": [{"name": "REFERENCE_NUMBER", "type": "STRING"}]}],
}

PLATAFORMAS = [
    {"id": "banco_venezuela", "name": "Banco de Venezuela", "bank_code": "0102", "currency": "VEF",
     "providers": ["VE_BAN", "VE_BAN_EMP_V2"], "is_bank": True, "have_notification_sms": True},
    {"id": "provincial", "name": "Provincial", "bank_code": "0108", "currency": "VEF",
     "providers": None, "is_bank": True, "have_notification_sms": True},
    {"id": "test", "name": "Banco de Prueba (Test)", "bank_code": "9999", "currency": "VEF",
     "providers": ["BANK_TEST"], "is_bank": True},
]


@pytest.fixture(autouse=True)
def _limpio(monkeypatch):
    """Sin clave en el servidor y sin nada guardado de una prueba anterior."""
    monkeypatch.setattr(settings, "PABILO_API_KEY", "")
    monkeypatch.setattr(settings, "PABILO_USER_BANK_ID", "")
    pabilo.ajustar(clave="", cuenta="")
    yield
    pabilo.ajustar(clave="", cuenta="")


@pytest.fixture()
def pabilo_falso(monkeypatch):
    """Un Pabilo de mentira: responde /me, /me/usersbank y /v1/platforms, y
    anota lo que se le manda. `clave_buena` es la unica que acepta."""
    estado = {"cuentas": [dict(CUENTA_BDV)], "llamadas": []}

    def _get(ruta, con_clave=True):
        if con_clave and pabilo.clave() != "clave-buena":
            return 401, {"error": "UNAUTHORIZED", "message": "bad key"}
        if ruta == "/me":
            return 200, dict(PERFIL)
        if ruta == "/me/usersbank":
            return 200, {"user_banks": [dict(c) for c in estado["cuentas"]]}
        if ruta == "/v1/platforms":
            return 200, PLATAFORMAS
        return 404, {"error": "NOT_FOUND", "message": ruta}

    def _post(ruta, cuerpo):
        estado["llamadas"].append(("POST", ruta, cuerpo))
        if ruta == "/usersbank":
            nueva = dict(CUENTA_BDV, id="nueva-123", description=cuerpo.get("description", ""),
                         provider=cuerpo.get("bank_provider", ""))
            estado["cuentas"].append(nueva)
            return 200, {"message": "Usersbank created successfully", "usersbank": nueva}
        return 404, {"error": "NOT_FOUND", "message": ruta}

    def _put(ruta, cuerpo):
        estado["llamadas"].append(("PUT", ruta, cuerpo))
        if ruta.endswith("/change-secret"):
            return 200, {"message": "Usersbank secret changed successfully"}
        return 404, {"error": "NOT_FOUND", "message": ruta}

    def _delete(ruta):
        estado["llamadas"].append(("DELETE", ruta, None))
        return 200, {"message": "Usersbank moved to trash successfully"}

    monkeypatch.setattr(pabilo, "_get", _get)
    monkeypatch.setattr(pabilo, "_post", _post)
    monkeypatch.setattr(pabilo, "_put", _put)
    monkeypatch.setattr(pabilo, "_delete", _delete)
    # La lista real pasa por `_get`; sin cache entre pruebas.
    monkeypatch.setattr(pabilo, "_cache_cuentas", (0.0, []))
    return estado


def guardar_clave(client, clave):
    return client.put("/api/pagos/config/clave", json={"clave": clave})


# ── La clave ────────────────────────────────────────────────────────────────


def test_sin_clave_la_pantalla_lo_dice(client, pabilo_falso):
    r = client.get("/api/pagos/config")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["configurado"] is False and d["origen_clave"] == "" and d["cuentas"] == []


def test_la_clave_se_prueba_antes_de_guardarse(client, db, pabilo_falso):
    r = guardar_clave(client, "clave-mala")
    assert r.status_code == 400, r.text
    assert "no reconoce" in r.json()["detail"]
    fila = db.query(models.Configuracion).first()
    assert not (fila and fila.pabilo_api_key), "una clave mala no se queda puesta"
    assert pabilo.configurado() is False


def test_clave_buena_queda_guardada_y_con_su_cuenta(client, db, pabilo_falso):
    r = guardar_clave(client, "clave-buena")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["configurado"] is True and d["origen_clave"] == "pantalla"
    assert d["clave_pista"] == "…uena", "solo el final, nunca la clave entera"
    assert d["perfil"]["empresa"] == "Sávora C.A." and d["perfil"]["creditos"] == 38
    # Una sola cuenta conectada: esa es, sin que nadie la elija.
    assert d["cuenta_activa_id"] == CUENTA_BDV["id"]
    assert d["cuentas"][0]["activa"] is True
    assert d["cuentas"][0]["numero"] == "…4041", "el numero de cuenta no viaja entero"
    assert db.query(models.Configuracion).first().pabilo_api_key == "clave-buena"
    # Y el cobro la usa: /estado ya dice que se puede verificar.
    e = client.get("/api/pagos/estado").json()
    assert e["configurado"] is True and e["cuenta"] == "Leider BDV"


def test_quitar_la_clave_vuelve_a_la_del_servidor(client, pabilo_falso, monkeypatch):
    guardar_clave(client, "clave-buena")
    monkeypatch.setattr(settings, "PABILO_API_KEY", "clave-del-env")
    d = guardar_clave(client, "").json()
    assert d["origen_clave"] == "servidor" and d["clave_pista"] == "…-env"
    monkeypatch.setattr(settings, "PABILO_API_KEY", "")
    d = client.get("/api/pagos/config").json()
    assert d["configurado"] is False


def test_lo_guardado_se_carga_al_arrancar(client, db, pabilo_falso):
    from app.routers import pagos as pagos_router

    guardar_clave(client, "clave-buena")
    pabilo.ajustar(clave="", cuenta="")  # como si el proceso hubiera reiniciado
    assert pabilo.configurado() is False
    pagos_router.cargar_ajustes(db)
    assert pabilo.clave() == "clave-buena" and pabilo.cuenta_configurada() == CUENTA_BDV["id"]


# ── Las cuentas ─────────────────────────────────────────────────────────────


def test_bancos_ofrece_los_proveedores_que_sabemos_conectar(client, pabilo_falso):
    guardar_clave(client, "clave-buena")
    r = client.get("/api/pagos/config/bancos")
    assert r.status_code == 200, r.text
    opciones = {o["proveedor"]: o for o in r.json()}
    bdv = opciones["VE_BAN"]
    assert bdv["banco"] == "banco_venezuela" and bdv["codigo_banco"] == "0102"
    assert [c["clave"] for c in bdv["campos"]] == ["usuario", "clave"]
    assert bdv["campos"][1]["secreto"] is True
    assert "VE_BAN_EMP_V2" in opciones and opciones["VE_BAN_EMP_V2"]["ayuda"]
    # Provincial no tiene conexion directa: se ofrece por notificaciones.
    notif = opciones["NOTIFICATION_ACCOUNT"]
    assert "Provincial" in notif["ayuda"]
    assert opciones["BANK_TEST"]["prueba"] is True
    # Los de verdad primero, el sandbox y las notificaciones al final.
    orden = [o["proveedor"] for o in r.json()]
    assert orden.index("VE_BAN") < orden.index("BANK_TEST") < orden.index("NOTIFICATION_ACCOUNT")


def test_crear_cuenta_bdv_manda_lo_que_el_banco_pide(client, pabilo_falso):
    guardar_clave(client, "clave-buena")
    r = client.post("/api/pagos/config/cuentas", json={
        "proveedor": "VE_BAN", "descripcion": "Cuenta del local",
        "usuario": "V12345678", "clave": "secreta",
    })
    assert r.status_code == 200, r.text
    metodo, ruta, cuerpo = pabilo_falso["llamadas"][-1]
    assert (metodo, ruta) == ("POST", "/usersbank")
    assert cuerpo == {
        "user_id": PERFIL["id"], "bank_provider": "VE_BAN", "description": "Cuenta del local",
        "username": "V12345678", "password": "secreta",
    }
    assert len(r.json()["cuentas"]) == 2
    # Ya habia una elegida: la nueva no la pisa.
    assert r.json()["cuenta_activa_id"] == CUENTA_BDV["id"]


def test_crear_cuenta_sin_credenciales_es_400_y_no_llama(client, pabilo_falso):
    guardar_clave(client, "clave-buena")
    antes = len(pabilo_falso["llamadas"])
    r = client.post("/api/pagos/config/cuentas", json={"proveedor": "VE_BAN", "usuario": "x", "clave": ""})
    assert r.status_code == 400 and "Hacen falta" in r.json()["detail"]
    assert len(pabilo_falso["llamadas"]) == antes


def test_crear_cuenta_con_metadata_y_de_notificaciones(client, pabilo_falso):
    guardar_clave(client, "clave-buena")
    r = client.post("/api/pagos/config/cuentas", json={
        "proveedor": "MERCANTIL_EMP_V1", "descripcion": "Mercantil", "usuario": "cid", "clave": "sec",
        "metadata": {"INTEGRATOR_ID": "1", "TERMINAL_ID": "T", "MERCHANT_ID": "M"},
    })
    assert r.status_code == 200, r.text
    cuerpo = pabilo_falso["llamadas"][-1][2]
    assert {m["key_name"]: m["key_value"] for m in cuerpo["metadata"]} == {
        "INTEGRATOR_ID": "1", "TERMINAL_ID": "T", "MERCHANT_ID": "M"}
    r = client.post("/api/pagos/config/cuentas", json={
        "proveedor": "NOTIFICATION_ACCOUNT", "descripcion": "Provincial por SMS",
        "telefono": "0414-123.45.67", "cedula": "V-12.345.678",
    })
    assert r.status_code == 200, r.text
    cuerpo = pabilo_falso["llamadas"][-1][2]
    assert cuerpo["user_bank_phone"] == {"countryCode": "58", "number": "4141234567"}
    assert cuerpo["user_bank_dni"] == {"dni_type": "V", "dni_number": "12345678"}
    assert "username" not in cuerpo


def test_elegir_principal_cambiar_clave_y_borrar(client, db, pabilo_falso):
    guardar_clave(client, "clave-buena")
    client.post("/api/pagos/config/cuentas", json={
        "proveedor": "VE_BAN", "descripcion": "Segunda", "usuario": "u", "clave": "c"})
    r = client.put("/api/pagos/config/cuenta", json={"user_bank_id": "nueva-123"})
    assert r.status_code == 200 and r.json()["cuenta_activa_id"] == "nueva-123"
    assert db.query(models.Configuracion).first().pabilo_user_bank_id == "nueva-123"
    assert client.put("/api/pagos/config/cuenta", json={"user_bank_id": "no-existe"}).status_code == 404

    r = client.put("/api/pagos/config/cuentas/nueva-123/clave", json={"clave": "otra"})
    assert r.status_code == 200
    assert pabilo_falso["llamadas"][-1][1:] == ("/v1/usersbank/nueva-123/change-secret", {"secret": "otra"})

    r = client.delete("/api/pagos/config/cuentas/nueva-123")
    assert r.status_code == 200
    assert pabilo_falso["llamadas"][-1][:2] == ("DELETE", "/usersbank/nueva-123/to-trash")
    # Era la elegida: queda sin cuenta elegida, y con una sola conectada,
    # la pantalla vuelve a elegirla sola.
    pabilo_falso["cuentas"] = [c for c in pabilo_falso["cuentas"] if c["id"] != "nueva-123"]
    d = client.get("/api/pagos/config").json()
    assert d["cuenta_activa_id"] == CUENTA_BDV["id"]


def test_errores_de_pabilo_llegan_en_cristiano(client, pabilo_falso, monkeypatch):
    guardar_clave(client, "clave-buena")
    monkeypatch.setattr(pabilo, "_put", lambda ruta, cuerpo: (
        429, {"error": "PASSWORD_CHANGE_TRY_TOO_FREQUENT", "message": "x"}))
    r = client.put("/api/pagos/config/cuentas/x/clave", json={"clave": "otra"})
    assert r.status_code == 400 and "30 segundos" in r.json()["detail"]
    monkeypatch.setattr(pabilo, "_post", lambda ruta, cuerpo: (
        400, {"error": "USER_BANCK_BAD_PASSWORD", "message": "x"}))
    r = client.post("/api/pagos/config/cuentas", json={
        "proveedor": "VE_BAN", "usuario": "u", "clave": "mala"})
    assert r.status_code == 400 and "clave del banco" in r.json()["detail"].lower()


# ── Con dos cuentas, la caja elige a cual le pagaron ────────────────────────


def test_la_caja_elige_a_cual_cuenta_le_pagaron(client, pabilo_falso, monkeypatch):
    guardar_clave(client, "clave-buena")
    client.post("/api/pagos/config/cuentas", json={
        "proveedor": "VE_BAN", "descripcion": "Segunda", "usuario": "u", "clave": "c"})
    e = client.get("/api/pagos/estado").json()
    assert e["cuenta_id"] == CUENTA_BDV["id"], "la principal sigue siendo la primera"
    assert [c["id"] for c in e["cuentas"]] == [CUENTA_BDV["id"], "nueva-123"]

    client.put("/api/tasas", json={"bcv": 100.0})
    pago = {"id": "ubp_1", "bank_reference_id": "12345678", "amount": 1000.0}
    monkeypatch.setattr(pabilo, "_post", lambda ruta, cuerpo: (
        200, {"user_bank_payment": pago, "is_new": True, "credit_cost": 1, "user_credits_total": 37}))
    rutas = []
    real = pabilo.verificar

    def espiar(cuenta, cuerpo):
        rutas.append(cuenta.id)
        return real(cuenta, cuerpo)

    monkeypatch.setattr(pabilo, "verificar", espiar)
    r = client.post("/api/pagos/verificar", json={
        "referencia": "12345678", "monto_usd": 10, "metodo": "Pago movil", "user_bank_id": "nueva-123"})
    assert r.status_code == 200 and r.json()["resultado"] == "verificado"
    assert rutas == ["nueva-123"], "se pregunto a la cuenta que dijo la caja"
    r = client.post("/api/pagos/verificar", json={
        "referencia": "12345678", "monto_usd": 10, "metodo": "Pago movil", "user_bank_id": "fantasma"})
    assert r.json()["resultado"] == "error" and "elige otra" in r.json()["mensaje"].lower()


# ── Quien puede ─────────────────────────────────────────────────────────────

def test_el_dueno_ve_sus_cuentas_pero_no_la_integracion(como_duena, pabilo_falso, monkeypatch):
    """Con quien esta hecha la integracion, la clave, los creditos y el plan
    son de Vertigo. El dueño conecta y elige sus cuentas, y nada mas."""
    monkeypatch.setattr(settings, "PABILO_API_KEY", "clave-buena")
    duena = como_duena
    d = duena.get("/api/pagos/config").json()
    assert d["configurado"] is True
    assert d["perfil"] is None and d["clave_pista"] == "" and d["origen_clave"] == ""
    assert [c["id"] for c in d["cuentas"]] == [CUENTA_BDV["id"]]
    # La clave no la toca.
    assert duena.put("/api/pagos/config/clave", json={"clave": "otra"}).status_code == 403
    # Ni ve el banco de prueba.
    assert "BANK_TEST" not in [o["proveedor"] for o in duena.get("/api/pagos/config/bancos").json()]
    # Pero si conecta cuentas y elige la principal.
    r = duena.post("/api/pagos/config/cuentas", json={
        "proveedor": "VE_BAN", "descripcion": "Mia", "usuario": "u", "clave": "c"})
    assert r.status_code == 200, r.text
    assert duena.put("/api/pagos/config/cuenta", json={"user_bank_id": "nueva-123"}).status_code == 200
    # Y en todo lo que le llega no aparece el proveedor.
    import json as _json
    assert "abilo" not in _json.dumps(r.json(), ensure_ascii=False)



@pytest.fixture()
def como_caja(fuera):
    """Una cajera que existe solo durante la prueba: el almacen de cuentas es
    de toda la sesion y test_acceso cuenta la gente del local."""
    usuarios.crear(*CAJERA, rol="caja", locales=[LOCAL])
    try:
        yield entrar(fuera, *CAJERA)
    finally:
        usuarios.borrar(CAJERA[0])


@pytest.fixture()
def como_duena(fuera):
    usuarios.crear(*DUENA, rol="dueno", locales=[LOCAL])
    try:
        yield entrar(fuera, *DUENA)
    finally:
        usuarios.borrar(DUENA[0])


def test_caja_no_toca_la_configuracion(como_caja, pabilo_falso):
    caja = como_caja
    assert caja.get("/api/pagos/config").status_code == 403
    assert caja.put("/api/pagos/config/clave", json={"clave": "clave-buena"}).status_code == 403
    assert caja.post("/api/pagos/config/cuentas", json={"proveedor": "BANK_TEST"}).status_code == 403
    # Pero verificar un pago, que es parte de cobrar, si.
    assert caja.get("/api/pagos/estado").status_code == 200


# ── El monto corregido por la cajera ────────────────────────────────────────


def test_el_monto_corregido_es_contra_lo_que_se_compara(client, pabilo_falso, monkeypatch):
    guardar_clave(client, "clave-buena")
    client.put("/api/tasas", json={"bcv": 100.0})
    pago = {"id": "ubp_1", "bank_reference_id": "12345678", "amount": 1700.0}
    monkeypatch.setattr(pabilo, "_post", lambda ruta, cuerpo: (
        200, {"user_bank_payment": pago, "is_new": True, "credit_cost": 1, "user_credits_total": 37}))
    # La cuenta es $16,50 = Bs 1.650; el cliente dijo "te mande 1.700".
    r = client.post("/api/pagos/verificar", json={
        "referencia": "12345678", "monto_usd": 16.5, "monto_bs": 1700, "metodo": "Pago movil"})
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["resultado"] == "verificado", "encontro exactamente lo que la cajera escribio"
    assert v["esperado_bs"] == 1700.0 and v["monto_bs"] == 1700.0
    # Y la cuenta real viaja aparte: con eso la pantalla reparte los Bs 50.
    assert v["cuenta_bs"] == 1650.0
