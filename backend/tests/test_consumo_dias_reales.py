"""Para cuanto alcanza se mide con los dias que de verdad hubo, no con la ventana.

26-oct: la carne mechada llevaba 5 dias en el sistema; lo que se gasto en esos
5 dias se dividia entre 30 y 7 kg "alcanzaban para 2 meses".
"""
import datetime

from app import kardex


def test_dias_medidos_empieza_en_la_primera_historia():
    hasta = datetime.datetime(2026, 10, 26, 14, 0)
    desde = hasta - datetime.timedelta(days=30)
    primero = datetime.datetime(2026, 10, 21, 9, 0)
    assert round(kardex.dias_medidos(desde, hasta, primero), 1) == 5.2
    assert kardex.dias_medidos(desde, hasta, None) == 30
    assert kardex.dias_medidos(desde, hasta, desde - datetime.timedelta(days=90)) == 30
    assert kardex.dias_medidos(desde, hasta, hasta) == 1, "un dia como minimo"


def test_lo_vendido_hoy_no_se_reparte_entre_30_dias(client, insumo, variante):
    p = client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": 10}], "nota": "", "permitir_sin_stock": True},
    ).json()
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})
    extracto = client.get(f"/api/inventario/ingredientes/{insumo.id}/movimientos").json()
    gastado = abs(sum(m["cantidad"] for m in extracto["movimientos"] if m["tipo"] == "venta"))
    fila = next(f for f in client.get("/api/inventario/consumo?dias=30").json() if f["ingrediente_id"] == insumo.id)
    assert gastado > 0
    assert abs(fila["por_dia"] - gastado) < 0.001, "todo se gastó en un día, no en treinta"
