"""El inventario como modulo: alta por tipo, archivado y conteo fisico en lote.

Leider (16-sep): "el inventario es para llenar todos los productos y la
materia y tambien llevar conteo, y eso no se esta reflejando". No habia forma
de crear un insumo desde la pantalla, y contar era un dialogo del navegador
por insumo.
"""


def _insumo(client, nombre, stock=10.0, costo=2.0, minimo=1.0, **extra):
    r = client.post(
        "/api/inventario/ingredientes",
        json={
            "nombre": nombre,
            "unidad": "kg",
            "stock_actual": stock,
            "stock_minimo": minimo,
            "costo_unitario": costo,
            **extra,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_un_insumo_nace_como_materia_prima_activa_y_acepta_reventa(client):
    harina = _insumo(client, "Harina")
    assert harina["tipo"] == "insumo"
    assert harina["activo"] is True

    refresco = _insumo(client, "Refresco", tipo="reventa")
    assert refresco["tipo"] == "reventa"

    r = client.post("/api/inventario/ingredientes", json={"nombre": "X", "unidad": "kg", "tipo": "otro"})
    assert r.status_code == 422


def test_el_conteo_en_lote_registra_faltante_sobrante_y_deja_el_stock_contado(client):
    harina = _insumo(client, "Harina", stock=10, costo=2)
    queso = _insumo(client, "Queso", stock=5, costo=6)
    sal = _insumo(client, "Sal", stock=3, costo=1)

    r = client.post(
        "/api/inventario/conteo",
        json={
            "items": [
                {"ingrediente_id": harina["id"], "stock_real": 8},
                {"ingrediente_id": queso["id"], "stock_real": 6},
                {"ingrediente_id": sal["id"], "stock_real": 3},
            ]
        },
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["faltante_valor"] == 4.0  # 2 kg de harina a $2
    assert d["sobrante_valor"] == 6.0  # 1 kg de queso a $6
    assert d["sin_cambio"] == 1  # la sal cuadro y no aparece entre los ajustes
    assert {a["nombre"]: a["diferencia"] for a in d["ajustes"]} == {"Harina": -2.0, "Queso": 1.0}

    stocks = {i["nombre"]: i["stock_actual"] for i in client.get("/api/inventario/ingredientes").json()}
    assert stocks == {"Harina": 8, "Queso": 6, "Sal": 3}

    mermas = client.get("/api/inventario/mermas").json()
    assert [(m["ingrediente_nombre"], m["cantidad"], m["valor"]) for m in mermas] == [("Harina", 2.0, 4.0)]
    sobrantes = client.get("/api/inventario/sobrantes").json()
    assert [(s["ingrediente_nombre"], s["cantidad"], s["valor"]) for s in sobrantes] == [("Queso", 1.0, 6.0)]


def test_el_conteo_es_todo_o_nada(client):
    harina = _insumo(client, "Harina", stock=10)

    assert client.post("/api/inventario/conteo", json={"items": []}).status_code == 400

    repetido = [
        {"ingrediente_id": harina["id"], "stock_real": 1},
        {"ingrediente_id": harina["id"], "stock_real": 2},
    ]
    assert client.post("/api/inventario/conteo", json={"items": repetido}).status_code == 400

    # Un id que no existe tumba el lote entero: la harina sigue en 10.
    con_fantasma = [
        {"ingrediente_id": harina["id"], "stock_real": 1},
        {"ingrediente_id": 9999, "stock_real": 1},
    ]
    assert client.post("/api/inventario/conteo", json={"items": con_fantasma}).status_code == 404
    assert client.get("/api/inventario/ingredientes").json()[0]["stock_actual"] == 10


def test_archivar_un_insumo_lo_saca_de_las_sugerencias_sin_borrarlo(client):
    harina = _insumo(client, "Harina", stock=0, minimo=5)
    assert [s["ingrediente_nombre"] for s in client.get("/api/inventario/sugerencias").json()] == ["Harina"]

    datos = {
        k: harina[k]
        for k in ("nombre", "unidad", "stock_minimo", "stock_objetivo", "costo_unitario", "rendimiento_pct", "tipo")
    }
    r = client.put(f"/api/inventario/ingredientes/{harina['id']}", json={**datos, "activo": False})
    assert r.status_code == 200, r.text
    assert r.json()["activo"] is False

    assert client.get("/api/inventario/sugerencias").json() == []
    # Sigue existiendo: sus recetas, compras y mermas no quedan huerfanas.
    assert any(i["id"] == harina["id"] for i in client.get("/api/inventario/ingredientes").json())
