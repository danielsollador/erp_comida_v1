"""La sesion de la app nativa (Android / iOS).

La app trae sus pantallas adentro y llama a la API desde otro origen, donde la
cookie no viaja. Se identifica con `X-Vp-App: 1`, recibe el token firmado en
`X-Vp-Token` y lo devuelve en `Authorization: Bearer`. La web no cambia.
"""
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.database import get_db
from app.main import app
from tests.conftest import CLAVE_TEST, USUARIO_TEST

APP = {"X-Vp-App": "1"}


@pytest.fixture()
def sin_cookie(db):
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def token_de_la_app(c) -> str:
    r = c.post("/api/acceso/login", json={"usuario": USUARIO_TEST, "clave": CLAVE_TEST}, headers=APP)
    assert r.status_code == 200, r.text
    token = r.headers.get("x-vp-token")
    assert token, "la app no recibio su token"
    # La app no se queda con la cookie: el WebView no la mandaria.
    c.cookies.clear()
    return token


def test_la_app_entra_con_su_token(sin_cookie):
    token = token_de_la_app(sin_cookie)
    r = sin_cookie.get("/api/menu/categorias", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text


def test_sin_token_ni_cookie_no_entra(sin_cookie):
    token_de_la_app(sin_cookie)
    assert sin_cookie.get("/api/menu/categorias").status_code == 401
    assert sin_cookie.get("/api/menu/categorias", headers={"Authorization": "Bearer basura"}).status_code == 401


def test_la_web_no_recibe_el_token_en_cabecera(sin_cookie):
    r = sin_cookie.post("/api/acceso/login", json={"usuario": USUARIO_TEST, "clave": CLAVE_TEST})
    assert r.status_code == 200
    assert "x-vp-token" not in {k.lower() for k in r.headers.keys()}
    assert sin_cookie.cookies.get("erp_acceso")


def test_el_estado_reconoce_a_la_app(sin_cookie):
    token = token_de_la_app(sin_cookie)
    d = sin_cookie.get("/api/acceso/estado", headers={"Authorization": f"Bearer {token}", **APP}).json()
    assert d["autenticado"] is True and d["usuario"] == USUARIO_TEST


def test_el_canal_en_vivo_acepta_el_token_como_subprotocolo(sin_cookie):
    token = token_de_la_app(sin_cookie)
    with sin_cookie.websocket_connect("/ws", subprotocols=["vp", token]) as ws:
        assert ws.accepted_subprotocol == "vp"


def test_el_canal_en_vivo_sin_token_se_cierra(sin_cookie):
    token_de_la_app(sin_cookie)
    with pytest.raises(WebSocketDisconnect):
        with sin_cookie.websocket_connect("/ws") as ws:
            ws.receive_text()


def test_la_puerta_de_nginx_acepta_el_token_de_la_app(sin_cookie):
    # nginx pregunta a /api/acceso/check antes de dejar pasar cada llamada:
    # si solo miraba la cookie, la app quedaba fuera de todo /api.
    token = token_de_la_app(sin_cookie)
    assert sin_cookie.get("/api/acceso/check").status_code == 401
    assert sin_cookie.get("/api/acceso/check", headers={"Authorization": f"Bearer {token}"}).status_code == 200
    assert sin_cookie.get("/api/acceso/check", headers={"Sec-WebSocket-Protocol": f"vp, {token}"}).status_code == 200
    assert sin_cookie.get("/api/acceso/check", headers={"Authorization": "Bearer falso"}).status_code == 401
