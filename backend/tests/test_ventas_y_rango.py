"""El modulo de Ventas y el filtro de fechas que comparte todo el ERP.

Lo que se prueba es lo que un dueño va a mirar: que una venta aparezca en su
dia con lo que le paso, que el promedio diario divida entre los dias que YA
pasaron, que lo perdido se sume solo con lo que de verdad se perdio, y que
`desde`/`hasta` filtren igual en cada lista mientras `periodo=` y `dias=`
siguen funcionando para los enlaces viejos.
"""
import datetime

from app import models
from app.rango import Rango, dias_transcurridos, etiqueta, granularidad, serie
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


def mover(db, pedido_id, dias_atras):
    """Lleva una venta a hace N dias, para tener historico que filtrar."""
    p = db.query(models.Pedido).get(pedido_id)
    cuando = inicio_del_dia(hoy()) - datetime.timedelta(days=dias_atras) + datetime.timedelta(hours=12)
    p.creado_en = cuando
    if p.cerrado_en:
        p.cerrado_en = cuando
    db.commit()


def iso(dias_atras=0):
    return (hoy() - datetime.timedelta(days=dias_atras)).isoformat()


# ── el rango en si ───────────────────────────────────────────────────────────


def test_desde_hasta_son_inclusive_y_se_ordenan_solos():
    d, h = datetime.date(2026, 9, 1), datetime.date(2026, 9, 16)
    inicio, fin, _ = Rango(desde=h, hasta=d).resolver()
    assert inicio == datetime.datetime(2026, 9, 1)
    assert fin == datetime.datetime(2026, 9, 17), "el 16 entra entero"


def test_sin_parametros_cada_endpoint_conserva_su_defecto():
    inicio, fin, _ = Rango().resolver(dias=30)
    assert (fin - inicio).days == 30
    inicio, fin, _ = Rango().resolver(periodo="mes")
    assert inicio.day == 1


def test_los_parametros_viejos_siguen_valiendo():
    inicio, _, _ = Rango(periodo="semana").resolver()
    assert inicio.weekday() == 0
    inicio, fin, et = Rango(anio=2026, mes=2).resolver()
    assert (inicio.month, fin.month) == (2, 3) and et == "Febrero 2026"
    inicio, fin, _ = Rango(dias=7).resolver(dias=30)
    assert (fin - inicio).days == 7, "el dias= de la peticion manda sobre el del endpoint"


def test_etiqueta_legible():
    assert etiqueta(datetime.date(2026, 9, 1), datetime.date(2026, 9, 30)) == "Septiembre 2026"
    assert etiqueta(datetime.date(2026, 9, 1), datetime.date(2026, 9, 16)) == "01/09 – 16/09/2026"
    assert etiqueta(datetime.date(2025, 12, 1), datetime.date(2026, 1, 5)) == "01/12/2025 – 05/01/2026"


def test_granularidad_segun_el_tamano():
    d0 = datetime.datetime(2026, 1, 1)
    assert granularidad(d0, d0 + datetime.timedelta(days=1)) == "hora"
    assert granularidad(d0, d0 + datetime.timedelta(days=30)) == "dia"
    assert granularidad(d0, d0 + datetime.timedelta(days=120)) == "semana"
    assert granularidad(d0, d0 + datetime.timedelta(days=800)) == "mes"


def test_la_serie_trae_los_dias_en_cero():
    d0 = datetime.datetime(2026, 9, 1)
    puntos = serie([(datetime.datetime(2026, 9, 3, 13), 10.0)], d0, d0 + datetime.timedelta(days=5))
    assert [p["etiqueta"] for p in puntos] == ["01/09", "02/09", "03/09", "04/09", "05/09"]
    assert [p["ventas"] for p in puntos] == [0, 0, 10.0, 0, 0]


def test_dias_transcurridos_no_cuenta_el_futuro():
    inicio = inicio_del_dia(hoy().replace(day=1))
    fin = inicio + datetime.timedelta(days=40)
    assert dias_transcurridos(inicio, fin) == hoy().day


# ── ventas ───────────────────────────────────────────────────────────────────


def test_cada_venta_aparece_con_lo_que_le_paso(client, db, variante):
    cobrada = comanda(client, variante)
    cobrar(client, cobrada["id"])

    fiada = comanda(client, variante)
    cobrar(client, fiada["id"], metodo="Fiado", cliente="Pedro")

    anulada = comanda(client, variante)
    r = client.post(f"/api/pedidos/{anulada['id']}/anular", json={"motivo": "se equivoco"})
    assert r.status_code == 200, r.text

    devuelta = comanda(client, variante)
    cobrar(client, devuelta["id"])
    r = client.post(f"/api/pedidos/{devuelta['id']}/devolver", json={"motivo": "fria"})
    assert r.status_code == 200, r.text

    abierta = comanda(client, variante)

    lista = client.get("/api/ventas").json()
    assert lista["total"] == 5 and not lista["recortado"]
    por_id = {f["id"]: f for f in lista["filas"]}
    assert por_id[cobrada["id"]]["estado"] == "cobrada"
    assert por_id[fiada["id"]]["estado"] == "fiada"
    assert por_id[fiada["id"]]["cliente"] == "Pedro"
    assert por_id[fiada["id"]]["fiado_pendiente"] == 5.0
    assert por_id[anulada["id"]]["estado"] == "anulada"
    assert por_id[devuelta["id"]]["estado"] == "devuelta"
    assert por_id[abierta["id"]]["estado"] == "abierta"
    assert por_id[cobrada["id"]]["detalle"] == "1× Empanada - Carne"
    assert por_id[cobrada["id"]]["pago"] == "Efectivo $"

    solo_fiadas = client.get("/api/ventas?estado=fiada").json()
    assert [f["id"] for f in solo_fiadas["filas"]] == [fiada["id"]]


def test_el_rango_filtra_y_lo_de_ayer_no_es_de_hoy(client, db, variante):
    ayer = comanda(client, variante)
    cobrar(client, ayer["id"])
    mover(db, ayer["id"], 1)
    hoy_ = comanda(client, variante)
    cobrar(client, hoy_["id"])

    solo_hoy = client.get(f"/api/ventas?desde={iso()}&hasta={iso()}").json()
    assert [f["id"] for f in solo_hoy["filas"]] == [hoy_["id"]]
    ambos = client.get(f"/api/ventas?desde={iso(1)}&hasta={iso()}").json()
    assert {f["id"] for f in ambos["filas"]} == {ayer["id"], hoy_["id"]}
    # La mas reciente primero.
    assert ambos["filas"][0]["id"] == hoy_["id"]


def test_el_promedio_diario_divide_entre_los_dias_que_pasaron(client, db, variante):
    for dias in (0, 1, 2):
        p = comanda(client, variante, cantidad=2)
        cobrar(client, p["id"])
        mover(db, p["id"], dias)

    r = client.get(f"/api/ventas/resumen?desde={iso(2)}&hasta={iso()}").json()
    assert r["ventas"] == 30.0 and r["pedidos"] == 3 and r["dias"] == 3
    assert r["promedio_diario"] == 10.0
    assert r["pedidos_por_dia"] == 1.0
    assert r["ticket_promedio"] == 10.0
    assert r["granularidad"] == "dia"
    assert len(r["serie"]) == 3 and all(s["ventas"] == 10.0 for s in r["serie"])

    # Un rango que llega al futuro no infla el divisor.
    r = client.get(f"/api/ventas/resumen?desde={iso(2)}&hasta={iso(-10)}").json()
    assert r["dias"] == 3 and r["promedio_diario"] == 10.0


def test_lo_perdido_suma_solo_lo_que_de_verdad_se_perdio(client, db, variante):
    cobrar(client, comanda(client, variante, 2)["id"])  # $10 limpios

    con_descuento = comanda(client, variante, 2)
    cobrar(client, con_descuento["id"], descuento=2, motivo_descuento="amigo")  # $8

    anulada = comanda(client, variante, 4)  # $20 que nunca entraron
    client.post(f"/api/pedidos/{anulada['id']}/anular", json={"motivo": "x"})

    devuelta = comanda(client, variante, 1)
    cobrar(client, devuelta["id"])
    client.post(f"/api/pedidos/{devuelta['id']}/devolver", json={"motivo": "fria"})  # $5 que salieron

    fiada = comanda(client, variante, 3)
    cobrar(client, fiada["id"], metodo="Fiado", cliente="Ana")  # $15 por cobrar

    r = client.get("/api/ventas/resumen?periodo=dia").json()
    p = r["perdidas"]
    assert p["anuladas"] == 1 and p["valor_anulado"] == 20.0
    assert p["devueltas"] == 1 and p["valor_devuelto"] == 5.0
    assert p["con_descuento"] == 1 and p["valor_descuentos"] == 2.0
    assert p["fiado_pendiente"] == 1 and p["valor_fiado_pendiente"] == 15.0
    # Lo anulado nunca entro y lo fiado se puede cobrar: no son perdida.
    assert p["total"] == 5.0 + 2.0 + p["merma_inventario"]
    # Las ventas del periodo: cobradas + fiada; ni la devuelta ni la anulada.
    assert r["ventas"] == 10.0 + 8.0 + 15.0
    assert r["por_metodo_pago"]["Fiado"] == 15.0


def test_compara_con_el_periodo_anterior(client, db, variante):
    viejo = comanda(client, variante, 2)
    cobrar(client, viejo["id"])
    mover(db, viejo["id"], 1)
    cobrar(client, comanda(client, variante, 3)["id"])

    r = client.get(f"/api/ventas/resumen?desde={iso()}&hasta={iso()}").json()
    assert r["ventas"] == 15.0
    assert r["anterior"]["ventas"] == 10.0
    assert r["cambio_pct"] == 50.0


# ── el mismo filtro en las otras listas ──────────────────────────────────────


def test_reportes_acepta_desde_hasta_y_sigue_aceptando_periodo(client, db, variante):
    ayer = comanda(client, variante)
    cobrar(client, ayer["id"])
    mover(db, ayer["id"], 1)
    cobrar(client, comanda(client, variante)["id"])

    assert client.get("/api/reportes/resumen?periodo=dia").json()["ventas"] == 5.0
    r = client.get(f"/api/reportes/resumen?desde={iso(1)}&hasta={iso()}").json()
    assert r["ventas"] == 10.0
    assert r["granularidad"] == "dia" and len(r["serie"]) == 2
    assert r["periodo"] == "rango"
    # Combos ya no explota (antes leia `anio` y `mes` sin declararlos).
    assert client.get("/api/reportes/combos?periodo=mes").status_code == 200
    assert client.get(f"/api/reportes/combos?desde={iso(1)}&hasta={iso()}").status_code == 200


def test_gastos_facturas_y_mermas_filtran_por_el_mismo_rango(client, db, variante, insumo):
    r = client.post("/api/caja/gastos", json={"descripcion": "hielo", "monto": 3, "metodo_pago": "Banco"})
    assert r.status_code == 200, r.text
    g = db.query(models.Gasto).first()
    g.fecha = inicio_del_dia(hoy()) - datetime.timedelta(days=5, hours=-10)
    db.commit()

    assert len(client.get("/api/caja/gastos").json()) == 1, "los 30 dias por defecto siguen"
    assert client.get(f"/api/caja/gastos?desde={iso()}&hasta={iso()}").json() == []
    assert len(client.get(f"/api/caja/gastos?desde={iso(5)}&hasta={iso(5)}").json()) == 1
    assert len(client.get("/api/caja/gastos?dias=3").json()) == 0, "dias= sigue valiendo"

    r = client.post(
        f"/api/inventario/ingredientes/{insumo.id}/merma",
        json={"cantidad": 1, "motivo": "se daño"},
    )
    assert r.status_code == 200, r.text
    assert len(client.get("/api/inventario/mermas").json()) == 1
    assert client.get(f"/api/inventario/mermas?desde={iso(3)}&hasta={iso(2)}").json() == []

    assert client.get(f"/api/compras/facturas?desde={iso(2)}&hasta={iso()}").status_code == 200
    assert client.get(f"/api/caja/cierres?desde={iso(2)}&hasta={iso()}").status_code == 200
    assert client.get(f"/api/tasas/historial?desde={iso(2)}&hasta={iso()}").status_code == 200
    assert client.get(f"/api/contabilidad/asientos?desde={iso(2)}&hasta={iso()}").status_code == 200
    assert client.get(f"/api/contabilidad/estado-resultados?desde={iso(2)}&hasta={iso()}").status_code == 200
    assert client.get(f"/api/impuestos/libro-ventas?desde={iso(2)}&hasta={iso()}").status_code == 200
    assert client.get(f"/api/impuestos/resumen?desde={iso(2)}&hasta={iso()}").status_code == 200


def test_un_rango_absurdo_se_rechaza(client):
    assert client.get("/api/ventas?desde=2000-01-01&hasta=2026-01-01").status_code == 400
    assert client.get("/api/ventas?desde=ayer").status_code == 422
