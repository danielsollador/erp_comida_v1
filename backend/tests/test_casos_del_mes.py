"""Los casos de un mes normal de Savora (26-oct) que no tenian salida.

Cada prueba es uno de los casos que se repasaron con el dueño: el numero es
el de esa lista. Lo que se mira siempre es lo mismo: que la plata quede donde
esta de verdad y que los libros sigan cuadrando.
"""
from app import models
from app.timeutils import hoy
from tests.conftest import caja_esperado, libros_cuadrados, saldo
from tests.test_cuentas_por_cobrar import alta, fiar
from tests.test_pagos_sin_factura import pagar


def fiar_facturado(client, variante, cantidad=2, cliente="Oficina Torre Sur", factura="V-9"):
    p = client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": cantidad}], "nota": ""},
    ).json()
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={
        "metodo_pago": "Fiado", "cliente": cliente, "facturado": True, "numero_factura": factura,
    })
    assert r.status_code == 200, r.text
    return p


# ── Cuentas por cobrar ──────────────────────────────────────────────────────

def test_17_la_empresa_retiene_iva_al_pagar_despues(client, db, libros, variante):
    """Catering facturado a credito; la empresa paga a los 15 dias y retiene
    el 75 % del IVA. Lo retenido no entra al banco: va a 1035."""
    c = alta(client, nombre="Oficina Torre Sur")
    p = fiar_facturado(client, variante)
    banco = saldo(db, "1020")
    r = client.post("/api/cobranzas/cobros", json={
        "cliente_id": c["id"], "pedido_ids": [p["id"]], "metodo_pago": "Transferencia",
        "referencia": "1", "retencion_iva_pct": 75,
    })
    assert r.status_code == 200, r.text
    cobro = r.json()
    assert cobro["retencion_iva"] > 0
    db.expire_all()
    pedido = db.get(models.Pedido, p["id"])
    assert pedido.retencion_iva_usd == cobro["retencion_iva"] and pedido.retencion_iva_pct == 75
    assert saldo(db, "1035") == cobro["retencion_iva"]
    assert round(saldo(db, "1020") - banco, 2) == round(10 - cobro["retencion_iva"], 2)
    assert saldo(db, "1015") == 0.0
    libros_cuadrados(client, db)

    client.post(f"/api/cobranzas/cobros/{cobro['id']}/anular")
    db.expire_all()
    assert db.get(models.Pedido, p["id"]).retencion_iva_usd is None, "anular el cobro quita la retención"
    assert saldo(db, "1035") == 0.0


def test_17_no_se_retiene_iva_de_ventas_sin_factura(client, variante):
    c = alta(client)
    p = fiar(client, variante)
    r = client.post("/api/cobranzas/cobros", json={
        "cliente_id": c["id"], "pedido_ids": [p["id"]], "metodo_pago": "Efectivo Bs", "retencion_iva_pct": 75,
    })
    assert r.status_code == 400


def test_08_pedidosya_paga_de_mas(client, db, libros, variante):
    """Entro mas de lo que se debia (propinas de la app): lo de mas es otro
    ingreso; la deuda no queda en negativo."""
    c = alta(client)
    p = fiar(client, variante)
    r = client.post("/api/cobranzas/cobros", json={
        "cliente_id": c["id"], "pedido_ids": [p["id"]], "metodo_pago": "Transferencia",
        "referencia": "2", "excedente": 1.5,
    })
    assert r.status_code == 200, r.text
    assert r.json()["recibido"] == 11.5
    db.expire_all()
    assert saldo(db, "1015") == 0.0
    assert saldo(db, "4040") == 1.5
    libros_cuadrados(client, db)


def test_19_y_18_abono_a_cuenta_de_la_mas_vieja_y_pago_partido(client, db, libros, variante):
    """La vecina abona $12 "a lo que debo" sobre dos ventas de $10, y el resto
    lo paga mitad Zelle y mitad pago movil."""
    c = alta(client, nombre="Sra. Carmen", tipo="persona")
    p1 = fiar(client, variante, cliente="Sra. Carmen")
    p2 = fiar(client, variante, cliente="Sra. Carmen")
    r = client.post(f"/api/cobranzas/clientes/{c['id']}/abono", json={"monto": 12, "metodo_pago": "Efectivo Bs"})
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(models.Pedido, p1["id"]).fiado_saldado, "la vieja queda pagada"
    assert db.get(models.Pedido, p2["id"]).fiado_saldo == 8.0, "a la nueva le abona el resto"
    assert saldo(db, "1015") == 8.0

    url = f"/api/cobranzas/clientes/{c['id']}/abono"
    assert client.post(url, json={"monto": 4, "metodo_pago": "Zelle", "referencia": "z"}).status_code == 200
    assert client.post(url, json={"monto": 4, "metodo_pago": "Pago movil", "referencia": "p"}).status_code == 200
    db.expire_all()
    assert saldo(db, "1015") == 0.0
    assert db.get(models.Pedido, p2["id"]).fiado_saldado
    estado = client.get(f"/api/cobranzas/clientes/{c['id']}/estado").json()
    assert estado["movimientos"][-1]["saldo"] == 0.0
    libros_cuadrados(client, db)


def test_19_no_se_abona_mas_de_lo_que_se_debe(client, variante):
    c = alta(client)
    fiar(client, variante)
    r = client.post(f"/api/cobranzas/clientes/{c['id']}/abono", json={"monto": 50, "metodo_pago": "Efectivo Bs"})
    assert r.status_code == 400


def test_07_dar_por_perdida_y_recuperar(client, db, libros, variante):
    """PedidosYa no reconoce un pedido: se da por perdido, va a gasto y deja
    de deberse; la venta sigue en los libros."""
    c = alta(client)
    p = fiar(client, variante)
    ventas_antes = saldo(db, "4010")
    r = client.post(f"/api/cobranzas/ventas/{p['id']}/perdida", json={"motivo": "PY no lo reconoció"})
    assert r.status_code == 200, r.text
    db.expire_all()
    assert saldo(db, "1015") == 0.0
    assert saldo(db, "6140") == 10.0
    assert saldo(db, "4010") == ventas_antes, "la venta no se toca"
    resumen = client.get("/api/cobranzas/resumen").json()
    assert next(x for x in resumen["clientes"] if x["id"] == c["id"])["saldo"] == 0.0
    tipos = [m["tipo"] for m in client.get(f"/api/cobranzas/clientes/{c['id']}/estado").json()["movimientos"]]
    assert tipos == ["venta", "perdida"]
    assert client.post(f"/api/pedidos/{p['id']}/devolver", json={"motivo": "x"}).status_code == 409

    assert client.delete(f"/api/cobranzas/ventas/{p['id']}/perdida").status_code == 200
    db.expire_all()
    assert saldo(db, "1015") == 10.0 and saldo(db, "6140") == 0.0
    libros_cuadrados(client, db)


# ── Pagos ───────────────────────────────────────────────────────────────────

def test_11_anticipo_y_descuento_en_la_quincena(client, db, libros):
    """$30 de adelanto en efectivo a mitad de quincena; la quincena de $100 se
    paga con el anticipo descontado solo."""
    efectivo = caja_esperado(client, "Efectivo Bs")
    r = pagar(client, concepto="Anticipo", monto=30.0, metodo_pago="Efectivo Bs", referencia="")
    assert r.status_code == 200, r.text
    assert round(efectivo - caja_esperado(client, "Efectivo Bs"), 2) == 30.0
    db.expire_all()
    assert saldo(db, "1016") == 30.0 and saldo(db, "6080") == 0.0, "un anticipo no es gasto todavía"
    assert client.get("/api/egresos/anticipos").json() == [{"beneficiario": "Ana Pérez", "saldo": 30.0}]

    f = client.post("/api/egresos/fijos", json={
        "beneficiario": "Ana Perez", "concepto": "Sueldos", "monto": 100.0,
        "metodo_pago": "Pago movil", "frecuencia": "quincenal", "proximo": hoy().isoformat(),
    }).json()
    banco = saldo(db, "1020")
    r = client.post(f"/api/egresos/fijos/{f['id']}/pagar", json={"referencia": "9"})
    assert r.status_code == 200, r.text
    assert r.json()["anticipo_descontado"] == 30.0 and r.json()["neto"] == 70.0
    db.expire_all()
    assert saldo(db, "6080") == 100.0, "el sueldo es el gasto completo"
    assert saldo(db, "1016") == 0.0
    assert round(banco - saldo(db, "1020"), 2) == 70.0
    assert client.get("/api/egresos/anticipos").json() == []
    libros_cuadrados(client, db)


def test_11_no_se_descuenta_mas_anticipo_del_que_hay(client, libros):
    pagar(client, concepto="Anticipo", monto=10.0, metodo_pago="Efectivo Bs", referencia="")
    assert pagar(client, descontar_anticipo=20.0).status_code == 400


def test_11_un_anticipo_ya_descontado_no_se_anula(client, libros):
    a = pagar(client, concepto="Anticipo", monto=10.0, metodo_pago="Efectivo Bs", referencia="").json()
    assert pagar(client, descontar_anticipo=10.0).status_code == 200
    assert client.post(f"/api/egresos/{a['id']}/anular").status_code == 409


def test_15_enterar_el_islr_retenido(client, db, libros):
    """Lo retenido se le paga al SENIAT y la deuda queda en cero."""
    pagar(client, beneficiario="Contador", concepto="Honorarios", monto=100.0, retencion_islr_pct=3)
    r = client.post("/api/egresos/islr/enterar", json={"metodo_pago": "Transferencia", "referencia": "PL-1"})
    assert r.status_code == 200, r.text
    assert r.json()["enterado"] == 3.0
    db.expire_all()
    assert saldo(db, "2060") == 0.0
    otra = client.post("/api/egresos/islr/enterar", json={"metodo_pago": "Transferencia", "referencia": "x"})
    assert otra.status_code == 409
    libros_cuadrados(client, db)


def test_16_patente_municipal_va_a_impuestos(client, db, libros):
    assert pagar(client, beneficiario="Alcaldía", concepto="Impuestos", monto=25.0).status_code == 200
    db.expire_all()
    assert saldo(db, "6150") == 25.0


# ── Caja: traspasos y aportes ───────────────────────────────────────────────

def test_20_llevar_el_efectivo_al_banco(client, db, libros):
    """El deposito del efectivo baja la gaveta y no es gasto."""
    efectivo = caja_esperado(client, "Efectivo Bs")
    banco = saldo(db, "1020")
    r = client.post("/api/caja/traspasos", json={
        "tipo": "traspaso", "desde": "Efectivo Bs", "hacia": "Transferencia", "monto": 50, "referencia": "dep-1",
    })
    assert r.status_code == 200, r.text
    assert round(efectivo - caja_esperado(client, "Efectivo Bs"), 2) == 50.0
    db.expire_all()
    assert round(saldo(db, "1020") - banco, 2) == 50.0
    libros_cuadrados(client, db)
    assert client.post(f"/api/caja/traspasos/{r.json()['id']}/anular").status_code == 200
    assert caja_esperado(client, "Efectivo Bs") == efectivo


def test_20_aporte_del_dueno(client, db, libros):
    """El dueño pone plata: entra a Zelle y sube el capital."""
    capital = saldo(db, "3010")
    r = client.post("/api/caja/traspasos", json={"tipo": "aporte", "hacia": "Zelle", "monto": 200, "referencia": "z"})
    assert r.status_code == 200, r.text
    db.expire_all()
    assert saldo(db, "1021") == 200.0
    assert round(saldo(db, "3010") - capital, 2) == 200.0
    libros_cuadrados(client, db)


def test_20_traspaso_al_mismo_sitio_no_tiene_sentido(client):
    r = client.post("/api/caja/traspasos", json={
        "tipo": "traspaso", "desde": "Pago movil", "hacia": "Transferencia", "monto": 5, "referencia": "x",
    })
    assert r.status_code == 400


def test_06_lo_que_entro_decide_la_comision_despues_de_la_retencion(client, db, libros, variante):
    """La pantalla manda lo que entro al banco; el servidor separa la
    retencion (exacta, de cada factura) y deja el resto como comision."""
    c = alta(client, nombre="Oficina Torre Sur")
    p = fiar_facturado(client, variante)
    r = client.post("/api/cobranzas/cobros", json={
        "cliente_id": c["id"], "pedido_ids": [p["id"]], "metodo_pago": "Transferencia",
        "referencia": "3", "retencion_iva_pct": 75, "recibido": 8.0,
    })
    assert r.status_code == 200, r.text
    cobro = r.json()
    assert cobro["recibido"] == 8.0
    assert round(cobro["comision"] + cobro["retencion_iva"] + cobro["recibido"], 2) == 10.0
    libros_cuadrados(client, db)
