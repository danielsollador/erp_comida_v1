"""Cuentas por cobrar: PedidosYa paga la semana de una vez, ya sin su comision.

Antes habia que partir el deposito en un abono por pedido y la comision no
tenia donde ir. Lo que se prueba es que los libros sigan diciendo la verdad:
1015 baja por todo lo que se debia, el banco sube por lo que llego y la
diferencia es gasto de comision, no una deuda eterna ni un descuento falso.
"""
from app import models
from tests.conftest import libros_cuadrados, saldo


def fiar(client, variante, cantidad=2, cliente="PedidosYa"):
    """Una venta a credito. Con cantidad=2 son $10."""
    p = client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": cantidad}], "nota": ""},
    ).json()
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Fiado", "cliente": cliente})
    assert r.status_code == 200, r.text
    return p


def alta(client, nombre="PedidosYa", **extra):
    r = client.post("/api/cobranzas/clientes", json={"nombre": nombre, "tipo": "plataforma", **extra})
    assert r.status_code == 200, r.text
    return r.json()


def test_al_crear_la_ficha_entran_los_fiados_que_ya_tenia(client, variante):
    fiar(client, variante, cliente="Pedidos ya")
    fiar(client, variante, cliente="PEDIDOSYA")
    alta(client)
    r = client.get("/api/cobranzas/resumen").json()
    py = next(c for c in r["clientes"] if c["nombre"] == "PedidosYa")
    assert py["saldo"] == 20.0 and py["ventas"] == 2
    assert r["sin_ficha"] == []


def test_fiar_con_el_nombre_de_una_ficha_entra_en_su_cuenta(client, db, variante):
    c = alta(client)
    p = fiar(client, variante, cliente="pedidos ya")
    assert db.get(models.Pedido, p["id"]).cliente_id == c["id"]


def test_no_se_duplica_un_cliente(client):
    alta(client)
    assert client.post("/api/cobranzas/clientes", json={"nombre": "Pedidos Ya"}).status_code == 409


def test_cobro_agrupado_con_comision(client, db, libros, variante):
    c = alta(client, comision_pct=20)
    p1 = fiar(client, variante)
    p2 = fiar(client, variante)
    banco_antes = saldo(db, "1020")
    r = client.post("/api/cobranzas/cobros", json={
        "cliente_id": c["id"], "pedido_ids": [p1["id"], p2["id"]],
        "metodo_pago": "Transferencia", "referencia": "123456", "comision": 4.0,
    })
    assert r.status_code == 200, r.text
    cobro = r.json()
    assert cobro["monto"] == 20.0 and cobro["recibido"] == 16.0

    db.expire_all()
    assert saldo(db, "1015") == 0.0, "ya no se debe nada"
    assert round(saldo(db, "1020") - banco_antes, 2) == 16.0, "al banco entro lo que llego"
    assert saldo(db, "6130") == 4.0, "la comision es gasto"
    assert all(db.get(models.Pedido, p["id"]).fiado_saldado for p in (p1, p2))
    libros_cuadrados(client, db)

    estado = client.get(f"/api/cobranzas/clientes/{c['id']}/estado").json()
    assert estado["saldo"] == 0.0
    assert [m["tipo"] for m in estado["movimientos"]] == ["venta", "venta", "cobro"]
    assert estado["movimientos"][-1]["saldo"] == 0.0


def test_anular_el_cobro_deja_todo_como_antes(client, db, libros, variante):
    c = alta(client)
    p = fiar(client, variante)
    banco_antes = saldo(db, "1020")
    cobro = client.post("/api/cobranzas/cobros", json={
        "cliente_id": c["id"], "pedido_ids": [p["id"]], "metodo_pago": "Transferencia",
        "referencia": "9", "comision": 2.0,
    }).json()
    r = client.post(f"/api/cobranzas/cobros/{cobro['id']}/anular")
    assert r.status_code == 200, r.text
    db.expire_all()
    assert saldo(db, "1015") == 10.0
    assert saldo(db, "1020") == banco_antes
    assert saldo(db, "6130") == 0.0
    assert not db.get(models.Pedido, p["id"]).fiado_saldado
    assert client.post(f"/api/cobranzas/cobros/{cobro['id']}/anular").status_code == 409
    libros_cuadrados(client, db)


def test_cobro_por_banco_pide_referencia(client, variante):
    c = alta(client)
    p = fiar(client, variante)
    r = client.post("/api/cobranzas/cobros", json={
        "cliente_id": c["id"], "pedido_ids": [p["id"]], "metodo_pago": "Pago movil",
    })
    assert r.status_code == 400


def test_no_se_cobra_una_venta_de_otro_cliente(client, variante):
    py = alta(client)
    alta(client, nombre="Oficina Torre Sur")
    p = fiar(client, variante, cliente="Oficina Torre Sur")
    r = client.post("/api/cobranzas/cobros", json={
        "cliente_id": py["id"], "pedido_ids": [p["id"]], "metodo_pago": "Efectivo Bs",
    })
    assert r.status_code == 409


def test_la_comision_no_se_come_todo_el_cobro(client, variante):
    c = alta(client)
    p = fiar(client, variante)
    r = client.post("/api/cobranzas/cobros", json={
        "cliente_id": c["id"], "pedido_ids": [p["id"]], "metodo_pago": "Efectivo Bs", "comision": 10.0,
    })
    assert r.status_code == 400


def test_una_venta_cobrada_en_grupo_no_se_devuelve_sin_anular_el_cobro(client, variante):
    c = alta(client)
    p = fiar(client, variante)
    client.post("/api/cobranzas/cobros", json={
        "cliente_id": c["id"], "pedido_ids": [p["id"]], "metodo_pago": "Efectivo Bs",
    })
    r = client.post(f"/api/pedidos/{p['id']}/devolver", json={"motivo": "llegó frío"})
    assert r.status_code == 409
    assert "Anula ese cobro" in r.json()["detail"]


def test_asignar_un_fiado_suelto_a_un_cliente(client, db, variante):
    c = alta(client)
    p = fiar(client, variante, cliente="El motorizado de PY")
    assert client.get("/api/cobranzas/resumen").json()["sin_ficha"][0]["pedido_id"] == p["id"]
    assert client.post(f"/api/cobranzas/ventas/{p['id']}/cliente", json={"cliente_id": c["id"]}).status_code == 200
    r = client.get("/api/cobranzas/resumen").json()
    assert r["sin_ficha"] == []
    assert next(x for x in r["clientes"] if x["id"] == c["id"])["saldo"] == 10.0


def test_vencido_segun_el_plazo(client, db, variante):
    import datetime
    c = alta(client, dias_credito=7)
    p = fiar(client, variante)
    pedido = db.get(models.Pedido, p["id"])
    pedido.cerrado_en = pedido.cerrado_en - datetime.timedelta(days=10)
    db.commit()
    fila = next(x for x in client.get("/api/cobranzas/resumen").json()["clientes"] if x["id"] == c["id"])
    assert fila["vencido"] == 10.0 and fila["mas_vieja_dias"] >= 10
