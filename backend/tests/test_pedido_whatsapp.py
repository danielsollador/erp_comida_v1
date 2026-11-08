"""Pedidos por WhatsApp como borrador (22-oct). No crean nada: devuelven la
comanda para que la cajera la revise."""
import json

import pytest

from app import asistente_ayuda, models, pedido_whatsapp as pw, settings


@pytest.fixture()
def carta(db):
    cat = models.Categoria(nombre="Comida", orden=0)
    db.add(cat)
    db.flush()
    ids = {}
    for producto, variantes in (("Empanada", [("Queso", 1.5), ("Carne", 1.8), ("Pollo", 1.8)]),
                                ("Jugo natural", [("Regular", 2.0)]), ("Tequeños", [("Grande", 6.0), ("Pequeño", 3.5)])):
        p = models.Producto(categoria_id=cat.id, nombre=producto)
        db.add(p)
        db.flush()
        for nombre, precio in variantes:
            v = models.Variante(producto_id=p.id, nombre=nombre, precio=precio)
            db.add(v)
            db.flush()
            ids[f"{producto} {nombre}"] = v.id
    db.commit()
    return ids


@pytest.fixture(autouse=True)
def _sin_ia(monkeypatch):
    monkeypatch.setattr(settings, "LECTOR_FACTURAS", "")


MENSAJE = """Buenas tardes! me mandas 3 empanadas de queso, 2 de carne y un jugo natural
a nombre de Luis Pérez
dirección: calle 4, casa 12
gracias"""


def test_sin_ia_arma_la_comanda_renglon_por_renglon(client, carta):
    r = client.post("/api/pedidos/whatsapp", json={"texto": MENSAJE})
    assert r.status_code == 200, r.text
    d = r.json()
    assert [(l["cantidad"], l["variante_id"]) for l in d["lineas"]] == [
        (3, carta["Empanada Queso"]), (2, carta["Empanada Carne"]), (1, carta["Jugo natural Regular"])]
    assert d["cliente"] == "Luis Pérez"
    assert "calle 4" in d["nota"]
    assert d["total"] == 10.1
    assert d["con_ia"] is False


def test_lo_que_no_se_entiende_queda_para_que_elija_la_cajera(client, carta):
    d = client.post("/api/pedidos/whatsapp", json={"texto": "2 hamburguesas dobles"}).json()
    [l] = d["lineas"]
    assert l["variante_id"] is None and l["cantidad"] == 2


def test_no_crea_ningun_pedido(client, db, carta):
    antes = db.query(models.Pedido).count()
    client.post("/api/pedidos/whatsapp", json={"texto": MENSAJE})
    assert db.query(models.Pedido).count() == antes


def test_con_ia_un_id_inventado_no_pasa(client, carta, monkeypatch):
    monkeypatch.setattr(settings, "LECTOR_FACTURAS", "gemini")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "clave-de-prueba")
    respuesta = {"cliente": "Ana", "nota": "sin cebolla", "lineas": [
        {"texto": "media docena de tequeños grandes", "cantidad": 6, "variante_id": carta["Tequeños Grande"]},
        {"texto": "una de pollo", "cantidad": 1, "variante_id": 99999, "busca": "empanada de pollo"},
    ]}
    monkeypatch.setattr(asistente_ayuda, "gemini", lambda *a, **k: json.dumps(respuesta))
    d = client.post("/api/pedidos/whatsapp", json={"texto": "..."}).json()
    assert d["con_ia"] is True
    assert [(l["cantidad"], l["variante_id"]) for l in d["lineas"]] == [
        (6, carta["Tequeños Grande"]), (1, carta["Empanada Pollo"])], "el 99999 no existe: lo busca por nombre"


def test_si_la_ia_no_contesta_quedan_las_reglas(client, carta, monkeypatch):
    monkeypatch.setattr(settings, "LECTOR_FACTURAS", "gemini")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "clave-de-prueba")
    monkeypatch.setattr(asistente_ayuda, "gemini", lambda *a, **k: None)
    d = client.post("/api/pedidos/whatsapp", json={"texto": "2 tequeños pequeños"}).json()
    assert d["con_ia"] is False and d["lineas"][0]["variante_id"] == carta["Tequeños Pequeño"]


def test_la_cocina_no_arma_pedidos(fuera, carta):
    from app.acceso import usuarios
    from tests.conftest import entrar
    try:
        usuarios.crear("cocina-wa", "clave-de-cocina-larga", rol="cocina", locales=[settings.LOCAL_SLUG])
    except usuarios.ErrorUsuarios:
        pass
    cocina = entrar(fuera, "cocina-wa", "clave-de-cocina-larga")
    assert cocina.post("/api/pedidos/whatsapp", json={"texto": "2 empanadas"}).status_code == 403


def test_no_sugiere_lo_que_no_se_parece_y_trae_todo_el_menu(client, carta):
    d = client.post("/api/pedidos/whatsapp", json={"texto": "3 granjeros"}).json()
    [l] = d["lineas"]
    assert l["variante_id"] is None and l["opciones"] == [], "un parecido del 20 % no es sugerencia"
    assert {o["variante_id"] for o in d["menu"]} >= set(carta.values())


def test_aprende_lo_que_la_cajera_elige_a_mano(client, carta):
    r = client.post("/api/pedidos/whatsapp/aprender",
                    json={"elecciones": [{"texto": "3 granjeros", "variante_id": carta["Empanada Carne"]}]})
    assert r.json() == {"aprendidos": 1}
    d = client.post("/api/pedidos/whatsapp", json={"texto": "dame 2 granjeros porfa"}).json()
    assert [(l["cantidad"], l["variante_id"]) for l in d["lineas"]] == [(2, carta["Empanada Carne"])]


def test_no_guarda_lo_que_ya_acertaba(client, carta):
    r = client.post("/api/pedidos/whatsapp/aprender",
                    json={"elecciones": [{"texto": "2 empanadas de queso", "variante_id": carta["Empanada Queso"]}]})
    assert r.json() == {"aprendidos": 0}
