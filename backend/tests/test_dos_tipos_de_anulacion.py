"""Anular guarda la decision de VERDAD, no una adivinanza.

Antes, Ventas mostraba "se preparo (perdida real)" mirando si algun item
quedo con `preparado=True` - pero quien anula puede corregir esa adivinanza
del sistema (la cocina hizo la comida sin tocar la casilla, o al reves), y
esa correccion se perdia: no quedaba guardada en ningun lado, asi que Ventas
la mostraba mal.
"""


def comanda(client, variante, cantidad=1):
    return client.post("/api/pedidos", json={
        "items": [{"variante_id": variante.id, "cantidad": cantidad}], "nota": "",
    }).json()


def test_anular_sin_preparar_queda_como_no_perdida(client, variante):
    p = comanda(client, variante)
    r = client.post(f"/api/pedidos/{p['id']}/anular", json={"comida_preparada": False})
    assert r.status_code == 200
    assert r.json()["anulado_es_perdida"] is False


def test_anular_preparado_queda_como_perdida(client, variante):
    p = comanda(client, variante)
    client.post(f"/api/pedidos/items/{p['items'][0]['id']}/preparado")
    r = client.post(f"/api/pedidos/{p['id']}/anular", json={"comida_preparada": True})
    assert r.status_code == 200
    assert r.json()["anulado_es_perdida"] is True


def test_la_correccion_manual_prevalece_sobre_la_adivinanza_del_sistema(client, variante):
    """El caso que antes se perdia: la cocina SI hizo la comida (item marcado
    preparado) pero quien anula sabe que en realidad no se toco -se marco el
    item por error- y corrige. Lo que se guarda es la correccion, no la
    marca de preparado."""
    p = comanda(client, variante)
    client.post(f"/api/pedidos/items/{p['items'][0]['id']}/preparado")
    r = client.post(f"/api/pedidos/{p['id']}/anular", json={"comida_preparada": False})
    assert r.status_code == 200
    assert r.json()["anulado_es_perdida"] is False


def test_un_pedido_no_anulado_no_tiene_veredicto(client, variante):
    p = comanda(client, variante)
    r = client.get("/api/pedidos")
    mio = next(x for x in r.json() if x["id"] == p["id"])
    assert mio["anulado_es_perdida"] is None


def test_se_ve_en_el_historial_de_ventas(client, variante):
    p = comanda(client, variante)
    client.post(f"/api/pedidos/{p['id']}/anular", json={"comida_preparada": True})
    fila = next(v for v in client.get("/api/ventas").json()["filas"] if v["id"] == p["id"])
    assert fila["anulado_es_perdida"] is True
