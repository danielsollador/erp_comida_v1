"""Los filtros de Reportes (Leider, 30-sep: "que la gente pueda filtrar por
la categoria de su producto y hasta por su producto").

Resumen, Ventas y combos se filtran por el MENU: una categoria o un producto.
Lo que se cuenta son los renglones de eso --la venta es la de esos
renglones, el pedido cuenta si lleva alguno-- y lo que es del pedido entero
(como se pago, lo anulado) no se reparte. Perdidas e Inventario se filtran
por el DEPOSITO: un cajon o una mercancia.
"""
from app import kardex, models

from tests.test_reportes_graficos import cobrar
from tests.test_reportes_perdidas_inventario import merma


def pedido(client, *renglones):
    r = client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": v.id, "cantidad": n} for v, n in renglones], "nota": ""},
    )
    assert r.status_code == 200, r.text
    p = r.json()
    cobrar(client, p["id"])
    return p


def refresco_de(db):
    """Un producto de otra categoria: Bebidas > Refresco a $2, sin receta."""
    cat = models.Categoria(nombre="Bebidas", orden=1, bebida=True)
    db.add(cat)
    db.flush()
    prod = models.Producto(categoria_id=cat.id, nombre="Refresco")
    db.add(prod)
    db.flush()
    v = models.Variante(producto_id=prod.id, nombre="Regular", precio=2.0)
    db.add(v)
    db.commit()
    db.refresh(v)
    return v


def resumen(client, **filtro):
    extra = "".join(f"&{k}={v}" for k, v in filtro.items())
    r = client.get(f"/api/reportes/resumen?periodo=dia{extra}")
    assert r.status_code == 200, r.text
    return r.json()


# ── Por producto y por categoria del menu ────────────────────────────────────


def test_filtrar_por_producto_cuenta_solo_sus_renglones(client, db, variante):
    refresco = refresco_de(db)
    pedido(client, (variante, 2), (refresco, 1))  # $10 + $2
    pedido(client, (refresco, 1))  # $2

    todo = resumen(client)
    assert todo["ventas"] == 14.0
    assert todo["pedidos"] == 2
    assert todo["unidades"] == 4
    assert todo["filtro"] is None

    r = resumen(client, producto_id=refresco.producto_id)
    assert r["ventas"] == 4.0
    assert r["pedidos"] == 2  # los dos pedidos llevan refresco
    assert r["unidades"] == 2
    assert r["ticket_promedio"] == 2.0
    assert r["filtro"] == {
        "categoria_id": None,
        "categoria": "",
        "producto_id": refresco.producto_id,
        "producto": "Refresco",
    }
    assert [p["nombre"] for p in r["top_productos"]] == ["Refresco"]
    assert r["top_productos"][0]["producto_id"] == refresco.producto_id
    assert r["top_productos"][0]["categoria"] == "Bebidas"
    assert sum(pt["ventas"] for pt in r["serie"]) == 4.0
    # Lo que es del pedido entero no se reparte entre sus renglones.
    assert r["por_metodo_pago"] == {}
    assert r["facturadas"] == 0 and r["iva_cobrado"] == 0

    e = resumen(client, producto_id=variante.producto_id)
    assert e["ventas"] == 10.0
    assert e["pedidos"] == 1
    assert e["unidades"] == 2


def test_filtrar_por_categoria_y_la_ganancia_es_venta_menos_mercancia(client, db, variante):
    refresco = refresco_de(db)
    pedido(client, (variante, 2), (refresco, 1))
    comida = db.get(models.Producto, variante.producto_id).categoria_id

    r = resumen(client, categoria_id=comida)
    assert r["ventas"] == 10.0
    assert r["filtro"]["categoria"] == "Comida"
    assert r["filtro"]["producto_id"] is None
    # Sin contabilidad de por medio: lo que deja es lo vendido menos la
    # mercancia de esos renglones, y no hay gastos ni IVA "de la comida".
    assert r["costo_insumos"] == r["top_productos"][0]["costo"] > 0
    assert r["gastos"] == 0
    assert r["ganancia_neta"] == round(r["ventas"] - r["costo_insumos"], 2)
    assert r["ganancia_bruta"] == r["ganancia_neta"]
    assert r["por_categoria"] == [
        {"nombre": "Comida", "ventas": 10.0, "pedidos": 1, "pct": 100.0, "promedio": None, "id": comida}
    ]
    # Y no se opina de lo que es del negocio entero.
    titulos = " ".join(i["titulo"] for i in r["insights"])
    assert "gastos" not in titulos.lower()
    assert "merma" not in titulos.lower()
    assert r["consolidado_en"] is None

    # Una categoria sin ventas: todo en cero, sin romperse.
    vacia = resumen(client, categoria_id=db.get(models.Producto, refresco.producto_id).categoria_id + 100)
    assert vacia["ventas"] == 0 and vacia["pedidos"] == 0 and vacia["top_productos"] == []


def test_sin_filtro_el_resumen_trae_el_id_de_cada_categoria_y_producto(client, db, variante):
    pedido(client, (variante, 1))
    r = resumen(client)
    comida = db.get(models.Producto, variante.producto_id).categoria_id
    assert next(g for g in r["por_categoria"] if g["nombre"] == "Comida")["id"] == comida
    assert r["top_productos"][0]["producto_id"] == variante.producto_id
    assert r["top_productos"][0]["categoria"] == "Comida"


def test_combos_filtrados_miran_los_pedidos_que_llevan_eso(client, db, variante):
    refresco = refresco_de(db)
    for _ in range(3):
        pedido(client, (refresco, 1))
    pedido(client, (variante, 1), (refresco, 1))

    todo = client.get("/api/reportes/combos?periodo=dia").json()
    assert todo["pedidos_analizados"] == 4
    assert todo["filtro"] is None

    r = client.get(f"/api/reportes/combos?periodo=dia&producto_id={variante.producto_id}").json()
    assert r["pedidos_analizados"] == 1
    assert r["filtro"]["producto"] == "Empanada"


# ── Por cajon y por mercancia del deposito ───────────────────────────────────


def azucar_de(db, categoria_id=None):
    otro = models.Ingrediente(
        nombre="Azucar", unidad="kg", stock_actual=0, stock_minimo=0, stock_objetivo=0,
        costo_unitario=2.0, rendimiento_pct=100.0, categoria_id=categoria_id,
    )
    db.add(otro)
    db.flush()
    kardex.anotar(db, otro, 5.0, kardex.AJUSTE, origen="apertura_kardex", nota="Existencia al empezar")
    db.commit()
    db.refresh(otro)
    return otro


def test_perdidas_por_mercancia_y_por_cajon(client, db, insumo):
    carnes = models.CategoriaInsumo(nombre="Carnes")
    db.add(carnes)
    db.flush()
    insumo.categoria_id = carnes.id
    db.commit()
    azucar = azucar_de(db)
    merma(client, insumo, 1.0, "se dano")  # 1 kg a $8
    merma(client, azucar, 2.0, "se mojo")  # 2 kg a $2

    todo = client.get("/api/reportes/perdidas?periodo=dia").json()
    assert todo["merma"] == 12.0
    assert todo["filtro"] is None

    r = client.get(f"/api/reportes/perdidas?periodo=dia&ingrediente_id={azucar.id}").json()
    assert r["merma"] == 4.0
    assert r["registros"] == 1
    assert [p["nombre"] for p in r["por_insumo"]] == ["Azucar"]
    assert [m["motivo"] for m in r["por_motivo"]] == ["se mojo"]
    assert [d["ingrediente_nombre"] for d in r["detalle"]] == ["Azucar"]
    assert r["sin_merma"] == 0
    assert r["filtro"] == {"categoria_id": None, "categoria": "", "ingrediente_id": azucar.id, "ingrediente": "Azucar"}

    c = client.get(f"/api/reportes/perdidas?periodo=dia&categoria_id={carnes.id}").json()
    assert c["merma"] == 8.0
    assert c["filtro"]["categoria"] == "Carnes"


def test_inventario_por_cajon(client, db, insumo):
    carnes = models.CategoriaInsumo(nombre="Carnes")
    db.add(carnes)
    db.flush()
    insumo.categoria_id = carnes.id
    db.commit()
    azucar_de(db)  # 5 kg a $2 = $10

    todo = client.get("/api/reportes/inventario?periodo=mes").json()
    assert todo["valor_total"] == 90.0  # 10 kg de carne a $8 + el azucar
    assert todo["activos"] == 2

    r = client.get(f"/api/reportes/inventario?periodo=mes&categoria_id={carnes.id}").json()
    assert [i["nombre"] for i in r["por_insumo"]] == ["Carne molida"]
    assert r["valor_total"] == 80.0
    assert r["activos"] == 1
    assert r["por_insumo"][0]["pct"] == 100.0
    assert r["filtro"]["categoria"] == "Carnes"
    assert all(s["ingrediente_id"] == insumo.id for s in r["por_comprar"])

    # Un cajon vacio no rompe nada.
    vacio = client.get(f"/api/reportes/inventario?periodo=mes&categoria_id={carnes.id + 100}").json()
    assert vacio["valor_total"] == 0 and vacio["activos"] == 0 and vacio["por_insumo"] == []
