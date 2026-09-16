"""El libro de movimientos: que el stock se pueda explicar, no solo mirar.

El dueno pregunta "la carne bajo 3 kg hoy, desglosame eso". Antes habia que
abrir cuatro pantallas -mermas, sobrantes, pedidos, compras- y aun asi el
consumo del personal y las compras sueltas no tenian listado propio. La
respuesta honesta era "no se puede".

La prueba que manda es la ultima: despues de un dia completo de operacion, la
suma del libro tiene que dar exactamente el stock. Si alguien agrega manana un
camino que toca `stock_actual` sin pasar por `kardex.anotar`, esa prueba se
cae. Ese es el punto.
"""

import datetime

from app import models


def comanda(client, variante, cantidad=1, cobrar=True):
    p = client.post("/api/pedidos", json={
        "items": [{"variante_id": variante.id, "cantidad": cantidad}],
        "nota": "", "permitir_sin_stock": True,
    }).json()
    if cobrar:
        client.post("/api/pedidos/{}/cobrar".format(p["id"]), json={"metodo_pago": "Efectivo Bs"})
    return p


def extracto(client, ing_id):
    return client.get("/api/inventario/ingredientes/{}/movimientos".format(ing_id)).json()


def test_una_venta_deja_su_rastro(client, insumo, variante):
    comanda(client, variante, cantidad=10)
    e = extracto(client, insumo.id)
    ventas = [m for m in e["movimientos"] if m["tipo"] == "venta"]
    assert len(ventas) == 1
    assert ventas[0]["cantidad"] < 0, "una venta saca insumo"
    assert "Comanda #" in ventas[0]["nota"], "hay que poder llegar hasta la comanda"
    assert e["cuadra"]


def test_el_extracto_explica_el_saldo(client, db, insumo, variante):
    """Los cuatro caminos que antes vivian en pantallas distintas, juntos."""
    comanda(client, variante, cantidad=10)
    client.post("/api/inventario/ingredientes/{}/merma".format(insumo.id),
                json={"cantidad": 0.5, "motivo": "se cayo al piso"})
    client.post("/api/inventario/ingredientes/{}/consumo-personal".format(insumo.id),
                json={"cantidad": 0.3, "motivo": "almuerzo"})
    client.post("/api/inventario/ingredientes/{}/comprar".format(insumo.id),
                json={"cantidad": 5, "costo_total": 10.0})

    e = extracto(client, insumo.id)
    tipos = set(m["tipo"] for m in e["movimientos"])
    assert set(["venta", "merma", "consumo_personal", "compra"]) <= tipos, tipos
    assert e["cuadra"], "libro {} vs stock {}".format(e["saldo_segun_libro"], e["stock_actual"])
    # Y cada linea dice cuanto quedaba despues, como la libreta del banco.
    assert e["movimientos"][0]["saldo"] == e["stock_actual"]


def test_el_costo_queda_congelado_en_el_movimiento(client, insumo):
    """Si se anotara el costo de hoy, el libro dejaria de cuadrar con lo que se
    asento en su momento."""
    client.post("/api/inventario/ingredientes/{}/comprar".format(insumo.id),
                json={"cantidad": 10, "costo_total": 10.0})
    client.post("/api/inventario/ingredientes/{}/comprar".format(insumo.id),
                json={"cantidad": 10, "costo_total": 50.0})
    compras = [m for m in extracto(client, insumo.id)["movimientos"] if m["tipo"] == "compra"]
    costos = sorted(m["costo_unitario"] for m in compras)
    assert costos == [1.0, 5.0], "cada compra se anota al precio al que entro, no al promedio"


def test_el_conteo_es_ajuste_y_no_merma(client, db, insumo):
    """Un conteo que baja el stock no es comida botada.

    Iban al mismo saco y el informe de perdidas se leia como si se hubiera
    tirado mercancia. Son dos problemas distintos con dos soluciones distintas:
    uno dice "se cayo al piso" y el otro "el sistema estaba mal".
    """
    client.post("/api/inventario/conteo", json={
        "items": [{"ingrediente_id": insumo.id, "stock_real": 1.0}],
        "motivo": "conteo del lunes",
    })
    e = extracto(client, insumo.id)
    assert any(m["tipo"] == "ajuste" for m in e["movimientos"])
    assert not any(m["tipo"] == "merma" for m in e["movimientos"])

    conteos = db.query(models.Merma).filter_by(por_conteo=True).all()
    accidentes = db.query(models.Merma).filter_by(por_conteo=False).all()
    assert len(conteos) == 1 and not accidentes, "la merma del conteo queda marcada como tal"
    assert e["cuadra"]


def test_revertir_una_merma_tambien_se_anota(client, insumo):
    r = client.post("/api/inventario/ingredientes/{}/merma".format(insumo.id),
                    json={"cantidad": 2, "motivo": "error de tecleo"})
    assert r.status_code == 200
    merma = client.get("/api/inventario/mermas?dias=1").json()[0]
    client.post("/api/inventario/mermas/{}/revertir".format(merma["id"]))

    e = extracto(client, insumo.id)
    assert [m["tipo"] for m in e["movimientos"][:2]] == ["reverso", "merma"]
    assert e["cuadra"], "deshacer no puede dejar el libro torcido"


def test_cuanto_habia_en_una_fecha(client, insumo, variante):
    """La pregunta del contador para cerrar el mes."""
    antes = client.get("/api/inventario/existencias").json()
    fila = [f for f in antes["insumos"] if f["ingrediente_id"] == insumo.id][0]
    cantidad_inicial = fila["cantidad"]

    comanda(client, variante, cantidad=20)

    corte = (datetime.datetime.now() - datetime.timedelta(days=1)).isoformat()
    ayer = client.get("/api/inventario/existencias?fecha={}".format(corte)).json()
    de_ayer = [f for f in ayer["insumos"] if f["ingrediente_id"] == insumo.id]
    assert not de_ayer, "ayer todavia no existia nada de esto"

    hoy = client.get("/api/inventario/existencias").json()
    fila_hoy = [f for f in hoy["insumos"] if f["ingrediente_id"] == insumo.id][0]
    assert fila_hoy["cantidad"] < cantidad_inicial, "hoy hay menos: se vendio"
    assert hoy["total"] > 0


def test_el_consumo_por_dia_se_mide_no_se_adivina(client, insumo, variante):
    comanda(client, variante, cantidad=30)
    filas = client.get("/api/inventario/consumo?dias=30").json()
    fila = [f for f in filas if f["ingrediente_id"] == insumo.id][0]
    assert fila["por_dia"] > 0
    assert fila["dias_de_stock"] is not None


def test_el_ajuste_por_conteo_no_cuenta_como_consumo(client, insumo):
    """Corregir el sistema no es gastar insumo. Si contara, el proximo pedido al
    proveedor saldria inflado por un error de tecleo."""
    client.post("/api/inventario/conteo", json={
        "items": [{"ingrediente_id": insumo.id, "stock_real": 0.5}],
        "motivo": "conteo",
    })
    filas = client.get("/api/inventario/consumo?dias=30").json()
    fila = [f for f in filas if f["ingrediente_id"] == insumo.id][0]
    assert fila["por_dia"] == 0


def test_un_dia_completo_y_el_libro_sigue_cuadrando(client, db, libros, insumo, variante):
    """La prueba que protege la regla: TODO pasa por el kardex."""
    client.post("/api/inventario/ingredientes/{}/comprar".format(insumo.id),
                json={"cantidad": 10, "costo_total": 20.0})
    comanda(client, variante, cantidad=15)
    p = comanda(client, variante, cantidad=5, cobrar=False)
    client.post("/api/pedidos/{}/anular".format(p["id"]), json={"comida_preparada": False})
    p2 = comanda(client, variante, cantidad=3)
    client.post("/api/pedidos/{}/devolver".format(p2["id"]),
                json={"motivo": "no le gusto", "recuperable": True})
    client.post("/api/inventario/ingredientes/{}/merma".format(insumo.id),
                json={"cantidad": 0.4, "motivo": "se quemo"})
    client.post("/api/inventario/ingredientes/{}/consumo-personal".format(insumo.id),
                json={"cantidad": 0.2, "motivo": "almuerzo"})
    client.post("/api/inventario/conteo", json={
        "items": [{"ingrediente_id": insumo.id, "stock_real": 7.77}], "motivo": "cierre",
    })

    for ing in db.query(models.Ingrediente).all():
        e = extracto(client, ing.id)
        assert e["cuadra"], (
            "{}: el libro dice {} y el stock {}. Alguien movio existencias sin "
            "anotarlas.".format(ing.nombre, e["saldo_segun_libro"], e["stock_actual"])
        )


def test_el_inventario_valorizado_ata_con_la_contabilidad(client, db, libros, insumo, variante):
    """El informe de existencias y la cuenta 1040 tienen que dar LO MISMO.

    Valorar con el precio de la ultima compra daba numeros parecidos pero
    distintos (medido: 395.88 contra 391.15), y en contabilidad "parecido" es
    estar mal. Por eso cada movimiento guarda ademas el promedio ponderado que
    dejo: es el criterio con el que se asienta la cuenta.
    """
    client.post("/api/inventario/ingredientes/{}/comprar".format(insumo.id),
                json={"cantidad": 6, "costo_total": 60.0})  # entra a 10, promedio sube
    comanda(client, variante, cantidad=12)
    client.post("/api/inventario/ingredientes/{}/merma".format(insumo.id),
                json={"cantidad": 0.3, "motivo": "se quemo"})

    valorizado = client.get("/api/inventario/existencias").json()["total"]
    balance = client.get("/api/contabilidad/balance-general").json()
    contable = [f for f in balance["activos"] if f["codigo"] == "1040"][0]["saldo"]

    assert abs(valorizado - contable) < 0.05, (
        "existencias valorizadas {} vs cuenta 1040 {}".format(valorizado, contable)
    )
