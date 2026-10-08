"""Lo que encontraron los casos prácticos del 8-oct.

  * Recetas mostraba el margen al costo promedio y sin el aceite: el pastelito
    frito salía con 93 % cuando dejaba 56 %. `/menu/costos-para-precios` da
    el costo de cada mercancía con el método elegido y el aceite por pieza.
  * El pollo que comparten dos guisos se contaba entero para cada uno: ahora
    se reparte según lo vendido (o en partes iguales sin ventas).
  * "Crema de leche." se colaba como ficha nueva al lado de "Crema de leche".
"""

from app import models


def alta(client, nombre, unidad="kg", **extra):
    r = client.post("/api/inventario/ingredientes", json={"nombre": nombre, "unidad": unidad, "tipo": "insumo", "stock_actual": 0, "costo_unitario": 0, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def comprar(client, numero, items):
    r = client.post("/api/compras/facturas", json={
        "numero_factura": numero, "proveedor_nombre": "Mayorista", "proveedor_rif": "J123456789",
        "forma_pago": "Credito", "tasa_bcv": 100, "items": items,
    })
    assert r.status_code == 200, r.text


def producto(db, nombre, receta, precio=1.0, se_frie=False):
    cat = db.query(models.Categoria).first() or models.Categoria(nombre="Comida", orden=0)
    db.add(cat)
    db.flush()
    p = models.Producto(categoria_id=cat.id, nombre=nombre)
    db.add(p)
    db.flush()
    v = models.Variante(producto_id=p.id, nombre="Regular", precio=precio, se_frie=se_frie)
    db.add(v)
    db.flush()
    for iid, q in receta:
        db.add(models.RecetaItem(variante_id=v.id, ingrediente_id=iid, cantidad_por_unidad=q))
    db.commit()
    return v


def vender(client, vid, n):
    r = client.post("/api/pedidos", json={"items": [{"variante_id": vid, "cantidad": n}], "nota": ""})
    assert r.status_code == 200, r.text
    assert client.post(f"/api/pedidos/{r.json()['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"}).status_code == 200


def test_el_costo_para_precios_usa_el_ultimo_costo_y_el_aceite(client, db, libros):
    pollo = alta(client, "Pollo")
    aceite = alta(client, "Aceite", unidad="lt", es_indirecto=True)
    comprar(client, "C-1", [{"ingrediente_id": pollo["id"], "cantidad": 10, "costo_unitario": 4}, {"ingrediente_id": aceite["id"], "cantidad": 10, "costo_unitario": 3}])
    comprar(client, "C-2", [{"ingrediente_id": pollo["id"], "cantidad": 10, "costo_unitario": 5}])
    client.put("/api/config/costo-precios", json={"costo_para_precios": "reposicion"})

    cp = client.get("/api/menu/costos-para-precios").json()
    assert cp["metodo"] == "reposicion"
    assert cp["por_ingrediente"][str(pollo["id"])] == 5.0, "el ultimo pagado, no el promedio de 4,50"

    client.put("/api/config/costo-precios", json={"costo_para_precios": "promedio"})
    assert client.get("/api/menu/costos-para-precios").json()["por_ingrediente"][str(pollo["id"])] == 4.5

    v = producto(db, "Pastelito frito", [(pollo["id"], 0.05)], se_frie=True)
    vender(client, v.id, 20)
    assert client.post(f"/api/inventario/ingredientes/{aceite['id']}/cargar-indirecto", json={"cantidad": 2}).status_code == 200
    cp = client.get("/api/menu/costos-para-precios").json()
    # 2 L a $3 entre 20 piezas fritas.
    assert cp["indirecto_por_pieza"] == 0.3


def test_el_pollo_compartido_se_reparte_entre_los_guisos(client, db, libros):
    pollo = alta(client, "Pollo")
    queso = alta(client, "Queso")
    comprar(client, "G-1", [{"ingrediente_id": pollo["id"], "cantidad": 10, "costo_unitario": 4}, {"ingrediente_id": queso["id"], "cantidad": 10, "costo_unitario": 6}])
    g = client.post("/api/inventario/preparaciones", json={"nombre": "Guiso de pollo", "unidad": "kg", "rinde": 1, "lineas": [{"ingrediente_id": pollo["id"], "cantidad": 1}]}).json()
    r = client.post("/api/inventario/preparaciones", json={"nombre": "Ranchero", "unidad": "kg", "rinde": 1, "lineas": [
        {"ingrediente_id": pollo["id"], "cantidad": 0.5}, {"ingrediente_id": queso["id"], "cantidad": 0.5}]}).json()

    d = {x["nombre"]: x for x in client.get("/api/inventario/preparaciones/disponibilidad").json()}
    # Sin ventas, mitad y mitad: 5 kg de pollo para cada uno.
    assert d["Guiso de pollo"]["reparto_segun"] == "iguales"
    assert d["Guiso de pollo"]["potencial"] == 5.0
    assert d["Guiso de pollo"]["potencial_solo"] == 10.0
    assert d["Ranchero"]["potencial"] == 10.0  # 5 kg de pollo / 0,5 por kg

    # Se vende el triple de guiso de pollo que de ranchero: le toca 3/4 del pollo.
    vender(client, producto(db, "Pastelito de pollo", [(g["id"], 0.3)]).id, 1)
    vender(client, producto(db, "Pastelito ranchero", [(r["id"], 0.1)]).id, 1)
    d = {x["nombre"]: x for x in client.get("/api/inventario/preparaciones/disponibilidad").json()}
    assert d["Guiso de pollo"]["reparto_segun"] == "ventas"
    assert d["Guiso de pollo"]["reparto_pct"] == 75.0
    pollo_hoy = db.get(models.Ingrediente, pollo["id"])
    db.refresh(pollo_hoy)
    assert abs(d["Guiso de pollo"]["potencial"] - pollo_hoy.stock_actual * 0.75) < 0.002


def test_un_signo_no_hace_otra_mercancia(client, libros):
    alta(client, "Crema de leche")
    for gemela in ("Crema de leche.", "Crema de leche!", "crema-de leche"):
        r = client.post("/api/inventario/ingredientes", json={"nombre": gemela, "unidad": "kg", "tipo": "insumo"})
        assert r.status_code == 409, gemela
    alta(client, "Queso 0,5 kg", unidad="unidad")
    r = client.post("/api/inventario/ingredientes", json={"nombre": "Queso 0.5 KG", "unidad": "unidad", "tipo": "insumo"})
    assert r.status_code == 409


def test_la_merma_guarda_quien_la_anoto(client, db, libros):
    """La merma guardaba quién solo en el kardex: la lista y el reporte de
    pérdidas no podían decir si una misma persona botaba todos los días."""
    pollo = alta(client, "Pollo")
    comprar(client, "M-1", [{"ingrediente_id": pollo["id"], "cantidad": 10, "costo_unitario": 4}])
    for _ in range(3):
        assert client.post(f"/api/inventario/ingredientes/{pollo['id']}/merma", json={"cantidad": 0.5, "motivo": "se dañó"}).status_code == 200
    mermas = client.get("/api/inventario/mermas").json()
    assert {m["operador"] for m in mermas} == {"admin"}
    per = client.get("/api/reportes/perdidas").json()["por_operador"]
    assert per == [{"operador": "admin", "valor": 6.0, "veces": 3}]
