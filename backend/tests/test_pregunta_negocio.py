"""Pregúntale a tu negocio (22-oct). La IA se reemplaza: lo que se prueba es
que la consulta que elija se valide, se calcule con los permisos de quien
pregunta y que la tabla salga del sistema, no de la IA."""
import json

import pytest

from app import asistente_ayuda, settings
from app.acceso import usuarios
from app.timeutils import hoy
from tests.conftest import entrar
from tests.test_cierre_resumen import vender

CAJERA = ("cajera-negocio", "clave-de-cajera-larga")


@pytest.fixture(scope="module", autouse=True)
def _cajera():
    try:
        usuarios.crear(*CAJERA, rol="caja", locales=[settings.LOCAL_SLUG])
    except usuarios.ErrorUsuarios:
        pass


@pytest.fixture()
def ia(monkeypatch):
    """Las consultas que "elige" la IA, en orden; la redacción es fija."""
    monkeypatch.setattr(settings, "LECTOR_FACTURAS", "gemini")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "clave-de-prueba")
    cola, vistas = [], []

    def falsa(contenidos, instrucciones, esquema=None, rapido=False):
        vistas.append({"contenidos": contenidos, "instrucciones": instrucciones, "esquema": esquema})
        if esquema:
            return json.dumps(cola.pop(0))
        return "Vendiste lo de la tabla."

    monkeypatch.setattr(asistente_ayuda, "gemini", falsa)
    return cola, vistas


def consulta(**kw):
    d = hoy().isoformat()
    return {"tipo": "consulta", "desde": d, "hasta": d, "filas": [], "filtros": [], **kw}


def preguntar(cliente, pregunta="¿cuánto vendí hoy?"):
    r = cliente.post("/api/ayuda/negocio", json={"pregunta": pregunta})
    assert r.status_code == 200, r.text
    return r.json()


def test_el_numero_sale_del_sistema(client, variante, ia):
    cola, vistas = ia
    vender(client, variante, "Zelle")
    vender(client, variante, "Efectivo $")
    cola.append(consulta(fuente="ventas", medidas=["ventas", "pedidos"]))
    d = preguntar(client)
    assert d["con_ia"] is True and d["texto"] == "Vendiste lo de la tabla."
    assert d["columnas"] == ["Total vendido", "Número de ventas"]
    assert d["filas"] == [["$10,00", "2"]]
    assert d["titulo"].startswith("Ventas · ")
    assert "$10,00" in vistas[-1]["contenidos"][0]["parts"][0]["text"], "la IA redacta con la tabla del sistema"
    assert "`ventas`" in vistas[0]["instrucciones"] and hoy().isoformat() in vistas[0]["instrucciones"]


def test_el_filtro_se_busca_por_el_nombre_que_dice_la_persona(client, variante, ia):
    cola, _ = ia
    vender(client, variante, "Zelle", cantidad=3)
    cola.append(consulta(fuente="productos", filas=["producto"], medidas=["unidades"],
                         filtros=[{"campo": "producto", "valores": ["empanadas"]}]))
    d = preguntar(client, "¿cuántas empanadas vendí hoy?")
    assert len(d["filas"]) == 1 and "Empanada" in d["filas"][0][0] and d["filas"][0][1] == "3", d


def test_lo_que_no_existe_se_dice_y_no_se_inventa(client, variante, ia):
    cola, _ = ia
    vender(client, variante, "Zelle")
    cola.append(consulta(fuente="productos", medidas=["unidades"], filtros=[{"campo": "producto", "valores": ["hamburguesa"]}]))
    d = preguntar(client, "¿cuántas hamburguesas vendí?")
    assert "No encontré «hamburguesa»" in d["texto"] and d["filas"] == []


def test_si_la_consulta_no_sirve_la_ia_la_corrige_una_vez(client, variante, ia):
    cola, vistas = ia
    vender(client, variante, "Zelle")
    cola.append(consulta(fuente="ventas", medidas=["unidades"]))  # "unidades" es del Menú, no de Ventas
    cola.append(consulta(fuente="ventas", medidas=["ventas"]))
    d = preguntar(client)
    assert d["filas"] == [["$5,00"]]
    assert "rechazó" in vistas[1]["contenidos"][-1]["parts"][0]["text"]


def test_la_cajera_no_ve_el_margen(fuera, variante, ia):
    cola, vistas = ia
    caja = entrar(fuera, *CAJERA)
    cola += [consulta(fuente="productos", medidas=["margen"])] * 2
    d = preguntar(caja, "¿cuánto me dejó la empanada?")
    assert d["filas"] == [] and "administra" in d["texto"]
    assert "margen" not in json.dumps(vistas[0]["esquema"]), "ni se le ofrece a la IA"


def test_lo_que_no_se_puede_preguntar(client, ia):
    cola, _ = ia
    cola.append({"tipo": "no_se_puede", "motivo": "No guardo el clima; pregunta por ventas o compras."})
    d = preguntar(client, "¿llovió el sábado?")
    assert d["texto"] == "No guardo el clima; pregunta por ventas o compras."


def _eventos(r):
    assert r.status_code == 200, r.text
    return [json.loads(l) for l in r.text.splitlines() if l.strip()]


def test_en_vivo_cuenta_los_pasos_manda_la_tabla_y_escribe(client, variante, ia, monkeypatch):
    cola, _ = ia
    vender(client, variante, "Zelle")
    cola.append(consulta(fuente="ventas", medidas=["ventas"]))
    vistas = []

    def en_vivo(contenidos, instrucciones, rapido=False):
        vistas.append(contenidos[0]["parts"][0]["text"])
        yield "Hoy vendiste "
        yield "**$5,00**."

    monkeypatch.setattr(asistente_ayuda, "gemini_en_vivo", en_vivo)
    e = _eventos(client.post("/api/ayuda/negocio/en-vivo", json={"pregunta": "¿cuánto vendí hoy?"}))
    pasos = [x["paso"] for x in e if "paso" in x]
    assert pasos[0] == "Entendiendo tu pregunta…" and pasos[1].startswith("Buscando en ventas")
    [tabla] = [x["tabla"] for x in e if "tabla" in x]
    assert tabla["filas"] == [["$5,00"]]
    assert "".join(x["texto"] for x in e if "texto" in x) == "Hoy vendiste **$5,00**."
    assert e[-1] == {"fin": True, "con_ia": True}
    assert "$5,00" in vistas[0], "redacta con la tabla del sistema"


def test_la_ayuda_en_vivo_saluda_con_el_nombre(client, monkeypatch):
    monkeypatch.setattr(settings, "LECTOR_FACTURAS", "gemini")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "clave-de-prueba")
    from tests.conftest import USUARIO_TEST
    usuarios.cambiar_nombre(USUARIO_TEST, "Ana María", "Pérez")
    vistas = []

    def en_vivo(contenidos, instrucciones, rapido=False):
        vistas.append(instrucciones)
        yield "Hola"

    monkeypatch.setattr(asistente_ayuda, "gemini_en_vivo", en_vivo)
    e = _eventos(client.post("/api/ayuda/en-vivo", json={"pregunta": "hola", "pantalla": "/pos"}))
    assert e[0] == {"paso": "Buscando en el manual…"} and e[-1] == {"fin": True, "con_ia": True}
    assert "`/pos`" in vistas[0]
    assert "Se llama Ana." in vistas[0], "el primer nombre, para saludar"
