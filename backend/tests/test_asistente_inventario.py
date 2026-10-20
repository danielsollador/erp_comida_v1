"""Cargar el inventario con IA (20-oct).

La IA propone por NOMBRES; la revision lo cruza con lo que existe y el
guardado lo convierte en fichas, preparaciones y recetas, todo o nada. Aqui
se prueba con el lector de prueba (no llama a nadie) y con propuestas
escritas a mano, que es lo mismo que manda la pantalla tras corregir.
"""
import pytest

from app import kardex, models, settings


@pytest.fixture(autouse=True)
def _lector_de_prueba(monkeypatch):
    monkeypatch.setattr(settings, "LECTOR_FACTURAS", "prueba")


def pastelito(db):
    cat = models.Categoria(nombre="Horneados", orden=1)
    db.add(cat)
    db.flush()
    p = models.Producto(categoria_id=cat.id, nombre="Pastelito de pollo")
    db.add(p)
    db.flush()
    v = models.Variante(producto_id=p.id, nombre="Regular", precio=1.5)
    db.add(v)
    db.commit()
    return v


def leer(client, texto="el pastelito de pollo lleva un disco y 50 g de guiso"):
    r = client.post("/api/inventario/asistente/leer", data={"texto": texto})
    assert r.status_code == 200, r.text
    return r.json()


def test_apagado_no_lee(client, monkeypatch):
    monkeypatch.setattr(settings, "LECTOR_FACTURAS", "")
    assert client.get("/api/inventario/asistente").json()["activo"] is False
    r = client.post("/api/inventario/asistente/leer", data={"texto": "pollo"})
    assert r.status_code == 422


def test_sin_texto_ni_fotos_pide_algo(client):
    r = client.post("/api/inventario/asistente/leer", data={"texto": "  "})
    assert r.status_code == 422
    assert "foto" in r.json()["detail"]


def test_la_revision_cruza_con_el_menu_y_convierte_unidades(client, db):
    v = pastelito(db)
    d = leer(client)
    receta = d["recetas"][0]
    assert receta["variante_id"] == v.id, "el pastelito del menu es ese"
    guiso = next(l for l in receta["lineas"] if l["mercancia"] == "Guiso de pollo")
    assert guiso["unidad_ficha"] == "kg"
    assert guiso["cantidad_ficha"] == 0.05, "50 g de una preparacion en kg son 0,05 kg"
    assert guiso["problema"] == ""
    prep = d["preparaciones"][0]
    cebolla = next(l for l in prep["lineas"] if l["mercancia"] == "Cebolla")
    assert cebolla["cantidad_ficha"] == 0.2
    assert d["dudas"], "lo que no esta claro se pregunta"


def test_lo_que_ya_existe_no_se_vuelve_a_crear(client, db):
    db.add(models.Ingrediente(nombre="POLLO", unidad="kg", tipo="insumo", activo=True, stock_actual=0))
    db.commit()
    d = leer(client)
    pollo = next(m for m in d["mercancias"] if m["nombre"] == "Pollo")
    assert pollo["ya_existe"] == "POLLO (kg)"


def test_guardar_todo_de_una_vez(client, db):
    v = pastelito(db)
    d = leer(client)
    r = client.post("/api/inventario/asistente/guardar", json={
        "mercancias": [m for m in d["mercancias"] if not m["ya_existe"]],
        "preparaciones": [{"nombre": p["nombre"], "unidad": p["unidad"], "rinde": p["rinde"], "lineas": p["lineas"]}
                          for p in d["preparaciones"]],
        "recetas": [{"producto": x["producto"], "variante_id": x["variante_id"], "lineas": x["lineas"]} for x in d["recetas"]],
    })
    assert r.status_code == 200, r.text
    hecho = r.json()
    assert "Pollo" in hecho["mercancias"] and "Guiso de pollo" in hecho["preparaciones"]
    assert hecho["recetas"] == ["Pastelito de pollo"]

    guiso = db.query(models.Ingrediente).filter(models.Ingrediente.nombre == "Guiso de pollo").one()
    assert guiso.tipo == "preparacion"
    lineas = {l.ingrediente.nombre: l.cantidad for l in guiso.lineas_preparacion}
    # 1 kg de pollo y 200 g de cebolla dan 0,8 kg: por 1 kg de guiso, 1,25 y 0,25.
    assert round(lineas["Pollo"], 4) == 1.25
    assert round(lineas["Cebolla"], 4) == 0.25
    assert guiso.costo_unitario > 0, "el costo sigue a la cadena"

    receta = {r.ingrediente.nombre: r.cantidad_por_unidad
              for r in db.query(models.RecetaItem).filter(models.RecetaItem.variante_id == v.id)}
    assert receta == {"Disco de masa": 1, "Guiso de pollo": 0.05}
    # Sin stock ni asientos: eso entra con la compra o el conteo.
    assert db.query(models.MovimientoInventario).count() == 0
    assert db.query(models.AsientoContable).count() == 0


def test_si_algo_falla_no_queda_nada_a_medias(client, db):
    v = pastelito(db)
    r = client.post("/api/inventario/asistente/guardar", json={
        "mercancias": [{"nombre": "Harina", "tipo": "insumo", "unidad": "kg"}],
        "recetas": [{"producto": "Pastelito", "variante_id": v.id,
                     "lineas": [{"mercancia": "Harina", "cantidad": 2, "unidad": "unidad"}]}],
    })
    assert r.status_code == 400
    assert "kg" in r.json()["detail"]
    assert db.query(models.Ingrediente).filter(models.Ingrediente.nombre == "Harina").count() == 0


def test_un_desechable_no_entra_en_una_receta(client, db):
    v = pastelito(db)
    d = client.post("/api/inventario/asistente/revisar", json={
        "mercancias": [{"nombre": "Servilleta", "tipo": "desechable", "unidad": "unidad"}],
        "recetas": [{"producto": "Pastelito de pollo",
                     "lineas": [{"mercancia": "Servilleta", "cantidad": 1, "unidad": "unidad"}]}],
    }).json()
    assert "desechable" in d["recetas"][0]["lineas"][0]["problema"]
    r = client.post("/api/inventario/asistente/guardar", json={
        "mercancias": [{"nombre": "Servilleta", "tipo": "desechable", "unidad": "unidad"}],
        "recetas": [{"producto": "Pastelito", "variante_id": v.id,
                     "lineas": [{"mercancia": "Servilleta", "cantidad": 1, "unidad": "unidad"}]}],
    })
    assert r.status_code == 400
    assert db.query(models.Ingrediente).filter(models.Ingrediente.nombre == "Servilleta").count() == 0


def test_un_nombre_que_no_esta_sugiere_el_parecido(client, db):
    d = client.post("/api/inventario/asistente/revisar", json={
        "mercancias": [{"nombre": "Queso blanco", "tipo": "insumo", "unidad": "kg"}],
        "preparaciones": [{"nombre": "Relleno", "unidad": "kg", "rinde": 1,
                           "lineas": [{"mercancia": "Queso blaco", "cantidad": 1, "unidad": "kg"}]}],
    }).json()
    assert "Queso blanco" in d["preparaciones"][0]["lineas"][0]["problema"]


def test_una_preparacion_dentro_de_otra(client, db):
    r = client.post("/api/inventario/asistente/guardar", json={
        "mercancias": [{"nombre": "Tomate", "tipo": "insumo", "unidad": "kg", "costo_unitario": 2}],
        "preparaciones": [
            # Primero la que lleva a la otra: se ordenan solas.
            {"nombre": "Guiso", "unidad": "kg", "rinde": 1,
             "lineas": [{"mercancia": "Salsa", "cantidad": 300, "unidad": "g"}]},
            {"nombre": "Salsa", "unidad": "kg", "rinde": 0.5,
             "lineas": [{"mercancia": "Tomate", "cantidad": 1, "unidad": "kg"}]},
        ],
    })
    assert r.status_code == 200, r.text
    assert set(r.json()["preparaciones"]) == {"Guiso", "Salsa"}
    guiso = db.query(models.Ingrediente).filter(models.Ingrediente.nombre == "Guiso").one()
    assert round(guiso.costo_unitario, 4) == 1.2, "0,3 kg de salsa a $4/kg"


def test_la_receta_existente_se_reemplaza_y_queda_en_el_historial(client, db, variante, insumo):
    r = client.post("/api/inventario/asistente/guardar", json={
        "recetas": [{"producto": "Empanada", "variante_id": variante.id,
                     "lineas": [{"mercancia": "Carne molida", "cantidad": 120, "unidad": "g"}]}],
    })
    assert r.status_code == 200, r.text
    item = db.query(models.RecetaItem).filter(models.RecetaItem.variante_id == variante.id).one()
    assert round(item.cantidad_por_unidad, 4) == 0.12
    assert db.query(models.CambioReceta).filter(models.CambioReceta.variante_id == variante.id).count() >= 1
