"""Lo que el resumen trae para poder DIBUJARSE y compararse, y dos avisos de
la salud contable que gritaban sin motivo.

El reporte antes era una serie y una lista. Lo que se prueba aqui es lo que
se agrego para el dueño que mira la pantalla: el periodo anterior puesto al
lado, tramo a tramo; el mapa de cuando entra la gente; el reparto por
categoria del menu; y el dia tipico de la semana. Y dos correcciones: el
envio no es un producto "sin receta" (es un servicio, cuesta cero de verdad)
y una factura con flete no es una factura que "no suma".
"""
import datetime

from app import models, settings
from app.seed import CATEGORIA_ENVIOS, variantes_de_servicio
from app.timeutils import hoy, inicio_del_dia


def comanda(client, variante, cantidad=1):
    return client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": cantidad}], "nota": ""},
    ).json()


def cobrar(client, pedido_id, metodo="Efectivo $"):
    r = client.post(f"/api/pedidos/{pedido_id}/cobrar", json={"metodo_pago": metodo})
    assert r.status_code == 200, r.text
    return r.json()


def mover(db, pedido_id, dias_atras, hora=12):
    """Lleva una venta a hace N dias a esa hora, para tener historico."""
    p = db.get(models.Pedido, pedido_id)
    cuando = inicio_del_dia(hoy()) - datetime.timedelta(days=dias_atras) + datetime.timedelta(hours=hora)
    p.creado_en = cuando
    if p.cerrado_en:
        p.cerrado_en = cuando
    db.commit()


def vender_hace(client, db, variante, dias_atras, hora=12, cantidad=1, metodo="Efectivo $"):
    p = comanda(client, variante, cantidad)
    cobrar(client, p["id"], metodo)
    mover(db, p["id"], dias_atras, hora)
    return p["id"]


def iso(dias_atras=0):
    return (hoy() - datetime.timedelta(days=dias_atras)).isoformat()


def envio(db):
    return (
        db.query(models.Variante)
        .join(models.Producto)
        .join(models.Categoria)
        .filter(models.Categoria.nombre == CATEGORIA_ENVIOS)
        .first()
    )


# ── el periodo anterior, al lado ─────────────────────────────────────────────


def test_el_resumen_compara_con_el_periodo_anterior_del_mismo_tamano(client, db, variante):
    """Siete dias contra los siete anteriores: la comparativa trae el cambio
    en porcentaje y la etiqueta en palabras, y la serie anterior viene con
    la misma cantidad de tramos para poder superponerla."""
    # Esta semana (los ultimos 7 dias): 3 ventas de $5. La anterior: 2.
    for d in (0, 2, 4):
        vender_hace(client, db, variante, d)
    for d in (8, 10):
        vender_hace(client, db, variante, d)

    r = client.get(f"/api/reportes/resumen?desde={iso(6)}&hasta={iso(0)}").json()
    assert r["ventas"] == 15.0
    ant = r["anterior"]
    # Siete dias que casi nunca empiezan en lunes; el dia que si, se llama
    # "la semana pasada" y tambien esta bien.
    assert ant["etiqueta"] in ("el periodo anterior", "la semana pasada")
    assert ant["ventas"] == 10.0 and ant["pedidos"] == 2
    assert ant["cambio_ventas_pct"] == 50.0
    assert ant["cambio_pedidos_pct"] == 50.0
    assert ant["cambio_ticket_pct"] == 0.0, "mismo ticket de $5 en las dos"
    assert len(r["serie_anterior"]) == len(r["serie"]) == 7
    assert sum(p["ventas"] for p in r["serie_anterior"]) == 10.0
    # Las etiquetas son las de la serie actual: se dibuja encima de ella.
    assert [p["etiqueta"] for p in r["serie_anterior"]] == [p["etiqueta"] for p in r["serie"]]


def test_con_el_boton_de_hoy_la_comparativa_dice_ayer(client, db, variante):
    vender_hace(client, db, variante, 0)
    vender_hace(client, db, variante, 1)
    r = client.get("/api/reportes/resumen?periodo=dia").json()
    assert r["anterior"]["etiqueta"] == "ayer"
    assert r["anterior"]["ventas"] == 5.0
    # Por horas, la serie anterior se alinea por la hora, no por el indice.
    assert len(r["serie_anterior"]) == len(r["serie"])
    assert r["serie_anterior"][0]["ventas"] == 5.0, "ayer tambien vendio a las 12"


def test_sin_periodo_anterior_los_porcentajes_no_se_inventan(client, db, variante):
    vender_hace(client, db, variante, 0)
    r = client.get("/api/reportes/resumen?periodo=dia").json()
    assert r["anterior"]["ventas"] == 0.0
    assert r["anterior"]["cambio_ventas_pct"] is None, "dividir entre cero no es +infinito"


# ── cuando entra la gente ────────────────────────────────────────────────────


def test_el_mapa_de_calor_y_el_dia_de_la_semana_solo_con_varios_dias(client, db, variante):
    vender_hace(client, db, variante, 0, hora=9)
    r = client.get("/api/reportes/resumen?periodo=dia").json()
    assert r["calor"] == [] and r["por_dia_semana"] == [], "un dia se lee por horas"

    vender_hace(client, db, variante, 1, hora=9)
    vender_hace(client, db, variante, 1, hora=9)
    r = client.get(f"/api/reportes/resumen?desde={iso(1)}&hasta={iso(0)}").json()
    assert len(r["por_dia_semana"]) == 7, "lunes a domingo, siempre los siete"
    ayer = (hoy() - datetime.timedelta(days=1)).weekday()
    celdas = {(c["dia"], c["hora"]): c for c in r["calor"]}
    assert celdas[(ayer, 9)]["pedidos"] == 2
    assert celdas[(ayer, 9)]["ventas"] == 10.0
    assert celdas[(hoy().weekday(), 9)]["pedidos"] == 1


def test_el_dia_tipico_divide_entre_las_veces_que_ese_dia_cayo(client, db, variante):
    """Dos semanas: el dia de hoy vendio $5 la semana pasada y $15 hoy. Un dia
    tipico de esos vende $10, no $20."""
    vender_hace(client, db, variante, 7, cantidad=1)
    vender_hace(client, db, variante, 0, cantidad=3)
    r = client.get(f"/api/reportes/resumen?desde={iso(13)}&hasta={iso(0)}").json()
    de_hoy = next(d for d in r["por_dia_semana"] if d["pedidos"] == 2)
    assert de_hoy["ventas"] == 20.0
    assert de_hoy["promedio"] == 10.0
    assert de_hoy["pct"] == 100.0


# ── por categoria, y el envio no es "sin receta" ─────────────────────────────


def test_el_reparto_por_categoria_suma_la_venta_y_el_envio_va_aparte(client, db, variante):
    delivery = envio(db)
    pedido = client.post(
        "/api/pedidos",
        json={
            "items": [
                {"variante_id": variante.id, "cantidad": 2},
                {"variante_id": delivery.id, "cantidad": 1},
            ]
        },
    ).json()
    cobrar(client, pedido["id"])

    r = client.get("/api/reportes/resumen?periodo=dia").json()
    por_nombre = {g["nombre"]: g for g in r["por_categoria"]}
    assert por_nombre["Comida"]["ventas"] == 10.0
    assert por_nombre[CATEGORIA_ENVIOS]["ventas"] == delivery.precio
    assert round(sum(g["ventas"] for g in r["por_categoria"]), 2) == r["ventas"]
    assert round(sum(g["pct"] for g in r["por_categoria"])) == 100

    # El delivery costo cero porque es un servicio, no porque falte la receta.
    top = {p["nombre"]: p for p in r["top_productos"]}
    assert top["Delivery corto"]["sin_receta"] is False
    empanada = next(p for n, p in top.items() if n.startswith("Empanada"))
    assert empanada["sin_receta"] is False
    assert not any("sin receta" in i["titulo"] for i in r["insights"])


def test_un_producto_de_verdad_sin_receta_si_se_avisa(client, db):
    categoria = models.Categoria(nombre="Postres", orden=1)
    db.add(categoria)
    db.flush()
    producto = models.Producto(categoria_id=categoria.id, nombre="Torta")
    db.add(producto)
    db.flush()
    torta = models.Variante(producto_id=producto.id, nombre="Regular", precio=3.0)
    db.add(torta)
    db.commit()
    pedido = comanda(client, torta)
    cobrar(client, pedido["id"])

    r = client.get("/api/reportes/resumen?periodo=dia").json()
    assert r["top_productos"][0]["sin_receta"] is True
    assert any("sin receta" in i["titulo"] for i in r["insights"])


def test_variantes_de_servicio_son_solo_los_envios(db, variante):
    servicios = variantes_de_servicio(db)
    assert envio(db).id in servicios
    assert variante.id not in servicios


# ── la salud contable ya no grita sin motivo ─────────────────────────────────


def test_la_salud_no_pide_receta_para_el_delivery(client, db):
    delivery = envio(db)
    pedido = comanda(client, delivery)
    cobrar(client, pedido["id"])
    salud = client.get("/api/contabilidad/salud").json()
    assert not any("sin receta" in p["titulo"] for p in salud["problemas"]), salud


def test_una_factura_con_recargo_no_es_una_factura_que_no_suma(client, insumo):
    """El flete va en la cabecera y forma parte de la base. El chequeo
    comparaba los renglones contra la base sin el flete y toda factura con
    recargo salia como sospechosa."""
    r = client.post(
        "/api/compras/facturas",
        json={
            "numero_factura": "F-200",
            "proveedor_nombre": "Carnes SA",
            "proveedor_rif": "J123456789",
            "categoria": "Insumos",
            "forma_pago": "Efectivo",
            "recargo": 10.0,
            "items": [{"ingrediente_id": insumo.id, "cantidad": 10, "costo_unitario": 10.0}],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["base_imponible"] == 110.0
    salud = client.get("/api/contabilidad/salud").json()
    assert not any("no suman su base" in p["titulo"] for p in salud["problemas"]), salud


# ── el menu de ejemplo no vuelve solo ────────────────────────────────────────


def test_la_siembra_del_menu_demo_esta_apagada_por_defecto(client, db):
    """Limpiar la base para salir a produccion y reiniciar NO tiene que
    devolver los cafes y las empanadas de la demo. Solo la categoria de envios
    se asegura sola, porque es una funcion y no un dato de ejemplo."""
    assert settings.SEMBRAR_DEMO is False
    nombres = {c.nombre for c in db.query(models.Categoria).all()}
    assert nombres == {CATEGORIA_ENVIOS}
    assert db.query(models.Ingrediente).count() == 0
