"""El recargo y el descuento del proveedor, y el IVA renglon por renglon.

Una factura casi nunca es la suma limpia de sus renglones: viene con flete,
con recargo por pagar a credito, o con un descuento por volumen. Hasta ahora
no habia donde ponerlos, asi que o se tecleaba un costo unitario falseado --y
el costo de receta quedaba mintiendo-- o se cargaba la factura por un monto
que no era el que se pago.

Y el IVA: la misma mercancia puede venir exenta de un proveedor y gravada de
otro. La marca del insumo es el valor por defecto, no la ultima palabra.
"""
from app import models

from conftest import libros, libros_cuadrados  # noqa: F401


def factura(client, insumo, **extra):
    cuerpo = {
        "numero_factura": "F-100",
        "proveedor_nombre": "Carnes SA",
        "proveedor_rif": "J123456789",
        "categoria": "Insumos",
        "forma_pago": "Efectivo",
        "items": [{"ingrediente_id": insumo.id, "cantidad": 10, "costo_unitario": 10.0}],
    }
    cuerpo.update(extra)
    return client.post("/api/compras/facturas", json=cuerpo)


def test_sin_recargo_ni_descuento_nada_cambia(client, insumo):
    r = factura(client, insumo)
    assert r.status_code == 200, r.text
    assert r.json()["base_imponible"] == 100.0
    assert r.json()["iva"] == 16.0


def test_el_recargo_sube_la_base_y_el_costo_de_la_mercancia(client, insumo, db):
    """Un flete de $10 en una compra de $100 hace que esa mercancia cueste 10%
    mas de verdad. Dejarlo anotado a un lado mantendria el costo de receta
    mintiendo a favor, y el margen de cada plato saldria inflado."""
    antes = insumo.stock_actual
    r = factura(client, insumo, recargo=10.0)
    assert r.status_code == 200, r.text
    assert r.json()["base_imponible"] == 110.0
    assert r.json()["recargo"] == 10.0
    assert r.json()["iva"] == 17.6, "el IVA va sobre la base ya con el flete"

    db.refresh(insumo)
    assert insumo.stock_actual == antes + 10
    # El renglon guarda lo que dice el papel ($10), pero al deposito entro a
    # $11: es lo que la mercancia costo.
    assert r.json()["items"][0]["costo_unitario"] == 10.0
    entrada = (
        db.query(models.MovimientoInventario)
        .filter(models.MovimientoInventario.origen == "factura")
        .order_by(models.MovimientoInventario.id.desc())
        .first()
    )
    assert round(entrada.costo_unitario, 2) == 11.0


def test_el_descuento_baja_la_base_y_el_costo(client, insumo, db):
    r = factura(client, insumo, descuento=20.0)
    assert r.status_code == 200, r.text
    assert r.json()["base_imponible"] == 80.0
    assert r.json()["descuento"] == 20.0
    assert r.json()["iva"] == 12.8

    entrada = (
        db.query(models.MovimientoInventario)
        .filter(models.MovimientoInventario.origen == "factura")
        .order_by(models.MovimientoInventario.id.desc())
        .first()
    )
    assert round(entrada.costo_unitario, 2) == 8.0


def test_un_descuento_que_se_come_la_factura_se_rechaza(client, insumo):
    r = factura(client, insumo, descuento=100.0)
    assert r.status_code == 400
    assert "se come la factura" in r.json()["detail"]


def test_los_dos_montos_van_en_positivo(client, insumo):
    r = factura(client, insumo, descuento=-5.0)
    assert r.status_code == 400
    assert "en positivo" in r.json()["detail"]


def test_sin_renglones_el_recargo_tambien_mueve_la_base(client):
    """Una factura de servicios no tiene renglones: la base la teclea quien
    tiene el papel delante, y el recargo se le suma igual."""
    r = client.post("/api/compras/facturas", json={
        "numero_factura": "F-gas", "proveedor_nombre": "Gas SA",
        "proveedor_rif": "J123456789", "categoria": "Servicios",
        "forma_pago": "Efectivo", "base_imponible": 50.0, "iva": 8.0, "recargo": 5.0,
    })
    assert r.status_code == 200, r.text
    assert r.json()["base_imponible"] == 55.0
    # El IVA no se recalcula: lo dice la factura, no una regla de tres.
    assert r.json()["iva"] == 8.0


# ── El IVA de cada renglon ──────────────────────────────────────────────────

def test_el_renglon_hereda_lo_que_diga_el_insumo(client, insumo, db):
    insumo.exento = True
    db.commit()
    r = factura(client, insumo)
    assert r.status_code == 200, r.text
    assert r.json()["iva"] == 0.0
    assert r.json()["items"][0]["exento"] is True


def test_la_factura_manda_sobre_la_ficha_del_insumo(client, insumo):
    """La misma mercancia puede venir exenta de un proveedor y gravada de otro.
    Quien tiene el papel delante es quien sabe."""
    r = factura(client, insumo, items=[
        {"ingrediente_id": insumo.id, "cantidad": 10, "costo_unitario": 10.0, "exento": True},
    ])
    assert r.status_code == 200, r.text
    assert r.json()["iva"] == 0.0, "el insumo esta gravado, pero esta factura vino exenta"
    assert r.json()["items"][0]["exento"] is True


def test_marcar_gravado_un_insumo_exento_tambien_vale(client, insumo, db):
    insumo.exento = True
    db.commit()
    r = factura(client, insumo, items=[
        {"ingrediente_id": insumo.id, "cantidad": 10, "costo_unitario": 10.0, "exento": False},
    ])
    assert r.status_code == 200, r.text
    assert r.json()["iva"] == 16.0
    assert r.json()["items"][0]["exento"] is False


def test_lo_que_se_guardo_no_cambia_si_despues_cambia_la_ficha(client, insumo, db):
    """El Libro de Compras de este mes no se puede reescribir porque alguien
    le cambie la marca al insumo el mes que viene."""
    r = factura(client, insumo)
    assert r.json()["items"][0]["exento"] is False

    insumo.exento = True
    db.commit()
    traida = client.get("/api/compras/facturas").json()[0]
    assert traida["items"][0]["exento"] is False
    assert traida["iva"] == 16.0


def test_una_factura_con_recargo_deja_los_libros_cuadrados(client, insumo, db, libros):
    """Lo que entra al deposito tiene que valer exactamente lo que dice la base
    de la factura: si el reparto del flete no cuadra, el inventario contable se
    separa del fisico y no se nota hasta que alguien arquea."""
    r = client.post("/api/compras/facturas", json={
        "numero_factura": "F-flete", "proveedor_nombre": "Carnes SA",
        "proveedor_rif": "J123456789", "categoria": "Insumos", "forma_pago": "Efectivo",
        "recargo": 7.5, "descuento": 2.5,
        "items": [
            {"ingrediente_id": insumo.id, "cantidad": 3, "costo_unitario": 8.0},
            {"ingrediente_id": insumo.id, "cantidad": 2, "costo_unitario": 9.5},
        ],
    })
    assert r.status_code == 200, r.text
    assert r.json()["base_imponible"] == 48.0, "43 + 7.50 - 2.50"
    libros_cuadrados(client, db)
