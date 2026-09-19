"""Devolver una venta vieja no puede reescribir un mes ya declarado.

Una venta devuelta salia del Libro de Ventas, y punto. Eso funciona mientras
la devolucion cae en el mismo mes que la venta; pero si el cliente trae la
comida en octubre y esa factura ya se le declaro al SENIAT en septiembre,
borrarla de septiembre hace que el libro reimpreso deje de coincidir con la
declaracion firmada.

Lo correcto -y lo que hace cualquier contabilidad- es que la factura se quede
en su mes y la nota de credito entre en negativo en el mes en que se emitio.
"""

import datetime

from app import models

from conftest import libros, libros_cuadrados  # noqa: F401


def vendida_y_facturada(client, variante, numero, cantidad=2):
    p = client.post("/api/pedidos", json={
        "items": [{"variante_id": variante.id, "cantidad": cantidad}], "nota": "",
    }).json()
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={
        "metodo_pago": "Efectivo Bs", "facturado": True, "numero_factura": numero,
    })
    assert r.status_code == 200, r.text
    return r.json()


def envejecer(db, pedido_id, dias):
    p = db.query(models.Pedido).filter_by(id=pedido_id).first()
    p.cerrado_en = p.cerrado_en - datetime.timedelta(days=dias)
    asiento = (
        db.query(models.AsientoContable).filter_by(origen="venta", referencia_id=pedido_id).first()
    )
    if asiento:
        asiento.fecha = p.cerrado_en
    db.commit()
    return p.cerrado_en


def mes_de(fecha):
    inicio = datetime.datetime(fecha.year, fecha.month, 1)
    fin = (
        datetime.datetime(fecha.year + 1, 1, 1) if fecha.month == 12
        else datetime.datetime(fecha.year, fecha.month + 1, 1)
    )
    return inicio, fin


def libro(client, inicio, fin):
    return client.get(
        f"/api/impuestos/libro-ventas?desde={inicio.date()}"
        f"&hasta={(fin - datetime.timedelta(days=1)).date()}"
    ).json()


def test_la_factura_se_queda_en_su_mes_aunque_se_devuelva_despues(client, db, variante):
    v = vendida_y_facturada(client, variante, "F-500")
    fecha = envejecer(db, v["id"], dias=40)
    inicio, fin = mes_de(fecha)
    iva_antes = libro(client, inicio, fin)["total_iva"]
    assert iva_antes > 0

    r = client.post(f"/api/pedidos/{v['id']}/devolver", json={
        "recuperable": True, "motivo": "no le gusto", "nota_credito": "NC-500",
    })
    assert r.status_code == 200, r.text

    despues = libro(client, inicio, fin)
    assert despues["total_iva"] == iva_antes, (
        "devolver hoy borro la factura del mes en que se declaro"
    )
    assert any(f["numero_factura"] == "F-500" for f in despues["filas"])


def test_la_nota_de_credito_entra_en_el_mes_en_que_se_emitio(client, db, variante):
    v = vendida_y_facturada(client, variante, "F-501")
    envejecer(db, v["id"], dias=40)
    client.post(f"/api/pedidos/{v['id']}/devolver", json={
        "recuperable": True, "motivo": "fria", "nota_credito": "NC-501",
    })

    inicio, fin = mes_de(datetime.date.today())
    este_mes = libro(client, inicio, fin)
    nc = [f for f in este_mes["filas"] if f["numero_factura"] == "NC-501"]
    assert len(nc) == 1, "la nota de credito no aparece en el mes en que se emitio"
    assert nc[0]["total"] < 0 and nc[0]["iva"] < 0
    assert este_mes["total_iva"] < 0 or este_mes["total_iva"] == nc[0]["iva"]


def test_la_declaracion_del_mes_viejo_no_cambia(client, db, variante):
    """La prueba que importa: lo que el SENIAT vería si se reimprime."""
    v = vendida_y_facturada(client, variante, "F-502")
    fecha = envejecer(db, v["id"], dias=40)
    pendientes_antes = client.get("/api/impuestos/periodos-pendientes").json()
    debito_antes = {
        (p["anio"], p["mes"]): p["iva_debito"] for p in pendientes_antes
    }.get((fecha.year, fecha.month))
    assert debito_antes

    client.post(f"/api/pedidos/{v['id']}/devolver", json={
        "recuperable": True, "motivo": "x", "nota_credito": "NC-502",
    })

    pendientes = client.get("/api/impuestos/periodos-pendientes").json()
    debito = {(p["anio"], p["mes"]): p["iva_debito"] for p in pendientes}.get(
        (fecha.year, fecha.month)
    )
    assert debito == debito_antes


def test_vendida_y_devuelta_el_mismo_mes_sale_entera(client, variante):
    """Ese mes todavia no se declaro: no hay nada que corregir, y un par
    factura/NC que se anulan entre si solo ensuciaria el libro."""
    v = vendida_y_facturada(client, variante, "F-503")
    client.post(f"/api/pedidos/{v['id']}/devolver", json={
        "recuperable": True, "motivo": "x", "nota_credito": "NC-503",
    })

    inicio, fin = mes_de(datetime.date.today())
    filas = libro(client, inicio, fin)["filas"]
    numeros = [f["numero_factura"] for f in filas]
    assert "F-503" not in numeros
    assert "NC-503" not in numeros


def test_el_mayor_y_el_libro_dicen_lo_mismo_en_el_mes_de_la_nota(client, db, variante, libros):
    """`registrar_devolucion` asienta la reversion con fecha de hoy; el libro
    ahora pone la NC en ese mismo mes. Los dos tienen que coincidir."""
    v = vendida_y_facturada(client, variante, "F-504")
    envejecer(db, v["id"], dias=40)
    client.post(f"/api/pedidos/{v['id']}/devolver", json={
        "recuperable": True, "motivo": "x", "nota_credito": "NC-504",
    })

    inicio, fin = mes_de(datetime.date.today())
    total_iva_libro = libro(client, inicio, fin)["total_iva"]

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
    assert abs(iva_mayor - total_iva_libro) < 0.02, (
        f"el mayor dice {iva_mayor} y el libro {total_iva_libro}"
    )
    libros_cuadrados(client, db)


def test_una_venta_sin_facturar_devuelta_no_genera_nota(client, db, variante):
    """Lo que nunca entro al libro no tiene que salir de el."""
    p = client.post("/api/pedidos", json={
        "items": [{"variante_id": variante.id, "cantidad": 1}], "nota": "",
    }).json()
    v = client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"}).json()
    envejecer(db, v["id"], dias=40)
    client.post(f"/api/pedidos/{v['id']}/devolver", json={"recuperable": True, "motivo": "x"})

    inicio, fin = mes_de(datetime.date.today())
    assert libro(client, inicio, fin)["filas"] == []
