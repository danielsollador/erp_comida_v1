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


def test_la_misma_factura_dos_veces_se_frena_en_el_servidor(client, db, libros):
    """Dos tablets guardando la misma factura casi a la vez: la segunda llega
    cuando la primera ya entró y se rechaza, en vez de duplicar el stock."""
    pollo = alta(client, "Pollo")
    cuerpo = {"numero_factura": "0001133", "proveedor_nombre": "Mayorista", "proveedor_rif": "J123456789",
              "forma_pago": "Credito", "tasa_bcv": 100, "items": [{"ingrediente_id": pollo["id"], "cantidad": 10, "costo_unitario": 4}]}
    assert client.post("/api/compras/facturas", json=cuerpo).status_code == 200
    r = client.post("/api/compras/facturas", json={**cuerpo, "numero_factura": "1133"})
    assert r.status_code == 409 and r.json()["detail"].startswith("Ya está cargada")
    db.expire_all()
    assert db.get(models.Ingrediente, pollo["id"]).stock_actual == 10
    # Si quien carga confirma, entra.
    assert client.post("/api/compras/facturas", json={**cuerpo, "confirmar_duplicado": True}).status_code == 200


def test_abonos_a_una_factura_a_credito(client, db, libros):
    from conftest import libros_cuadrados, saldo
    pollo = alta(client, "Pollo")
    comprar(client, "A-1", [{"ingrediente_id": pollo["id"], "cantidad": 10, "costo_unitario": 4}])
    f = client.get("/api/compras/facturas").json()[0]
    assert f["saldo"] == 46.4
    deuda = saldo(db, "2010")
    r = client.post(f"/api/compras/facturas/{f['id']}/abonos", json={"monto": 20, "forma_pago": "Efectivo Bs"})
    assert r.status_code == 200, r.text
    assert (r.json()["abonado"], r.json()["saldo"], r.json()["pagada"]) == (20, 26.4, False)
    assert round(deuda - saldo(db, "2010"), 2) == 20
    assert client.post(f"/api/compras/facturas/{f['id']}/abonos", json={"monto": 30, "forma_pago": "Efectivo Bs"}).status_code == 400
    assert client.delete(f"/api/compras/facturas/{f['id']}").status_code == 409
    r = client.post(f"/api/compras/facturas/{f['id']}/abonos", json={"monto": 26.4, "forma_pago": "Efectivo Bs"})
    assert r.json()["pagada"] is True and r.json()["saldo"] == 0
    assert round(deuda - saldo(db, "2010"), 2) == 46.4
    libros_cuadrados(client, db)


def test_pagar_despues_de_una_nota_de_credito_paga_lo_que_se_debe(client, db, libros):
    """Antes se pagaba el total original y la deuda quedaba en negativo."""
    from conftest import libros_cuadrados, saldo
    pollo = alta(client, "Pollo")
    comprar(client, "N-1", [{"ingrediente_id": pollo["id"], "cantidad": 10, "costo_unitario": 4}])
    f = client.get("/api/compras/facturas").json()[0]
    deuda = saldo(db, "2010")
    client.post(f"/api/compras/facturas/{f['id']}/notas-credito", json={"numero": "NC-1", "tipo": "devolucion", "items": [{"ingrediente_id": pollo["id"], "cantidad": 2}]})
    assert client.get("/api/compras/facturas").json()[0]["saldo"] == 37.12
    client.post(f"/api/compras/facturas/{f['id']}/abonos", json={"monto": 10, "forma_pago": "Efectivo Bs"})
    r = client.post(f"/api/compras/facturas/{f['id']}/pagar", json={"forma_pago": "Efectivo"})
    assert r.status_code == 200, r.text
    assert round(saldo(db, "2010") - (deuda - 46.4), 2) == 0, "la deuda queda en cero, no en negativo"
    libros_cuadrados(client, db)


def test_llego_menos_queda_como_reclamo_y_la_nota_lo_cierra(client, db, libros):
    from conftest import libros_cuadrados, saldo
    pollo = alta(client, "Pollo")
    comprar(client, "F-1", [{"ingrediente_id": pollo["id"], "cantidad": 10, "costo_unitario": 4}])
    f = client.get("/api/compras/facturas").json()[0]
    antes = {c: saldo(db, c) for c in ("1040", "1045", "6020", "2010")}

    r = client.post(f"/api/compras/facturas/{f['id']}/faltantes", json={"items": [{"ingrediente_id": pollo["id"], "cantidad": 2}], "motivo": "llegaron 8"})
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(models.Ingrediente, pollo["id"]).stock_actual == 8
    assert round(saldo(db, "1045") - antes["1045"], 2) == 8.0, "el proveedor debe $8"
    assert round(saldo(db, "6020") - antes["6020"], 2) == 0, "no es merma"
    assert [x["cantidad"] for x in client.get("/api/compras/reclamos").json()] == [2]
    libros_cuadrados(client, db)

    # Llega la nota: cierra el reclamo, baja la deuda y el IVA, y el stock no se mueve otra vez.
    r = client.post(f"/api/compras/facturas/{f['id']}/notas-credito", json={"numero": "NC-9", "tipo": "faltante"})
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(models.Ingrediente, pollo["id"]).stock_actual == 8
    assert round(saldo(db, "1045") - antes["1045"], 2) == 0
    assert round(antes["2010"] - saldo(db, "2010"), 2) == 9.28
    assert client.get("/api/compras/reclamos").json() == []
    libros_cuadrados(client, db)


def test_un_reclamo_que_nunca_se_acredita_pasa_a_perdida(client, db, libros):
    from conftest import libros_cuadrados, saldo
    pollo = alta(client, "Pollo")
    comprar(client, "F-2", [{"ingrediente_id": pollo["id"], "cantidad": 10, "costo_unitario": 4}])
    f = client.get("/api/compras/facturas").json()[0]
    client.post(f"/api/compras/facturas/{f['id']}/faltantes", json={"items": [{"ingrediente_id": pollo["id"], "cantidad": 3}]})
    assert client.post(f"/api/compras/facturas/{f['id']}/faltantes", json={"items": [{"ingrediente_id": pollo["id"], "cantidad": 8}]}).status_code == 409
    rid = client.get("/api/compras/reclamos").json()[0]["id"]
    antes = saldo(db, "6020")
    assert client.post(f"/api/compras/reclamos/{rid}/perder").status_code == 200
    assert round(saldo(db, "6020") - antes, 2) == 12.0
    assert saldo(db, "1045") == 0
    libros_cuadrados(client, db)


def test_un_combo_suma_las_recetas_de_sus_productos_y_se_entera_de_los_cambios(client, db, libros):
    harina = alta(client, "Harina")
    naranja = alta(client, "Naranja")
    comprar(client, "K-1", [{"ingrediente_id": harina["id"], "cantidad": 10, "costo_unitario": 1}, {"ingrediente_id": naranja["id"], "cantidad": 10, "costo_unitario": 2}])
    pastelito = producto(db, "Pastelito", [(harina["id"], 0.05)], 1.0)
    jugo = producto(db, "Jugo", [(naranja["id"], 0.5)], 3.0)
    combo = producto(db, "Combo", [], 3.5)

    r = client.put(f"/api/inventario/combos/{combo.id}", json=[{"variante_id": pastelito.id, "cantidad": 2}, {"variante_id": jugo.id, "cantidad": 1}])
    assert r.status_code == 200, r.text
    receta = {x["ingrediente_id"]: x["cantidad_por_unidad"] for x in client.get(f"/api/inventario/recetas/{combo.id}").json()}
    assert receta == {harina["id"]: 0.1, naranja["id"]: 0.5}
    c = next(x for x in client.get("/api/menu/costos").json() if x["variante_id"] == combo.id)
    assert round(c["costo"], 4) == 1.1  # 2 pastelitos ($0,05) + 1 jugo ($1)

    # Cambia la receta del pastelito: el combo se rearma solo.
    assert client.put(f"/api/inventario/recetas/{pastelito.id}", json=[{"ingrediente_id": harina["id"], "cantidad_por_unidad": 0.08}]).status_code == 200
    receta = {x["ingrediente_id"]: x["cantidad_por_unidad"] for x in client.get(f"/api/inventario/recetas/{combo.id}").json()}
    assert receta[harina["id"]] == 0.16

    # Vender el combo descuenta todo.
    vender(client, combo.id, 1)
    db.expire_all()
    assert round(db.get(models.Ingrediente, naranja["id"]).stock_actual, 3) == 9.5

    # La receta del combo no se edita a mano, y un combo no lleva otro combo.
    assert client.put(f"/api/inventario/recetas/{combo.id}", json=[]).status_code == 409
    otro = producto(db, "Combo doble", [], 6)
    assert client.put(f"/api/inventario/combos/{otro.id}", json=[{"variante_id": combo.id, "cantidad": 1}]).status_code == 400
    assert client.put(f"/api/inventario/combos/{combo.id}", json=[{"variante_id": combo.id, "cantidad": 1}]).status_code == 400


def test_hoy_el_pollo_es_pavo(client, db, libros):
    """No hay pollo: se anota el cambio y lo vendido descuenta pavo, sin tocar recetas."""
    pollo = alta(client, "Pollo", rendimiento_pct=70)
    pavo = alta(client, "Pavo", rendimiento_pct=80)
    comprar(client, "S-1", [{"ingrediente_id": pollo["id"], "cantidad": 0.2, "costo_unitario": 4}, {"ingrediente_id": pavo["id"], "cantidad": 5, "costo_unitario": 6}])
    g = client.post("/api/inventario/preparaciones", json={"nombre": "Guiso de pollo", "unidad": "kg", "rinde": 1, "lineas": [{"ingrediente_id": pollo["id"], "cantidad": 1}]}).json()
    v = producto(db, "Pastelito de pollo", [(g["id"], 0.07)])
    r = client.post("/api/pedidos", json={"items": [{"variante_id": v.id, "cantidad": 10}], "nota": ""})
    assert r.status_code == 409, "sin pollo no se vende"

    r = client.post("/api/inventario/sustituciones", json={"original_id": pollo["id"], "sustituto_id": pavo["id"], "nota": "no llegó el pollo"})
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    assert [s["sustituto"] for s in client.get("/api/inventario/sustituciones").json()] == ["Pavo"]
    vender(client, v.id, 10)
    db.expire_all()
    # 10 × 70 g de guiso = 0,7 kg de guiso = 1 kg de pollo bruto = 0,7 kg útil = 0,875 kg de pavo bruto.
    assert round(db.get(models.Ingrediente, pavo["id"]).stock_actual, 3) == round(5 - 0.875, 3)
    assert db.get(models.Ingrediente, pollo["id"]).stock_actual == 0.2, "el pollo no se tocó"
    assert [r.ingrediente_id for r in db.query(models.RecetaItem).filter_by(variante_id=v.id)] == [g["id"]], "la receta sigue igual"

    assert client.delete(f"/api/inventario/sustituciones/{sid}").status_code == 200
    assert client.get("/api/inventario/sustituciones").json() == []
    from conftest import libros_cuadrados
    libros_cuadrados(client, db)


# ── tercera tanda (8-oct): merma, fusión, rendimiento, avisos, cantidades ────


def test_una_merma_mayor_que_el_stock_se_frena(client, db, libros):
    queso = alta(client, "Queso")
    comprar(client, "Q-1", [{"ingrediente_id": queso["id"], "cantidad": 2, "costo_unitario": 6}])
    r = client.post(f"/api/inventario/ingredientes/{queso['id']}/merma", json={"cantidad": 300, "motivo": "se dañó"})
    assert r.status_code == 409
    assert "¿Eran 300 g (0.3 kg)?" in r.json()["detail"]
    db.expire_all()
    assert db.get(models.Ingrediente, queso["id"]).stock_actual == 2
    assert client.post(f"/api/inventario/ingredientes/{queso['id']}/merma", json={"cantidad": 0.3}).status_code == 200
    # Confirmando, pasa (alguien sabe que el sistema estaba mal).
    assert client.post(f"/api/inventario/ingredientes/{queso['id']}/consumo-personal", json={"cantidad": 5}).status_code == 409
    assert client.post(f"/api/inventario/ingredientes/{queso['id']}/merma", json={"cantidad": 5, "forzar": True}).status_code == 200


def test_fusionar_stock_negativo_no_separa_libros_y_deposito(client, db, libros):
    from conftest import libros_cuadrados
    a = alta(client, "Pollo entero")
    b = alta(client, "Pollo")
    comprar(client, "N-1", [{"ingrediente_id": a["id"], "cantidad": 1, "costo_unitario": 4}, {"ingrediente_id": b["id"], "cantidad": 10, "costo_unitario": 5}])
    v = producto(db, "Asado", [(a["id"], 0.5)], 4)
    r = client.post("/api/pedidos", json={"items": [{"variante_id": v.id, "cantidad": 5}], "nota": "", "permitir_sin_stock": True})
    client.post(f"/api/pedidos/{r.json()['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})
    libros_cuadrados(client, db)
    assert client.post(f"/api/inventario/ingredientes/{a['id']}/fusionar", json={"destino_id": b["id"]}).status_code == 200
    db.expire_all()
    pb = db.get(models.Ingrediente, b["id"])
    assert pb.stock_actual == 8.5
    assert round(pb.stock_actual * pb.costo_unitario, 2) == 44.0, "50 - 1,5 kg a $4"
    libros_cuadrados(client, db)


def test_avisa_cuando_las_tandas_rinden_menos_que_la_ficha(client, db, libros):
    pollo = alta(client, "Pollo", rendimiento_pct=70)
    comprar(client, "R-1", [{"ingrediente_id": pollo["id"], "cantidad": 30, "costo_unitario": 4}])
    g = client.post("/api/inventario/preparaciones", json={"nombre": "Guiso", "unidad": "kg", "rinde": 1, "modo_produccion": "producir",
                                                          "lineas": [{"ingrediente_id": pollo["id"], "cantidad": 1}]}).json()
    for _ in range(3):
        client.post("/api/inventario/produccion", json={"preparacion_id": g["id"], "cantidad": 3.1, "usado": [{"ingrediente_id": pollo["id"], "cantidad": 5}]})
    r = client.get("/api/inventario/preparaciones/rendimientos").json()
    assert [(x["nombre"], x["crudo"], x["ficha_pct"], x["sugerido_pct"]) for x in r] == [("Guiso", "Pollo", 70, 62.0)]
    assert any(a["id"].startswith("rinde-") for a in client.get("/api/reportes/avisos").json())
    # Se ajusta la ficha: el aviso se va, aunque las tandas sean las mismas.
    ficha = client.get("/api/inventario/ingredientes").json()
    p = next(i for i in ficha if i["id"] == pollo["id"])
    assert client.put(f"/api/inventario/ingredientes/{pollo['id']}", json={**{k: p[k] for k in ("nombre", "unidad", "tipo", "stock_minimo", "stock_objetivo", "costo_unitario", "exento")}, "rendimiento_pct": 62}).status_code == 200
    assert client.get("/api/inventario/preparaciones/rendimientos").json() == []


def test_vencidas_y_reclamos_viejos_en_los_avisos(client, db, libros):
    import datetime
    from app.timeutils import ahora
    carne = alta(client, "Carne", rendimiento_pct=60)
    comprar(client, "V-1", [{"ingrediente_id": carne["id"], "cantidad": 10, "costo_unitario": 7}])
    m = client.post("/api/inventario/preparaciones", json={"nombre": "Mechada", "unidad": "kg", "rinde": 0.6, "modo_produccion": "producir",
                                                          "vida_util_horas": 48, "lineas": [{"ingrediente_id": carne["id"], "cantidad": 1}]}).json()
    client.post("/api/inventario/produccion", json={"preparacion_id": m["id"], "cantidad": 3, "usado": [{"ingrediente_id": carne["id"], "cantidad": 5}]})
    f = client.get("/api/compras/facturas").json()[0]
    client.post(f"/api/compras/facturas/{f['id']}/faltantes", json={"items": [{"ingrediente_id": carne["id"], "cantidad": 1}]})
    ids = {a["id"] for a in client.get("/api/reportes/avisos").json()}
    assert "vencidas" not in ids and "reclamos" not in ids
    for t in db.query(models.Produccion).all():
        t.fecha = ahora() - datetime.timedelta(hours=72)
    for r in db.query(models.ReclamoProveedor).all():
        r.fecha = ahora() - datetime.timedelta(days=10)
    db.commit()
    ids = {a["id"] for a in client.get("/api/reportes/avisos").json()}
    assert {"vencidas", "reclamos"} <= ids
    assert client.get("/api/compras/reclamos").json()[0]["dias"] == 10


def test_una_cantidad_rara_en_la_factura_avisa(client, db, libros):
    harina = alta(client, "Harina")
    comprar(client, "H-1", [{"ingrediente_id": harina["id"], "cantidad": 2, "costo_unitario": 26}])
    comprar(client, "H-2", [{"ingrediente_id": harina["id"], "cantidad": 3, "costo_unitario": 26}])
    def revisar(cantidad):
        return client.post("/api/compras/revision", json={"proveedor_rif": "J123456789", "numero_factura": "H-3",
                                                          "items": [{"indice": 0, "ingrediente_id": harina["id"], "costo_unitario": 26, "cantidad": cantidad}]}).json()["cantidades"]
    assert revisar(3) == []
    rara = revisar(20)
    assert rara and rara[0]["referencia"] == 2.5 and "Revisa la cantidad" in rara[0]["mensaje"]
    assert revisar(0.2)


# ── cuarta tanda (8-oct): inventario ─────────────────────────────────────────


def test_la_planilla_respeta_su_unidad(client, db, libros):
    queso = alta(client, "Queso")
    comprar(client, "P-1", [{"ingrediente_id": queso["id"], "cantidad": 1, "costo_unitario": 6}])
    def leer(unidad, contado):
        csv = f"ID;Insumo;Unidad;Contado\n{queso['id']};Queso;{unidad};{contado}\n".encode()
        return client.post("/api/inventario/conteos/leer-planilla", files={"archivo": ("c.csv", csv, "text/csv")}).json()
    assert leer("g", "850")["filas"][0]["contado"] == 0.85
    assert leer("kg", "0,85")["filas"][0]["contado"] == 0.85
    sin = leer("", "850")["filas"][0]
    assert sin["contado"] == 850 and "¿eran g?" in sin["aviso"]
    assert "se cuenta en kg" in leer("unidad", "3")["errores"][0]


def test_una_tanda_con_mas_crudo_del_que_hay_pide_confirmar(client, db, libros):
    pollo = alta(client, "Pollo", rendimiento_pct=70)
    comprar(client, "P-2", [{"ingrediente_id": pollo["id"], "cantidad": 3, "costo_unitario": 4}])
    g = client.post("/api/inventario/preparaciones", json={"nombre": "Guiso", "unidad": "kg", "rinde": 1, "modo_produccion": "producir",
                                                          "lineas": [{"ingrediente_id": pollo["id"], "cantidad": 1}]}).json()
    cuerpo = {"preparacion_id": g["id"], "cantidad": 3.5, "usado": [{"ingrediente_id": pollo["id"], "cantidad": 5}]}
    r = client.post("/api/inventario/produccion", json=cuerpo)
    assert r.status_code == 409 and r.json()["detail"].startswith("No alcanza: Pollo")
    db.expire_all()
    assert db.get(models.Ingrediente, pollo["id"]).stock_actual == 3
    assert client.post("/api/inventario/produccion", json={**cuerpo, "forzar": True}).status_code == 200


def _editar(client, iid, **cambios):
    f = next(i for i in client.get("/api/inventario/ingredientes").json() if i["id"] == iid)
    cuerpo = {k: f[k] for k in ("nombre", "unidad", "tipo", "stock_minimo", "stock_objetivo", "costo_unitario", "exento", "rendimiento_pct")}
    return client.put(f"/api/inventario/ingredientes/{iid}", json={**cuerpo, **cambios})


def test_pasar_a_desechable_con_stock_lo_manda_a_gasto(client, db, libros):
    from conftest import libros_cuadrados, saldo
    vaso = alta(client, "Vaso", unidad="unidad", tipo="consumible")
    comprar(client, "V-1", [{"ingrediente_id": vaso["id"], "cantidad": 80, "costo_unitario": 0.08}])
    r = _editar(client, vaso["id"], tipo="desechable")
    assert r.status_code == 409 and r.json()["detail"].startswith("Confirmar: quedan 80 unidad")
    antes = saldo(db, "6050")
    assert _editar(client, vaso["id"], tipo="desechable", confirmar=True).status_code == 200
    db.expire_all()
    assert db.get(models.Ingrediente, vaso["id"]).stock_actual == 0
    assert round(saldo(db, "6050") - antes, 2) == 6.4
    libros_cuadrados(client, db)
    # Si va en una receta, ni confirmando.
    jarra = alta(client, "Jarra", unidad="unidad", tipo="consumible")
    producto(db, "Limonada", [(jarra["id"], 1)])
    assert "va en la receta de Limonada" in _editar(client, jarra["id"], tipo="desechable", confirmar=True).json()["detail"]


def test_archivar_lo_que_lleva_una_receta_pide_confirmar(client, db, libros):
    cebolla = alta(client, "Cebolla")
    client.post("/api/inventario/preparaciones", json={"nombre": "Guiso", "unidad": "kg", "rinde": 1, "lineas": [{"ingrediente_id": cebolla["id"], "cantidad": 0.1}]})
    r = _editar(client, cebolla["id"], activo=False)
    assert r.status_code == 409 and "va en Guiso" in r.json()["detail"]
    assert _editar(client, cebolla["id"], activo=False, confirmar=True).status_code == 200
    suelta = alta(client, "Perejil")
    assert _editar(client, suelta["id"], activo=False).status_code == 200


def test_una_caja_distinta_no_cambia_lo_aprendido(client, db, libros):
    malta = alta(client, "Malta", unidad="unidad", tipo="reventa")
    def aprender(trae):
        client.post("/api/compras/equivalencias/aprender", json={"proveedor_rif": "J123456789", "renglones": [
            {"descripcion": "MALTA CAJA 24", "unidad": "CAJA", "cantidad_papel": 1, "precio_papel": 12, "ingrediente_id": malta["id"], "cantidad": trae, "costo_unitario": 12 / trae}]})
    def factor():
        return client.post("/api/compras/equivalencias/buscar", json={"proveedor_rif": "J123456789", "renglones": [{"descripcion": "MALTA CAJA 24", "unidad": "CAJA"}]}).json()[0]["factor"]
    aprender(24)
    aprender(24)
    aprender(20)
    assert factor() == 24, "una caja abierta no es la nueva regla"
    aprender(24)
    aprender(20)
    assert factor() == 24
    aprender(20)
    assert factor() == 20, "dos seguidas: el proveedor cambió la presentación"


def test_una_categoria_borrada_revive_con_su_mercancia(client, db, libros):
    cat = client.post("/api/inventario/categorias", json={"nombre": "Lácteos"}).json()
    for n in ("Queso", "Leche"):
        alta(client, n, categoria_id=cat["id"])
    client.delete(f"/api/inventario/categorias/{cat['id']}")
    otra = alta(client, "Crema")
    r = client.post("/api/inventario/categorias", json={"nombre": "lacteos"}).json()
    assert r["id"] == cat["id"] and r["usos"] == 2
    nombres = {i["nombre"]: i["categoria"] for i in client.get("/api/inventario/ingredientes").json()}
    assert nombres["Queso"] == "Lácteos" and nombres["Leche"] == "Lácteos" and not nombres["Crema"]
