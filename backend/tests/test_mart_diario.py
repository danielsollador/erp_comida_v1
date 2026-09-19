"""El mart diario: los numeros de un dia cerrado se calculan una vez y las
pantallas los leen de ahi.

Lo que se prueba es la promesa central: el reporte da EXACTAMENTE lo mismo
venga del mart o de los pedidos; un dia pasado que cambia se recalcula; hoy
nunca se congela; y la contabilidad suma igual con y sin mart.
"""
import datetime

from app import consolidacion, contabilidad, models
from app.timeutils import hoy, inicio_del_dia


def comanda(client, variante, cantidad=1):
    return client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": cantidad}], "nota": ""},
    ).json()


def cobrar(client, pedido_id, metodo="Efectivo $", **extra):
    r = client.post(f"/api/pedidos/{pedido_id}/cobrar", json={"metodo_pago": metodo, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def mover(db, pedido_id, dias_atras, hora=12):
    """Lleva la venta Y su asiento a hace N dias: el mart parte por fecha."""
    p = db.get(models.Pedido, pedido_id)
    cuando = inicio_del_dia(hoy()) - datetime.timedelta(days=dias_atras) + datetime.timedelta(hours=hora)
    p.creado_en = cuando
    if p.cerrado_en:
        p.cerrado_en = cuando
    for a in db.query(models.AsientoContable).filter_by(origen="venta", referencia_id=pedido_id).all():
        a.fecha = cuando
    db.commit()


def vender_hace(client, db, variante, dias_atras, cantidad=1, hora=12, metodo="Efectivo $"):
    p = comanda(client, variante, cantidad)
    # Los pagos electronicos exigen referencia; el efectivo no.
    cobrar(client, p["id"], metodo, **({} if metodo.startswith("Efectivo") else {"referencia": "REF-1"}))
    mover(db, p["id"], dias_atras, hora)
    return p["id"]


def iso(dias_atras=0):
    return (hoy() - datetime.timedelta(days=dias_atras)).isoformat()


def ayer():
    return hoy() - datetime.timedelta(days=1)


def resumen(client, dias_atras_desde, dias_atras_hasta=0):
    r = client.get(f"/api/reportes/resumen?desde={iso(dias_atras_desde)}&hasta={iso(dias_atras_hasta)}")
    assert r.status_code == 200, r.text
    return r.json()


def sin_ruido(r):
    """Lo comparable entre dos lecturas: todo menos la marca de tiempo."""
    r = dict(r)
    r.pop("consolidado_en", None)
    return r


# ── la promesa: mismo numero venga de donde venga ────────────────────────────


def test_el_reporte_da_lo_mismo_desde_el_mart_que_en_vivo(client, db, variante):
    for d, n in ((1, 2), (1, 1), (2, 3), (0, 1)):
        vender_hace(client, db, variante, d, cantidad=n, hora=9 + n)
    en_vivo = resumen(client, 7)
    assert en_vivo["consolidado_en"] is None, "nada consolidado todavia"

    # Se consolida desde el primer dato del local (hace dos dias) hasta ayer;
    # antes no hay nada que guardar.
    assert consolidacion.consolidar_pendientes(db) == 2
    desde_mart = resumen(client, 7)
    assert desde_mart["consolidado_en"] is not None
    assert sin_ruido(desde_mart) == sin_ruido(en_vivo)
    # Incluye la parte que mas facil se rompe al agregar: la serie, el mapa,
    # los productos, la mediana y el periodo anterior.
    assert desde_mart["serie"] == en_vivo["serie"]
    assert desde_mart["calor"] == en_vivo["calor"]
    assert desde_mart["top_productos"] == en_vivo["top_productos"]
    assert desde_mart["ticket_mediano"] == en_vivo["ticket_mediano"]
    assert desde_mart["anterior"] == en_vivo["anterior"]


def test_hoy_nunca_se_consolida(db):
    import pytest

    with pytest.raises(ValueError):
        consolidacion.consolidar_dia(db, hoy())
    assert hoy() not in {d for d in consolidacion.dias_pendientes(db)}


def test_el_dia_de_hoy_se_calcula_en_vivo_aunque_ayer_venga_del_mart(client, db, variante):
    vender_hace(client, db, variante, 1)
    consolidacion.consolidar_pendientes(db)
    antes = resumen(client, 1)
    assert antes["ventas"] == 5.0
    # Una venta de hoy aparece sin esperar a ninguna noche.
    vender_hace(client, db, variante, 0)
    despues = resumen(client, 1)
    assert despues["ventas"] == 10.0
    assert despues["pedidos"] == 2


def test_una_semana_que_no_cambio_no_vuelve_a_leer_pedidos(client, db, variante):
    """Con todo consolidado, el rango entero de dias pasados sale del mart:
    borrar los pedidos de la tabla no cambia el reporte. Es la prueba mas
    directa de que ya no se recorren."""
    vender_hace(client, db, variante, 1, cantidad=2)
    vender_hace(client, db, variante, 3)
    consolidacion.consolidar_pendientes(db)
    antes = resumen(client, 6, 1)
    # Se saca la mesa de abajo: si el reporte siguiera leyendo pedidos, esto lo
    # dejaria en cero.
    db.query(models.PedidoConsumo).delete()
    db.query(models.PedidoItem).delete()
    db.query(models.PagoPedido).delete()
    db.query(models.Pedido).delete()
    db.commit()
    despues = resumen(client, 6, 1)
    assert sin_ruido(despues) == sin_ruido(antes)
    assert despues["ventas"] == 15.0


# ── cuando un dia pasado cambia ──────────────────────────────────────────────


def test_devolver_una_venta_de_ayer_recalcula_ayer(client, db, variante):
    pid = vender_hace(client, db, variante, 1, cantidad=2)
    consolidacion.consolidar_pendientes(db)
    assert resumen(client, 1, 1)["ventas"] == 10.0
    assert db.query(models.DmVentaDia).filter_by(fecha=ayer()).count() == 1

    r = client.post(f"/api/pedidos/{pid}/devolver", json={"recuperable": False, "motivo": "mala"})
    assert r.status_code == 200, r.text
    # El dia se invalido: se borra del mart y se calcula en vivo, ya sin esa venta.
    assert db.query(models.DmVentaDia).filter_by(fecha=ayer()).count() == 0
    assert resumen(client, 1, 1)["ventas"] == 0.0
    # La noche siguiente lo guarda otra vez, ya correcto.
    consolidacion.consolidar_pendientes(db)
    assert resumen(client, 1, 1)["ventas"] == 0.0
    assert db.query(models.DmVentaDia).filter_by(fecha=ayer()).count() == 1


def test_facturar_tarde_una_venta_de_ayer_recalcula_ayer(client, db, variante):
    pid = vender_hace(client, db, variante, 1)
    consolidacion.consolidar_pendientes(db)
    assert resumen(client, 1, 1)["facturadas"] == 0
    r = client.post(f"/api/pedidos/{pid}/facturar", json={"numero_factura": "00-77"})
    assert r.status_code == 200, r.text
    assert resumen(client, 1, 1)["facturadas"] == 1
    assert resumen(client, 1, 1)["iva_cobrado"] > 0


def test_un_asiento_manual_con_fecha_de_ayer_recalcula_la_contabilidad_de_ayer(client, db, variante):
    vender_hace(client, db, variante, 1)
    consolidacion.consolidar_pendientes(db)
    gastos_antes = resumen(client, 1, 1)["gastos"]
    fecha = inicio_del_dia(ayer()) + datetime.timedelta(hours=15)
    contabilidad.crear_asiento(
        db, "Alquiler de ayer", [("6010", 40.0, 0.0), ("1010", 0.0, 40.0)], origen="manual", fecha=fecha
    )
    db.commit()
    assert db.query(models.DmVentaDia).filter_by(fecha=ayer()).count() == 0, "se invalido"
    assert resumen(client, 1, 1)["gastos"] == round(gastos_antes + 40.0, 2)


def test_anular_una_comanda_de_ayer_recalcula_ayer(client, db, variante):
    p = comanda(client, variante)
    mover(db, p["id"], 1)
    consolidacion.consolidar_pendientes(db)
    assert resumen(client, 1, 1)["pedidos_anulados"] == 0
    r = client.post(f"/api/pedidos/{p['id']}/anular", json={"perdida": False})
    assert r.status_code == 200, r.text
    assert resumen(client, 1, 1)["pedidos_anulados"] == 1


# ── la contabilidad ──────────────────────────────────────────────────────────


def test_las_sumas_por_cuenta_son_iguales_con_y_sin_mart(client, db, variante):
    vender_hace(client, db, variante, 2, cantidad=3)
    vender_hace(client, db, variante, 1)
    vender_hace(client, db, variante, 0)
    cuentas = db.query(models.CuentaContable).all()
    en_vivo = {c.codigo: contabilidad.sumas_de_cuenta(db, c.id) for c in cuentas}
    del_periodo = {
        c.codigo: contabilidad.sumas_de_cuenta(db, c.id, inicio_del_dia(hoy() - datetime.timedelta(days=2)), inicio_del_dia(hoy()))
        for c in cuentas
    }
    consolidacion.consolidar_pendientes(db)
    assert {c.codigo: contabilidad.sumas_de_cuenta(db, c.id) for c in cuentas} == en_vivo
    assert {
        c.codigo: contabilidad.sumas_de_cuenta(db, c.id, inicio_del_dia(hoy() - datetime.timedelta(days=2)), inicio_del_dia(hoy()))
        for c in cuentas
    } == del_periodo
    # Y el estado de resultados de la pantalla, que pasa por lo mismo.
    r = client.get(f"/api/contabilidad/estado-resultados?desde={iso(2)}&hasta={iso(0)}")
    assert r.status_code == 200, r.text
    assert r.json()["ingresos"] == 25.0


def test_las_ventas_del_modulo_de_ventas_tambien_salen_del_mart(client, db, variante):
    vender_hace(client, db, variante, 1, cantidad=2, metodo="Pago movil")
    en_vivo = client.get(f"/api/ventas/resumen?desde={iso(1)}&hasta={iso(1)}").json()
    consolidacion.consolidar_pendientes(db)
    del_mart = client.get(f"/api/ventas/resumen?desde={iso(1)}&hasta={iso(1)}").json()
    assert del_mart == en_vivo
    assert del_mart["ventas"] == 10.0
    assert del_mart["por_metodo_pago"] == {"Pago movil": 10.0}


# ── la corrida nocturna ──────────────────────────────────────────────────────


def test_la_version_del_calculo_manda_recalcular(client, db, variante):
    vender_hace(client, db, variante, 1)
    consolidacion.consolidar_pendientes(db)
    fila = db.query(models.DmVentaDia).filter_by(fecha=ayer()).one()
    fila.version = 0
    db.commit()
    assert ayer() in consolidacion.dias_pendientes(db)
    consolidacion.consolidar_pendientes(db)
    assert db.query(models.DmVentaDia).filter_by(fecha=ayer()).one().version == consolidacion.VERSION


def test_la_proxima_corrida_es_a_las_tres_y_media():
    a_las_dos = datetime.datetime(2026, 9, 20, 2, 0)
    assert consolidacion._segundos_hasta_la_proxima(a_las_dos) == 90 * 60
    a_las_cuatro = datetime.datetime(2026, 9, 20, 4, 0)
    assert consolidacion._segundos_hasta_la_proxima(a_las_cuatro) == 23.5 * 3600
