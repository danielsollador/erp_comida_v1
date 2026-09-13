"""Un test por hallazgo de la auditoria, para que ninguno vuelva en silencio.

Todos estos casos estaban rotos y ninguno hacia ruido: mostraban un numero
equivocado o corrompian datos sin avisar. Son justo los que no se pueden
detectar mirando la pantalla.
"""

import datetime

from app import contabilidad, costeo, models
from tests.conftest import saldo


# ---------------------------------------------------------------- E: costeo
def test_stock_negativo_no_dispara_el_costo_promedio():
    """Con -9.9 kg previos, comprar a $2 daba $101/kg: el stock negativo
    restaba valor al numerador y el denominador tendia a cero."""

    class Falso:
        def __init__(self, stock, costo):
            self.stock_actual, self.costo_unitario = stock, costo

    for stock_previo in (-9.9, -5, 0, 10):
        ing = Falso(stock_previo, 1.0)
        costeo.registrar_entrada(ing, 10, 2.0)
        assert 1.0 <= ing.costo_unitario <= 2.0, (
            f"con stock previo {stock_previo} el costo quedo en {ing.costo_unitario}"
        )


def test_el_stock_negativo_se_arrastra_aunque_no_promedie():
    class Falso:
        def __init__(self, stock, costo):
            self.stock_actual, self.costo_unitario = stock, costo

    ing = Falso(-5, 1.0)
    costeo.registrar_entrada(ing, 10, 2.0)
    assert ing.stock_actual == 5  # la deuda de inventario sigue existiendo


# ------------------------------------------------------- A/N: receta y stock
def test_el_consumo_descuenta_lo_bruto_no_lo_utilizable(db, insumo):
    """La receta guarda cantidad utilizable; del inventario sale mas, porque
    parte se pierde al limpiar. Antes se descontaba la neta mientras el costo
    usaba el costo real, y esa asimetria separaba el inventario contable del
    fisico."""
    receta = models.RecetaItem(variante_id=1, ingrediente_id=insumo.id, cantidad_por_unidad=0.1)
    receta.ingrediente = insumo
    # 0.1 kg utilizables con 80% de rendimiento -> 0.125 kg comprados
    assert costeo.consumo_bruto(receta, 1) == 0.125
    assert costeo.consumo_bruto(receta, 4) == 0.5


# ----------------------------------------------------------- D/K: inventario
def test_no_se_puede_vender_sin_inventario(client, variante):
    r = client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": 1000}], "nota": ""},
    )
    assert r.status_code == 409
    assert "No alcanza el inventario" in r.json()["detail"]


def test_se_puede_forzar_la_venta_con_aviso(client, variante):
    """El cajero tiene un cliente enfrente y el conteo del sistema puede estar
    atrasado: se permite, pero solo de forma explicita."""
    r = client.post(
        "/api/pedidos",
        json={
            "items": [{"variante_id": variante.id, "cantidad": 1000}],
            "nota": "",
            "permitir_sin_stock": True,
        },
    )
    assert r.status_code == 200


def test_el_stock_baja_al_crear_la_comanda_no_al_cobrar(client, db, variante, insumo):
    """La cocina gasta insumos cuando cocina. Descontar al cobrar dejaba una
    ventana donde el sistema creia tener lo que ya estaba en el sarten."""
    antes = insumo.stock_actual
    r = client.post(
        "/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 4}], "nota": ""}
    )
    db.refresh(insumo)
    assert insumo.stock_actual == antes - 0.5  # 4 x 0.125 kg brutos

    client.post(f"/api/pedidos/{r.json()['id']}/cobrar", json={"metodo_pago": "Efectivo"})
    db.refresh(insumo)
    assert insumo.stock_actual == antes - 0.5  # cobrar no vuelve a descontar


# ------------------------------------------------------------- J: anulacion
def test_anular_sin_preparar_devuelve_el_inventario(client, db, variante, insumo):
    antes = insumo.stock_actual
    r = client.post(
        "/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 2}], "nota": ""}
    )
    client.post(f"/api/pedidos/{r.json()['id']}/anular", json={"comida_preparada": False})
    db.refresh(insumo)
    assert insumo.stock_actual == antes


def test_anular_ya_preparado_registra_merma(client, db, variante, insumo):
    """La comida se hizo y se boto: el insumo no vuelve, es una perdida."""
    antes = insumo.stock_actual
    r = client.post(
        "/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 2}], "nota": ""}
    )
    client.post(f"/api/pedidos/{r.json()['id']}/anular", json={"comida_preparada": True})
    db.refresh(insumo)
    assert insumo.stock_actual == antes - 0.25
    assert db.query(models.Merma).count() == 1
    assert saldo(db, "6020") > 0


# ------------------------------------------------------------------ G/H: caja
def test_pagar_al_proveedor_en_efectivo_baja_la_gaveta(client):
    """Caja restaba solo los Gastos: los dias de pagarle al proveedor mostraba
    un faltante que no existia."""
    antes = client.get("/api/caja/resumen").json()["efectivo_esperado"]
    factura = client.post(
        "/api/compras/facturas",
        json={
            "numero_factura": "F-1",
            "proveedor_nombre": "Proveedor",
            "categoria": "Insumos",
            "forma_pago": "Credito",
            "base_imponible": 100,
            "iva": 16,
        },
    ).json()
    client.post(f"/api/compras/facturas/{factura['id']}/pagar", json={"forma_pago": "Efectivo"})
    despues = client.get("/api/caja/resumen").json()["efectivo_esperado"]
    assert round(antes - despues, 2) == 116.0


def test_un_gasto_por_banco_no_toca_la_gaveta(client):
    antes = client.get("/api/caja/resumen").json()["efectivo_esperado"]
    client.post(
        "/api/caja/gastos",
        json={"descripcion": "Sueldo", "categoria": "Sueldos", "monto": 50, "metodo_pago": "Banco"},
    )
    assert client.get("/api/caja/resumen").json()["efectivo_esperado"] == antes


def test_un_gasto_en_efectivo_si_baja_la_gaveta(client):
    antes = client.get("/api/caja/resumen").json()["efectivo_esperado"]
    client.post(
        "/api/caja/gastos",
        json={"descripcion": "Gas", "categoria": "Servicios", "monto": 12, "metodo_pago": "Efectivo"},
    )
    assert round(antes - client.get("/api/caja/resumen").json()["efectivo_esperado"], 2) == 12.0


# ------------------------------------------------------------------- S: borrados
def test_borrar_un_gasto_no_deja_movimientos_huerfanos(client, db):
    """El DELETE masivo sobre el query no dispara el cascade del ORM: los
    movimientos quedaban vivos y el balance los seguia sumando."""
    gasto = client.post(
        "/api/caja/gastos",
        json={"descripcion": "Prueba", "categoria": "Otros", "monto": 99, "metodo_pago": "Efectivo"},
    ).json()
    assert saldo(db, "6010") == 99.0

    client.delete(f"/api/caja/gastos/{gasto['id']}")
    huerfanos = (
        db.query(models.MovimientoContable)
        .outerjoin(
            models.AsientoContable,
            models.MovimientoContable.asiento_id == models.AsientoContable.id,
        )
        .filter(models.AsientoContable.id.is_(None))
        .count()
    )
    assert huerfanos == 0
    assert saldo(db, "6010") == 0.0


# ---------------------------------------------------------------- C/Q: reportes
def test_reportes_y_contabilidad_dan_el_mismo_resultado(client, variante):
    """Reportes contaba el IVA como ingreso propio e ignoraba las mermas: daba
    8.1% mas de ganancia que el Estado de Resultados por el mismo periodo."""
    pedido = client.post(
        "/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 2}], "nota": ""}
    ).json()
    client.post(
        f"/api/pedidos/{pedido['id']}/cobrar",
        json={"metodo_pago": "Efectivo", "facturado": True, "numero_factura": "00-1"},
    )
    client.post(
        "/api/caja/gastos",
        json={"descripcion": "Gas", "categoria": "Servicios", "monto": 3, "metodo_pago": "Efectivo"},
    )

    r = client.get("/api/reportes/resumen?periodo=mes").json()
    c = client.get("/api/contabilidad/estado-resultados?periodo=mes").json()
    assert r["ganancia_neta"] == c["utilidad_neta"]
    assert r["ingresos_netos"] == c["ingresos"]
    assert r["iva_cobrado"] > 0  # el IVA se separa, no se cuenta como ganancia


# -------------------------------------------------------------- T/U: mermas
def test_una_merma_se_puede_listar_y_revertir(client, db, insumo):
    """No habia endpoint para verlas ni deshacerlas: la unica salida era un
    conteo fisico, que arreglaba el stock y dejaba los libros peor."""
    antes = insumo.stock_actual
    client.post(f"/api/inventario/ingredientes/{insumo.id}/merma", json={"cantidad": 2, "motivo": "se dano"})
    db.refresh(insumo)
    assert insumo.stock_actual == antes - 2

    mermas = client.get("/api/inventario/mermas").json()
    assert len(mermas) == 1 and mermas[0]["valor"] == 16.0

    client.post(f"/api/inventario/mermas/{mermas[0]['id']}/revertir")
    db.refresh(insumo)
    assert insumo.stock_actual == antes
    assert saldo(db, "6020") == 0.0  # el gasto quedo neteado por el reverso
    assert client.get("/api/inventario/mermas").json()[0]["revertida"] is True


def test_un_sobrante_en_el_conteo_tambien_se_contabiliza(client, db, insumo):
    """Antes solo se asentaba el faltante: si sobraba, el stock subia en
    silencio y el inventario contable quedaba por debajo del real."""
    client.post(
        f"/api/inventario/ingredientes/{insumo.id}/ajustar",
        json={"stock_real": insumo.stock_actual + 3, "motivo": "conteo"},
    )
    assert saldo(db, "1040") == 24.0  # 3 kg x $8


# ----------------------------------------------------------------- W: tasa
def test_la_tasa_congelada_se_expone(client, db, variante):
    """Se guardaba y no se leia: el historico en bolivares se recalculaba con
    la tasa de hoy y cambiaba solo cada vez que subia el dolar."""
    db.add(models.TasaCambio(fecha=datetime.date.today(), bcv=800.0, origen="manual"))
    db.commit()
    pedido = client.post(
        "/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 1}], "nota": ""}
    ).json()
    cobrado = client.post(
        f"/api/pedidos/{pedido['id']}/cobrar", json={"metodo_pago": "Efectivo"}
    ).json()
    assert cobrado["tasa_bcv"] == 800.0
    assert client.get("/api/reportes/resumen?periodo=mes").json()["ventas_bs"] == 4000.0


# ------------------------------------------------------- R: salud contable
def test_la_salud_contable_detecta_el_inventario_sin_apertura(client, db, insumo):
    """Justo el escenario del hallazgo B: hay mercancia real y los libros en
    cero. El `cuadra` del balance general no lo ve, porque es una identidad de
    la partida doble y nunca falla."""
    salud = client.get("/api/contabilidad/salud").json()
    assert salud["sano"] is False
    assert "descuadrado" in " ".join(p["titulo"] for p in salud["problemas"])

    assert client.get("/api/contabilidad/balance-general").json()["cuadra"] is True

    contabilidad.asiento_de_apertura(db)
    assert client.get("/api/contabilidad/salud").json()["sano"] is True


def test_la_salud_contable_detecta_el_stock_negativo(client, db, insumo):
    contabilidad.asiento_de_apertura(db)
    insumo.stock_actual = -50
    db.commit()
    salud = client.get("/api/contabilidad/salud").json()
    assert salud["sano"] is False
    assert "negativo" in " ".join(p["titulo"] for p in salud["problemas"])


# ---------------------------------------------------------------- B: apertura
def test_el_asiento_de_apertura_registra_el_inventario_inicial(db, insumo):
    """Sin el, los libros arrancan en cero con mercancia real en el local y
    1040 se va a negativo apenas se vende."""
    contabilidad.asiento_de_apertura(db)
    assert saldo(db, "1040") == 80.0  # 10 kg x $8
    assert saldo(db, "3010") == 80.0

    contabilidad.asiento_de_apertura(db)  # idempotente
    assert saldo(db, "1040") == 80.0


# ------------------------------------------- Y/Z: producto sin receta (caso 9)
def test_un_producto_sin_receta_no_pasa_por_margen_perfecto(client, db, variante):
    """Vendia con costo 0 y margen 100%, salia como producto estrella, y de
    paso hundia el food cost hasta convertir la alerta en felicitacion."""
    sin_receta = models.Variante(
        producto_id=variante.producto_id, nombre="Sin receta", precio=100.0
    )
    db.add(sin_receta)
    db.commit()

    for vid in (variante.id, sin_receta.id):
        pedido = client.post(
            "/api/pedidos", json={"items": [{"variante_id": vid, "cantidad": 1}], "nota": ""}
        ).json()
        client.post(f"/api/pedidos/{pedido['id']}/cobrar", json={"metodo_pago": "Efectivo"})

    r = client.get("/api/reportes/resumen?periodo=mes").json()
    marcado = next(p for p in r["top_productos"] if p["nombre"].endswith("Sin receta"))
    assert marcado["sin_receta"] is True
    assert marcado["margen_pct"] == 0  # no se reporta el 100% ficticio

    titulos = " ".join(i["titulo"] for i in r["insights"])
    assert "sin receta" in titulos

    # El food cost se mide solo sobre lo que tiene costo conocido: 0.1 kg
    # utilizables a $10 (=$8 con 80% de rendimiento) sobre $5 de venta medible
    # da 20%. Contando los $100 del producto fantasma daria 1%, que es
    # exactamente como una alerta se volvia felicitacion.
    food_cost = next(i for i in r["insights"] if "insumos" in i["titulo"].lower())
    assert "20%" in food_cost["titulo"]


def test_la_salud_contable_avisa_de_ventas_sin_receta(client, db, variante):
    contabilidad.asiento_de_apertura(db)
    sin_receta = models.Variante(producto_id=variante.producto_id, nombre="Fantasma", precio=9.0)
    db.add(sin_receta)
    db.commit()
    pedido = client.post(
        "/api/pedidos", json={"items": [{"variante_id": sin_receta.id, "cantidad": 1}], "nota": ""}
    ).json()
    client.post(f"/api/pedidos/{pedido['id']}/cobrar", json={"metodo_pago": "Efectivo"})

    salud = client.get("/api/contabilidad/salud").json()
    assert salud["sano"] is False
    assert "sin receta" in " ".join(p["titulo"] for p in salud["problemas"])


# ------------------------------------------- DD/EE: precios (caso 10)
def test_subir_el_precio_no_toca_el_historico(client, db, variante):
    """El precio se congela por venta igual que el costo."""
    pedido = client.post(
        "/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 2}], "nota": ""}
    ).json()
    client.post(f"/api/pedidos/{pedido['id']}/cobrar", json={"metodo_pago": "Efectivo"})
    antes = client.get("/api/reportes/resumen?periodo=mes").json()["ventas"]

    client.put(
        f"/api/menu/variantes/{variante.id}",
        json={"nombre": variante.nombre, "precio": 99.0, "activo": True},
    )
    assert client.get("/api/reportes/resumen?periodo=mes").json()["ventas"] == antes


def test_cambiar_el_precio_deja_historial(client, variante):
    """Antes se sobrescribia y no quedaba forma de saber cuando ni desde cuanto."""
    assert client.get(f"/api/menu/variantes/{variante.id}/precios").json() == []

    client.put(
        f"/api/menu/variantes/{variante.id}",
        json={"nombre": variante.nombre, "precio": 6.0, "activo": True},
    )
    historial = client.get(f"/api/menu/variantes/{variante.id}/precios").json()
    assert len(historial) == 1
    assert historial[0]["precio_anterior"] == 5.0 and historial[0]["precio_nuevo"] == 6.0

    # guardar el mismo precio no ensucia el historial
    client.put(
        f"/api/menu/variantes/{variante.id}",
        json={"nombre": variante.nombre, "precio": 6.0, "activo": True},
    )
    assert len(client.get(f"/api/menu/variantes/{variante.id}/precios").json()) == 1


def test_se_avisa_de_los_productos_vendidos_bajo_costo(client, variante):
    """Con inflacion el costo sube solo y el precio no: el margen promedio del
    mes esconde que ya se esta vendiendo a perdida."""
    costos = client.get("/api/menu/costos").json()
    costo = next(c for c in costos if c["variante_id"] == variante.id)["costo"]
    assert costo == 1.0  # 0.1 kg utilizables a $10 (=$8 con 80% de rendimiento)

    pedido = client.post(
        "/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 1}], "nota": ""}
    ).json()
    client.post(f"/api/pedidos/{pedido['id']}/cobrar", json={"metodo_pago": "Efectivo"})
    titulos = " ".join(i["titulo"] for i in client.get("/api/reportes/resumen?periodo=mes").json()["insights"])
    assert "debajo de su costo" not in titulos

    client.put(
        f"/api/menu/variantes/{variante.id}",
        json={"nombre": variante.nombre, "precio": 0.5, "activo": True},
    )
    insights = client.get("/api/reportes/resumen?periodo=mes").json()["insights"]
    alerta = next(i for i in insights if "debajo de su costo" in i["titulo"])
    assert "$0.50" in alerta["detalle"] and "$1.00" in alerta["detalle"]


# ------------------------------------------- GG/HH: activos fijos (caso 11)
def _comprar_nevera(client, meses=60, hace_meses=0):
    factura = client.post(
        "/api/compras/facturas",
        json={
            "numero_factura": "NEV-1",
            "proveedor_nombre": "Refrigeracion",
            "categoria": "Activos",
            "forma_pago": "Banco",
            "descripcion": "Nevera exhibidora",
            "base_imponible": 600,
            "iva": 96,
            "vida_util_meses": meses,
            "fecha": (datetime.datetime.now() - datetime.timedelta(days=31 * hace_meses)).isoformat(),
        },
    ).json()
    return factura


def test_comprar_un_activo_lo_registra_para_depreciar(client, db):
    """Antes entraba a 1050 y se quedaba ahi a valor de compra para siempre."""
    _comprar_nevera(client)
    activos = client.get("/api/contabilidad/activos").json()
    assert len(activos) == 1
    a = activos[0]
    assert a["nombre"] == "Nevera exhibidora"
    assert a["valor"] == 600 and a["vida_util_meses"] == 60
    assert a["cuota_mensual"] == 10.0  # 600 / 60
    assert saldo(db, "1050") == 600.0


def test_la_depreciacion_se_pone_al_dia_sola(client, db):
    """Se asienta al consultar los libros, sin tareas en background: un local
    que estuvo un mes sin abrir el sistema se pone al dia al mirarlos."""
    _comprar_nevera(client, meses=60, hace_meses=7)

    a = client.get("/api/contabilidad/activos").json()[0]
    assert a["meses_depreciados"] == 7
    assert a["depreciacion_acumulada"] == 70.0
    assert a["valor_en_libros"] == 530.0
    # la contra-cuenta resta del activo, por eso su saldo es negativo
    assert saldo(db, "1051") == -70.0
    assert saldo(db, "6040") == 70.0

    # idempotente: volver a consultar no duplica cuotas
    assert client.get("/api/contabilidad/activos").json()[0]["meses_depreciados"] == 7


def test_la_depreciacion_llega_al_estado_de_resultados(client):
    """El desgaste del equipo es un gasto real: antes nunca aparecia."""
    _comprar_nevera(client, meses=12, hace_meses=2)
    er = client.get("/api/contabilidad/estado-resultados?periodo=mes").json()
    codigos = {f["codigo"] for f in er["detalle_gastos"]}
    assert "6040" in codigos


def test_la_depreciacion_no_pasa_del_valor_del_bien(client, db):
    _comprar_nevera(client, meses=6, hace_meses=24)  # vida cumplida hace rato
    a = client.get("/api/contabilidad/activos").json()[0]
    assert a["meses_depreciados"] == 6
    assert a["depreciacion_acumulada"] == 600.0
    assert a["valor_en_libros"] == 0.0


def test_dar_de_baja_saca_el_equipo_de_los_libros(client, db):
    """Si se daño o se vendio, lo que quedaba sin depreciar es perdida."""
    _comprar_nevera(client, meses=60, hace_meses=10)
    activo = client.get("/api/contabilidad/activos").json()[0]
    assert activo["valor_en_libros"] == 500.0

    r = client.post(f"/api/contabilidad/activos/{activo['id']}/baja", json={"motivo": "Se daño"})
    assert r.status_code == 200
    assert saldo(db, "1050") == 0.0  # ya no esta en el balance
    assert saldo(db, "1051") == 0.0  # su depreciacion acumulada tambien se va
    assert saldo(db, "6040") == 600.0  # 100 depreciados + 500 de perdida

    # no se puede dar de baja dos veces
    assert client.post(
        f"/api/contabilidad/activos/{activo['id']}/baja", json={"motivo": "otra vez"}
    ).status_code == 409


def test_la_depreciacion_acumulada_no_se_reporta_como_descuadre(client, db, insumo):
    """1051 es una contra-cuenta: su saldo negativo RESTA del activo y es
    correcto. El chequeo de activos en negativo no debe confundirlas."""
    contabilidad.asiento_de_apertura(db)
    _comprar_nevera(client, meses=60, hace_meses=6)

    # consultar la salud es lo que pone al dia la depreciacion
    salud = client.get("/api/contabilidad/salud").json()
    assert saldo(db, "1051") < 0
    assert "1051" not in " ".join(p["titulo"] for p in salud["problemas"])


def test_no_se_puede_acortar_la_vida_util_por_debajo_de_lo_ya_depreciado(client):
    _comprar_nevera(client, meses=60, hace_meses=8)
    activo = client.get("/api/contabilidad/activos").json()[0]
    r = client.put(f"/api/contabilidad/activos/{activo['id']}", json={"vida_util_meses": 3})
    assert r.status_code == 409


# ------------------------------------------- JJ/KK: declaracion de IVA (caso 12)
def _mes_pasado():
    hoy_ = datetime.date.today()
    return (hoy_.year - 1, 12) if hoy_.month == 1 else (hoy_.year, hoy_.month - 1)


def _venta_facturada(client, db, variante, total_deseado, cuando):
    """Una venta facturada en una fecha dada, para armar el debito del mes.

    El precio se fija ANTES de cobrar: el asiento contable se genera al cobrar,
    asi que tocarlo despues dejaria los libros diciendo una cosa y el Libro de
    Ventas otra (algo que la app no permite hacer, pero el test si).
    """
    pedido = client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": 1}], "nota": "", "permitir_sin_stock": True},
    ).json()
    p = db.query(models.Pedido).filter_by(id=pedido["id"]).first()
    p.items[0].precio_unitario = total_deseado
    db.commit()

    client.post(
        f"/api/pedidos/{pedido['id']}/cobrar",
        json={"metodo_pago": "Efectivo", "facturado": True, "numero_factura": f"F-{pedido['id']}"},
    )
    p.cerrado_en = cuando
    db.commit()
    return p


def test_no_se_puede_declarar_un_mes_que_no_termino(client):
    hoy_ = datetime.date.today()
    r = client.post("/api/impuestos/declaraciones", json={"anio": hoy_.year, "mes": hoy_.month})
    assert r.status_code == 400
    assert "todavia no termina" in r.json()["detail"]


def test_declarar_cierra_el_iva_del_mes_contra_las_cuentas_fiscales(client, db, variante):
    """Antes 2030 y 1030 solo crecian: el balance mostraba como deuda todo el
    debito acumulado desde siempre."""
    anio, mes = _mes_pasado()
    _venta_facturada(client, db, variante, 1160.0, datetime.datetime(anio, mes, 15))
    # una compra del mismo mes, con menos IVA que la venta
    factura = client.post(
        "/api/compras/facturas",
        json={"numero_factura": "C-1", "proveedor_nombre": "Prov", "categoria": "Servicios",
              "forma_pago": "Banco", "base_imponible": 100, "iva": 16,
              "fecha": datetime.datetime(anio, mes, 10).isoformat()},
    ).json()
    assert factura["iva"] == 16

    debito_antes, credito_antes = saldo(db, "2030"), saldo(db, "1030")
    assert debito_antes == 160.0 and credito_antes == 16.0

    d = client.post("/api/impuestos/declaraciones", json={"anio": anio, "mes": mes}).json()
    assert d["iva_debito"] == 160.0
    assert d["iva_credito"] == 16.0
    assert d["credito_usado"] == 16.0
    assert d["iva_a_pagar"] == 144.0
    assert d["credito_excedente"] == 0.0

    # las cuentas de IVA quedaron saldadas y la deuda paso a 2020
    assert saldo(db, "2030") == 0.0
    assert saldo(db, "1030") == 0.0
    assert saldo(db, "2020") == 144.0
    assert d["pagada"] is False


def test_el_credito_que_sobra_se_arrastra_al_mes_siguiente(client, db, variante):
    """Si se compro mas de lo que se facturo, el excedente no se pierde."""
    anio, mes = _mes_pasado()
    mes_previo, anio_previo = (mes - 1, anio) if mes > 1 else (12, anio - 1)

    # mes previo: solo compras -> todo queda como credito a favor
    client.post(
        "/api/compras/facturas",
        json={"numero_factura": "C-0", "proveedor_nombre": "Prov", "categoria": "Servicios",
              "forma_pago": "Banco", "base_imponible": 500, "iva": 80,
              "fecha": datetime.datetime(anio_previo, mes_previo, 5).isoformat()},
    )
    d0 = client.post(
        "/api/impuestos/declaraciones", json={"anio": anio_previo, "mes": mes_previo}
    ).json()
    assert d0["iva_a_pagar"] == 0.0
    assert d0["credito_excedente"] == 80.0
    assert saldo(db, "1030") == 80.0  # el sobrante se queda en la cuenta

    # mes siguiente: una venta con $100 de IVA
    _venta_facturada(client, db, variante, 725.0, datetime.datetime(anio, mes, 15))
    d1 = client.post("/api/impuestos/declaraciones", json={"anio": anio, "mes": mes}).json()
    assert d1["credito_arrastrado"] == 80.0
    assert d1["iva_debito"] == 100.0
    assert d1["credito_usado"] == 80.0
    assert d1["iva_a_pagar"] == 20.0  # 100 de debito - 80 arrastrados
    assert saldo(db, "1030") == 0.0


def test_un_mes_con_solo_compras_tambien_se_declara(client, db):
    """Un mes sin ventas pero con compras genera credito fiscal, y hay que
    declararlo para poder arrastrarlo. Antes la lista arrancaba en la primera
    venta, asi que el IVA de los equipos comprados antes de abrir se quedaba
    fuera de todo periodo."""
    anio, mes = _mes_pasado()
    client.post(
        "/api/compras/facturas",
        json={"numero_factura": "EQ-9", "proveedor_nombre": "Prov", "categoria": "Activos",
              "forma_pago": "Banco", "descripcion": "Congelador", "base_imponible": 300, "iva": 48,
              "fecha": datetime.datetime(anio, mes, 3).isoformat()},
    )
    pendientes = client.get("/api/impuestos/periodos-pendientes").json()
    assert any(p["anio"] == anio and p["mes"] == mes for p in pendientes)

    d = client.post("/api/impuestos/declaraciones", json={"anio": anio, "mes": mes}).json()
    assert d["iva_credito"] == 48.0
    assert d["iva_a_pagar"] == 0.0
    assert d["credito_excedente"] == 48.0


def test_no_se_declara_dos_veces_el_mismo_periodo(client, db, variante):
    anio, mes = _mes_pasado()
    _venta_facturada(client, db, variante, 116.0, datetime.datetime(anio, mes, 15))
    client.post("/api/impuestos/declaraciones", json={"anio": anio, "mes": mes})
    r = client.post("/api/impuestos/declaraciones", json={"anio": anio, "mes": mes})
    assert r.status_code == 409


def test_pagar_el_iva_salda_la_deuda_y_saca_la_plata(client, db, variante):
    anio, mes = _mes_pasado()
    _venta_facturada(client, db, variante, 1160.0, datetime.datetime(anio, mes, 15))
    d = client.post("/api/impuestos/declaraciones", json={"anio": anio, "mes": mes}).json()
    assert saldo(db, "2020") == 160.0

    pagada = client.post(f"/api/impuestos/declaraciones/{d['id']}/pagar", json={"forma_pago": "Banco"}).json()
    assert pagada["pagada"] is True
    assert saldo(db, "2020") == 0.0  # la deuda con el SENIAT se cancelo
    assert saldo(db, "1020") == -160.0  # salio del banco

    # no se paga dos veces
    assert client.post(
        f"/api/impuestos/declaraciones/{d['id']}/pagar", json={"forma_pago": "Banco"}
    ).status_code == 409


def test_la_salud_avisa_de_ventas_en_un_periodo_ya_declarado(client, db, variante):
    """Una venta que aparece despues de declarar cambia un Libro de Ventas que
    ya se le presento al SENIAT."""
    anio, mes = _mes_pasado()
    _venta_facturada(client, db, variante, 116.0, datetime.datetime(anio, mes, 10))
    client.post("/api/impuestos/declaraciones", json={"anio": anio, "mes": mes})
    assert "ya declarado" not in str(client.get("/api/contabilidad/salud").json())

    _venta_facturada(client, db, variante, 58.0, datetime.datetime(anio, mes, 20))
    salud = client.get("/api/contabilidad/salud").json()
    assert salud["sano"] is False
    assert "ya declarado" in " ".join(p["titulo"] for p in salud["problemas"])


# ------------------------------------------- caja: cierres y retiros (caso 13)
def test_el_faltante_deja_la_caja_en_lo_que_se_conto(client, db, variante):
    """El dia siguiente tiene que arrancar del dinero que hay de verdad, no del
    que el sistema creia que habia."""
    pedido = client.post(
        "/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 4}], "nota": ""}
    ).json()
    client.post(f"/api/pedidos/{pedido['id']}/cobrar", json={"metodo_pago": "Efectivo"})

    esperado = client.get("/api/caja/resumen").json()["efectivo_esperado"]
    assert esperado == 20.0

    cierre = client.post(
        "/api/caja/cerrar", json={"efectivo_contado": 15.0, "nota": "faltaron 5"}
    ).json()
    assert cierre["diferencia"] == -5.0
    assert saldo(db, "6030") == 5.0  # el faltante es una perdida reconocida
    assert saldo(db, "1010") == 15.0  # la caja quedo en lo contado


def test_no_se_cierra_la_caja_dos_veces_el_mismo_dia(client, variante):
    client.post("/api/caja/cerrar", json={"efectivo_contado": 0.0, "nota": ""})
    r = client.post("/api/caja/cerrar", json={"efectivo_contado": 0.0, "nota": ""})
    assert r.status_code == 409


def test_un_sobrante_netea_contra_los_faltantes(client, db, variante):
    pedido = client.post(
        "/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 4}], "nota": ""}
    ).json()
    client.post(f"/api/pedidos/{pedido['id']}/cobrar", json={"metodo_pago": "Efectivo"})
    client.post("/api/caja/cerrar", json={"efectivo_contado": 23.0, "nota": "sobraron 3"})
    assert saldo(db, "6030") == -3.0  # un sobrante baja el gasto acumulado
    assert saldo(db, "1010") == 23.0


def test_el_retiro_del_dueno_no_es_un_gasto(client, db, variante):
    """Sacar plata del negocio sale del patrimonio, no de la ganancia. Antes la
    unica via era cargarlo como Gasto, que hacia ver al negocio menos rentable
    de lo que es."""
    pedido = client.post(
        "/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 4}], "nota": ""}
    ).json()
    client.post(f"/api/pedidos/{pedido['id']}/cobrar", json={"metodo_pago": "Efectivo"})
    utilidad_antes = client.get("/api/contabilidad/estado-resultados?periodo=mes").json()["utilidad_neta"]

    r = client.post("/api/caja/retiros", json={"monto": 12.0, "metodo_pago": "Efectivo"})
    assert r.status_code == 200

    er = client.get("/api/contabilidad/estado-resultados?periodo=mes").json()
    assert er["utilidad_neta"] == utilidad_antes  # la ganancia no se movio
    assert saldo(db, "3030") == -12.0  # resta del patrimonio
    assert saldo(db, "1010") == 8.0  # salio de la gaveta

    # y la caja lo cuenta como salida de efectivo
    resumen = client.get("/api/caja/resumen").json()
    assert resumen["retiros_hoy"] == 12.0
    assert resumen["efectivo_esperado"] == 8.0


def test_el_retiro_no_descuadra_el_balance(client, db, variante):
    contabilidad.asiento_de_apertura(db)
    pedido = client.post(
        "/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 4}], "nota": ""}
    ).json()
    client.post(f"/api/pedidos/{pedido['id']}/cobrar", json={"metodo_pago": "Efectivo"})
    client.post("/api/caja/retiros", json={"monto": 12.0, "metodo_pago": "Efectivo"})

    bg = client.get("/api/contabilidad/balance-general").json()
    assert bg["cuadra"] is True
    # 3030 es contra-patrimonio: su saldo negativo es correcto y no se reporta
    salud = client.get("/api/contabilidad/salud").json()
    assert "3030" not in " ".join(p["titulo"] for p in salud["problemas"])


# ------------------------------------------- NN: recetas cambiantes (caso 14)
def test_cambiar_la_receta_no_toca_el_costo_historico(client, db, variante, insumo):
    """El costo se congela por venta: subirle carne a la empanada hoy no puede
    cambiar el margen del mes pasado."""
    pedido = client.post(
        "/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 2}], "nota": ""}
    ).json()
    client.post(f"/api/pedidos/{pedido['id']}/cobrar", json={"metodo_pago": "Efectivo"})
    costo_antes = client.get("/api/reportes/resumen?periodo=mes").json()["costo_insumos"]

    client.put(
        f"/api/inventario/recetas/{variante.id}",
        json=[{"ingrediente_id": insumo.id, "cantidad_por_unidad": 0.5}],  # de 0.1 a 0.5
    )
    assert client.get("/api/reportes/resumen?periodo=mes").json()["costo_insumos"] == costo_antes


def test_anular_devuelve_lo_que_salio_no_lo_que_dice_la_receta_nueva(client, db, variante, insumo):
    """Si la receta cambia mientras el pedido esta en cocina, al anularlo se
    devuelve lo que de verdad se descontó. Recalcular desde la receta nueva
    hacia aparecer inventario de la nada."""
    stock_inicial = insumo.stock_actual

    client.post(
        "/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 10}], "nota": ""}
    ).json()
    db.refresh(insumo)
    descontado = round(stock_inicial - insumo.stock_actual, 6)
    assert descontado == 1.25  # 10 x 0.1 kg utiles / 0.8 de rendimiento

    # el dueno cambia la receta con el pedido todavia en cocina
    client.put(
        f"/api/inventario/recetas/{variante.id}",
        json=[{"ingrediente_id": insumo.id, "cantidad_por_unidad": 0.5}],
    )

    pedido_id = client.get("/api/pedidos?estado=pendiente").json()[0]["id"]
    client.post(f"/api/pedidos/{pedido_id}/anular", json={"comida_preparada": False})

    db.refresh(insumo)
    assert insumo.stock_actual == stock_inicial  # ni un gramo de mas ni de menos


def test_anular_preparado_con_receta_cambiada_valora_bien_la_merma(client, db, variante, insumo):
    client.post(
        "/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 10}], "nota": ""}
    )
    client.put(
        f"/api/inventario/recetas/{variante.id}",
        json=[{"ingrediente_id": insumo.id, "cantidad_por_unidad": 0.5}],
    )
    pedido_id = client.get("/api/pedidos?estado=pendiente").json()[0]["id"]
    client.post(f"/api/pedidos/{pedido_id}/anular", json={"comida_preparada": True})

    mermas = client.get("/api/inventario/mermas").json()
    assert len(mermas) == 1
    assert mermas[0]["cantidad"] == 1.25  # lo que salio, no lo que diria la receta nueva


# ----------------------------------------------------- menores: numeracion
def test_no_se_repite_el_numero_de_factura(client, variante):
    """Dos facturas con el mismo numero en el Libro de Ventas es un problema
    fiscal, no cosmetico."""
    for _ in range(2):
        pedido = client.post(
            "/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 1}], "nota": ""}
        ).json()
        r = client.post(
            f"/api/pedidos/{pedido['id']}/cobrar",
            json={"metodo_pago": "Efectivo", "facturado": True, "numero_factura": "00-7"},
        )
    assert r.status_code == 409


def test_el_numero_de_comanda_no_se_repite_tras_anular(client, variante):
    primero = client.post(
        "/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 1}], "nota": ""}
    ).json()
    client.post(f"/api/pedidos/{primero['id']}/anular", json={"comida_preparada": False})
    segundo = client.post(
        "/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 1}], "nota": ""}
    ).json()
    assert segundo["numero"] != primero["numero"]
