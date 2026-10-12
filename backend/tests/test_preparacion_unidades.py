"""La receta de una preparación es por UNO: lo que lleva 1 kg, 1 lt o 1 unidad (8-oct).

Antes era "una tanda" y lo que salía se calculaba sumando lo que quedaba de
cada crudo medido como la preparación; con leche en litros dentro de un guiso
en kilos la suma se quedaba corta y el costo salía inflado. Ahora no hay nada
que sumar: 1 kg cuesta lo que lleva, se mida como se mida.
"""


def alta(client, nombre, unidad="kg", **extra):
    r = client.post(
        "/api/inventario/ingredientes",
        json={"nombre": nombre, "unidad": unidad, "tipo": "insumo", "stock_actual": 10, "costo_unitario": 2.0, **extra},
    )
    assert r.status_code == 200, r.text
    return r.json()


def preparacion(client, nombre, unidad, lineas, **extra):
    r = client.post(
        "/api/inventario/preparaciones",
        json={"nombre": nombre, "unidad": unidad, "lineas": lineas, **extra},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_un_litro_de_jugo_cuesta_lo_que_lleva(client, libros):
    naranja = alta(client, "Naranja", rendimiento_pct=45)
    azucar = alta(client, "Azucar")
    jugo = preparacion(
        client, "Jugo de naranja", "lt",
        [{"ingrediente_id": naranja["id"], "cantidad": 2.2}, {"ingrediente_id": azucar["id"], "cantidad": 0.03}],
        rinde=1.8,  # se ignora: la receta ya es por litro
    )
    assert jugo["rinde"] == 1
    # 2,2 kg de naranja + 30 g de azucar a $2 = $4,46 el litro. El 45 % de la
    # naranja no se aplica otra vez: ya esta en los 2,2 kg.
    assert round(jugo["costo_unitario"], 2) == 4.46
    assert jugo["costo_tanda"] == jugo["costo_unitario"]


def test_la_leche_en_litros_cuenta_dentro_de_un_guiso_en_kilos(client, libros):
    pollo = alta(client, "Pollo", rendimiento_pct=70)
    leche = alta(client, "Leche", unidad="lt")
    cebolla = alta(client, "Cebolla", unidad="g")
    guiso = preparacion(
        client, "Guiso", "kg",
        [
            {"ingrediente_id": pollo["id"], "cantidad": 1},
            {"ingrediente_id": leche["id"], "cantidad": 0.5},
            {"ingrediente_id": cebolla["id"], "cantidad": 100},
        ],
    )
    # 1 kg x $2 + 0,5 lt x $2 + 100 g x $2 = $203 el kilo: cada cosa a su costo,
    # sin que la leche (en litros) se quede fuera de la cuenta.
    assert guiso["rinde"] == 1
    assert guiso["costo_unitario"] == 203.0
