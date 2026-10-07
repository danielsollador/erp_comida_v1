"""El flujo compras -> inventario -> produccion -> venta (docs/plan-compras-...).

Lo que fija, por fase:

  1. Tipos y cuentas: una factura mezcla carne y servilletas; la carne entra
     al deposito (1040) y las servilletas van a gasto (6050) sin stock. La
     reventa pasa al menu con su receta de 1 unidad.
  2. Sub-recetas: el pastelito lleva 50 g de guiso, y al venderlo sale el
     pollo crudo segun lo que rinde el guiso. El costo sigue la cadena.
  3. Produccion: una tanda saca crudo y mete guiso al mismo valor, y guarda
     el rendimiento real. Lo vendido sale primero de lo producido.
  4. Costo teorico vs real, aceite de freir prorrateado y costo para precios.

Y en todos, la invariante de siempre: el inventario contable (1040) vale lo
mismo que el fisico.
"""

import pytest

from app import kardex, models
from conftest import inventario_fisico, libros_cuadrados, saldo  # noqa: F401


# ── ayudantes ────────────────────────────────────────────────────────────────


def alta(client, nombre, unidad="kg", tipo="insumo", stock=0.0, costo=0.0, **extra):
    r = client.post(
        "/api/inventario/ingredientes",
        json={"nombre": nombre, "unidad": unidad, "tipo": tipo, "stock_actual": stock, "costo_unitario": costo, **extra},
    )
    assert r.status_code == 200, r.text
    return r.json()


def vender(client, variante_id, cantidad=1):
    r = client.post("/api/pedidos", json={"items": [{"variante_id": variante_id, "cantidad": cantidad}], "nota": ""})
    assert r.status_code == 200, r.text
    r = client.post(f"/api/pedidos/{r.json()['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})
    assert r.status_code == 200, r.text
    return r.json()


def producto(db, nombre, receta, precio=2.0, se_frie=False):
    """Un producto del menu con su receta: [(ingrediente_id, cantidad)]."""
    cat = db.query(models.Categoria).first()
    if cat is None:
        cat = models.Categoria(nombre="Comida", orden=0)
        db.add(cat)
        db.flush()
    p = models.Producto(categoria_id=cat.id, nombre=nombre)
    db.add(p)
    db.flush()
    v = models.Variante(producto_id=p.id, nombre="Regular", precio=precio, se_frie=se_frie)
    db.add(v)
    db.flush()
    for iid, cantidad in receta:
        db.add(models.RecetaItem(variante_id=v.id, ingrediente_id=iid, cantidad_por_unidad=cantidad))
    db.commit()
    return v


def stock(db, iid):
    db.expire_all()
    return round(db.get(models.Ingrediente, iid).stock_actual, 4)


@pytest.fixture()
def guiso(client, libros):
    """Guiso de pollo: 1 kg de pollo crudo + 0,1 kg de cebolla rinden 0,8 kg."""
    pollo = alta(client, "Pollo", stock=10, costo=4.0)
    cebolla = alta(client, "Cebolla", stock=2, costo=1.0)
    r = client.post(
        "/api/inventario/preparaciones",
        json={
            "nombre": "Guiso de pollo", "unidad": "kg", "rinde": 0.8,
            "lineas": [
                {"ingrediente_id": pollo["id"], "cantidad": 1},
                {"ingrediente_id": cebolla["id"], "cantidad": 0.1},
            ],
        },
    )
    assert r.status_code == 200, r.text
    return {"pollo": pollo, "cebolla": cebolla, "guiso": r.json()}


# ── Fase 1: tipos y cuentas ──────────────────────────────────────────────────


def test_una_factura_mixta_reparte_inventario_y_desechables(client, db, libros):
    carne = alta(client, "Carne mechar", costo=0)
    servilletas = alta(client, "Servilletas", unidad="paquete", tipo="desechable")
    inv_antes, gasto_antes = saldo(db, "1040"), saldo(db, "6050")

    r = client.post("/api/compras/facturas", json={
        "numero_factura": "F-1", "proveedor_nombre": "Mayorista", "proveedor_rif": "J123456789",
        "categoria": "Insumos", "forma_pago": "Efectivo",
        "items": [
            {"ingrediente_id": carne["id"], "cantidad": 5, "costo_unitario": 6.0},
            {"ingrediente_id": servilletas["id"], "cantidad": 4, "costo_unitario": 2.5},
        ],
    })
    assert r.status_code == 200, r.text

    assert stock(db, carne["id"]) == 5
    assert stock(db, servilletas["id"]) == 0, "un desechable no lleva stock"
    assert round(saldo(db, "1040") - inv_antes, 2) == 30.0
    assert round(saldo(db, "6050") - gasto_antes, 2) == 10.0
    renglones = db.query(models.FacturaCompraItem).all()
    assert {(i.ingrediente_id, i.cuenta) for i in renglones} == {(carne["id"], "1040"), (servilletas["id"], "6050")}
    libros_cuadrados(client, db)

    # Devolver servilletas acredita el gasto, y el stock no se mueve.
    r = client.post(f"/api/compras/facturas/{r.json()['id']}/notas-credito", json={
        "numero": "NC-1", "tipo": "devolucion",
        "items": [{"ingrediente_id": servilletas["id"], "cantidad": 2}],
    })
    assert r.status_code == 200, r.text
    assert round(saldo(db, "6050") - gasto_antes, 2) == 5.0
    assert stock(db, servilletas["id"]) == 0
    libros_cuadrados(client, db)


def test_un_desechable_no_va_en_recetas(client, db, variante):
    bolsa = alta(client, "Bolsa para llevar", unidad="unidad", tipo="desechable")
    r = client.put(f"/api/inventario/recetas/{variante.id}", json=[{"ingrediente_id": bolsa["id"], "cantidad_por_unidad": 1}])
    assert r.status_code == 400
    assert "desechable" in r.json()["detail"]


def test_la_reventa_pasa_al_menu_y_venderla_la_descuenta(client, db, libros):
    pepsi = alta(client, "Pepsi lata", unidad="unidad", tipo="reventa", stock=24, costo=0.5)
    cat = db.query(models.Categoria).first()
    r = client.post(f"/api/menu/desde-mercancia/{pepsi['id']}", json={"categoria_id": cat.id, "precio": 1.5})
    assert r.status_code == 200, r.text
    variante_id = r.json()["variantes"][0]["id"]

    vender(client, variante_id, 3)
    assert stock(db, pepsi["id"]) == 21
    libros_cuadrados(client, db)

    # Dos veces no: ya se vende.
    r = client.post(f"/api/menu/desde-mercancia/{pepsi['id']}", json={"categoria_id": cat.id, "precio": 1.5})
    assert r.status_code == 409


# ── Fase 2: sub-recetas ──────────────────────────────────────────────────────


def test_el_costo_de_la_preparacion_sale_de_su_receta(guiso):
    g = guiso["guiso"]
    # (1 kg x $4 + 0,1 kg x $1) / 0,8 kg = $5,125 por kg de guiso.
    assert g["costo_tanda"] == 4.1
    assert g["costo_unitario"] == 5.125


def test_vender_un_pastelito_baja_hasta_el_pollo_crudo(client, db, guiso):
    disco = alta(client, "Disco", unidad="unidad", stock=100, costo=0.1)
    pastelito = producto(db, "Pastelito de pollo", [(guiso["guiso"]["id"], 0.05), (disco["id"], 1)])

    vender(client, pastelito.id, 16)
    # 16 x 50 g = 0,8 kg de guiso = una tanda: 1 kg de pollo y 0,1 kg de cebolla.
    assert stock(db, guiso["pollo"]["id"]) == 9
    assert stock(db, guiso["cebolla"]["id"]) == 1.9
    assert stock(db, disco["id"]) == 84
    assert stock(db, guiso["guiso"]["id"]) == 0, "lo que se descuenta del crudo no lleva stock"

    item = db.query(models.PedidoItem).filter_by(variante_id=pastelito.id).one()
    # 0,05 kg x $5,125 + 1 disco x $0,10
    assert round(item.costo_unitario, 4) == 0.3563
    libros_cuadrados(client, db)


def test_una_preparacion_no_puede_contenerse_a_si_misma(client, guiso):
    g = guiso["guiso"]
    r = client.post("/api/inventario/preparaciones", json={
        "nombre": "Relleno", "unidad": "kg", "rinde": 1,
        "lineas": [{"ingrediente_id": g["id"], "cantidad": 1}],
    })
    assert r.status_code == 200, r.text
    relleno = r.json()
    r = client.put(f"/api/inventario/preparaciones/{g['id']}", json={
        "nombre": g["nombre"], "unidad": "kg", "rinde": 0.8,
        "lineas": [{"ingrediente_id": guiso["pollo"]["id"], "cantidad": 1}, {"ingrediente_id": relleno["id"], "cantidad": 0.1}],
    })
    assert r.status_code == 400
    assert "contendría a sí misma" in r.json()["detail"]


def test_una_preparacion_dentro_de_otra(client, db, guiso):
    """El relleno lleva guiso: al venderlo, igual sale el pollo."""
    r = client.post("/api/inventario/preparaciones", json={
        "nombre": "Relleno ranchero", "unidad": "kg", "rinde": 1,
        "lineas": [{"ingrediente_id": guiso["guiso"]["id"], "cantidad": 0.8}, {"ingrediente_id": guiso["cebolla"]["id"], "cantidad": 0.2}],
    })
    assert r.status_code == 200, r.text
    relleno = r.json()
    # 0,8 kg de guiso ($4,10) + 0,2 kg de cebolla ($0,20) rinden 1 kg.
    assert relleno["costo_unitario"] == 4.3
    ranchero = producto(db, "Ranchero", [(relleno["id"], 1)])
    vender(client, ranchero.id, 1)
    assert stock(db, guiso["pollo"]["id"]) == 9
    assert stock(db, guiso["cebolla"]["id"]) == round(2 - 0.1 - 0.2, 4)
    libros_cuadrados(client, db)


# ── Fase 3: produccion ───────────────────────────────────────────────────────


def _a_producir(client, guiso, vida=None):
    g = guiso["guiso"]
    r = client.put(f"/api/inventario/preparaciones/{g['id']}", json={
        "nombre": g["nombre"], "unidad": "kg", "rinde": 0.8, "modo_produccion": "producir", "vida_util_horas": vida,
        "lineas": [{"ingrediente_id": guiso["pollo"]["id"], "cantidad": 1}, {"ingrediente_id": guiso["cebolla"]["id"], "cantidad": 0.1}],
    })
    assert r.status_code == 200, r.text
    return r.json()


def test_una_tanda_transforma_el_crudo_sin_cambiar_el_valor(client, db, guiso):
    g = _a_producir(client, guiso)
    antes = inventario_fisico(db)
    r = client.post("/api/inventario/produccion", json={
        "preparacion_id": g["id"], "cantidad": 2,
        "usado": [{"ingrediente_id": guiso["pollo"]["id"], "cantidad": 3}, {"ingrediente_id": guiso["cebolla"]["id"], "cantidad": 0.3}],
    })
    assert r.status_code == 200, r.text
    tanda = r.json()
    # De 3 kg de pollo la receta esperaba 2,4 kg: salieron 2 (rindio 83 %).
    assert tanda["cantidad_esperada"] == 2.4
    assert tanda["rendimiento_real"] == 0.8333
    assert stock(db, guiso["pollo"]["id"]) == 7
    assert stock(db, g["id"]) == 2
    # $12 de pollo + $0,30 de cebolla = $12,30 en 2 kg: $6,15 el kg.
    assert round(db.get(models.Ingrediente, g["id"]).costo_unitario, 4) == 6.15
    assert inventario_fisico(db) == antes
    libros_cuadrados(client, db)

    lista = client.get("/api/inventario/preparaciones").json()
    assert next(p for p in lista if p["id"] == g["id"])["rendimiento_real"] == 0.8333


def test_lo_vendido_sale_de_lo_producido_y_lo_que_falta_del_crudo(client, db, guiso):
    g = _a_producir(client, guiso)
    client.post("/api/inventario/produccion", json={"preparacion_id": g["id"], "cantidad": 0.8})
    assert stock(db, guiso["pollo"]["id"]) == 9  # la tanda estandar: 1 kg
    pastelito = producto(db, "Pastelito", [(g["id"], 0.1)])

    vender(client, pastelito.id, 12)  # 1,2 kg de guiso: 0,8 producidos + 0,4 del crudo
    assert stock(db, g["id"]) == 0
    assert stock(db, guiso["pollo"]["id"]) == 8.5  # 0,4 kg de guiso = 0,5 kg de pollo
    libros_cuadrados(client, db)


def test_no_se_anotan_tandas_de_lo_que_se_descuenta_del_crudo(client, guiso):
    r = client.post("/api/inventario/produccion", json={"preparacion_id": guiso["guiso"]["id"], "cantidad": 1})
    assert r.status_code == 400
    assert "se descuenta del crudo" in r.json()["detail"]


def test_lo_que_sobra_vencido_se_ofrece_para_botar(client, db, guiso):
    g = _a_producir(client, guiso, vida=1)
    client.post("/api/inventario/produccion", json={"preparacion_id": g["id"], "cantidad": 0.8})
    assert client.get("/api/inventario/preparaciones/vencidas").json() == []
    tanda = db.query(models.Produccion).one()
    tanda.fecha = tanda.fecha.replace(year=tanda.fecha.year - 1)
    db.commit()
    vencidas = client.get("/api/inventario/preparaciones/vencidas").json()
    assert [v["id"] for v in vencidas] == [g["id"]]
    # Se bota con la merma de siempre.
    r = client.post(f"/api/inventario/ingredientes/{g['id']}/merma", json={"cantidad": 0.8, "motivo": "Sobró del día"})
    assert r.status_code == 200, r.text
    libros_cuadrados(client, db)


def test_la_disponibilidad_avisa_que_el_pollo_es_compartido(client, guiso):
    client.post("/api/inventario/preparaciones", json={
        "nombre": "Guiso ranchero", "unidad": "kg", "rinde": 1,
        "lineas": [{"ingrediente_id": guiso["pollo"]["id"], "cantidad": 1}],
    })
    filas = {f["nombre"]: f for f in client.get("/api/inventario/preparaciones/disponibilidad").json()}
    # 10 kg de pollo dan 8 kg de guiso de pollo (la cebolla da para 16), o 10 de ranchero.
    assert filas["Guiso de pollo"]["potencial"] == 8
    assert filas["Guiso de pollo"]["limita"] == "Pollo"
    assert filas["Guiso de pollo"]["comparte_con"] == ["Guiso ranchero"]
    assert filas["Guiso ranchero"]["potencial"] == 10


# ── Fase 4: control y costos ─────────────────────────────────────────────────


def test_costo_teorico_contra_el_conteo(client, db, guiso):
    pastelito = producto(db, "Pastelito", [(guiso["guiso"]["id"], 0.08)])
    vender(client, pastelito.id, 10)  # 0,8 kg de guiso = 1 kg de pollo teorico
    # El conteo encuentra 8,5 kg y no 9: medio kilo se fue sin explicacion.
    r = client.post("/api/inventario/conteo", json={"items": [{"ingrediente_id": guiso["pollo"]["id"], "stock_real": 8.5}]})
    assert r.status_code == 200, r.text
    filas = {f["nombre"]: f for f in client.get("/api/inventario/costo-teorico").json()}
    pollo = filas["Pollo"]
    assert pollo["teorico"] == 1
    assert pollo["diferencia_conteo"] == -0.5
    assert pollo["pct_desvio"] == 50.0


def test_el_aceite_se_reparte_por_pieza_frita(client, db, libros):
    aceite = alta(client, "Aceite de freir", unidad="lt", stock=20, costo=2.0, es_indirecto=True)
    masa = alta(client, "Masa", stock=10, costo=1.0)
    frito = producto(db, "Pastelito frito", [(masa["id"], 0.05)], se_frie=True)
    horneado = producto(db, "Pan horneado", [(masa["id"], 0.05)])
    costo_ventas = saldo(db, "5010")

    r = client.post(f"/api/inventario/ingredientes/{aceite['id']}/cargar-indirecto", json={"cantidad": 5})
    assert r.status_code == 200, r.text
    assert stock(db, aceite["id"]) == 15
    assert round(saldo(db, "5010") - costo_ventas, 2) == 10.0, "el aceite cargado es costo de producir"
    libros_cuadrados(client, db)

    vender(client, frito.id, 40)
    vender(client, horneado.id, 10)
    fila = client.get("/api/inventario/indirectos").json()[0]
    assert fila["piezas"] == 40, "solo lo que se frie"
    assert fila["por_pieza"] == 0.25  # $10 / 40 piezas

    costos = {c["variante_id"]: c for c in client.get("/api/menu/costos").json()}
    assert costos[frito.id]["costo_indirecto"] == 0.25
    assert costos[horneado.id]["costo_indirecto"] == 0


def test_el_aceite_indirecto_no_va_en_recetas(client, db, variante):
    aceite = alta(client, "Aceite", unidad="lt", es_indirecto=True)
    r = client.put(f"/api/inventario/recetas/{variante.id}", json=[{"ingrediente_id": aceite["id"], "cantidad_por_unidad": 0.01}])
    assert r.status_code == 400


def test_costo_para_precios_configurable(client, db, guiso):
    pastelito = producto(db, "Pastelito", [(guiso["guiso"]["id"], 0.1)], precio=2.0)
    # El pollo se compra mas caro: reponer cuesta mas que el promedio.
    r = client.post("/api/compras/facturas", json={
        "numero_factura": "F-9", "proveedor_nombre": "Avicola", "proveedor_rif": "J123456789",
        "categoria": "Insumos", "forma_pago": "Efectivo",
        "items": [{"ingrediente_id": guiso["pollo"]["id"], "cantidad": 10, "costo_unitario": 8.0}],
    })
    assert r.status_code == 200, r.text

    def costo():
        return next(c for c in client.get("/api/menu/costos").json() if c["variante_id"] == pastelito.id)

    c = costo()
    assert c["costo_para_precio"] == c["costo_reposicion"]
    assert c["costo_reposicion"] > c["costo"]
    r = client.put("/api/config/costo-precios", json={"costo_para_precios": "promedio"})
    assert r.status_code == 200 and r.json()["costo_para_precios"] == "promedio"
    assert costo()["costo_para_precio"] == costo()["costo"]


def test_guardar_la_ficha_no_pisa_lo_de_la_preparacion(client, db, guiso):
    """La ficha de Inventario no conoce `rinde` ni el modo: guardar un minimo
    desde ahi no puede dejar el guiso rindiendo 1."""
    g = _a_producir(client, guiso, vida=24)
    r = client.put(f"/api/inventario/ingredientes/{g['id']}", json={
        "nombre": g["nombre"], "unidad": "kg", "tipo": "preparacion", "stock_minimo": 1,
    })
    assert r.status_code == 200, r.text
    db.expire_all()
    prep = db.get(models.Ingrediente, g["id"])
    assert (prep.rinde, prep.modo_produccion, prep.vida_util_horas) == (0.8, "producir", 24)
    assert prep.stock_minimo == 1
