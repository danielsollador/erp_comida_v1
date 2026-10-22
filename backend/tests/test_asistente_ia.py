"""Las piezas del asistente que NO dependen del modelo: lo que el ERP valida,
calcula y guarda con lo que el modelo devuelve.

El modelo se reemplaza por respuestas fijas (`claude.estructurado`): estas
pruebas no gastan ni necesitan clave. Lo que se prueba es que, diga lo que
diga el modelo, el ERP no guarda un precio que nadie vio, no usa un campo que
no existe y no deja entrar a quien no tiene el módulo.
"""
import pytest

from app import models, settings
from app.acceso import usuarios
from app.asistente import claude, precios, reportes_hablados
from app.asistente.gemini import Resultado

from tests.conftest import entrar


def _menu(db):
    cat = models.Categoria(nombre="Comida", orden=0, activo=True)
    db.add(cat)
    db.commit()
    emp = models.Producto(categoria_id=cat.id, nombre="Empanada", activo=True)
    cafe = models.Producto(categoria_id=cat.id, nombre="Café", activo=True)
    db.add_all([emp, cafe])
    db.commit()
    vs = {
        "carne": models.Variante(producto_id=emp.id, nombre="Carne", precio=1.5, activo=True),
        "queso": models.Variante(producto_id=emp.id, nombre="Queso", precio=1.3, activo=True),
        "cafe": models.Variante(producto_id=cafe.id, nombre="Regular", precio=1.2, activo=True),
    }
    db.add_all(vs.values())
    db.commit()
    return vs


def _modelo_responde(monkeypatch, *respuestas):
    """Cada llamada al modelo devuelve la siguiente respuesta de la lista."""
    cola = list(respuestas)

    def falso(*_a, **_k):
        return cola.pop(0), Resultado(texto="", modelo="claude-sonnet-5-5")

    monkeypatch.setattr(claude, "estructurado", falso)


# ── Cambios de precio ───────────────────────────────────────────────────────


def test_la_cuenta_la_hace_el_erp_con_el_precio_de_hoy(db):
    vs = _menu(db)
    reglas = [
        {"variantes": [vs["carne"].id, vs["queso"].id], "operacion": "porcentaje", "valor": 10, "redondeo": 0.05},
        {"variantes": [vs["cafe"].id], "operacion": "sumar", "valor": 0.25, "redondeo": None},
    ]
    cambios = {c["variante_id"]: c["precio_nuevo"] for c in precios.calcular(precios._variantes(db), reglas)}
    assert cambios == {vs["carne"].id: 1.65, vs["queso"].id: 1.45, vs["cafe"].id: 1.45}


def test_el_medio_centavo_redondea_hacia_arriba():
    # 1,50 bajado 5% = 1,425: con `round` de Python quedaba en 1,42.
    assert precios._redondear(1.425, None) == 1.43


def test_reglas_encadenadas_parten_del_resultado_anterior(db):
    vs = _menu(db)
    reglas = [
        {"variantes": [vs["cafe"].id, vs["carne"].id], "operacion": "porcentaje", "valor": 10, "redondeo": None},
        {"variantes": [vs["cafe"].id], "operacion": "fijar", "valor": 1.0, "redondeo": None},
    ]
    cambios = {c["variante_id"]: c["precio_nuevo"] for c in precios.calcular(precios._variantes(db), reglas)}
    assert cambios[vs["cafe"].id] == 1.0
    assert cambios[vs["carne"].id] == 1.65


def test_ids_inventados_y_precios_en_cero_no_pasan(db, monkeypatch):
    vs = _menu(db)
    _modelo_responde(monkeypatch, {
        "reglas": [
            {"variantes": [vs["carne"].id, 99999], "operacion": "porcentaje", "valor": 10, "redondeo": None},
            {"variantes": [vs["queso"].id], "operacion": "fijar", "valor": 0, "redondeo": None},
            {"variantes": [vs["cafe"].id], "operacion": "porcentaje", "valor": -100, "redondeo": None},
        ],
        "entendi": "x",
        "duda": None,
    })
    d = precios.proponer(db, "lo que sea")
    assert [c["variante_id"] for c in d["cambios"]] == [vs["carne"].id]


def test_proponer_no_guarda_nada(client, db, monkeypatch):
    vs = _menu(db)
    _modelo_responde(monkeypatch, {
        "reglas": [{"variantes": [vs["carne"].id], "operacion": "fijar", "valor": 2.0, "redondeo": None}],
        "entendi": "Poner la empanada de carne en $2",
        "duda": None,
    })
    r = client.post("/api/asistente/precios/proponer", json={"instruccion": "pon la de carne en 2"})
    assert r.status_code == 200, r.text
    assert r.json()["cambios"][0]["precio_nuevo"] == 2.0
    db.refresh(vs["carne"])
    assert vs["carne"].precio == 1.5
    assert db.query(models.CambioPrecio).count() == 0


def test_aplicar_deja_historial_y_deshacer_vuelve_atras(client, db):
    vs = _menu(db)
    ida = [{"variante_id": vs["carne"].id, "precio_anterior": 1.5, "precio_nuevo": 1.65}]
    assert client.post("/api/asistente/precios/aplicar", json={"cambios": ida}).status_code == 200
    db.refresh(vs["carne"])
    assert vs["carne"].precio == 1.65
    vuelta = [{"variante_id": vs["carne"].id, "precio_anterior": 1.65, "precio_nuevo": 1.5}]
    assert client.post("/api/asistente/precios/aplicar", json={"cambios": vuelta}).status_code == 200
    db.refresh(vs["carne"])
    assert vs["carne"].precio == 1.5
    assert db.query(models.CambioPrecio).count() == 2


def test_si_otro_cambio_el_precio_no_se_guarda_nada(client, db):
    vs = _menu(db)
    # La lista se armó cuando la de carne estaba en 1,40; alguien la puso en 1,50.
    cambios = [
        {"variante_id": vs["queso"].id, "precio_anterior": 1.3, "precio_nuevo": 1.4},
        {"variante_id": vs["carne"].id, "precio_anterior": 1.4, "precio_nuevo": 1.6},
    ]
    r = client.post("/api/asistente/precios/aplicar", json={"cambios": cambios})
    assert r.status_code == 409
    db.refresh(vs["queso"])
    assert vs["queso"].precio == 1.3  # todo o nada


def test_cocina_no_cambia_precios(fuera, db):
    _menu(db)
    usuarios.crear("cocinero_ia", "clave-cocina-1", rol="cocina", locales=[settings.LOCAL_SLUG])
    entrar(fuera, "cocinero_ia", "clave-cocina-1")
    r = fuera.post("/api/asistente/precios/aplicar", json={"cambios": [{"variante_id": 1, "precio_anterior": 1.5, "precio_nuevo": 9}]})
    assert r.status_code == 403


# ── Reportes hablados ───────────────────────────────────────────────────────


def _definicion(**cambios):
    d = {
        "fuente": "ventas", "desde": "2026-10-01", "hasta": "2026-10-22", "filas": ["forma_pago"],
        "columna": None, "medidas": ["ventas"], "filtros": [], "entendi": "Ventas por forma de pago", "no_se_puede": None,
    }
    d.update(cambios)
    return d


def test_un_campo_inventado_se_corrige_o_no_pasa(db, monkeypatch):
    _modelo_responde(monkeypatch, _definicion(filas=["sabor"]), _definicion())
    d = reportes_hablados.traducir(db, "ventas por forma de pago", True, None)
    assert d["definicion"]["filas"] == ["forma_pago"]

    _modelo_responde(monkeypatch, _definicion(medidas=["plata"]), _definicion(medidas=["plata"]))
    with pytest.raises(Exception, match="No logré armar"):
        reportes_hablados.traducir(db, "ventas", True, None)


def test_lo_que_no_existe_se_dice(db, monkeypatch):
    _modelo_responde(monkeypatch, _definicion(no_se_puede="No se registra cuándo un cliente compra por primera vez."))
    d = reportes_hablados.traducir(db, "clientes nuevos", True, None)
    assert d["no_se_puede"] and "definicion" not in d


def test_sin_clave_avisa_en_vez_de_romper(client, monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    r = client.post("/api/asistente/reporte", json={"frase": "ventas de hoy"})
    assert r.status_code == 503
    assert "ANTHROPIC_API_KEY" in r.json()["detail"]


# ── Guías en pantalla ───────────────────────────────────────────────────────


def test_cada_recorrido_usa_elementos_del_mapa():
    from app.asistente import guias

    for tarea, pasos in guias.RECORRIDOS.items():
        faltan = [p for p in pasos if p not in guias.MAPA]
        assert not faltan, f"«{tarea}» usa elementos que no están en el mapa: {faltan}"


def test_cada_ancla_del_mapa_existe_en_las_pantallas():
    """Si alguien renombra o quita un botón marcado, la guía quedaría
    señalando la nada: esto lo ataja antes de que lo vea un cliente."""
    import pathlib
    import re as _re

    from app.asistente import guias

    src = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src"
    texto = "\n".join(p.read_text(encoding="utf-8") for p in src.rglob("*.tsx"))
    fijas = set(_re.findall(r'data-guia="([\w.-]+)"', texto))
    # Y las que se eligen con una expresión: data-guia={x ? 'a' : 'b'}.
    for expr in _re.findall(r"data-guia=\{([^}]*)\}", texto):
        fijas |= set(_re.findall(r"'([\w.-]+)'", expr))
    # Las pestañas se marcan solas: data-guia={`seccion.${s.id}`}.
    secciones = {f"seccion.{i}" for i in _re.findall(r"\{\s*id:\s*'([\w-]+)'", texto)}
    faltan = [k for k, v in guias.MAPA.items() if v[1] not in fijas | secciones]
    assert not faltan, f"Anclas que ya no existen en el frontend: {faltan}"


def test_la_guia_no_repite_un_paso_seguido_y_trae_la_accion():
    from app.asistente import guias

    pasos = guias.validar("admin", [
        {"elemento": "menu.recetas", "titulo": "1. Abre Recetas", "texto": "x"},
        {"elemento": "menu.recetas", "titulo": "Otra vez", "texto": "x"},
        {"elemento": "inventado", "titulo": "x", "texto": "x"},
        {"elemento": "recetas.cantidad", "titulo": "Cantidades", "texto": "x"},
    ])
    assert [p["ancla"] for p in pasos] == ["seccion.recetas", "recetas.cantidad"]
    assert pasos[0]["titulo"] == "Abre Recetas"
    assert [p["accion"] for p in pasos] == ["tocar", "escribir"]
