"""Una factura de compra pagada con mas de una cosa (Leider, 8-oct).

Al proveedor se le da una parte en efectivo y el resto por banco. La factura
queda como "Mixto" con sus partes, cada parte sale de su propia cuenta en el
asiento, y las partes tienen que sumar exactamente lo que se le paga.
"""

from conftest import saldo

FACTURA = {
    "numero_factura": "FM-001",
    "proveedor_nombre": "Distribuidora X",
    "proveedor_rif": "J123456789",
    "categoria": "Servicios",
    "base_imponible": 100.0,
    "iva": 16.0,
    "forma_pago": "Mixto",
}


def crear(client, **extra):
    return client.post("/api/compras/facturas", json={**FACTURA, **extra})


def test_un_pago_mixto_se_guarda_con_sus_partes_y_sale_de_cada_cuenta(client, db):
    bs_antes, banco_antes = saldo(db, "1010"), saldo(db, "1020")
    r = crear(client, pagos=[
        {"forma_pago": "Efectivo", "monto": 50.0},
        {"forma_pago": "Banco", "monto": 66.0, "referencia": "TRF-1"},
    ])
    assert r.status_code == 200, r.text
    f = r.json()
    assert f["forma_pago"] == "Mixto" and f["pagada"] is True
    assert [(p["forma_pago"], p["monto"], p["referencia"]) for p in f["pagos"]] == [
        ("Efectivo", 50.0, ""), ("Banco", 66.0, "TRF-1"),
    ]
    # $50 salieron de la gaveta y $66 del banco: ni mas ni menos.
    assert round(bs_antes - saldo(db, "1010"), 2) == 50.0
    assert round(banco_antes - saldo(db, "1020"), 2) == 66.0


def test_las_partes_tienen_que_sumar_lo_que_se_paga(client):
    r = crear(client, pagos=[{"forma_pago": "Efectivo", "monto": 50.0}, {"forma_pago": "Efectivo $", "monto": 50.0}])
    assert r.status_code == 400, r.text
    assert "suman $100.00" in r.json()["detail"] and "$116.00" in r.json()["detail"]


def test_una_parte_por_banco_lleva_su_referencia(client):
    r = crear(client, pagos=[{"forma_pago": "Efectivo", "monto": 50.0}, {"forma_pago": "Banco", "monto": 66.0}])
    assert r.status_code == 400, r.text
    assert "referencia" in r.json()["detail"].lower()


def test_mixto_con_una_sola_parte_no_es_mixto(client):
    r = crear(client, pagos=[{"forma_pago": "Efectivo", "monto": 116.0}])
    assert r.status_code == 400, r.text
    assert "dos partes" in r.json()["detail"]


def test_las_partes_solo_van_con_mixto(client):
    r = crear(client, forma_pago="Efectivo", pagos=[{"forma_pago": "Efectivo", "monto": 116.0}, {"forma_pago": "Banco", "monto": 0.01}])
    assert r.status_code == 400, r.text


def test_los_servicios_cargados_se_listan_los_mas_repetidos_primero(client):
    def con_servicio(numero, descripcion):
        r = client.post("/api/compras/facturas", json={
            "numero_factura": numero, "proveedor_nombre": "CANTV", "proveedor_rif": "G200000001",
            "forma_pago": "Efectivo", "tasa_bcv": 100,
            "gastos": [{"concepto": "Servicio", "descripcion": descripcion, "monto": 20.0}],
        })
        assert r.status_code == 200, r.text

    assert client.get("/api/compras/servicios").json() == []
    con_servicio("S-1", "Internet")
    con_servicio("S-2", "Luz")
    con_servicio("S-3", "Internet")
    assert client.get("/api/compras/servicios").json() == ["Internet", "Luz"]
