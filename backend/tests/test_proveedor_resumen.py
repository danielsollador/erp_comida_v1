"""La ficha del proveedor: cuanto se le compro, cuanto se le debe y sus
ultimas facturas.

Antes la pestaña de proveedores era una agenda (nombre, RIF, telefono): para
saber cuanto se le debia a Carnes SA habia que irse a la lista de facturas y
sumar a ojo. La ficha lo responde sola. Las facturas se enlazan por RIF
normalizado, igual que el Libro de Compras.
"""


def _factura(client, numero, **extra):
    cuerpo = {
        "numero_factura": numero, "proveedor_nombre": "Carnes SA",
        "proveedor_rif": "J-12345678-9", "categoria": "Insumos",
        "forma_pago": "Efectivo", "base_imponible": 100.0, "iva": 16.0,
    }
    cuerpo.update(extra)
    r = client.post("/api/compras/facturas", json=cuerpo)
    assert r.status_code == 200, r.text
    return r.json()


def test_resumen_suma_compras_y_deuda(client):
    p = client.post("/api/proveedores", json={"nombre": "Carnes SA", "rif": "J-12345678-9"}).json()
    _factura(client, "F-1")
    _factura(client, "F-2", forma_pago="Credito", base_imponible=50.0, iva=8.0)
    # Otro proveedor: no cuenta.
    client.post("/api/compras/facturas", json={
        "numero_factura": "F-9", "proveedor_nombre": "Otro", "proveedor_rif": "V-11111111-1",
        "categoria": "Insumos", "forma_pago": "Efectivo", "base_imponible": 999.0, "iva": 0,
    })

    r = client.get(f"/api/proveedores/{p['id']}/resumen")
    assert r.status_code == 200
    d = r.json()
    assert d["facturas"] == 2
    assert d["comprado"] == 150.0, "base sin IVA"
    assert d["deuda"] == 58.0, "solo lo de credito sin pagar, con IVA"
    assert d["vencidas"] == 0
    assert [f["numero_factura"] for f in d["ultimas"]] == ["F-2", "F-1"], "la mas reciente primero"
    assert d["ultimas"][0]["saldo"] == 58.0 and d["ultimas"][0]["pagada"] is False
    assert d["ultima_compra"] is not None


def test_resumen_sin_rif_enlaza_por_nombre(client):
    p = client.post("/api/proveedores", json={"nombre": "Verduras del mercado"}).json()
    client.post("/api/compras/facturas", json={
        "numero_factura": "F-V1", "proveedor_nombre": "verduras del mercado", "proveedor_rif": "V-22222222-2",
        "categoria": "Insumos", "forma_pago": "Efectivo", "base_imponible": 20.0, "iva": 0,
    })
    d = client.get(f"/api/proveedores/{p['id']}/resumen").json()
    assert d["facturas"] == 1 and d["comprado"] == 20.0


def test_resumen_de_proveedor_inexistente(client):
    assert client.get("/api/proveedores/9999/resumen").status_code == 404
