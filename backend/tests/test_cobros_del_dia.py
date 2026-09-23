"""El detalle de la columna "Entró": cobro por cobro, con su referencia.

El cierre dice cuanto falta en el punto; con esto se ve CUAL ticket fue,
poniendo la lista al lado del lote que imprime el terminal.
"""


def vender(client, variante, metodo, referencia=None, cliente="Ana", cantidad=1):
    p = client.post("/api/pedidos", json={
        "items": [{"variante_id": variante.id, "cantidad": cantidad}], "cliente": cliente,
    }).json()
    cuerpo = {"metodo_pago": metodo}
    if referencia is not None:
        cuerpo["referencia"] = referencia
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json=cuerpo)
    assert r.status_code == 200, r.text
    return r.json()


def test_cada_cobro_sale_con_su_referencia(client, variante):
    a = vender(client, variante, "Punto de venta", "000123", cliente="Ana")
    vender(client, variante, "Efectivo Bs", cliente="Beto")

    cobros = client.get("/api/caja/cobros").json()
    punto = [c for c in cobros if c["metodo"] == "Punto de venta"]
    assert len(punto) == 1
    assert punto[0]["numero"] == a["numero"]
    assert punto[0]["cliente"] == "Ana"
    assert punto[0]["referencia"] == "000123"
    assert punto[0]["monto"] == 5.0
    assert punto[0]["repetida"] is False
    assert any(c["metodo"] == "Efectivo Bs" and c["cliente"] == "Beto" for c in cobros)


def test_suma_lo_mismo_que_el_desglose(client, variante):
    vender(client, variante, "Pago movil", "111", cantidad=2)
    vender(client, variante, "Pago movil", "222")

    cobros = client.get("/api/caja/cobros").json()
    total = sum(c["monto"] for c in cobros if c["metodo"] == "Pago movil")
    resumen = client.get("/api/caja/resumen").json()
    fila = next(l for l in resumen["desglose"] if l["metodo"] == "Pago movil")
    assert round(total, 2) == fila["ventas"] == 15.0


def test_la_misma_referencia_dos_veces_se_marca(client, variante):
    """Casi siempre es un pago anotado dos veces, o una referencia copiada
    de la venta anterior: justo lo que no cuadra al final del dia."""
    vender(client, variante, "Pago movil", "4455")
    vender(client, variante, "Pago movil", "4455")
    vender(client, variante, "Pago movil", "9999")

    cobros = [c for c in client.get("/api/caja/cobros").json() if c["metodo"] == "Pago movil"]
    assert sorted(c["repetida"] for c in cobros) == [False, True, True]


def test_las_devueltas_no_salen(client, variante):
    v = vender(client, variante, "Punto de venta", "777")
    r = client.post(f"/api/pedidos/{v['id']}/devolver", json={"recuperable": True})
    assert r.status_code == 200, r.text
    assert client.get("/api/caja/cobros").json() == []
