"""Cuentas por cobrar: PedidosYa paga la semana de una vez, ya sin su comision.

Antes habia que partir el deposito en un abono por pedido y la comision no
tenia donde ir. Lo que se prueba es que los libros sigan diciendo la verdad:
1015 baja por todo lo que se debia, el banco sube por lo que llego y la
diferencia es gasto de comision, no una deuda eterna ni un descuento falso.
"""
import csv
import datetime
import io

from openpyxl import load_workbook

from app import models, settings
from app.acceso import usuarios
from app.exportar_csv import csv_de
from app.timeutils import hoy
from tests.conftest import entrar, libros_cuadrados, saldo


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


def _parte_fiada(client, db, variante):
    """Venta de $10: $5 en efectivo y $5 a crédito, facturada."""
    p = client.post("/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 2}], "nota": ""}).json()
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={
        "metodo_pago": "Mixto", "cliente": "Empresa Sur",
        "pagos": [{"metodo": "Efectivo $", "monto": 5.0}, {"metodo": "Fiado", "monto": 5.0}],
    })
    assert r.status_code == 200, r.text
    pedido = db.get(models.Pedido, p["id"])
    pedido.facturado = True
    pedido.numero_factura = "F-1"
    pedido.tasa_iva = 16
    db.commit()
    return p


def test_la_pantalla_recibe_la_retencion_que_calcula_el_sistema(client, db, variante, libros):
    """4-nov: en una venta parte fiada la pantalla calculaba sobre lo fiado
    ($0,52) y el sistema sobre toda la factura ($1,04): quedaban $0,52 de "otro
    ingreso" que no existen. El resumen trae la cifra, para que no se calcule
    dos veces, y pagar lo que dice la pantalla no deja ni comisión ni ingreso."""
    p = _parte_fiada(client, db, variante)
    fila = client.get("/api/cobranzas/resumen").json()["ventas"][0]
    assert (fila["retencion_75"], fila["retencion_100"]) == (1.04, 1.38)
    r = client.post("/api/cobranzas/cobros", json={
        "pedido_ids": [p["id"]], "metodo_pago": "Transferencia", "referencia": "1",
        "retencion_iva_pct": 75, "recibido": round(fila["saldo"] - fila["retencion_75"], 2),
    })
    assert r.status_code == 200, r.text
    c = r.json()
    assert (c["retencion_iva"], c["excedente"], c["comision"], c["recibido"]) == (1.04, 0.0, 0.0, 3.96)
    libros_cuadrados(client, db)


def test_sin_factura_o_ya_retenida_no_hay_retencion_que_ofrecer(client, db, variante):
    fiar(client, variante, cliente="Ana")
    p = _venta_facturada(client, db, variante)
    pedido = db.get(models.Pedido, p["id"])
    pedido.retencion_iva_usd = 1.04
    db.commit()
    for fila in client.get("/api/cobranzas/resumen").json()["ventas"]:
        assert (fila["retencion_75"], fila["retencion_100"]) == (0.0, 0.0)


# ------------------------------------------------------------ exportar la lista
ENCABEZADOS_EXPORTAR = ["Cliente", "Venta", "Fecha", "Días", "Abonó ($)", "Debe ($)"]


def exportar(client, formato, ids):
    return client.post("/api/cobranzas/ventas/exportar", json={"formato": formato, "pedido_ids": ids})


def hoja_de(r):
    return load_workbook(io.BytesIO(r.content)).active


def filas_csv(r):
    texto = r.content.decode("utf-8-sig")
    return list(csv.reader(io.StringIO(texto), delimiter=";"))


def test_exportar_trae_las_ventas_pedidas_en_ese_orden(client, variante):
    """El dueño ordena la lista en pantalla y el archivo sale igual: el orden lo
    manda la pantalla, no la base."""
    a = fiar(client, variante, cliente="Ana")
    b = fiar(client, variante, cliente="Luis")
    c = fiar(client, variante, cliente="Rosa")
    orden = [c["id"], a["id"], b["id"]]
    ws = hoja_de(exportar(client, "xlsx", orden))
    assert [celda.value for celda in ws[1]] == ENCABEZADOS_EXPORTAR
    assert [fila[0] for fila in ws.iter_rows(min_row=2, values_only=True)] == ["Rosa", "Ana", "Luis"]
    filas = filas_csv(exportar(client, "csv", orden))
    assert filas[0] == ENCABEZADOS_EXPORTAR
    assert [f[0] for f in filas[1:]] == ["Rosa", "Ana", "Luis"]


def test_exportar_solo_trae_lo_pedido_y_sin_fila_de_total(client, variante):
    """Con el buscador puesto se ven dos de tres: salen esas y nada más."""
    a = fiar(client, variante, cliente="Ana")
    fiar(client, variante, cliente="Luis")
    ws = hoja_de(exportar(client, "xlsx", [a["id"]]))
    assert ws.max_row == 2 and ws.cell(2, 1).value == "Ana"
    assert len(filas_csv(exportar(client, "csv", [a["id"]]))) == 2


def test_exportar_trae_los_mismos_montos_de_la_pantalla(client, variante):
    """Fió $10 y abonó $4: el archivo dice lo mismo que la lista, y la suma de la
    columna Debe da el total de la pantalla."""
    p = fiar(client, variante, cliente="Ana")
    q = fiar(client, variante, cliente="Luis")
    r = client.post("/api/cobranzas/abonos", json={"pedido_ids": [p["id"]], "monto": 4.0, "metodo_pago": "Efectivo $"})
    assert r.status_code == 200, r.text
    pantalla = client.get("/api/cobranzas/resumen").json()
    fila = next(v for v in pantalla["ventas"] if v["pedido_id"] == p["id"])
    ws = hoja_de(exportar(client, "xlsx", [p["id"], q["id"]]))
    assert ws.cell(2, 2).value == fila["numero"]
    assert ws.cell(2, 4).value == fila["dias"]
    assert ws.cell(2, 5).value == fila["abonado"] == 4.0
    assert ws.cell(2, 6).value == fila["saldo"] == 6.0
    assert round(ws.cell(2, 6).value + ws.cell(3, 6).value, 2) == pantalla["total"]


def test_exportar_en_excel_son_numeros_y_fechas_de_verdad(client, db, variante):
    """Si el monto llega como texto, Excel no lo suma ni lo ordena bien."""
    p = fiar(client, variante)
    db.get(models.Pedido, p["id"]).cerrado_en = datetime.datetime(2026, 11, 2, 15, 30)
    db.commit()
    ws = hoja_de(exportar(client, "xlsx", [p["id"]]))
    venta, cuando, dias, abono, debe = (ws.cell(2, n) for n in (2, 3, 4, 5, 6))
    assert isinstance(venta.value, int) and isinstance(dias.value, int)
    assert venta.data_type == dias.data_type == abono.data_type == debe.data_type == "n"
    assert cuando.is_date and cuando.value.date() == datetime.date(2026, 11, 2)
    assert cuando.number_format == "dd/mm/yyyy"
    assert debe.number_format == "#,##0.00"


def test_exportar_csv_abre_bien_con_la_region_de_venezuela(client, db, variante):
    """En es-VE Excel separa con `;` y lee la coma como decimal: con `,` y `.`
    todo cae en una sola columna, o 1234.50 se vuelve 123450."""
    p = fiar(client, variante, cliente="José Ñáñez")
    pedido = db.get(models.Pedido, p["id"])
    next(x for x in pedido.pagos if x.metodo == "Fiado").monto = 1234.5
    pedido.cerrado_en = datetime.datetime(2026, 11, 2, 15, 30)
    db.commit()
    r = exportar(client, "csv", [p["id"]])
    assert r.content.startswith(b"\xef\xbb\xbf"), "sin BOM, las tildes salen rotas"
    assert r.headers["content-type"].startswith("text/csv")
    fila = filas_csv(r)[1]
    assert fila[0] == "José Ñáñez"
    assert fila[2] == "02/11/2026"
    assert fila[4:] == ["0,00", "1234,50"]


def test_exportar_cada_venta_se_identifica_aunque_el_numero_se_repita(client, db, variante):
    """El número de comanda vuelve a 1 cada día: dos ventas pueden tener el mismo.
    Se pide por id para que salga la que se ve y no su tocaya de otro día."""
    a = fiar(client, variante, cliente="Ana")
    b = fiar(client, variante, cliente="Luis")
    db.get(models.Pedido, a["id"]).numero = 7
    db.get(models.Pedido, b["id"]).numero = 7
    db.commit()
    ws = hoja_de(exportar(client, "xlsx", [b["id"]]))
    assert ws.max_row == 2 and ws.cell(2, 1).value == "Luis"


def test_exportar_omite_lo_que_ya_no_se_debe(client, variante):
    """Se cobró en otra pestaña después de cargar la pantalla: el archivo no puede
    decir que todavía debe. Tampoco sale lo que nunca se debió."""
    a = fiar(client, variante, cliente="Ana")
    b = fiar(client, variante, cliente="Luis")
    r = client.post("/api/cobranzas/cobros", json={"pedido_ids": [a["id"]], "metodo_pago": "Efectivo $"})
    assert r.status_code == 200, r.text
    ids = [a["id"], b["id"], 999999]
    ws = hoja_de(exportar(client, "xlsx", ids))
    assert [fila[0] for fila in ws.iter_rows(min_row=2, values_only=True)] == ["Luis"]
    assert [f[0] for f in filas_csv(exportar(client, "csv", ids))[1:]] == ["Luis"]


def test_exportar_un_nombre_nunca_se_ejecuta_como_formula(client, variante):
    """El nombre lo escribe cualquiera en el punto de venta. Abierto en Excel,
    "=1+1" daría 2, y una fórmula peor podría sacar datos del equipo."""
    nombres = ["=1+1", "+58412", "-5", "@Ana", "Ana"]
    ids = [fiar(client, variante, cliente=n)["id"] for n in nombres]
    ws = hoja_de(exportar(client, "xlsx", ids))
    for fila, nombre in enumerate(nombres, start=2):
        celda = ws.cell(fila, 1)
        assert celda.value == nombre, "en el Excel se ve igual que en pantalla"
        assert celda.data_type == "s"
    filas = filas_csv(exportar(client, "csv", ids))[1:]
    assert [f[0] for f in filas] == ["'=1+1", "'+58412", "'-5", "'@Ana", "Ana"]


def test_exportar_un_nombre_con_caracteres_raros_no_rompe_el_excel(client, db, variante):
    """openpyxl revienta con caracteres de control, y un nombre pegado de otro
    lado los puede traer: sin esto, el archivo entero da error."""
    p = fiar(client, variante, cliente="Ana")
    db.get(models.Pedido, p["id"]).cliente = "Ana\x0b López"
    db.commit()
    r = exportar(client, "xlsx", [p["id"]])
    assert r.status_code == 200, r.text
    assert hoja_de(r).cell(2, 1).value == "Ana López"


def test_exportar_el_archivo_dice_que_es_y_de_que_dia(client, variante):
    p = fiar(client, variante)
    for formato in ("csv", "xlsx"):
        cabecera = exportar(client, formato, [p["id"]]).headers["content-disposition"]
        assert f'cuentas-por-cobrar-{hoy().isoformat()}.{formato}"' in cabecera


def test_exportar_formato_desconocido_o_lista_vacia_se_rechaza(client, variante):
    p = fiar(client, variante)
    assert exportar(client, "pdf", [p["id"]]).status_code == 422
    assert exportar(client, "csv", []).status_code == 422


def test_exportar_no_mueve_nada(client, db, libros, variante):
    """Solo lee: ni saldos ni asientos."""
    p = fiar(client, variante)
    asientos = db.query(models.AsientoContable).count()
    exportar(client, "xlsx", [p["id"]])
    exportar(client, "csv", [p["id"]])
    db.expire_all()
    assert db.query(models.AsientoContable).count() == asientos
    assert saldo(db, "1015") == 10.0


def test_exportar_lo_puede_hacer_quien_ve_la_lista(fuera, variante):
    """La caja entra al módulo y exporta; cocina no entra; sin sesión, nadie."""
    cuentas = (("cajera-cxc", "clave-de-caja-larga", "caja"), ("cocina-cxc", "clave-de-cocina-larga", "cocina"))
    for usuario, clave, rol in cuentas:
        try:
            usuarios.crear(usuario, clave, rol=rol, locales=[settings.LOCAL_SLUG])
        except usuarios.ErrorUsuarios:
            pass
    assert exportar(fuera, "csv", [1]).status_code == 401
    entrar(fuera, "cocina-cxc", "clave-de-cocina-larga")
    assert exportar(fuera, "csv", [1]).status_code == 403
    fuera.cookies.clear()
    entrar(fuera, "cajera-cxc", "clave-de-caja-larga")
    assert exportar(fuera, "csv", [1]).status_code == 200


def test_exportar_mil_ventas_en_los_dos_formatos(client, db):
    """Con 1.000 ventas los ids no caben en una dirección: por eso va por POST y
    sale completo, en el orden pedido."""
    pedidos = []
    for n in range(1000):
        p = models.Pedido(numero=n + 1, cliente=f"Cliente {n:04d}")
        p.pagos.append(models.PagoPedido(metodo="Fiado", monto=1.5))
        pedidos.append(p)
    db.add_all(pedidos)
    db.commit()
    ids = [p.id for p in reversed(pedidos)]
    esperados = [f"Cliente {n:04d}" for n in reversed(range(1000))]
    ws = hoja_de(exportar(client, "xlsx", ids))
    assert [fila[0] for fila in ws.iter_rows(min_row=2, values_only=True)] == esperados
    assert [f[0] for f in filas_csv(exportar(client, "csv", ids))[1:]] == esperados


def test_el_csv_de_las_otras_exportaciones_no_cambia():
    """La opción regional es de esta lista: las demás siguen con coma y sin apóstrofo."""
    assert csv_de(["A", "B"], [["=x", 1.5]]) == "﻿A,B\r\n=x,1.5\r\n"
