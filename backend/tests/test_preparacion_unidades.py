"""Lo que rinde una preparación cuando lo que lleva se mide distinto (7-oct).

El jugo de naranja se mide en litros y se hace con kilos de naranja: no hay
forma de sumar kilos a litros, así que lo que sale de la tanda lo escribe la
cocina. Y 500 g de cebolla sí suman 0,5 kg a un guiso que se mide en kg.
"""


def alta(client, nombre, unidad="kg", **extra):
    r = client.post(
        "/api/inventario/ingredientes",
        json={"nombre": nombre, "unidad": unidad, "tipo": "insumo", "stock_actual": 10, "costo_unitario": 2.0, **extra},
    )
    assert r.status_code == 200, r.text
    return r.json()


def preparacion(client, nombre, unidad, rinde, lineas):
    r = client.post(
        "/api/inventario/preparaciones",
        json={"nombre": nombre, "unidad": unidad, "rinde": rinde, "lineas": lineas},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_jugo_en_litros_hecho_de_kilos_usa_lo_que_escribio_la_cocina(client, libros):
    naranja = alta(client, "Naranja", rendimiento_pct=45)
    azucar = alta(client, "Azucar")
    jugo = preparacion(
        client, "Jugo de naranja", "lt", 1.8,
        [{"ingrediente_id": naranja["id"], "cantidad": 4}, {"ingrediente_id": azucar["id"], "cantidad": 0.05}],
    )
    assert jugo["rinde"] == 1.8
    # 4 kg de naranja + 50 g de azucar a $2 = $8,10 la tanda, que da 1,8 lt.
    assert round(jugo["costo_unitario"], 2) == round(8.1 / 1.8, 2)


def test_los_gramos_suman_a_una_preparacion_en_kilos(client, libros):
    pollo = alta(client, "Pollo", rendimiento_pct=70)
    cebolla = alta(client, "Cebolla", unidad="g")
    guiso = preparacion(
        client, "Guiso", "kg", 9,
        [{"ingrediente_id": pollo["id"], "cantidad": 1}, {"ingrediente_id": cebolla["id"], "cantidad": 500}],
    )
    # 1 kg de pollo al 70 % + 500 g de cebolla = 0,7 + 0,5 kg.
    assert guiso["rinde"] == 1.2
