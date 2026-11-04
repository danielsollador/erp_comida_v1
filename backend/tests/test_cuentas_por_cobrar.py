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


def _abonar(client, pedidos, monto, **extra):
    return client.post("/api/cobranzas/abonos", json={
        "pedido_ids": [p["id"] for p in pedidos], "monto": monto, "metodo_pago": "Efectivo $", **extra,
    })


def test_el_resumen_trae_todas_las_ventas_que_se_deben_sin_crear_clientes(client, variante):
    """3-nov: sin clientes creados no habia nada que seleccionar en la pantalla."""
    fiar(client, variante, cliente="Ana")
    fiar(client, variante, cliente="Luis")
    r = client.get("/api/cobranzas/resumen").json()
    assert r["clientes"] == []
    assert sorted(v["cliente"] for v in r["ventas"]) == ["Ana", "Luis"]
    assert r["total"] == 20.0


def test_abonar_a_las_ventas_marcadas_empieza_por_la_mas_vieja(client, db, variante, libros):
    vieja = fiar(client, variante, cliente="Ana")
    nueva = fiar(client, variante, cliente="Ana")
    otra = fiar(client, variante, cliente="Ana")
    gaveta = saldo(db, "1011")
    r = _abonar(client, [vieja, nueva], 12.0)
    assert r.status_code == 200, r.text
    db.expire_all()
    assert round(saldo(db, "1011") - gaveta, 2) == 12.0, "entra a la gaveta lo que pagó"
    saldos = {v["pedido_id"]: v["saldo"] for v in client.get("/api/cobranzas/resumen").json()["ventas"]}
    assert vieja["id"] not in saldos, "la vieja quedó pagada"
    assert saldos[nueva["id"]] == 8.0, "a la nueva le queda el resto"
    assert saldos[otra["id"]] == 10.0, "la no marcada no se toca"
    libros_cuadrados(client, db)


def test_abonar_mas_de_lo_marcado_no_se_puede(client, variante):
    p = fiar(client, variante, cliente="Ana")
    assert _abonar(client, [p], 10.01).status_code == 400


def test_el_abono_por_banco_pide_referencia(client, variante):
    p = fiar(client, variante, cliente="Ana")
    assert _abonar(client, [p], 5.0, metodo_pago="Transferencia").status_code == 400


def test_anular_el_abono_vuelve_a_deberse(client, db, variante, libros):
    p = fiar(client, variante, cliente="Ana")
    cobro = _abonar(client, [p], 10.0).json()
    assert client.get("/api/cobranzas/resumen").json()["ventas"] == []
    assert client.post(f"/api/cobranzas/cobros/{cobro['id']}/anular").status_code == 200
    assert client.get("/api/cobranzas/resumen").json()["ventas"][0]["saldo"] == 10.0
    libros_cuadrados(client, db)


def test_el_cobro_sin_cliente_creado_lleva_el_nombre_de_la_venta(client, variante):
    p = fiar(client, variante, cliente="Ana")
    assert _abonar(client, [p], 5.0).json()["cliente"] == "Ana"


def test_lo_dado_de_baja_se_ve_y_se_recupera(client, db, variante, libros):
    p = fiar(client, variante, cliente="Ana")
    assert client.post(f"/api/cobranzas/ventas/{p['id']}/perdida", json={"motivo": "no paga"}).status_code == 200
    r = client.get("/api/cobranzas/resumen").json()
    assert r["ventas"] == []
    assert [(v["pedido_id"], v["saldo"]) for v in r["dadas_de_baja"]] == [(p["id"], 10.0)]
    assert client.delete(f"/api/cobranzas/ventas/{p['id']}/perdida").status_code == 200
    r = client.get("/api/cobranzas/resumen").json()
    assert r["dadas_de_baja"] == [] and r["ventas"][0]["saldo"] == 10.0
    libros_cuadrados(client, db)


def test_un_abono_reenviado_cuenta_una_sola_vez(client, db, variante, libros):
    """4-nov: un reintento con mala señal aplicó dos veces el mismo abono de $3
    y una deuda de $10 quedó en $4."""
    p = fiar(client, variante, cliente="Ana")
    gaveta = saldo(db, "1011")
    uno = _abonar(client, [p], 3.0, clave_cliente="intento-1")
    dos = _abonar(client, [p], 3.0, clave_cliente="intento-1")
    assert uno.status_code == dos.status_code == 200
    assert uno.json()["id"] == dos.json()["id"], "devuelve el mismo cobro"
    assert client.get("/api/cobranzas/resumen").json()["ventas"][0]["saldo"] == 7.0
    db.expire_all()
    assert round(saldo(db, "1011") - gaveta, 2) == 3.0
    libros_cuadrados(client, db)


def test_dos_abonos_de_verdad_cuentan_los_dos(client, variante):
    """La señora abona $3 el martes y $3 el viernes: no es un reintento."""
    p = fiar(client, variante, cliente="Ana")
    assert _abonar(client, [p], 3.0, clave_cliente="martes").status_code == 200
    assert _abonar(client, [p], 3.0, clave_cliente="viernes").status_code == 200
    assert client.get("/api/cobranzas/resumen").json()["ventas"][0]["saldo"] == 4.0


def test_un_cobro_reenviado_no_se_rechaza_ni_se_duplica(client, db, variante):
    """El primero entró pero la respuesta se perdió: al reintentar no debe decir
    "ya no debe nada" como si fuera un error, sino el cobro que quedó."""
    p = fiar(client, variante, cliente="Ana")
    cuerpo = {"pedido_ids": [p["id"]], "metodo_pago": "Efectivo $", "clave_cliente": "intento-1"}
    uno = client.post("/api/cobranzas/cobros", json=cuerpo)
    dos = client.post("/api/cobranzas/cobros", json=cuerpo)
    assert uno.status_code == dos.status_code == 200
    assert uno.json()["id"] == dos.json()["id"]
    assert db.query(models.CobroCliente).count() == 1


def test_abonar_a_lo_que_debe_reenviado_cuenta_una_vez(client, variante):
    c = alta(client)
    fiar(client, variante)
    cuerpo = {"monto": 3.0, "metodo_pago": "Efectivo $", "clave_cliente": "intento-1"}
    assert client.post(f"/api/cobranzas/clientes/{c['id']}/abono", json=cuerpo).status_code == 200
    assert client.post(f"/api/cobranzas/clientes/{c['id']}/abono", json=cuerpo).status_code == 200
    assert client.get("/api/cobranzas/resumen").json()["ventas"][0]["saldo"] == 7.0


def test_cobrar_desde_ventas_reenviado_cuenta_una_vez(client, db, variante, libros):
    p = fiar(client, variante, cliente="Ana")
    cuerpo = {"metodo_pago": "Efectivo $", "monto": 3.0, "clave_cliente": "intento-1"}
    uno = client.post(f"/api/caja/fiado/{p['id']}/cobrar", json=cuerpo)
    dos = client.post(f"/api/caja/fiado/{p['id']}/cobrar", json=cuerpo)
    assert uno.status_code == dos.status_code == 200
    assert dos.json()["cobrado"] == 3.0 and dos.json()["queda"] == 7.0
    assert db.query(models.AbonoFiado).count() == 1
    libros_cuadrados(client, db)


def test_sin_clave_se_sigue_aceptando(client, variante):
    """Lo que llegue de una pantalla vieja, abierta antes de actualizar."""
    p = fiar(client, variante, cliente="Ana")
    assert _abonar(client, [p], 3.0).status_code == 200
    assert _abonar(client, [p], 3.0).status_code == 200
    assert client.get("/api/cobranzas/resumen").json()["ventas"][0]["saldo"] == 4.0


def _venta_facturada(client, db, variante, numero="F-1", cliente="Empresa Sur"):
    """Una venta de $10 a crédito, facturada. El IVA de la factura es $1,38 y
    retener el 75 % son $1,04: entran $8,96."""
    p = fiar(client, variante, cliente=cliente)
    pedido = db.get(models.Pedido, p["id"])
    pedido.facturado = True
    pedido.numero_factura = numero
    pedido.tasa_iva = 16
    pedido.tasa_bcv = 100.0
    db.commit()
    return p


def _retener(client, p, **extra):
    return client.post("/api/cobranzas/cobros", json={
        "pedido_ids": [p["id"]], "metodo_pago": "Transferencia", "referencia": "1",
        "retencion_iva_pct": 75, **extra,
    })


def test_retencion_con_pago_parcial_sin_explicar_se_rechaza(client, db, variante, libros):
    """4-nov: debía $10, retuvo y pagó $3. Cerraba la deuda y dejaba $5,96 de
    comisión sin preguntar. Hasta que responda el contador no se deja parte
    debiendo con retención, y se dice qué hacer."""
    p = _venta_facturada(client, db, variante)
    r = _retener(client, p, recibido=3.0)
    assert r.status_code == 400
    assert "$5,96" in r.json()["detail"] and "comisión" in r.json()["detail"]
    db.expire_all()
    pedido = db.get(models.Pedido, p["id"])
    assert pedido.retencion_iva_usd is None, "no queda retención anotada"
    assert db.query(models.CobroCliente).count() == 0
    assert saldo(db, "1015") == 10.0 and saldo(db, "6130") == 0.0
    libros_cuadrados(client, db)


def test_retencion_con_comision_marcada_se_acepta(client, db, variante, libros):
    """La cajera marca que lo que falta es comisión: se acepta, y la retención
    va sobre toda la factura."""
    p = _venta_facturada(client, db, variante)
    r = _retener(client, p, recibido=8.0, diferencia_es_comision=True)
    assert r.status_code == 200, r.text
    c = r.json()
    assert (c["retencion_iva"], c["comision"], c["recibido"]) == (1.04, 0.96, 8.0)
    db.expire_all()
    assert saldo(db, "1015") == 0.0 and saldo(db, "6130") == 0.96 and saldo(db, "1035") == 1.04
    libros_cuadrados(client, db)


def test_retencion_con_pago_completo_o_de_mas_no_pide_nada(client, db, variante, libros):
    completo = _venta_facturada(client, db, variante, "F-1")
    r = _retener(client, completo, recibido=8.96)
    assert r.status_code == 200 and r.json()["comision"] == 0.0
    de_mas = _venta_facturada(client, db, variante, "F-2")
    r = _retener(client, de_mas, recibido=10.0)
    assert r.status_code == 200 and r.json()["excedente"] == 1.04
    libros_cuadrados(client, db)


def test_sin_retencion_paga_menos_y_cierra_como_antes(client, variante):
    """La medida temporal es solo con retención: PedidosYa sigue igual."""
    p = fiar(client, variante)
    r = client.post("/api/cobranzas/cobros", json={
        "pedido_ids": [p["id"]], "metodo_pago": "Efectivo $", "recibido": 8.0,
    })
    assert r.status_code == 200 and r.json()["comision"] == 2.0
