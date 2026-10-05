"""La portada avisa sola: arranque y avisos.

Un local nuevo tiene que saber por donde empezar (las cinco cuentas del
arranque) y un local en marcha tiene que enterarse en la portada de lo que
antes habia que ir a buscar: que se acaba, que le deben, que no tiene receta.
"""
from app import kardex, models


def comanda(client, variante, cantidad=1, **extra):
    return client.post(
        "/api/pedidos",
        json={
            "items": [{"variante_id": variante.id, "cantidad": cantidad}],
            "nota": "",
            "permitir_sin_stock": True,
            **extra,
        },
    ).json()


def vender(client, variante, cantidad=1, metodo="Efectivo $", **extra):
    p = comanda(client, variante, cantidad, **extra)
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": metodo})
    assert r.status_code == 200, r.text
    return p


def arranque(client):
    r = client.get("/api/reportes/arranque")
    assert r.status_code == 200, r.text
    return r.json()


def avisos(client):
    r = client.get("/api/reportes/avisos")
    assert r.status_code == 200, r.text
    return r.json()


def test_arranque_empieza_en_cero_y_cuenta_cada_paso(client, db, insumo, variante):
    a = arranque(client)
    assert set(a) == {"productos", "con_receta", "mercancias", "ventas", "cierres"}
    # El fixture trae un producto con receta y un insumo; nada vendido.
    assert a["productos"] == 1
    assert a["con_receta"] == 1
    assert a["mercancias"] == 1
    assert a["ventas"] == 0
    assert a["cierres"] == 0

    vender(client, variante)
    assert arranque(client)["ventas"] == 1

    # Un producto sin receta suma a productos y no a con_receta.
    cat = client.post("/api/menu/categorias", json={"nombre": "Bebidas", "orden": 1}).json()
    client.post(
        "/api/menu/productos",
        json={"categoria_id": cat["id"], "nombre": "Malta", "variantes": [{"nombre": "Regular", "precio": 1.0}]},
    )
    a = arranque(client)
    assert a["productos"] == 2
    assert a["con_receta"] == 1


def test_avisos_es_una_lista_corta_y_ordenada(client, db, insumo, variante):
    vender(client, variante)
    lista = avisos(client)
    assert len(lista) <= 4
    orden = {"ojo": 0, "info": 1, "bien": 2}
    tonos = [orden[a["tono"]] for a in lista]
    assert tonos == sorted(tonos)
    for a in lista:
        assert a["titulo"]
        assert a["a"].startswith("/")


def test_avisa_lo_que_se_acaba(client, db, insumo, variante):
    """Un insumo que se consume y no alcanza para la semana sale en la portada,
    con el dia en que se acaba y sin la palabra 'stock'."""
    # Se venden 20 hoy: 2 kg en 14 dias de ventana = 0.143 kg/dia...
    vender(client, variante, cantidad=20)
    # ...y se deja en el deposito lo justo para dos dias de ese ritmo.
    db.refresh(insumo)
    ritmo = 20 * 0.1 / 0.8 / 14
    kardex.anotar(db, insumo, -(insumo.stock_actual) + ritmo * 2, kardex.AJUSTE, origen="conteo", nota="prueba")
    db.commit()

    lista = avisos(client)
    mio = next((a for a in lista if a["id"] == "se-acaba"), None)
    assert mio is not None, lista
    assert "Carne molida" in mio["titulo"]
    assert "se te acaba" in mio["titulo"]
    assert "stock" not in mio["titulo"].lower()
    assert mio["a"] == "/inventario/comprar"


def test_lo_que_no_se_mueve_no_se_acaba(client, db, insumo, variante):
    """Sin consumo medido no hay aviso: un insumo quieto con poco stock no es
    urgente, es un insumo que no se usa."""
    assert not any(a["id"] in ("se-acaba", "agotados") for a in avisos(client))


def test_avisa_lo_que_le_deben(client, db, insumo, variante):
    vender(client, variante, metodo="Fiado", cliente="Pedro")
    lista = avisos(client)
    fiado = next((a for a in lista if a["id"] == "fiado"), None)
    assert fiado is not None, lista
    assert fiado["titulo"].startswith("Te deben $5.00")
    assert fiado["a"] == "/ventas?e=fiada&r=90d"


def test_producto_sin_receta_vendido_este_mes(client, db):
    cat = client.post("/api/menu/categorias", json={"nombre": "Bebidas", "orden": 1}).json()
    prod = client.post(
        "/api/menu/productos",
        json={"categoria_id": cat["id"], "nombre": "Malta", "variantes": [{"nombre": "Regular", "precio": 1.5}]},
    ).json()
    v = db.get(models.Variante, prod["variantes"][0]["id"])
    vender(client, v)
    lista = avisos(client)
    a = next((x for x in lista if x["id"] == "sin-receta"), None)
    assert a is not None, lista
    assert a["titulo"] == "1 producto que vendes no tiene receta"
    assert "$1.50" in a["detalle"]
    assert a["a"] == "/menu/recetas"
