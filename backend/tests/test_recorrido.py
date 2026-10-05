"""El recorrido de la portada: Compras > Inventario > Menu > Ventas > Caja.

Cada estacion dice en una frase como esta, y solo se marca `pendiente` la que
pide algo. Las frases salen de los mismos sitios que las pantallas a las que
llevan.
"""
from app import models


def pasos(client):
    r = client.get("/api/reportes/recorrido")
    assert r.status_code == 200, r.text
    return {p["id"]: p for p in r.json()["pasos"]}


def test_las_cinco_estaciones_en_orden_y_siete_dias(client, variante):
    r = client.get("/api/reportes/recorrido").json()
    assert [p["id"] for p in r["pasos"]] == ["compras", "inventario", "menu", "ventas", "caja"]
    assert len(r["ultimos_7_dias"]) == 7


def test_menu_cuenta_lo_que_falta_por_receta(client, variante, db):
    assert pasos(client)["menu"]["frase"] == "Todo con receta"
    assert pasos(client)["menu"]["pendiente"] is False
    otra = models.Variante(producto_id=variante.producto_id, nombre="Pollo", precio=5.0)
    db.add(otra)
    db.commit()
    menu = pasos(client)["menu"]
    assert menu["frase"] == "1 producto sin receta" and menu["pendiente"] is True
    assert menu["a"] == "/menu/recetas"


def test_los_envios_no_cuentan_como_sin_receta(client, variante, db):
    envios = models.Categoria(nombre="Envios", orden=9)
    db.add(envios)
    db.flush()
    p = models.Producto(categoria_id=envios.id, nombre="Delivery")
    db.add(p)
    db.flush()
    db.add(models.Variante(producto_id=p.id, nombre="Regular", precio=1.5))
    db.commit()
    assert pasos(client)["menu"]["frase"] == "Todo con receta"


def test_compras_dice_que_comprar(client, variante, insumo, db):
    insumo.stock_actual = 0.5  # bajo el minimo de 1 kg
    db.commit()
    compras = pasos(client)["compras"]
    assert compras["pendiente"] is True
    assert compras["frase"] == "Toca comprar carne molida"
    assert compras["a"] == "/inventario/comprar"


def test_ventas_cuenta_los_pedidos_de_hoy(client, variante):
    assert pasos(client)["ventas"]["frase"] == "Sin ventas todavía hoy"
    p = client.post("/api/pedidos", json={"cliente": "Ana", "items": [{"variante_id": variante.id, "cantidad": 1}]}).json()
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo $"})
    ventas = pasos(client)["ventas"]
    assert ventas["frase"] == "1 pedido hoy" and ventas["pendiente"] is False


def test_lo_fiado_se_dice_sin_signo_de_moneda(client, variante):
    p = client.post("/api/pedidos", json={"cliente": "Ana", "items": [{"variante_id": variante.id, "cantidad": 1}]}).json()
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Fiado"})
    ventas = pasos(client)["ventas"]
    assert ventas["frase"] == "Te deben {monto}" and ventas["monto"] == 5.0
    assert ventas["pendiente"] is True


def test_la_caja_sin_abrir_pide_abrirla(client, variante):
    caja = pasos(client)["caja"]
    assert caja["frase"] == "Falta abrirla" and caja["pendiente"] is True and caja["a"] == "/pos"
