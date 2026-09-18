"""Lo que dice la tasa, leido en prosa.

Traido del "Margen comido por la tasa" de Vertigo Timon y adaptado: alli el
problema son los precios en bolivares que se quedan viejos; aqui el menu esta
en dolares, asi que lo que se come el margen es LA BRECHA --se cobra al
oficial y se repone comprando divisas--, y solo sobre la parte que de verdad
entro en bolivares.

Lo que se prueba es justo eso: que la cuenta no se haga sobre la venta entera.
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
    """Una venta cobrada con los metodos indicados: [(metodo, monto), ...]."""
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


def _titulos(analisis):
    return " · ".join(l["titulo"] for l in analisis["lecturas"])


def test_la_brecha_solo_muerde_lo_que_entro_en_bolivares(client, db, variante):
    """Una venta mixta: lo que el cliente pago en efectivo en dolares no pasa
    por la tasa, asi que la brecha no se lo lleva. Contar la venta entera
    exageraria la perdida justo donde el dueno ya se esta cubriendo."""
    _tasa(db, 0, bcv=800.0, paralelo=1000.0)  # brecha 25%

    # $10: la mitad en pago movil (bolivares) y la mitad en efectivo en divisas.
    _vender(client, variante, 2, [("Pago movil", 5.0), ("Efectivo $", 5.0)])

    a = client.get("/api/tasas/analisis").json()
    assert a["brecha_fin_pct"] == 25.0
    assert a["cobrado_bs_usd"] == 5.0, "solo la parte en bolivares"
    # Con 25% de brecha, esos $5 rinden $4: se perdio $1, no $2.
    assert a["costo_brecha_usd"] == 1.0
    assert "La brecha se llevó $1.00" in _titulos(a)


def test_el_fiado_todavia_no_perdio_nada(client, db, variante):
    """Fiado no es plata que entro: no se sabe a que tasa ni en que moneda se
    va a cobrar. Contarlo como expuesto seria inventar una perdida."""
    _tasa(db, 0, bcv=800.0, paralelo=1000.0)
    _vender(client, variante, 1, [("Fiado", 5.0)], cliente="Pedro")

    a = client.get("/api/tasas/analisis").json()
    assert a["cobrado_bs_usd"] == 0.0
    assert a["costo_brecha_usd"] == 0.0


def test_lee_cuanto_se_movio_el_dolar_y_avisa_de_los_precios(client, db):
    _tasa(db, 20, bcv=800.0, paralelo=880.0)
    _tasa(db, 0, bcv=880.0, paralelo=980.0)

    a = client.get("/api/tasas/analisis").json()
    assert a["bcv_inicio"] == 800.0 and a["bcv_fin"] == 880.0
    assert a["variacion_pct"] == 10.0
    assert a["dias"] == 2
    assert "El dólar subió 10.0%" in _titulos(a)
    # Y dice que hacer: el margen del menu ya no es el de la carta.
    assert "margen" in " ".join(l["detalle"] for l in a["lecturas"])
    # La brecha se abrio de 10% a 11.4%.
    assert a["brecha_inicio_pct"] == 10.0
    assert a["brecha_fin_pct"] == 11.4
    assert "se abrió" in " ".join(l["detalle"] for l in a["lecturas"])


def test_con_la_tasa_quieta_no_alarma(client, db):
    _tasa(db, 10, bcv=800.0, paralelo=840.0)
    _tasa(db, 0, bcv=805.0, paralelo=845.0)

    a = client.get("/api/tasas/analisis").json()
    lectura = a["lecturas"][0]
    assert lectura["tipo"] == "bueno"
    assert "se movió poco" in lectura["titulo"]


def test_sin_tasas_en_el_periodo_lo_dice_en_vez_de_mentir(client, db):
    a = client.get("/api/tasas/analisis?desde=2020-01-01&hasta=2020-01-31").json()
    assert a["puntos"] == []
    assert a["dias"] == 0
    assert a["variacion_pct"] is None
    assert "Todavía no hay tasas guardadas" in _titulos(a)


def test_la_serie_va_en_orden_y_trae_el_euro(client, db):
    _tasa(db, 2, bcv=800.0, eur=930.0, paralelo=880.0)
    _tasa(db, 1, bcv=810.0, eur=940.0, paralelo=890.0)
    _tasa(db, 0, bcv=820.0, eur=950.0, paralelo=900.0)

    a = client.get("/api/tasas/analisis").json()
    assert [p["bcv"] for p in a["puntos"]] == [800.0, 810.0, 820.0], "del mas viejo al mas nuevo"
    assert [p["eur"] for p in a["puntos"]] == [930.0, 940.0, 950.0]
    assert a["bcv_min"] == 800.0 and a["bcv_max"] == 820.0
    assert a["brecha_media_pct"] == 9.9


def test_avisa_de_los_huecos_del_historico(client, db):
    """El BCV no publica fines de semana. Con huecos, el promedio de la brecha
    no es el del periodo: se dice en vez de disimularlo."""
    _tasa(db, 20, bcv=800.0, paralelo=880.0)
    _tasa(db, 0, bcv=820.0, paralelo=900.0)

    a = client.get("/api/tasas/analisis").json()
    assert "Faltan 19 días de tasa" in _titulos(a)


def test_avisa_si_la_tasa_quedo_cargada_a_mano(client, db):
    _tasa(db, 1, bcv=800.0, paralelo=880.0)
    _tasa(db, 0, bcv=900.0, paralelo=980.0, origen="manual")

    a = client.get("/api/tasas/analisis").json()
    assert "la cargaste a mano" in _titulos(a)
