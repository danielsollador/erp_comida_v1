"""Un insumo exento de IVA cambia de verdad el IVA de la factura.

Antes el IVA de una factura con renglones lo mandaba el cliente sin que nada
lo verificara. Marcar un insumo como exento sin que eso tocara un centavo del
calculo habria sido peor que no tener el campo: daria una falsa sensacion de
control.
"""


def crear_insumo(client, nombre="Harina exenta", exento=False):
    return client.post("/api/inventario/ingredientes", json={
        "nombre": nombre, "unidad": "kg", "stock_actual": 0, "stock_minimo": 0,
        "stock_objetivo": 0, "costo_unitario": 0, "exento": exento,
    }).json()


def factura(client, ing_id, cantidad=1, costo_unitario=10.0, rif="J123456789"):
    return client.post("/api/compras/facturas", json={
        "numero_factura": "F-EX", "proveedor_nombre": "Prov", "proveedor_rif": rif,
        "categoria": "Insumos", "forma_pago": "Efectivo",
        "items": [{"ingrediente_id": ing_id, "cantidad": cantidad, "costo_unitario": costo_unitario}],
    })


def test_un_insumo_exento_no_paga_iva(client):
    ing = crear_insumo(client, exento=True)
    r = factura(client, ing["id"])
    assert r.status_code == 200
    assert r.json()["iva"] == 0.0


def test_un_insumo_normal_si_paga_iva(client):
    ing = crear_insumo(client, exento=False)
    r = factura(client, ing["id"])
    assert r.json()["iva"] == 1.6  # 16% de $10


def test_mezcla_de_exento_y_gravado_solo_cobra_iva_sobre_lo_gravado(client):
    exento = crear_insumo(client, "Harina", exento=True)
    gravado = crear_insumo(client, "Refresco", exento=False)
    r = client.post("/api/compras/facturas", json={
        "numero_factura": "F-MIX", "proveedor_nombre": "Prov", "proveedor_rif": "J123456789",
        "categoria": "Insumos", "forma_pago": "Efectivo",
        "items": [
            {"ingrediente_id": exento["id"], "cantidad": 1, "costo_unitario": 10.0},
            {"ingrediente_id": gravado["id"], "cantidad": 1, "costo_unitario": 10.0},
        ],
    })
    assert r.json()["base_imponible"] == 20.0, "la base suma TODO lo comprado"
    assert r.json()["iva"] == 1.6, "el IVA solo sale de los $10 gravados"


def test_el_iva_que_manda_el_cliente_se_ignora_si_hay_renglones(client):
    """El IVA de una factura con items lo calcula el sistema, no lo que
    escriba el formulario: confiar en eso era lo que dejaba a "exento" sin
    ningun efecto real."""
    ing = crear_insumo(client, exento=False)
    r = client.post("/api/compras/facturas", json={
        "numero_factura": "F-ENGANO", "proveedor_nombre": "Prov", "proveedor_rif": "J123456789",
        "categoria": "Insumos", "forma_pago": "Efectivo", "iva": 999,
        "items": [{"ingrediente_id": ing["id"], "cantidad": 1, "costo_unitario": 10.0}],
    })
    assert r.json()["iva"] == 1.6


def test_una_factura_sin_renglones_sigue_confiando_en_el_iva_declarado(client):
    """Servicios y activos no tienen insumo que marcar exento: ese numero lo
    sigue poniendo quien carga la factura."""
    r = client.post("/api/compras/facturas", json={
        "numero_factura": "F-SERV", "proveedor_nombre": "Prov", "proveedor_rif": "J123456789",
        "categoria": "Servicios", "forma_pago": "Efectivo",
        "base_imponible": 100.0, "iva": 16.0,
    })
    assert r.json()["iva"] == 16.0
