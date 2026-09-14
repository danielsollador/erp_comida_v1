"""Tier 3: los numeros que mentian.

Agrupar por nombre en vez de por producto, evaluar el pasado con las recetas de
hoy, y promediar sin decir que un solo pedido movio el promedio.
"""

from app import models


def comanda(client, variante, cantidad=1):
    return client.post(
        "/api/pedidos",
        json={
            "items": [{"variante_id": variante.id, "cantidad": cantidad}],
            "nota": "",
            # Un catering se vende aunque el conteo diga que no alcanza: el
            # caso que se esta probando son los promedios, no el stock.
            "permitir_sin_stock": True,
        },
    ).json()


def vender(client, variante, cantidad=1):
    p = comanda(client, variante, cantidad)
    return client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"}).json()


def top(client):
    return client.get("/api/reportes/resumen?periodo=dia").json()["top_productos"]


# --------------------------------------- H90/H91: agrupar por producto, no por nombre
def test_dos_productos_con_el_mismo_nombre_no_se_funden(client, db, insumo, variante):
    """Uno en Desayuno a $10 con 2% de costo y otro en Merienda a $4 con 25%:
    fundidos daban un margen de 96.3% que no era el de ninguno."""
    otra_cat = models.Categoria(nombre="Merienda", orden=1)
    db.add(otra_cat)
    db.flush()
    otro_prod = models.Producto(categoria_id=otra_cat.id, nombre=variante.producto.nombre)
    db.add(otro_prod)
    db.flush()
    gemela = models.Variante(producto_id=otro_prod.id, nombre=variante.nombre, precio=2.0)
    db.add(gemela)
    db.flush()
    db.add(
        models.RecetaItem(variante_id=gemela.id, ingrediente_id=insumo.id, cantidad_por_unidad=0.2)
    )
    db.commit()

    vender(client, variante, cantidad=2)  # $5 c/u
    vender(client, gemela, cantidad=1)  # $2

    filas = top(client)
    assert len(filas) == 2, "dos productos distintos, dos lineas"
    assert sorted(f["ingresos"] for f in filas) == [2.0, 10.0]


def test_renombrar_un_producto_no_parte_su_historico(client, db, variante):
    vender(client, variante, cantidad=2)
    variante.producto.nombre = "Empanadita"
    db.commit()
    vender(client, variante, cantidad=1)

    filas = top(client)
    assert len(filas) == 1, "sigue siendo el mismo producto"
    assert filas[0]["unidades"] == 3
    assert filas[0]["nombre"].startswith("Empanadita"), "se muestra con el nombre de hoy"


# --------------------------------------- H93/H94: el pasado no se juzga con las recetas de hoy
def test_borrar_la_receta_no_reescribe_el_margen_de_lo_ya_vendido(client, db, insumo, variante):
    """Esas ventas SI tuvieron costo congelado: marcarlas 'sin receta' y su
    margen en 0% es reescribir la historia."""
    vender(client, variante, cantidad=10)
    antes = top(client)[0]
    assert antes["costo"] > 0 and antes["sin_receta"] is False
    margen_real = antes["margen_pct"]

    client.put(f"/api/inventario/recetas/{variante.id}", json=[])

    despues = top(client)[0]
    assert despues["costo"] == antes["costo"]
    assert despues["margen_pct"] == margen_real
    assert despues["sin_receta"] is False


def test_cargar_una_receta_hoy_no_vuelve_confiable_una_venta_sin_costo(
    client, db, insumo, variante
):
    """El error peor de los dos: presentaba como dato bueno un 100% inventado."""
    prod = variante.producto
    sin_receta = models.Variante(producto_id=prod.id, nombre="Pollo", precio=8.0)
    db.add(sin_receta)
    db.commit()

    vender(client, sin_receta, cantidad=5)
    fila = next(f for f in top(client) if "Pollo" in f["nombre"])
    assert fila["sin_receta"] is True

    client.put(
        f"/api/inventario/recetas/{sin_receta.id}",
        json=[{"ingrediente_id": insumo.id, "cantidad_por_unidad": 0.3}],
    )

    fila = next(f for f in top(client) if "Pollo" in f["nombre"])
    assert fila["costo"] == 0.0, "esas ventas nunca tuvieron costo"
    assert fila["sin_receta"] is True, "y hay que seguir diciendolo"


# --------------------------------------- H100/H101: promedios que un solo pedido rompe
def test_la_mediana_describe_el_mostrador_cuando_el_promedio_no(client, variante):
    """40 ventas de $5 y un catering: el promedio se va, la mediana no."""
    for _ in range(40):
        vender(client, variante, cantidad=1)  # $5
    vender(client, variante, cantidad=100)  # $500

    r = client.get("/api/reportes/resumen?periodo=dia").json()
    assert r["ticket_promedio"] > 15.0, "el promedio se disparo"
    assert r["ticket_mediano"] == 5.0, "la mediana sigue diciendo la verdad"


def test_se_avisa_cuando_un_pedido_domina_el_dia(client, variante):
    for _ in range(10):
        vender(client, variante, cantidad=1)
    vender(client, variante, cantidad=100)

    insights = client.get("/api/reportes/resumen?periodo=dia").json()["insights"]
    aviso = next((i for i in insights if "un solo pedido" in i["titulo"].lower()), None)
    assert aviso is not None
    assert "mediana" in aviso["detalle"]


def test_un_dia_parejo_no_dispara_el_aviso(client, variante):
    for _ in range(10):
        vender(client, variante, cantidad=1)
    insights = client.get("/api/reportes/resumen?periodo=dia").json()["insights"]
    assert not any("un solo pedido" in i["titulo"].lower() for i in insights)


def test_la_mejor_hora_se_decide_por_clientes_no_por_monto(client, db, variante):
    """Es el dato con el que se decide cuando reforzar personal: una hora con
    un catering le ganaba a una hora con treinta clientes."""
    import datetime

    def mover(pedido_id, hora):
        p = db.query(models.Pedido).filter_by(id=pedido_id).first()
        cuando = datetime.datetime.now().replace(hour=hora, minute=0, second=0, microsecond=0)
        p.cerrado_en = cuando
        for a in db.query(models.AsientoContable).filter_by(
            origen="venta", referencia_id=p.id
        ).all():
            a.fecha = cuando
        db.commit()

    for _ in range(12):  # las 13:00, mucha gente
        mover(vender(client, variante, cantidad=1)["id"], 13)
    mover(vender(client, variante, cantidad=100)["id"], 17)  # las 17:00, un catering

    insights = client.get("/api/reportes/resumen?periodo=dia").json()["insights"]
    mejor = next(i for i in insights if i["titulo"].startswith("Mejor hora"))
    assert "13:00" in mejor["titulo"], "gana la hora con mas clientes"
    assert "17:00" in mejor["detalle"], "pero se menciona la de mas facturacion"


# --------------------------------------- H109: error de unidad
def test_comprar_un_saco_tecleado_como_1_levanta_sospecha(client, insumo):
    """50x el precio anterior no es inflacion: es un saco de 50 kg tecleado
    como 1. El menu pasaba a decir que vendes a perdida algo que deja 96%."""
    r = client.post(
        f"/api/inventario/ingredientes/{insumo.id}/comprar",
        json={"cantidad": 1, "costo_total": 400.0},  # $400/kg contra $8 que tenia
    ).json()

    assert r["posible_error_de_unidad"] is not None
    assert "saco" in r["posible_error_de_unidad"]


def test_una_subida_creible_no_levanta_sospecha_de_unidad(client, insumo):
    """Duplicarse es carisimo pero posible; no hay que gritar 'error'."""
    r = client.post(
        f"/api/inventario/ingredientes/{insumo.id}/comprar",
        json={"cantidad": 5, "costo_total": 80.0},  # $16/kg contra $8
    ).json()

    assert r["posible_error_de_unidad"] is None
    assert r["revisar_precios"] is True, "pero si hay que revisar precios"
