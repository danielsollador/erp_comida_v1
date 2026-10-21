"""El pedido al proveedor (21-oct): «Qué comprar» por proveedor, en su
presentación y con el mensaje listo para WhatsApp. No envía nada."""
from app import models
from app.pedido_proveedor import whatsapp


def _bajo_minimo(db, insumo):
    insumo.stock_actual = 0.5  # minimo 1, objetivo 15: faltan 14,5 kg
    db.commit()


def _factura(db, insumo, rif="J-12345678-9", nombre="Carnes SA", costo=8.0):
    f = models.FacturaCompra(numero_factura="F-1", proveedor_nombre=nombre, proveedor_rif=rif, base_imponible=costo)
    db.add(f)
    db.flush()
    db.add(models.FacturaCompraItem(factura_id=f.id, ingrediente_id=insumo.id, cantidad=1, costo_unitario=costo))
    db.commit()


def pedir(client):
    r = client.get("/api/inventario/pedido-proveedor")
    assert r.status_code == 200, r.text
    return r.json()


def test_va_al_proveedor_de_la_ultima_factura_en_su_presentacion(client, db, insumo):
    _bajo_minimo(db, insumo)
    _factura(db, insumo)
    db.add(models.Proveedor(nombre="Carnes SA", rif="J123456789", telefono="0414-123.45.67", contacto="María Pérez"))
    db.add(models.EquivalenciaProveedor(proveedor_rif="J123456789", clave="CARNEMOLIDACAJA5KG", descripcion="CARNE MOLIDA CAJA 5KG",
                                        unidad_papel="CAJA", ingrediente_id=insumo.id, factor=5, veces=3))
    db.commit()
    [p] = pedir(client)
    assert p["proveedor"] == "Carnes SA" and p["whatsapp"] == "584141234567"
    [l] = p["lineas"]
    assert (l["cantidad_presentacion"], l["presentacion"], l["cantidad"]) == (3, "cajas", 15), "14,5 kg se piden como 3 cajas"
    assert p["estimado"] == 120.0
    assert p["mensaje"].startswith("Buenos días, María. Para ")
    assert "- Carne molida: 3 cajas (15 kg)" in p["mensaje"]


def test_sin_presentacion_va_en_nuestra_unidad(client, db, insumo):
    _bajo_minimo(db, insumo)
    _factura(db, insumo)
    [p] = pedir(client)
    assert p["whatsapp"] == "", "sin ficha no hay teléfono: se copia el mensaje"
    assert "- Carne molida: 14,5 kg" in p["mensaje"]


def test_lo_que_nunca_se_compro_queda_aparte(client, db, insumo):
    _bajo_minimo(db, insumo)
    [p] = pedir(client)
    assert p["conocido"] is False and p["lineas"][0]["precio"] is None


def test_el_numero_para_whatsapp():
    assert whatsapp("0412 555 1234") == "584125551234"
    assert whatsapp("+58 412-555-1234") == "584125551234"
    assert whatsapp("4125551234") == "584125551234"
    assert whatsapp("0212") == ""
