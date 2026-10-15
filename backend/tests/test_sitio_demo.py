"""El formulario "Pide una demo" del sitio publico: la unica escritura sin sesion."""
from __future__ import annotations

import json

import pytest

from app import settings
from app.routers import sitio

ENVIAR_REAL = sitio._enviar  # antes de que el fixture lo cambie por uno falso

BUENO = {
    "nombre": "Ana Pérez",
    "negocio": "Panadería La Esquina",
    "telefono": "+58 414 123 4567",
    "correo": "Ana@Ejemplo.com",
    "empleados": "6 a 15",
    "tipo": "Panadería, pastelería o café",
    "mensaje": "Tenemos dos locales.",
}


@pytest.fixture(autouse=True)
def _aislado(monkeypatch, tmp_path):
    monkeypatch.setattr(sitio, "_ARCHIVO", str(tmp_path / "solicitudes-demo.jsonl"))
    sitio._envios.clear()
    enviados = []
    monkeypatch.setattr(sitio, "_enviar", lambda s: enviados.append(s))
    yield enviados
    sitio._envios.clear()


def _anotadas():
    try:
        with open(sitio._ARCHIVO, encoding="utf-8") as f:
            return [json.loads(l) for l in f]
    except FileNotFoundError:
        return []


def test_sin_sesion_se_envia_y_queda_anotada(fuera, _aislado):
    r = fuera.post("/api/sitio/demo", json=BUENO)
    assert r.status_code == 200, r.text
    assert len(_aislado) == 1 and _aislado[0].correo == "ana@ejemplo.com"
    assert _anotadas()[0]["negocio"] == "Panadería La Esquina"


def test_tambien_en_el_hub(fuera, monkeypatch, _aislado):
    """El sitio lo sirve el hub (vertigopro.tech), que bloquea casi todo."""
    monkeypatch.setattr(settings, "ES_HUB", True)
    assert fuera.post("/api/sitio/demo", json=BUENO).status_code == 200


@pytest.mark.parametrize("campo,valor", [
    ("nombre", " "), ("telefono", "123"), ("correo", "ana@"),
    ("empleados", "100"), ("tipo", "Banco"),
])
def test_valida_cada_campo(fuera, campo, valor, _aislado):
    r = fuera.post("/api/sitio/demo", json={**BUENO, campo: valor})
    assert r.status_code == 422
    assert r.json()["detail"][0]["loc"][-1] == campo
    assert not _aislado and not _anotadas()


def test_el_mensaje_es_opcional(fuera):
    datos = {k: v for k, v in BUENO.items() if k != "mensaje"}
    assert fuera.post("/api/sitio/demo", json=datos).status_code == 200


def test_la_trampa_contesta_bien_y_no_manda_nada(fuera, _aislado):
    r = fuera.post("/api/sitio/demo", json={**BUENO, "sitio_web": "http://spam"})
    assert r.status_code == 200
    assert not _aislado and not _anotadas()


def test_limite_por_ip(fuera):
    for _ in range(sitio.LIMITE):
        assert fuera.post("/api/sitio/demo", json=BUENO).status_code == 200
    assert fuera.post("/api/sitio/demo", json=BUENO).status_code == 429


def test_si_el_correo_falla_responde_error_pero_la_guarda(fuera, monkeypatch):
    def falla(s):
        raise RuntimeError("SMTP sin configurar")
    monkeypatch.setattr(sitio, "_enviar", falla)
    assert fuera.post("/api/sitio/demo", json=BUENO).status_code == 503
    assert len(_anotadas()) == 1


def test_formsubmit_sin_activar_es_error(monkeypatch):
    """La primera vez FormSubmit pide activar el buzon: no cuenta como enviado."""
    class Resp:
        def raise_for_status(self): pass
        def json(self): return {"success": "false", "message": "This form needs Activation."}
    llamadas = []
    monkeypatch.setattr(sitio.httpx, "post", lambda url, **kw: llamadas.append((url, kw)) or Resp())
    with pytest.raises(RuntimeError, match="Activation"):
        ENVIAR_REAL(sitio.SolicitudDemo(**BUENO))
    url, kw = llamadas[0]
    assert url.endswith("/ajax/leideriverson@gmail.com")
    assert kw["json"]["_replyto"] == "ana@ejemplo.com"
