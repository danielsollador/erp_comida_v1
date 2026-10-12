"""Renglones que no son mercancia dentro de la factura (7-oct).

Una factura trae pollo, el flete y a veces un servicio, todo en el mismo
papel. Antes habia que elegir UNA categoria para la factura entera; ahora
cada renglon dice que es: la mercancia por su ficha, y lo demas por su
concepto (Flete, Servicio, Equipo, Otro), cada uno a su cuenta. El flete va
a 6060, aparte, porque lleva retencion de ISLR propia.
"""

from app import models
from conftest import libros_cuadrados, saldo  # noqa: F401


def alta(client, nombre, unidad="kg", tipo="insumo"):
    r = client.post(
        "/api/inventario/ingredientes",
        json={"nombre": nombre, "unidad": unidad, "tipo": tipo, "stock_actual": 0, "costo_unitario": 0},
    )
    assert r.status_code == 200, r.text
    return r.json()


def factura(client, **cuerpo):
    base = {
        "numero_factura": "F-1", "proveedor_nombre": "Mayorista", "proveedor_rif": "J123456789",
        "forma_pago": "Efectivo", "tasa_bcv": 100,
    }
    return client.post("/api/compras/facturas", json={**base, **cuerpo})


def test_mercancia_flete_y_servicio_en_la_misma_factura(client, db, libros):
    carne = alta(client, "Carne mechar")
    antes = {c: saldo(db, c) for c in ("1040", "6060", "6010", "1030")}

    r = factura(
        client,
        items=[{"ingrediente_id": carne["id"], "cantidad": 5, "costo_unitario": 6.0}],
        gastos=[
            {"concepto": "Flete", "descripcion": "Traslado", "monto": 10},
            {"concepto": "Servicio", "descripcion": "Desposte", "monto": 5, "exento": True},
        ],
        recargo=4.5,
    )
    assert r.status_code == 200, r.text
    f = r.json()

    # 30 + 10 + 5 = 45 de renglones, + 4,50 de recargo: cada uno lleva 10 % mas.
    assert f["base_imponible"] == 49.5
    assert f["iva"] == round((30 + 10) * 1.1 * 0.16, 2)
    assert f["categoria"] == "Insumos"
    assert [(g["concepto"], g["cuenta"], g["monto"]) for g in f["gastos"]] == [
        ("Flete", "6060", 10.0),
        ("Servicio", "6010", 5.0),
    ]
    assert round(saldo(db, "1040") - antes["1040"], 2) == 33.0
    assert round(saldo(db, "6060") - antes["6060"], 2) == 11.0
    assert round(saldo(db, "6010") - antes["6010"], 2) == 5.5
    assert round(saldo(db, "1030") - antes["1030"], 2) == f["iva"]

    db.expire_all()
    pollo = db.get(models.Ingrediente, carne["id"])
    assert pollo.stock_actual == 5
    assert round(pollo.costo_unitario, 4) == 6.6, "el recargo encarece la mercancia"
    libros_cuadrados(client, db)


def test_una_factura_solo_de_servicios_sin_mercancia(client, db, libros):
    r = factura(client, gastos=[{"concepto": "Flete", "monto": 20}, {"concepto": "Servicio", "monto": 30}])
    assert r.status_code == 200, r.text
    f = r.json()
    assert f["categoria"] == "Servicios"
    assert f["base_imponible"] == 50
    assert f["iva"] == 8.0
    assert f["items"] == []
    libros_cuadrados(client, db)

    # Sin mercancia no movio stock: se puede borrar, y sus renglones se van con ella.
    assert client.delete(f"/api/compras/facturas/{f['id']}").status_code == 200
    assert db.query(models.FacturaCompraGasto).count() == 0
    libros_cuadrados(client, db)


def test_un_equipo_en_la_factura_nace_como_activo(client, db, libros):
    harina = alta(client, "Harina")
    antes = saldo(db, "1050")
    r = factura(
        client,
        items=[{"ingrediente_id": harina["id"], "cantidad": 10, "costo_unitario": 1.0}],
        gastos=[{"concepto": "Equipo", "descripcion": "Licuadora", "monto": 90, "vida_util_meses": 24}],
        forma_pago="Credito",
    )
    assert r.status_code == 200, r.text
    activos = db.query(models.ActivoFijo).all()
    assert [(a.nombre, a.valor, a.vida_util_meses) for a in activos] == [("Licuadora", 90.0, 24)]
    assert round(saldo(db, "1050") - antes, 2) == 90.0
    libros_cuadrados(client, db)


def test_concepto_desconocido_o_sin_monto(client, libros):
    r = factura(client, gastos=[{"concepto": "Propina", "monto": 5}])
    assert r.status_code == 400
    assert "Flete, Servicio, Equipo u Otro" in r.json()["detail"]
    r = factura(client, gastos=[{"concepto": "Flete", "monto": 0}])
    assert r.status_code == 400


def test_nota_de_descuento_reparte_tambien_el_flete(client, db, libros):
    carne = alta(client, "Carne")
    r = factura(
        client,
        items=[{"ingrediente_id": carne["id"], "cantidad": 3, "costo_unitario": 10.0}],
        gastos=[{"concepto": "Flete", "monto": 10}],
    )
    assert r.status_code == 200, r.text
    antes = saldo(db, "6060")
    r = client.post(
        f"/api/compras/facturas/{r.json()['id']}/notas-credito",
        json={"numero": "NC-1", "tipo": "descuento", "base_imponible": 4},
    )
    assert r.status_code == 200, r.text
    # El flete pesa 10 de 40: le toca un cuarto de la rebaja.
    assert round(antes - saldo(db, "6060"), 2) == 1.0
    libros_cuadrados(client, db)
