"""Quien tocó el inventario.

Las ventas ya anotaban el operador desde que existe el login. La merma, el
conteo y el consumo del personal -justo los tres movimientos que un dueno
querria poder auditar, porque son los que no tienen un cliente del otro lado-
eran los unicos sin firma.
"""


def extracto(client, ing_id):
    return client.get("/api/inventario/ingredientes/{}/movimientos".format(ing_id)).json()


def movimiento(client, ing_id, tipo):
    return next(m for m in extracto(client, ing_id)["movimientos"] if m["tipo"] == tipo)


def test_la_merma_dice_quien_la_registro(client, insumo):
    client.post("/api/inventario/ingredientes/{}/merma".format(insumo.id),
                json={"cantidad": 0.5, "motivo": "se quemo"})
    m = movimiento(client, insumo.id, "merma")
    assert m["operador"], "una merma sin autor no se puede auditar"


def test_el_conteo_dice_quien_conto(client, insumo):
    client.post("/api/inventario/conteo", json={
        "items": [{"ingrediente_id": insumo.id, "stock_real": 3.0}],
        "motivo": "conteo del lunes",
    })
    m = movimiento(client, insumo.id, "ajuste")
    assert m["operador"], "un ajuste de existencias sin autor es un cheque en blanco"


def test_el_consumo_del_personal_dice_quien_comio(client, insumo):
    client.post("/api/inventario/ingredientes/{}/consumo-personal".format(insumo.id),
                json={"cantidad": 0.2, "motivo": "almuerzo"})
    m = movimiento(client, insumo.id, "consumo_personal")
    assert m["operador"]


def test_el_ajuste_de_una_sola_ficha_tambien_firma(client, insumo):
    """Contar desde la ficha del insumo y contar en lote son dos caminos al
    mismo hecho; los dos tienen que dejar el mismo rastro."""
    client.post("/api/inventario/ingredientes/{}/ajustar".format(insumo.id),
                json={"stock_real": 2.0, "motivo": "recuento"})
    m = movimiento(client, insumo.id, "ajuste")
    assert m["operador"]
