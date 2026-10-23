"""El asistente que hace cosas (23-oct). La IA se reemplaza por un guion de
llamadas a herramientas: lo que se prueba es que leer se hace solo, que
cambiar algo SIEMPRE espera el «Confirmar», y que al confirmar pasa por la
API de siempre con los permisos de quien pregunta."""
import json

import pytest

from app import agente, models, settings
from app.acceso import usuarios
from tests.conftest import entrar
from tests.test_cierre_resumen import vender

COCINERO = ("cocinero-agente", "clave-de-cocina-larga")


@pytest.fixture(scope="module", autouse=True)
def _cocinero():
    try:
        usuarios.crear(*COCINERO, rol="cocina", locales=[settings.LOCAL_SLUG])
    except usuarios.ErrorUsuarios:
        pass


@pytest.fixture()
def guion(monkeypatch):
    """Las respuestas de la IA, en orden; guarda lo que se le mando."""
    monkeypatch.setattr(settings, "LECTOR_FACTURAS", "gemini")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "clave-de-prueba")
    cola, vistos = [], []

    def turno(contenidos, instrucciones):
        vistos.append(json.loads(json.dumps(contenidos)))
        return cola.pop(0)

    monkeypatch.setattr(agente, "_turno", turno)
    return cola, vistos


def llama(_herramienta, **args):
    return [{"functionCall": {"name": _herramienta, "args": args}}]


def dice(texto):
    return [{"text": texto}]


def conversar(cliente, mensaje):
    r = cliente.post("/api/ayuda/agente/en-vivo", json={"mensaje": mensaje})
    assert r.status_code == 200, r.text
    return [json.loads(l) for l in r.text.splitlines() if l.strip()]


def respuestas_a_herramientas(vistos):
    return [p["functionResponse"] for c in vistos[-1] if c["role"] == "user" for p in c["parts"] if "functionResponse" in p]


def test_leer_lo_hace_solo_y_muestra_la_tabla(client, variante, guion):
    cola, _ = guion
    vender(client, variante, "Zelle")
    from app.timeutils import hoy
    d = hoy().isoformat()
    cola += [llama("consultar_reporte", fuente="ventas", desde=d, hasta=d, medidas=["ventas"]), dice("Hoy vendiste **$5,00**.")]
    e = conversar(client, "¿cuánto vendí hoy?")
    assert any(x.get("paso") == "Buscando en tus reportes…" for x in e)
    [tabla] = [x["tabla"] for x in e if "tabla" in x]
    assert tabla["filas"] == [["$5,00"]]
    assert e[-2] == {"texto": "Hoy vendiste **$5,00**."} and e[-1] == {"fin": True}


def test_un_pedido_espera_el_confirmar_y_luego_pasa_por_la_api(client, db, variante, guion):
    cola, vistos = guion
    cola += [llama("buscar_productos_menu", texto="empanada"),
             llama("crear_pedido", cliente="Juanito", items=[{"variante_id": variante.id, "cantidad": 2}])]
    antes = db.query(models.Pedido).count()
    e = conversar(client, "móntale un pedido a Juanito por dos empanadas de carne")
    buscadas = respuestas_a_herramientas(vistos)[0]["response"]["productos"]
    assert buscadas[0]["variante_id"] == variante.id
    [p] = [x["propuesta"] for x in e if "propuesta" in x]
    assert p["titulo"] == "Pedido a nombre de Juanito · $10,00" and p["detalle"] == ["2 × Empanada · Carne · $10,00"]
    assert db.query(models.Pedido).count() == antes, "sin confirmar no se crea nada"

    r = client.post("/api/ayuda/agente/confirmar", json={"propuesta_id": p["id"]}).json()
    assert r["ok"] is True and "Juanito" in r["texto"]
    pedido = db.query(models.Pedido).order_by(models.Pedido.id.desc()).first()
    assert pedido.cliente == "Juanito" and pedido.items[0].cantidad == 2
    assert client.post("/api/ayuda/agente/confirmar", json={"propuesta_id": p["id"]}).json()["ok"] is False, "no se ejecuta dos veces"


def test_regale_dos_harinas_sale_como_merma(client, db, insumo, guion):
    cola, _ = guion
    cola += [llama("buscar_mercancia", texto="carne"),
             llama("sacar_de_inventario", ingrediente_id=insumo.id, cantidad=2, motivo="Regalo", tipo="merma")]
    e = conversar(client, "regalé dos kilos de carne, descuéntalos")
    [p] = [x["propuesta"] for x in e if "propuesta" in x]
    assert "2 kg de Carne molida" in p["titulo"]
    antes = insumo.stock_actual
    r = client.post("/api/ayuda/agente/confirmar", json={"propuesta_id": p["id"]}).json()
    assert r["ok"], r
    db.refresh(insumo)
    assert insumo.stock_actual == pytest.approx(antes - 2)
    assert db.query(models.Merma).filter_by(ingrediente_id=insumo.id, motivo="Regalo").count() == 1


def test_un_id_inventado_vuelve_como_error_para_que_busque(client, variante, guion):
    cola, vistos = guion
    cola += [llama("crear_pedido", items=[{"variante_id": 99999, "cantidad": 1}]), dice("¿Cuál empanada?")]
    e = conversar(client, "véndeme una empanada")
    [r] = respuestas_a_herramientas(vistos)
    assert "no existe" in r["response"]["error"]
    assert not any("propuesta" in x for x in e)


def test_cada_quien_con_sus_permisos(client, fuera, variante, guion):
    cola, _ = guion
    p = client.post("/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 1}], "cliente": "Ana"}).json()
    cocina = entrar(fuera, *COCINERO)
    cola += [llama("anular_pedido", pedido_id=p["id"], motivo="prueba")]
    e = conversar(cocina, "anula el pedido de Ana")
    [prop] = [x["propuesta"] for x in e if "propuesta" in x]
    assert prop["peligro"] is True
    r = cocina.post("/api/ayuda/agente/confirmar", json={"propuesta_id": prop["id"]}).json()
    assert r["ok"] is False and "permiso" in r["texto"], "la cocina no anula: lo dice la API de siempre"


def test_la_propuesta_es_de_quien_la_pidio(client, fuera, variante, guion):
    cola, _ = guion
    cola += [llama("crear_pedido", items=[{"variante_id": variante.id, "cantidad": 1}])]
    [p] = [x["propuesta"] for x in conversar(client, "una empanada") if "propuesta" in x]
    otro = entrar(fuera, *COCINERO)
    assert otro.post("/api/ayuda/agente/confirmar", json={"propuesta_id": p["id"]}).json()["ok"] is False


def test_sin_ia_lo_dice(client, monkeypatch):
    monkeypatch.setattr(settings, "LECTOR_FACTURAS", "")
    e = conversar(client, "hola")
    assert "no está encendida" in e[0]["texto"]


def test_no_propone_anular_lo_cobrado(client, variante, guion):
    cola, vistos = guion
    p = vender(client, variante, "Zelle")
    cola += [llama("anular_pedido", pedido_id=p["id"]), dice("Ese ya está cobrado.")]
    e = conversar(client, "anula ese pedido")
    assert not any("propuesta" in x for x in e)
    assert "Devolver" in respuestas_a_herramientas(vistos)[0]["response"]["error"]


def test_los_pedidos_abiertos_traen_los_sin_cobrar(client, variante, guion):
    cola, vistos = guion
    abierto = client.post("/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 1}], "cliente": "Juanito"}).json()
    cola += [llama("pedidos_abiertos"), dice("Ahí está.")]
    conversar(client, "¿qué pedidos hay?")
    pedidos = respuestas_a_herramientas(vistos)[0]["response"]["pedidos"]
    assert any(x["pedido_id"] == abierto["id"] and x["estado"] == "sin cobrar" for x in pedidos)


def test_lo_creado_le_deja_el_id_a_la_ia(client, variante, guion):
    cola, _ = guion
    cola += [llama("crear_pedido", cliente="ana", items=[{"variante_id": variante.id, "cantidad": 1}])]
    [p] = [x["propuesta"] for x in conversar(client, "pedido para ana") if "propuesta" in x]
    assert "Ana" in p["titulo"], "el nombre como en la comanda"
    r = client.post("/api/ayuda/agente/confirmar", json={"propuesta_id": p["id"]}).json()
    assert r["nota"].startswith("pedido_id=")


def _propone_y_confirma(cliente, cola, mensaje, *pasos):
    cola += list(pasos)
    [p] = [x["propuesta"] for x in conversar(cliente, mensaje) if "propuesta" in x]
    r = cliente.post("/api/ayuda/agente/confirmar", json={"propuesta_id": p["id"]}).json()
    return p, r


def test_crea_un_producto_con_su_receta(client, db, variante, insumo, guion):
    cola, _ = guion
    cat = variante.producto.categoria_id
    p, r = _propone_y_confirma(client, cola, "crea el pastelito de carne a 1,5 con 80 g de carne",
                               llama("crear_producto_menu", nombre="Pastelito de carne", categoria_id=cat,
                                     variantes=[{"nombre": "Regular", "precio": 1.5}],
                                     receta=[{"ingrediente_id": insumo.id, "cantidad": 0.08}]))
    assert "0,08 kg de Carne molida" in " ".join(p["detalle"])
    assert r["ok"] and "receta" in r["texto"]
    nuevo = db.query(models.Producto).filter_by(nombre="Pastelito de carne").one()
    v = nuevo.variantes[0]
    assert v.precio == 1.5
    assert db.query(models.RecetaItem).filter_by(variante_id=v.id).one().cantidad_por_unidad == 0.08
    assert r["nota"].startswith("producto_id=")


def test_no_duplica_un_producto_que_ya_existe(client, variante, guion):
    cola, vistos = guion
    cola += [llama("crear_producto_menu", nombre="Empanada", categoria_id=variante.producto.categoria_id,
                   variantes=[{"nombre": "Regular", "precio": 2}]), dice("Ya existe.")]
    conversar(client, "crea la empanada")
    assert "Ya hay un «Empanada»" in respuestas_a_herramientas(vistos)[0]["response"]["error"]


def test_la_receta_agrega_sin_borrar_lo_que_tenia(client, db, variante, insumo, guion):
    cola, _ = guion
    queso = models.Ingrediente(nombre="Queso blanco", unidad="kg", costo_unitario=6)
    db.add(queso)
    db.commit()
    p, r = _propone_y_confirma(client, cola, "a la empanada de carne ponle 20 g de queso",
                               llama("guardar_receta", variante_id=variante.id, ingredientes=[{"ingrediente_id": queso.id, "cantidad": 0.02}]))
    assert "0,1 kg de Carne molida" in p["detalle"][0] and "0,02 kg de Queso blanco" in p["detalle"][0]
    assert r["ok"]
    assert {(i.ingrediente_id, i.cantidad_por_unidad) for i in db.query(models.RecetaItem).filter_by(variante_id=variante.id)} == {
        (insumo.id, 0.1), (queso.id, 0.02)}


def test_crea_mercancia_y_cambia_un_precio(client, db, variante, guion):
    cola, _ = guion
    p, r = _propone_y_confirma(client, cola, "crea la mercancía harina de maíz en kg a 1,2",
                               llama("crear_mercancia", nombre="Harina de maíz", unidad="kg", costo_unitario=1.2))
    assert r["ok"] and db.query(models.Ingrediente).filter_by(nombre="Harina de maíz").one().costo_unitario == 1.2
    p, r = _propone_y_confirma(client, cola, "sube la empanada a 5,5", llama("cambiar_precio", variante_id=variante.id, precio=5.5))
    assert "$5,00 → $5,50" in p["titulo"] and r["ok"]
    db.refresh(variante)
    assert variante.precio == 5.5
