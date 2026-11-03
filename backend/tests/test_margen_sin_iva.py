"""El margen se mide sobre el precio SIN IVA.

El precio del menu lleva el IVA adentro y ese IVA es del fisco. Comparar el
precio con IVA contra un costo sin IVA inflaba el margen: el jugo de $3 con
costo $1,65 "dejaba" $1,35 (45 %) cuando deja $0,94 (36 %). Leider, 28-oct.

Y en la tabla de inventario se mira UN costo, el que diga Configuracion
("Con que costo fijar precios"), con el margen calculado sobre ese mismo.
"""
from app import models


def _reventa(db, nombre="Jugo Hawi", costo=1.65, exento=False):
    ing = models.Ingrediente(nombre=nombre, unidad="unidad", stock_actual=5, stock_minimo=0,
                             costo_unitario=costo, rendimiento_pct=100, tipo="reventa", exento=exento)
    db.add(ing)
    db.commit()
    db.refresh(ing)
    return ing


def _al_menu(client, ing, precio):
    r = client.post(f"/api/menu/desde-mercancia/{ing.id}", json={"categoria_id": _categoria(client), "precio": precio, "nombre": ing.nombre})
    assert r.status_code == 200, r.text
    return r.json()


def _categoria(client):
    cats = client.get("/api/menu/categorias").json()
    if cats:
        return cats[0]["id"]
    return client.post("/api/menu/categorias", json={"nombre": "Bebidas", "orden": 0}).json()["id"]


def _fila(client, ing_id):
    return next(i for i in client.get("/api/inventario/ingredientes").json() if i["id"] == ing_id)


def test_el_margen_del_menu_sale_del_precio_sin_iva(client, db):
    jugo = _reventa(db)
    producto = _al_menu(client, jugo, 3.00)
    variante_id = producto["variantes"][0]["id"]
    fila = next(c for c in client.get("/api/menu/costos").json() if c["variante_id"] == variante_id)
    # $3,00 / 1,16 = $2,586; (2,586 - 1,65) / 2,586 = 36,2 %
    assert fila["precio_neto"] == 2.5862
    assert fila["margen_pct"] == 36.2
    assert fila["margen_para_precio_pct"] == 36.2


def test_un_producto_exento_no_le_quita_iva_al_precio(client, db):
    harina = _reventa(db, "Harina", costo=1.0, exento=True)
    producto = _al_menu(client, harina, 2.00)
    variante_id = producto["variantes"][0]["id"]
    fila = next(c for c in client.get("/api/menu/costos").json() if c["variante_id"] == variante_id)
    assert fila["precio_neto"] == 2.0
    assert fila["margen_pct"] == 50.0


def test_la_mercancia_de_reventa_trae_su_precio_y_su_margen(client, db):
    jugo = _reventa(db)
    _al_menu(client, jugo, 3.00)
    fila = _fila(client, jugo.id)
    assert fila["precio_venta"] == 3.0
    assert fila["precio_neto"] == 2.5862
    assert fila["margen_pct"] == 36.2
    # Sin compras todavia, el costo elegido (ultimo) cae al promedio.
    assert fila["costo_elegido"] == 1.65


def test_la_materia_prima_no_tiene_margen_propio(client, db):
    queso = models.Ingrediente(nombre="Queso", unidad="kg", stock_actual=2, stock_minimo=0,
                               costo_unitario=4.0, rendimiento_pct=100, tipo="insumo")
    db.add(queso)
    db.commit()
    fila = _fila(client, queso.id)
    assert fila["precio_venta"] is None and fila["margen_pct"] is None
    assert fila["costo_elegido"] == 4.0


def test_el_costo_elegido_sigue_a_configuracion(client, db):
    jugo = _reventa(db, costo=1.50)
    # Una compra mas cara: el ultimo costo sube a 1,80 y el promedio queda en medio.
    r = client.post(f"/api/inventario/ingredientes/{jugo.id}/comprar", json={"cantidad": 5, "costo_total": 9.00, "metodo_pago": "Efectivo $"})
    assert r.status_code == 200, r.text
    assert _fila(client, jugo.id)["costo_elegido"] == 1.8  # reposicion (por defecto)
    assert client.put("/api/config/costo-precios", json={"costo_para_precios": "promedio"}).status_code == 200
    assert _fila(client, jugo.id)["costo_elegido"] == 1.65
    assert client.put("/api/config/costo-precios", json={"costo_para_precios": "mayor"}).status_code == 200
    assert _fila(client, jugo.id)["costo_elegido"] == 1.8
