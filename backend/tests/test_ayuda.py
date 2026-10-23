"""El chat de ayuda (21-oct). Sin IA de verdad: se reemplaza la llamada y se
mira QUÉ se le manda, que es lo que decide si responde bien. Que responda bien
lo mide la prueba con preguntas reales (`evals/asistente_soporte.py`)."""
import pytest

from app import asistente_ayuda, settings
from app.acceso import usuarios
from tests.conftest import entrar

COCINERO = ("cocinero-ayuda", "clave-de-cocina-larga")


@pytest.fixture(scope="module", autouse=True)
def _cocinero():
    try:
        usuarios.crear(*COCINERO, rol="cocina", locales=[settings.LOCAL_SLUG])
    except usuarios.ErrorUsuarios:
        pass


@pytest.fixture()
def gemini(monkeypatch):
    """La IA encendida, con la llamada reemplazada: guarda lo que se le manda."""
    monkeypatch.setattr(settings, "LECTOR_FACTURAS", "gemini")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "clave-de-prueba")
    enviado = {}

    def falsa(contenidos, instrucciones, esquema=None, rapido=False):
        enviado.update(contenidos=contenidos, instrucciones=instrucciones)
        return "Toca «Lo viene a buscar» en la tarjeta."

    monkeypatch.setattr(asistente_ayuda, "gemini", falsa)
    return enviado


def test_responde_con_el_manual_y_sabe_donde_esta(client, gemini):
    r = client.post("/api/ayuda", json={"pregunta": "¿qué es esto?", "pantalla": "/pos/pedidos"})
    assert r.status_code == 200, r.text
    assert r.json() == {"texto": "Toca «Lo viene a buscar» en la tarjeta.", "con_ia": True}
    assert "«Lo viene a buscar»" in gemini["instrucciones"], "el manual va entero"
    assert "`/pos/pedidos`" in gemini["instrucciones"]
    assert gemini["contenidos"][-1] == {"role": "user", "parts": [{"text": "¿qué es esto?"}]}


def test_la_cocina_tambien_pregunta_y_el_asistente_sabe_a_que_entra(fuera, gemini):
    cocina = entrar(fuera, *COCINERO)
    assert cocina.get("/api/caja/resumen").status_code == 403, "la cocina no entra a la caja"
    r = cocina.post("/api/ayuda", json={"pregunta": "¿cómo cierro la caja?"})
    assert r.status_code == 200, r.text
    quien = gemini["instrucciones"].split("MANUAL:")[0]
    assert "Entra a: Cocina." in quien, quien


def test_recuerda_lo_ultimo_de_la_conversacion(client, gemini):
    historial = [{"rol": "usuario" if i % 2 == 0 else "asistente", "texto": f"turno {i}"} for i in range(10)]
    client.post("/api/ayuda", json={"pregunta": "¿y eso dónde está?", "historial": historial})
    c = gemini["contenidos"]
    assert len(c) == asistente_ayuda.TURNOS_DE_MEMORIA + 1
    assert c[0] == {"role": "user", "parts": [{"text": "turno 4"}]}
    assert c[-2] == {"role": "model", "parts": [{"text": "turno 9"}]}


def test_sin_ia_lo_dice_y_no_falla(client, monkeypatch):
    monkeypatch.setattr(settings, "LECTOR_FACTURAS", "")
    assert client.get("/api/ayuda").json()["activo"] is False
    r = client.post("/api/ayuda", json={"pregunta": "hola"})
    assert r.status_code == 200
    assert r.json()["con_ia"] is False


def test_si_la_ia_no_contesta_se_dice(client, gemini, monkeypatch):
    monkeypatch.setattr(asistente_ayuda, "gemini", lambda *a: None)
    d = client.post("/api/ayuda", json={"pregunta": "hola"}).json()
    assert d["con_ia"] is False and "otra vez" in d["texto"]


def test_sin_sesion_no(fuera):
    assert fuera.post("/api/ayuda", json={"pregunta": "hola"}).status_code == 401
