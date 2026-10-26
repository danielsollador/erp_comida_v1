"""Corregir el costo en la ficha mueve el inventario de los libros (26-oct).

19 refrescos contados a $0 y despues puestos a $1 en la ficha: la ficha decia
$19 y los libros $0. Asi se abrieron $40 entre las dos.
"""
from app import models
from tests.conftest import libros_cuadrados, saldo


def test_subir_el_costo_en_la_ficha_sube_el_inventario_contable(client, db, libros, insumo):
    antes = saldo(db, "1040")
    stock = insumo.stock_actual
    datos = {"nombre": insumo.nombre, "unidad": insumo.unidad, "costo_unitario": insumo.costo_unitario + 1}
    r = client.put(f"/api/inventario/ingredientes/{insumo.id}", json=datos)
    assert r.status_code == 200, r.text
    db.expire_all()
    assert round(saldo(db, "1040") - antes, 2) == round(stock * 1, 2)
    assert any(m.origen == "ajuste_costo" for m in db.query(models.MovimientoInventario).filter_by(ingrediente_id=insumo.id))
    libros_cuadrados(client, db)


def test_guardar_sin_cambiar_el_costo_no_mueve_nada(client, db, libros, insumo):
    antes = saldo(db, "1040")
    datos = {"nombre": insumo.nombre, "unidad": insumo.unidad, "costo_unitario": insumo.costo_unitario, "stock_minimo": 3}
    assert client.put(f"/api/inventario/ingredientes/{insumo.id}", json=datos).status_code == 200
    db.expire_all()
    assert saldo(db, "1040") == antes
