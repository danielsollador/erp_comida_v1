"""Que facturar tarde no deje al mayor diciendo una cosa y al Libro otra.

Facturar despues de cobrar es, contablemente, mover plata de "ingreso" a "IVA
por pagar". La pregunta que decide si el modulo esta bien o mal no es si el
asiento cuadra -eso lo garantiza `crear_asiento`- sino EN QUE MES cae:

  - el Libro de Ventas pone la factura en el mes de la venta (`cerrado_en`),
  - la declaracion del SENIAT se arma con ese libro,
  - y Reportes muestra "ventas cobradas - IVA = ingreso del negocio" mezclando
    los pedidos (mes de la venta) con el mayor.

Si el ajuste se fecha el dia en que el dueno agarro el talonario, los tres se
contradicen. Estas pruebas cierran esa puerta.
"""

import datetime

from app import contabilidad, models

from conftest import libros, libros_cuadrados, saldo  # noqa: F401


def cobrada(client, variante, cantidad=1):
    p = client.post("/api/pedidos", json={
        "items": [{"variante_id": variante.id, "cantidad": cantidad}], "nota": "",
    }).json()
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={
        "metodo_pago": "Efectivo Bs", "facturado": False,
    })
    assert r.status_code == 200, r.text
    return r.json()


def envejecer(db, pedido_id, dias):
    """Mueve la venta al pasado, que es el caso que importa: facturar hoy algo
    que se vendio la semana pasada."""
    p = db.query(models.Pedido).filter_by(id=pedido_id).first()
    p.cerrado_en = p.cerrado_en - datetime.timedelta(days=dias)
    asiento = (
        db.query(models.AsientoContable).filter_by(origen="venta", referencia_id=pedido_id).first()
    )
    if asiento:
        asiento.fecha = p.cerrado_en
    db.commit()
    return p.cerrado_en


def test_el_ajuste_cae_en_el_mes_de_la_venta_no_en_el_de_hoy(client, variante, db):
    v = cobrada(client, variante)
    fecha_venta = envejecer(db, v["id"], dias=40)

    r = client.post(f"/api/pedidos/{v['id']}/facturar", json={"numero_factura": "FT-100"})
    assert r.status_code == 200, r.text

    asiento = (
        db.query(models.AsientoContable)
        .filter_by(origen="factura_tardia", referencia_id=v["id"])
        .first()
    )
    assert asiento is not None
    assert asiento.fecha == fecha_venta, (
        "el ajuste se fecho el dia que se factura y no el dia que se vendio: "
        "el IVA queda en un mes y el Libro de Ventas en otro"
    )


def test_el_iva_del_mayor_coincide_con_el_del_libro_de_ventas(client, variante, db):
    """La prueba que de verdad importa: lo que el mayor dice que se le debe al
    SENIAT por ese mes tiene que ser lo mismo que dice el libro que se presenta.
    """
    v = cobrada(client, variante, cantidad=4)
    fecha = envejecer(db, v["id"], dias=40)
    client.post(f"/api/pedidos/{v['id']}/facturar", json={"numero_factura": "FT-101"})

    inicio = datetime.datetime(fecha.year, fecha.month, 1)
    fin = (
        datetime.datetime(fecha.year + 1, 1, 1)
        if fecha.month == 12
        else datetime.datetime(fecha.year, fecha.month + 1, 1)
    )
    libro = client.get(
        f"/api/impuestos/libro-ventas?desde={inicio.date()}&hasta={(fin - datetime.timedelta(days=1)).date()}"
    ).json()

    cuenta = db.query(models.CuentaContable).filter_by(codigo="2030").first()
    movimientos = (
        db.query(models.MovimientoContable)
        .join(models.AsientoContable)
        .filter(
            models.MovimientoContable.cuenta_id == cuenta.id,
            models.AsientoContable.fecha >= inicio,
            models.AsientoContable.fecha < fin,
        )
        .all()
    )
    iva_mayor = round(sum(m.haber - m.debe for m in movimientos), 2)

    assert abs(iva_mayor - libro["total_iva"]) < 0.02, (
        f"el mayor dice {iva_mayor} de IVA en ese mes y el libro {libro['total_iva']}"
    )


def test_el_ingreso_del_mes_de_la_venta_queda_neto_de_iva(client, variante, db):
    """Reportes resta el IVA de las ventas del mes y espera que el ingreso del
    mayor de esa misma cifra. Con el ajuste fechado hoy, el mes de la venta
    restaba un IVA que el mayor todavia no habia sacado de 4010."""
    v = cobrada(client, variante, cantidad=3)
    fecha = envejecer(db, v["id"], dias=40)
    client.post(f"/api/pedidos/{v['id']}/facturar", json={"numero_factura": "FT-102"})

    inicio = datetime.datetime(fecha.year, fecha.month, 1)
    fin = (
        datetime.datetime(fecha.year + 1, 1, 1)
        if fecha.month == 12
        else datetime.datetime(fecha.year, fecha.month + 1, 1)
    )
    resumen = client.get(
        f"/api/reportes/resumen?desde={inicio.date()}&hasta={(fin - datetime.timedelta(days=1)).date()}"
    ).json()

    assert abs(
        resumen["ventas"] - resumen["iva_cobrado"] - resumen["ingresos_netos"]
    ) < 0.02, (
        f"ventas {resumen['ventas']} - IVA {resumen['iva_cobrado']} no da el "
        f"ingreso del mayor {resumen['ingresos_netos']}"
    )


def test_facturar_tarde_no_le_inventa_un_hueco_al_mes_de_hoy(client, variante, db):
    """El otro lado del mismo error: si el ajuste se fecha hoy, hoy pierde una
    base imponible de una venta que hoy nunca ocurrio."""
    hoy = datetime.date.today()
    antes = client.get(f"/api/reportes/resumen?desde={hoy}&hasta={hoy}").json()["ingresos_netos"]

    v = cobrada(client, variante, cantidad=2)
    envejecer(db, v["id"], dias=40)
    client.post(f"/api/pedidos/{v['id']}/facturar", json={"numero_factura": "FT-103"})

    despues = client.get(f"/api/reportes/resumen?desde={hoy}&hasta={hoy}").json()["ingresos_netos"]
    assert abs(antes - despues) < 0.02, (
        "facturar una venta vieja movio el ingreso de hoy"
    )


def test_los_libros_siguen_cuadrados_despues_de_facturar_tarde(client, variante, db, libros):
    v = cobrada(client, variante, cantidad=2)
    envejecer(db, v["id"], dias=40)
    client.post(f"/api/pedidos/{v['id']}/facturar", json={"numero_factura": "FT-104"})
    libros_cuadrados(client, db)


def test_devolver_una_venta_facturada_tarde_deja_el_iva_en_cero(client, variante, db, libros):
    """Si la venta se devuelve, el IVA que nacio con la factura tardia tiene
    que morir con la devolucion: si no, el negocio le sigue debiendo al SENIAT
    por una venta que ya no existe."""
    v = cobrada(client, variante, cantidad=2)
    iva_antes = saldo(db, "2030")
    envejecer(db, v["id"], dias=40)
    client.post(f"/api/pedidos/{v['id']}/facturar", json={"numero_factura": "FT-105"})
    assert saldo(db, "2030") > iva_antes

    r = client.post(
        f"/api/pedidos/{v['id']}/devolver",
        json={"recuperable": True, "motivo": "se arrepintio", "nota_credito": "NC-9"},
    )
    assert r.status_code == 200, r.text
    assert abs(saldo(db, "2030") - iva_antes) < 0.02
    libros_cuadrados(client, db)


# ── Los periodos que ya se firmaron ─────────────────────────────────────────


def test_no_se_puede_facturar_dentro_de_un_mes_ya_declarado(client, variante, db):
    v = cobrada(client, variante)
    fecha = envejecer(db, v["id"], dias=40)
    db.add(models.DeclaracionIva(anio=fecha.year, mes=fecha.month, iva_debito=0, iva_credito=0))
    db.commit()

    r = client.post(f"/api/pedidos/{v['id']}/facturar", json={"numero_factura": "FT-200"})
    assert r.status_code == 409, r.text
    assert "declarado" in r.json()["detail"]


def test_no_se_puede_facturar_dentro_de_un_ejercicio_ya_cerrado(client, variante, db):
    v = cobrada(client, variante)
    fecha = envejecer(db, v["id"], dias=40)
    contabilidad.crear_asiento(
        db,
        f"Cierre del ejercicio {fecha.year}",
        [("4010", 1.0, 0.0), ("3020", 0.0, 1.0)],
        origen="cierre_ejercicio",
        referencia_id=fecha.year,
        fecha=datetime.datetime(fecha.year, 12, 31, 23, 59, 59),
    )
    db.commit()

    r = client.post(f"/api/pedidos/{v['id']}/facturar", json={"numero_factura": "FT-201"})
    assert r.status_code == 409, r.text
    assert "cerrado" in r.json()["detail"]


def test_un_mes_declarado_no_bloquea_facturar_una_venta_de_otro_mes(client, variante, db):
    """El candado tiene que ser del mes de la venta, no global: si no, declarar
    una vez dejaria al dueno sin poder facturar nada nunca mas."""
    v = cobrada(client, variante)
    fecha = envejecer(db, v["id"], dias=40)
    anterior = (fecha.replace(day=1) - datetime.timedelta(days=1))
    db.add(models.DeclaracionIva(anio=anterior.year, mes=anterior.month, iva_debito=0, iva_credito=0))
    db.commit()

    r = client.post(f"/api/pedidos/{v['id']}/facturar", json={"numero_factura": "FT-202"})
    assert r.status_code == 200, r.text
