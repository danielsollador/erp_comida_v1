"""El analisis de la tasa, segunda tanda: ritmo, exposicion, billetes y de
quien es la culpa de que los costos suban.

Lo de antes decia cuanto se movio el dolar y cuanto se llevo la brecha. Lo de
ahora responde lo que el dueño pregunta despues: ¿a donde va? ¿que parte de
mi plata esta expuesta? ¿cuanto es eso en billetes? y ¿lo que subieron mis
insumos es el dolar o es el proveedor?
"""
import datetime

from app import models
from app.timeutils import hoy


def _tasa(db, dias_atras, bcv, paralelo=None, eur=None, origen="auto"):
    db.add(models.TasaCambio(
        fecha=hoy() - datetime.timedelta(days=dias_atras),
        bcv=bcv, paralelo=paralelo, eur=eur, origen=origen,
    ))
    db.commit()


def _vender(client, variante, cantidad, pagos, cliente=""):
    pedido = client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": cantidad}]},
    ).json()
    r = client.post(
        f"/api/pedidos/{pedido['id']}/cobrar",
        json={
            "metodo_pago": pagos[0][0],
            "pagos": [{"metodo": m, "monto": v, "referencia": "REF-1"} for m, v in pagos],
            "cliente": cliente,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def _titulos(a):
    return " · ".join(l["titulo"] for l in a["lecturas"])


def test_con_una_semana_de_tasa_hay_ritmo_y_proyeccion(client, db):
    """De 800 a 856 en 7 dias es 7%: 0,97% diario compuesto. Proyectado 30
    dias, el dolar estaria ~33% mas caro. Se dice como extrapolacion."""
    _tasa(db, 7, bcv=800.0)
    _tasa(db, 0, bcv=856.0)
    a = client.get("/api/tasas/analisis").json()
    assert a["ritmo_diario_pct"] is not None
    assert 0.95 <= a["ritmo_diario_pct"] <= 1.0
    assert a["proyeccion_30d"] > 856.0
    assert 30 <= a["proyeccion_30d_pct"] <= 36
    assert "A este ritmo, en 30 días el dólar estaría en" in _titulos(a)


def test_con_pocos_dias_no_se_proyecta_nada(client, db):
    """Dos dias no son una tendencia: proyectar sobre eso seria inventar."""
    _tasa(db, 2, bcv=800.0)
    _tasa(db, 0, bcv=820.0)
    a = client.get("/api/tasas/analisis").json()
    assert a["ritmo_diario_pct"] is None
    assert a["proyeccion_30d"] is None
    assert "A este ritmo" not in _titulos(a)


def test_el_mayor_salto_es_el_dia_que_mas_se_movio(client, db):
    _tasa(db, 3, bcv=800.0)
    _tasa(db, 2, bcv=804.0)   # +0.5%
    _tasa(db, 1, bcv=828.0)   # +3.0%  <- el salto
    _tasa(db, 0, bcv=832.0)   # +0.5%
    a = client.get("/api/tasas/analisis").json()
    salto = a["mayor_salto"]
    assert salto["fecha"] == (hoy() - datetime.timedelta(days=1)).isoformat()
    assert salto["de"] == 804.0 and salto["a"] == 828.0
    assert round(salto["pct"], 1) == 3.0
    assert "El mayor salto fue el" in _titulos(a)


def test_la_exposicion_es_lo_cobrado_en_bolivares_sobre_el_total(client, db, variante):
    """$20 vendidos: $15 en pago movil y $5 en efectivo en dolares. Expuesto a
    la brecha esta el 75%, y el desglose por metodo solo trae los de Bs."""
    _tasa(db, 0, bcv=800.0, paralelo=880.0)
    _vender(client, variante, 4, [("Pago movil", 15.0), ("Efectivo $", 5.0)])

    a = client.get("/api/tasas/analisis").json()
    assert a["cobrado_total_usd"] == 20.0
    assert a["cobrado_bs_usd"] == 15.0
    assert a["cobrado_divisas_usd"] == 5.0
    assert a["exposicion_pct"] == 75.0
    assert a["por_metodo_bs"] == [{"nombre": "Pago movil", "monto": 15.0, "pct": 100.0}]
    assert "El 75% de lo cobrado entró en bolívares" in _titulos(a)


def test_el_fiado_no_cuenta_ni_en_el_total(client, db, variante):
    _tasa(db, 0, bcv=800.0, paralelo=880.0)
    _vender(client, variante, 1, [("Fiado", 5.0)], cliente="Pedro")
    a = client.get("/api/tasas/analisis").json()
    assert a["cobrado_total_usd"] == 0.0
    assert a["exposicion_pct"] is None


def test_las_equivalencias_van_del_primer_dia_al_ultimo(client, db):
    _tasa(db, 5, bcv=800.0)
    _tasa(db, 0, bcv=850.0)
    a = client.get("/api/tasas/analisis").json()
    billetes = {e["usd"]: e for e in a["equivalencias"]}
    assert set(billetes) == {1.0, 5.0, 10.0, 20.0, 50.0}
    assert billetes[20.0]["bs_inicio"] == 16000.0
    assert billetes[20.0]["bs_fin"] == 17000.0


def test_si_los_insumos_subieron_mas_que_el_dolar_la_culpa_es_del_proveedor(client, db, insumo):
    """El dolar subio 2% y la carne 20%: la diferencia no viene de la tasa.
    Se dice con nombre, porque la reaccion correcta es distinta (cambiar de
    proveedor, no subir todo el menu)."""
    _tasa(db, 10, bcv=800.0)
    _tasa(db, 0, bcv=816.0)
    for costo in (10.0, 12.0):
        r = client.post(
            "/api/compras/facturas",
            json={
                "numero_factura": f"F-{costo}",
                "proveedor_nombre": "Carnes SA",
                "proveedor_rif": "J123456789",
                "categoria": "Insumos",
                "forma_pago": "Efectivo",
                "items": [{"ingrediente_id": insumo.id, "cantidad": 5, "costo_unitario": costo}],
            },
        )
        assert r.status_code == 200, r.text

    a = client.get("/api/tasas/analisis").json()
    assert a["inflacion_insumos_pct"] == 20.0
    assert a["variacion_pct"] == 2.0
    assert "Tus insumos subieron 20.0% y el dólar +2.0%" in _titulos(a)


def test_sin_compras_no_se_opina_de_los_insumos(client, db):
    _tasa(db, 10, bcv=800.0)
    _tasa(db, 0, bcv=816.0)
    a = client.get("/api/tasas/analisis").json()
    assert a["inflacion_insumos_pct"] is None
    assert "insumos subieron" not in _titulos(a)
