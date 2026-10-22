"""Notificaciones push: registrar el telefono, el aviso de permiso y el de la
caja sin cerrar (ver app/push.py).

Leider (22-oct): "YO NECESITO QUE LA APP TENGA PUSH NOTIFICATIONS", solo de
autorizaciones y de caja sin cerrar. Expo no se llama de verdad: `_mandar` se
reemplaza y se mira que se le pidio.
"""
from __future__ import annotations

import pytest

from app import push, settings
from app.acceso import usuarios
from tests.conftest import entrar
from tests.test_cierre_resumen import vender

LOCAL = settings.LOCAL_SLUG
DUENA = ("duena-push", "clave-de-la-duena-larga")
CAJERA = ("caja-push", "clave-de-la-caja-larga")
TOKEN_DUENA = "ExponentPushToken[duena-123]"
TOKEN_CAJERA = "ExponentPushToken[caja-456]"


@pytest.fixture(scope="module", autouse=True)
def _gente():
    for (u, c), rol in ((DUENA, "dueno"), (CAJERA, "caja")):
        try:
            usuarios.crear(u, c, rol=rol, locales=[LOCAL], nombre=u.split("-")[0].title())
        except usuarios.ErrorUsuarios:
            pass
    yield
    for u, _ in (DUENA, CAJERA):
        try:
            usuarios.borrar(u)
        except Exception:  # noqa: BLE001
            pass


@pytest.fixture()
def enviados(monkeypatch):
    """Lo que se le habria mandado a Expo; cada ticket sale 'ok'."""
    lista: list[dict] = []

    def falso(mensajes):
        lista.extend(mensajes)
        return [{"status": "ok"} for _ in mensajes]

    monkeypatch.setattr(push, "_mandar", falso)
    return lista


def _registrar(cliente, token):
    r = cliente.post("/api/push/dispositivo", json={"token": token, "plataforma": "ios"})
    assert r.status_code == 200, r.text


def test_un_token_que_no_es_de_expo_no_se_guarda(client):
    r = client.post("/api/push/dispositivo", json={"token": "cualquier-cosa"})
    assert r.status_code == 400


def test_el_permiso_le_llega_al_dueno_y_no_a_la_caja(fuera, enviados):
    entrar(fuera, *DUENA)
    _registrar(fuera, TOKEN_DUENA)
    entrar(fuera, *CAJERA)
    _registrar(fuera, TOKEN_CAJERA)

    r = fuera.post("/api/autorizaciones", json={"accion": "editar_venta", "detalle": "El cliente paga de más", "monto": 2.5})
    assert r.status_code == 200, r.text

    assert [m["to"] for m in enviados] == [TOKEN_DUENA]
    m = enviados[0]
    assert m["title"] == "Piden tu permiso"
    assert "El cliente paga de más" in m["body"] and "$2.50" in m["body"]
    assert m["data"] == {"ruta": "/notificaciones"}


def test_al_salir_el_telefono_deja_de_recibir(fuera, enviados):
    entrar(fuera, *DUENA)
    _registrar(fuera, TOKEN_DUENA)
    fuera.post("/api/push/dispositivo/quitar", json={"token": TOKEN_DUENA})
    entrar(fuera, *CAJERA)
    fuera.post("/api/autorizaciones", json={"accion": "editar_venta"})
    assert enviados == []


def test_un_telefono_borrado_en_expo_se_olvida(db, fuera, monkeypatch):
    entrar(fuera, *DUENA)
    _registrar(fuera, TOKEN_DUENA)
    monkeypatch.setattr(push, "_mandar", lambda m: [{"status": "error", "details": {"error": "DeviceNotRegistered"}}])
    monkeypatch.setattr(push, "SessionLocal", lambda: _SinCerrar(db))
    assert push.enviar([TOKEN_DUENA], "t", "c") == 0
    assert push.tokens_de_autorizantes(db) == []


class _SinCerrar:
    """La sesion de prueba, usada como `with SessionLocal() as db` sin cerrarla."""

    def __init__(self, db):
        self.db = db

    def __enter__(self):
        return self.db

    def __exit__(self, *a):
        return False


def test_caja_sin_cerrar_con_ventas_avisa(db, client, variante, enviados):
    push.registrar(db, DUENA[0], TOKEN_DUENA)
    db.commit()
    vender(client, variante, "Zelle")

    assert push.revisar_caja(db) == 1
    assert enviados[0]["title"] == "La caja de hoy sigue abierta"
    assert "1 pedido " in enviados[0]["body"]
    assert enviados[0]["data"] == {"ruta": "/caja"}


def test_caja_cerrada_o_sin_ventas_no_avisa(db, client, variante, enviados):
    push.registrar(db, DUENA[0], TOKEN_DUENA)
    db.commit()
    assert push.revisar_caja(db) == 0, "un dia sin ventas no se cuadra"

    vender(client, variante, "Zelle")
    r = client.post("/api/caja/cerrar", json={"conteos": [{"metodo": "Zelle", "contado": 5}]})
    assert r.status_code == 200, r.text
    assert push.revisar_caja(db) == 0
    assert enviados == []
