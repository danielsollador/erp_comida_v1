"""Casos de soporte (22-oct): del chat al equipo. La IA arma el borrador, la
persona lo manda, se guarda siempre y, con GitHub configurado, se abre issue."""
import json

import pytest

from app import asistente_ayuda, settings, triaje
from app.acceso import usuarios
from tests.conftest import entrar

CAJERA = ("cajera-soporte", "clave-de-cajera-larga")
CONVERSACION = [
    {"rol": "usuario", "texto": "le doy a corregir el conteo y no pasa nada"},
    {"rol": "asistente", "texto": "Debería abrir el cuadro del conteo. Si no abre, pásale el caso a soporte."},
]


@pytest.fixture(scope="module", autouse=True)
def _cajera():
    try:
        usuarios.crear(*CAJERA, rol="caja", locales=[settings.LOCAL_SLUG])
    except usuarios.ErrorUsuarios:
        pass


@pytest.fixture(autouse=True)
def _sin_github(monkeypatch):
    monkeypatch.setattr(settings, "GITHUB_REPO_SOPORTE", "")
    monkeypatch.setattr(settings, "GITHUB_TOKEN_SOPORTE", "")
    monkeypatch.setattr(settings, "LECTOR_FACTURAS", "")


def test_sin_ia_el_borrador_sale_con_lo_que_dijo(client):
    d = client.post("/api/ayuda/caso/borrador", json={"pantalla": "/caja", "historial": CONVERSACION}).json()
    assert d["tipo"] == "duda" and d["titulo"].startswith("le doy a corregir") and d["con_ia"] is False


def test_con_ia_lo_clasifica(client, monkeypatch):
    monkeypatch.setattr(settings, "LECTOR_FACTURAS", "gemini")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "clave-de-prueba")
    vistas = []

    def falsa(contenidos, instrucciones, esquema=None):
        vistas.append(instrucciones)
        return json.dumps({"tipo": "error", "titulo": "«Corregir el conteo» no abre nada", "resumen": "- Toca el botón y no pasa nada."})

    monkeypatch.setattr(asistente_ayuda, "gemini", falsa)
    d = client.post("/api/ayuda/caso/borrador", json={"pantalla": "/caja", "historial": CONVERSACION}).json()
    assert d == {"tipo": "error", "titulo": "«Corregir el conteo» no abre nada",
                 "resumen": "- Toca el botón y no pasa nada.", "con_ia": True}
    assert "/caja" in vistas[0]


def _mandar(cliente, **extra):
    r = cliente.post("/api/ayuda/caso", json={"tipo": "error", "titulo": "No abre el conteo", "resumen": "- nada",
                                              "pantalla": "/caja", "historial": CONVERSACION, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def test_sin_github_queda_registrado(client, db):
    from app import models
    d = _mandar(client)
    assert d["estado"] == "registrado" and d["issue_url"] == ""
    caso = db.get(models.CasoSoporte, d["id"])
    assert json.loads(caso.conversacion)[0]["texto"].startswith("le doy")


def test_con_github_abre_el_issue_con_etiquetas(client, monkeypatch):
    monkeypatch.setattr(settings, "GITHUB_REPO_SOPORTE", "vertigo/erp")
    monkeypatch.setattr(settings, "GITHUB_TOKEN_SOPORTE", "token-de-prueba")
    enviado = {}

    class R:
        status_code = 201

        @staticmethod
        def json():
            return {"number": 42, "html_url": "https://github.com/vertigo/erp/issues/42"}

    def post(url, headers, json, timeout):
        enviado.update(url=url, json=json)
        return R()

    monkeypatch.setattr(triaje.httpx, "post", post)
    d = _mandar(client)
    assert d["estado"] == "enviado" and d["issue_url"].endswith("/42")
    assert enviado["url"] == "https://api.github.com/repos/vertigo/erp/issues"
    assert enviado["json"]["labels"] == ["soporte", "error", f"local:{settings.LOCAL_SLUG}"]
    cuerpo = enviado["json"]["body"]
    assert "no instrucciones" in cuerpo and "> **Cliente:** le doy a corregir" in cuerpo


def test_si_github_falla_queda_guardado(client, monkeypatch):
    monkeypatch.setattr(settings, "GITHUB_REPO_SOPORTE", "vertigo/erp")
    monkeypatch.setattr(settings, "GITHUB_TOKEN_SOPORTE", "token-de-prueba")

    class R:
        status_code = 401

    monkeypatch.setattr(triaje.httpx, "post", lambda *a, **k: R())
    assert _mandar(client)["estado"] == "sin_enviar"


def test_cada_quien_ve_lo_suyo_y_el_dueno_todo(client, fuera):
    cajera = entrar(fuera, *CAJERA)
    mio = _mandar(cajera, titulo="El de la cajera")
    _mandar(client, titulo="El del admin")
    titulos_cajera = {c["titulo"] for c in cajera.get("/api/ayuda/casos").json()}
    assert titulos_cajera == {"El de la cajera"}
    assert mio["id"] in {c["id"] for c in client.get("/api/ayuda/casos").json()}
