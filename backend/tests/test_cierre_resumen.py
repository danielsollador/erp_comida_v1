"""Cuadrar la caja de un dia: que entro, que salio y si coincide.

COMO PIENSA EL DUEÑO ESTO. "Lo que vendi tiene que estar repartido entre mis
formas de pago; de ahi saco lo que gaste y lo que me lleve, y lo que queda es
lo que debo tener." El modulo sigue ese orden, y estas pruebas lo fijan:

  1. El desglose por forma de pago suma lo mismo que las ventas.
  2. Un gasto pagado en efectivo baja lo que deberia haber en efectivo, y solo
     en efectivo.
  3. Se cuadra por metodo --el punto imprime su lote, el banco tiene su
     pantalla-- pero la diferencia se asienta por cuenta, que es lo que
     llevan los libros.
  4. Se puede cuadrar un dia pasado: la caja de ayer se cierra esta manana.
"""


def vender(client, variante, metodo="Efectivo Bs", cantidad=1):
    p = client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": cantidad}], "nota": ""},
    ).json()
    # Todo lo que no es efectivo lleva su numero de confirmacion.
    referencia = "" if metodo.startswith("Efectivo") else "REF-000"
    r = client.post(
        f"/api/pedidos/{p['id']}/cobrar",
        json={"metodo_pago": metodo, "referencia": referencia},
    )
    assert r.status_code == 200, r.text
    return p


def resumen(client, fecha=None):
    r = client.get("/api/caja/resumen" + (f"?fecha={fecha}" if fecha else ""))
    assert r.status_code == 200, r.text
    return r.json()


def linea(d, metodo):
    return next(l for l in d["desglose"] if l["metodo"] == metodo)


def test_el_desglose_reparte_la_venta_entre_las_formas_de_pago(client, variante):
    vender(client, variante, "Efectivo Bs")
    vender(client, variante, "Zelle")

    d = resumen(client)
    assert linea(d, "Efectivo Bs")["ventas"] == 5.0
    assert linea(d, "Zelle")["ventas"] == 5.0
    assert linea(d, "Pago movil")["ventas"] == 0


def test_lo_vendido_cuadra_con_lo_cobrado(client, variante):
    """La comprobacion de fondo: si el desglose no suma las ventas, hay un
    pago mal registrado."""
    vender(client, variante, "Efectivo Bs")
    vender(client, variante, "Punto de venta")

    d = resumen(client)
    assert d["vendido"] == 10.0
    assert d["a_cobrar"] == 10.0
    assert d["cobrado"] == 10.0
    assert d["cuadra_ventas"] is True


def test_todas_las_formas_de_pago_salen_aunque_no_se_usen(client):
    """El cajero tiene que poder decir "por aqui no entro nada" en cada una."""
    d = resumen(client)
    metodos = [l["metodo"] for l in d["desglose"]]
    for esperado in ("Efectivo Bs", "Efectivo $", "Punto de venta", "Pago movil",
                     "Transferencia", "Tarjeta", "Zelle", "Fiado"):
        assert esperado in metodos


def test_un_gasto_en_efectivo_solo_baja_el_efectivo(client, variante):
    """Si cobre 5 en efectivo y saque 2 para una bombona, al contar tienen que
    aparecer 3 -- y el Zelle no se entera."""
    vender(client, variante, "Efectivo Bs")
    vender(client, variante, "Zelle")
    client.post(
        "/api/caja/gastos",
        json={"descripcion": "Bombona", "categoria": "Servicios", "monto": 2.0,
              "metodo_pago": "Efectivo Bs"},
    )

    d = resumen(client)
    assert d["gastos"] == 2.0
    assert linea(d, "Efectivo Bs")["salidas"] == 2.0
    assert linea(d, "Efectivo Bs")["esperado"] == 3.0
    assert linea(d, "Zelle")["salidas"] == 0
    assert linea(d, "Zelle")["esperado"] == 5.0


def test_un_retiro_por_zelle_baja_el_zelle(client, variante):
    """El dueño elige por donde saca la plata, y eso es lo que cuadra."""
    vender(client, variante, "Zelle")
    r = client.post("/api/caja/retiros", json={"monto": 3.0, "metodo_pago": "Zelle", "nota": ""})
    assert r.status_code == 200, r.text

    d = resumen(client)
    assert d["retiros"] == 3.0
    assert linea(d, "Zelle")["esperado"] == 2.0
    assert linea(d, "Efectivo Bs")["esperado"] == 0


def test_anulado_y_devuelto_no_son_lo_mismo(client, variante):
    p = client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": 2}], "nota": ""},
    ).json()
    client.post(f"/api/pedidos/{p['id']}/anular", json={})

    otro = vender(client, variante, cantidad=2)
    client.post(f"/api/pedidos/{otro['id']}/devolver", json={"motivo": "vino malo"})

    d = resumen(client)
    assert d["anulados_hoy"] == 1
    assert d["anulado_monto_hoy"] == p["total"]
    assert d["devueltos_hoy"] == 1
    assert d["devuelto_monto_hoy"] == otro["total"]
    # Ninguno cuenta como venta.
    assert d["vendido"] == 0


def test_el_credito_se_ve_pero_no_se_cuenta(client, variante):
    """No entro plata: nacio una deuda. Se muestra para saber cuanto se fio."""
    p = client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": 1}], "nota": "",
              "cliente": "Don Ramiro"},
    ).json()
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Fiado"})

    d = resumen(client)
    fiado = linea(d, "Fiado")
    assert fiado["ventas"] == 5.0
    assert fiado["se_cuadra"] is False


def test_cerrar_cuenta_por_metodo_y_asienta_por_cuenta(client, variante):
    """El punto de venta y el pago movil caen los dos en 1020: si los dos
    fallan, lo que va al asiento es la suma."""
    vender(client, variante, "Punto de venta")
    vender(client, variante, "Pago movil")

    r = client.post("/api/caja/cerrar", json={"conteos": [
        {"metodo": "Punto de venta", "contado": 4.0},
        {"metodo": "Pago movil", "contado": 4.0},
    ]})
    assert r.status_code == 200, r.text
    lineas = {l["metodo"]: l for l in r.json()["lineas"]}
    assert lineas["Punto de venta"]["diferencia"] == -1.0
    assert lineas["Pago movil"]["diferencia"] == -1.0


def test_lo_que_no_se_conto_no_inventa_un_faltante(client, variante):
    vender(client, variante, "Efectivo Bs")
    r = client.post("/api/caja/cerrar", json={"conteos": [
        {"metodo": "Efectivo Bs", "contado": 5.0},
    ]})
    assert r.status_code == 200, r.text
    assert [l["metodo"] for l in r.json()["lineas"]] == ["Efectivo Bs"]
    assert r.json()["diferencia"] == 0


def test_cerrar_sin_contar_nada_no_se_deja(client):
    assert client.post("/api/caja/cerrar", json={"conteos": []}).status_code == 400


def test_no_se_cierra_dos_veces_el_mismo_dia(client, variante):
    vender(client, variante)
    conteo = {"conteos": [{"metodo": "Efectivo Bs", "contado": 5.0}]}
    assert client.post("/api/caja/cerrar", json=conteo).status_code == 200
    assert client.post("/api/caja/cerrar", json=conteo).status_code == 409


def test_el_resumen_dice_si_el_dia_ya_se_cerro(client, variante):
    vender(client, variante)
    assert resumen(client)["cerrada"] is False
    client.post("/api/caja/cerrar", json={"conteos": [{"metodo": "Efectivo Bs", "contado": 5.0}]})
    assert resumen(client)["cerrada"] is True


def test_una_fecha_futura_no_se_puede_mirar(client):
    import datetime
    manana = (datetime.date.today() + datetime.timedelta(days=2)).isoformat()
    assert client.get(f"/api/caja/resumen?fecha={manana}").status_code == 400


def test_se_puede_cuadrar_la_caja_de_ayer(client, db, variante):
    """El caso que motivo todo esto: no dio tiempo de cerrar anoche, y se
    cierra al llegar en la manana.

    Lo importante no es solo que deje: es que el cierre quede archivado en
    AYER. Si se guardara con la fecha de hoy, el historico mentiria y el dia
    de hoy arrancaria con el saldo equivocado.
    """
    import datetime

    from app import models

    p = client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": 1}], "nota": ""},
    ).json()
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})

    # La venta se corre a ayer, como si se hubiera cobrado anoche.
    ayer = datetime.date.today() - datetime.timedelta(days=1)
    pedido = db.query(models.Pedido).filter_by(id=p["id"]).first()
    anoche = datetime.datetime.combine(ayer, datetime.time(20, 30))
    pedido.cerrado_en = anoche
    # Y su asiento con el: en la vida real la venta y su asiento son del mismo
    # dia. Moviendo solo el pedido, los libros dirian que ayer no entro nada.
    for a in db.query(models.AsientoContable).filter_by(origen="venta", referencia_id=pedido.id):
        a.fecha = anoche
    db.commit()
    # La sesion es la misma que usa el endpoint: sin esto responde con el
    # pedido que tiene cacheado, con la fecha vieja.
    db.expire_all()

    # Hoy no hay nada; ayer si.
    assert resumen(client)["vendido"] == 0
    de_ayer = resumen(client, ayer.isoformat())
    assert de_ayer["vendido"] == 5.0
    assert de_ayer["es_hoy"] is False
    assert linea(de_ayer, "Efectivo Bs")["ventas"] == 5.0

    r = client.post("/api/caja/cerrar", json={
        "fecha": ayer.isoformat(),
        "conteos": [{"metodo": "Efectivo Bs", "contado": 5.0}],
    })
    assert r.status_code == 200, r.text
    assert r.json()["diferencia"] == 0

    # Archivado en ayer, no en hoy.
    guardado = db.query(models.CierreCaja).filter_by(id=r.json()["id"]).first()
    assert guardado.fecha.date() == ayer
    assert resumen(client, ayer.isoformat())["cerrada"] is True
    assert resumen(client)["cerrada"] is False


def test_pagarle_a_un_proveedor_en_efectivo_baja_lo_que_debe_haber(client, db, variante):
    """Lo que no es venta ni gasto tambien mueve la gaveta.

    Si se ignorara, contar el efectivo daria un faltante del tamano de lo que
    se le pago al proveedor -- que es exactamente lo que le paso a Savora.
    """
    from app import contabilidad, models

    vender(client, variante, "Efectivo Bs")
    insumo = models.Ingrediente(nombre="Harina", unidad="kg", costo_unitario=1.0)
    db.add(insumo)
    db.flush()
    contabilidad.registrar_compra_insumo(
        db, insumo, 2.0, referencia_id=insumo.id, metodo_pago="Efectivo Bs"
    )
    db.commit()
    db.expire_all()

    efectivo = linea(resumen(client), "Efectivo Bs")
    assert efectivo["ventas"] == 5.0
    assert efectivo["otros"] == -2.0
    assert efectivo["esperado"] == 3.0
