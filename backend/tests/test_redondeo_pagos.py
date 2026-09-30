"""Los centavos en bolivares que un pago trae de mas o de menos.

Los libros van en dolares con centavos; el banco, en bolivares. Bs 1.000,40
por una cuenta de Bs 1.000 son $10,00 en los dos casos, y antes esos Bs 0,40
no quedaban en ninguna parte (Leider, 30-sep). Ahora cada pago guarda sus
bolivares y su redondeo, y la cuenta 4030 "Redondeo de pagos" recibe lo del
dia en cuanto suma un centavo.
"""
from app import models
from tests.conftest import saldo


def con_tasa(client, bcv=100.0):
    assert client.put("/api/tasas", json={"bcv": bcv}).status_code == 200


def vender(client, variante, monto_bs, referencia):
    p = client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": 2}], "nota": "", "permitir_sin_stock": True},
    ).json()
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={
        "metodo_pago": "Pago movil",
        "pagos": [{"metodo": "Pago movil", "monto": 10.0, "referencia": referencia, "monto_bs": monto_bs}],
    })
    assert r.status_code == 200, r.text
    return r.json()


def test_el_sobrante_chico_se_guarda_y_se_asienta_al_sumar_un_centavo(client, db, variante):
    con_tasa(client, 100.0)
    v1 = vender(client, variante, 1000.40, "11110001")
    pago = db.query(models.PagoPedido).filter_by(pedido_id=v1["id"]).one()
    assert pago.monto_bs == 1000.40
    assert pago.redondeo_bs == 0.40
    assert abs(pago.redondeo_usd - 0.004) < 1e-9
    # $0,004 todavia no es un centavo: no hay asiento de $0,00.
    assert saldo(db, "4030") == 0
    assert v1["pagos"][0]["redondeo_bs"] == 0.40

    # Con el segundo del dia ya suma $0,008: se asienta un centavo.
    vender(client, variante, 1000.40, "11110002")
    assert saldo(db, "4030") == 0.01
    # Y entra al banco, que es donde de verdad estan esos bolivares.
    asientos = db.query(models.AsientoContable).filter_by(origen="redondeo").all()
    assert len(asientos) == 1


def test_el_faltante_resta(client, db, variante):
    con_tasa(client, 100.0)
    vender(client, variante, 998.50, "22220001")
    # -Bs 1,50 = -$0,015: ya es mas de un centavo, se asienta en negativo.
    assert saldo(db, "4030") < 0


def test_sin_bolivares_no_hay_redondeo(client, db, variante):
    con_tasa(client, 100.0)
    p = client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": 2}], "nota": "", "permitir_sin_stock": True},
    ).json()
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo $"})
    assert r.status_code == 200, r.text
    pago = db.query(models.PagoPedido).filter_by(pedido_id=p["id"]).one()
    assert pago.monto_bs is None
    assert (pago.redondeo_bs or 0) == 0
    assert saldo(db, "4030") == 0
