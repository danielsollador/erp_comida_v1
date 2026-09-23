"""Las dos secciones nuevas de Reportes: Perdidas e Inventario.

Perdidas responde que se merma mas y que menos, por que, y cuanto pesa sobre
la venta; separa lo que alguien registro de lo que aparecio en un conteo, y
no cuenta las mermas revertidas. Inventario dice donde esta la plata, para
cuantos dias alcanza y que hay que comprar, con el stock de hoy y el consumo
del periodo.
"""
import datetime

from app import models
from app.timeutils import hoy

from tests.test_reportes_graficos import comanda, cobrar, iso


def merma(client, insumo, cantidad, motivo="se dano"):
    r = client.post(f"/api/inventario/ingredientes/{insumo.id}/merma", json={"cantidad": cantidad, "motivo": motivo})
    assert r.status_code == 200, r.text
    return r.json()


def comprar(client, insumo, cantidad=10, costo=8.0):
    """Compra suelta: `costo` es el unitario, el endpoint pide el total."""
    r = client.post(
        f"/api/inventario/ingredientes/{insumo.id}/comprar",
        json={"cantidad": cantidad, "costo_total": round(cantidad * costo, 2)},
    )
    assert r.status_code == 200, r.text


def perdidas(client, dias=0):
    r = client.get(f"/api/reportes/perdidas?desde={iso(dias)}&hasta={iso(0)}")
    assert r.status_code == 200, r.text
    return r.json()


def inventario(client, dias=0):
    r = client.get(f"/api/reportes/inventario?desde={iso(dias)}&hasta={iso(0)}")
    assert r.status_code == 200, r.text
    return r.json()


# ── Perdidas ─────────────────────────────────────────────────────────────────


def test_sin_mermas_el_informe_esta_en_cero_y_lo_dice(client, insumo):
    r = perdidas(client)
    assert r["merma"] == 0
    assert r["registros"] == 0
    assert r["por_insumo"] == []
    assert r["sin_merma"] == 1


def test_la_merma_se_agrupa_por_mercancia_y_ordena_de_mayor_a_menor(client, db, insumo):
    comprar(client, insumo, 10, 8.0)
    otro = models.Ingrediente(nombre="Queso", unidad="kg", stock_actual=0, costo_unitario=2.0)
    db.add(otro)
    db.commit()
    comprar(client, otro, 10, 2.0)

    merma(client, insumo, 1)      # $8
    merma(client, insumo, 0.5)    # $4
    merma(client, otro, 1)        # $2

    r = perdidas(client)
    assert r["merma"] == 14.0
    assert r["registros"] == 3
    assert [p["nombre"] for p in r["por_insumo"]] == ["Carne molida", "Queso"]
    carne = r["por_insumo"][0]
    assert carne["valor"] == 12.0
    assert carne["veces"] == 2
    assert carne["cantidad"] == 1.5
    assert round(carne["pct"]) == 86
    assert r["sin_merma"] == 0
    assert r["merma_registrada"] == 14.0
    assert r["merma_por_conteo"] == 0


def test_los_motivos_se_agrupan_y_el_conteo_va_aparte(client, insumo):
    comprar(client, insumo, 10, 8.0)
    merma(client, insumo, 1, motivo="se quemo")
    merma(client, insumo, 1, motivo="se quemo")
    merma(client, insumo, 1, motivo="")
    # Un conteo que encuentra 1 kg menos de lo que decia el sistema (la
    # fixture arranca con 10 kg; mas 10 comprados, menos 3 de merma = 17).
    r = client.post("/api/inventario/conteo", json={"items": [{"ingrediente_id": insumo.id, "stock_real": 16}]})
    assert r.status_code == 200, r.text

    r = perdidas(client)
    motivos = {m["motivo"]: m for m in r["por_motivo"]}
    assert motivos["se quemo"]["veces"] == 2
    assert motivos["se quemo"]["valor"] == 16.0
    assert motivos["Sin motivo"]["veces"] == 1
    assert motivos["Conteo fisico"]["valor"] == 8.0
    assert r["merma_por_conteo"] == 8.0
    assert r["merma_registrada"] == 24.0
    assert r["por_insumo"][0]["valor_conteo"] == 8.0


def test_una_merma_revertida_no_cuenta(client, insumo):
    comprar(client, insumo, 10, 8.0)
    m = merma(client, insumo, 2)
    # Se revierte la ultima merma registrada.
    lista = client.get("/api/inventario/mermas").json()
    ultima = lista[0]
    assert ultima["ingrediente_id"] == m["id"]
    r = client.post(f"/api/inventario/mermas/{ultima['id']}/revertir")
    assert r.status_code == 200, r.text

    r = perdidas(client)
    assert r["merma"] == 0
    assert r["detalle"] == []


def test_el_peso_sobre_la_venta_y_la_lectura_de_alerta(client, db, insumo, variante):
    comprar(client, insumo, 10, 8.0)
    p = comanda(client, variante)
    cobrar(client, p["id"])        # $5 vendidos
    merma(client, insumo, 0.1)      # $0.80 = 16% de la venta

    r = perdidas(client)
    assert r["ventas"] == 5.0
    assert r["merma"] == 0.8
    assert r["peso_pct"] == 16.0
    assert any("16.0%" in i["titulo"] and i["tipo"] == "alerta" for i in r["insights"])


def test_el_valor_de_la_merma_queda_congelado_al_costo_de_su_dia(client, insumo):
    comprar(client, insumo, 10, 8.0)
    merma(client, insumo, 1)  # a $8
    comprar(client, insumo, 10, 20.0)  # el promedio sube

    r = perdidas(client)
    assert r["merma"] == 8.0


def test_compara_con_el_periodo_anterior(client, db, insumo):
    comprar(client, insumo, 10, 8.0)
    merma(client, insumo, 1)  # hoy: $8
    vieja = merma(client, insumo, 2)  # $16, se lleva a hace 10 dias
    m = db.query(models.Merma).order_by(models.Merma.id.desc()).first()
    m.fecha = datetime.datetime.combine(hoy() - datetime.timedelta(days=10), datetime.time(12))
    db.commit()
    assert vieja

    r = perdidas(client, dias=6)  # los ultimos 7 dias
    assert r["merma"] == 8.0
    assert r["merma_anterior"] == 16.0
    assert r["cambio_pct"] == -50.0


def test_las_ventas_que_no_llegaron_van_aparte(client, variante):
    p = comanda(client, variante)
    r = client.post(f"/api/pedidos/{p['id']}/anular", json={"comida_preparada": False})
    assert r.status_code == 200, r.text

    r = perdidas(client)
    assert r["anulados"] == 1
    assert r["valor_anulado"] == 5.0
    assert r["merma"] == 0


# ── Inventario ───────────────────────────────────────────────────────────────


def test_el_deposito_vale_lo_que_hay_al_costo_promedio(client, db, insumo):
    comprar(client, insumo, 10, 8.0)
    reventa = models.Ingrediente(nombre="Refresco", unidad="unidad", stock_actual=0, costo_unitario=1.0, tipo="reventa")
    db.add(reventa)
    db.commit()
    comprar(client, reventa, 24, 1.0)

    # Carne: 10 kg de la fixture + 10 comprados, a $8 = $160.
    r = inventario(client)
    assert r["valor_total"] == 184.0
    assert r["valor_insumos"] == 160.0
    assert r["valor_reventa"] == 24.0
    assert r["activos"] == 2
    assert [i["nombre"] for i in r["por_insumo"]] == ["Carne molida", "Refresco"]
    assert round(r["por_insumo"][0]["pct"]) == 87


def test_para_cuantos_dias_alcanza_sale_del_consumo_real(client, db, insumo, variante):
    comprar(client, insumo, 10, 8.0)
    # Hoy se vendieron 5 empanadas: 0.5 kg utilizables... la receta consume
    # 0.1 kg utilizables = 0.125 kg comprados cada una (rendimiento 80%).
    for _ in range(5):
        p = comanda(client, variante)
        cobrar(client, p["id"])

    r = inventario(client)
    carne = r["por_insumo"][0]
    assert carne["por_dia"] > 0
    assert carne["dias_de_stock"] is not None
    assert carne["consumido"] > 0
    assert carne["estado"] in ("ok", "sobra")
    assert r["consumido"] == carne["consumido"]
    assert r["rotacion"] is not None


def test_lo_que_no_se_mueve_es_plata_quieta(client, insumo):
    comprar(client, insumo, 10, 8.0)
    r = inventario(client)
    carne = r["por_insumo"][0]
    assert carne["estado"] == "quieto"
    assert carne["dias_de_stock"] is None
    assert r["quietos"] == 1
    assert r["valor_quieto"] == 160.0


def test_agotado_y_bajo_minimo_se_marcan_y_se_avisa(client, db, insumo):
    aceite = models.Ingrediente(nombre="Aceite", unidad="lt", stock_actual=0, stock_minimo=1, costo_unitario=3.0)
    queso = models.Ingrediente(nombre="Queso", unidad="kg", stock_actual=0, stock_minimo=5, costo_unitario=2.0)
    db.add_all([aceite, queso])
    db.commit()
    comprar(client, queso, 2, 2.0)  # 2 <= minimo 5 -> bajo

    r = inventario(client)
    estados = {i["nombre"]: i["estado"] for i in r["por_insumo"]}
    assert estados["Aceite"] == "agotado"
    assert estados["Queso"] == "bajo"
    assert estados["Carne molida"] == "quieto"  # 10 kg sin moverse
    assert r["agotados"] == 1
    assert r["bajo_minimo"] == 1
    assert any("agotada" in i["titulo"] for i in r["insights"])
    assert any("bajo el minimo" in i["titulo"] for i in r["insights"])
    # Y los dos estan en la lista de compra; la carne no, que sobra.
    assert {s["ingrediente_nombre"] for s in r["por_comprar"]} == {"Aceite", "Queso"}


def test_los_archivados_no_entran(client, db, insumo):
    comprar(client, insumo, 10, 8.0)
    insumo.activo = False
    db.commit()
    r = inventario(client)
    assert r["activos"] == 0
    assert r["valor_total"] == 0
