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
