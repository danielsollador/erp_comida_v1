"""Cargar mercancia que estaba en negativo (26-oct, carne mechada y molida).

Se vendio cinco dias sin cargarla: el stock quedo en -3,1 kg. Al llegar 7,15 kg
el sistema dejo 4,05, el cliente lo "arreglo" contando, y los 3,1 kg entraron
como sobrante: ganancia de un conteo por mercancia que siempre estuvo ahi.
"""
from app import models
from tests.conftest import saldo


def en_negativo(db, insumo, cantidad=-3.0):
    insumo.stock_actual = cantidad
    db.commit()
    return insumo


def test_al_comprar_en_negativo_queda_lo_que_llego(client, db, libros, insumo):
    en_negativo(db, insumo)
    capital, inventario = saldo(db, "3010"), saldo(db, "1040")
    costo = insumo.costo_unitario
    r = client.post(f"/api/inventario/ingredientes/{insumo.id}/comprar", json={
        "cantidad": 7, "costo_total": 56, "metodo_pago": "Efectivo Bs", "regularizar_negativo": True,
    })
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(models.Ingrediente, insumo.id).stock_actual == 7
    assert db.query(models.SobranteInventario).count() == 0, "no es ganancia de un conteo"
    assert round(saldo(db, "3010") - capital, 2) == round(3 * costo, 2), "es mercancía que ya tenía el dueño"
    assert round(saldo(db, "1040") - inventario, 2) == round(3 * costo + 56, 2)


def test_sin_regularizar_se_resta_como_antes(client, db, insumo):
    en_negativo(db, insumo)
    client.post(f"/api/inventario/ingredientes/{insumo.id}/comprar", json={"cantidad": 7, "costo_total": 56})
    db.expire_all()
    assert db.get(models.Ingrediente, insumo.id).stock_actual == 4


def test_contar_desde_negativo_no_es_sobrante(client, db, libros, insumo):
    en_negativo(db, insumo, -2.0)
    capital, inventario = saldo(db, "3010"), saldo(db, "1040")
    r = client.post(f"/api/inventario/ingredientes/{insumo.id}/ajustar", json={"stock_real": 5})
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(models.Ingrediente, insumo.id).stock_actual == 5
    assert db.query(models.SobranteInventario).count() == 0
    origenes = {m.origen for m in db.query(models.MovimientoInventario).filter_by(ingrediente_id=insumo.id)}
    assert "existencia_no_cargada" in origenes
    assert round(saldo(db, "3010") - capital, 2) == round(7 * insumo.costo_unitario, 2)
    assert round(saldo(db, "1040") - inventario, 2) == round(7 * insumo.costo_unitario, 2)


def test_contar_de_mas_con_stock_positivo_sigue_siendo_sobrante(client, db, insumo):
    insumo.stock_actual = 2
    db.commit()
    client.post(f"/api/inventario/ingredientes/{insumo.id}/ajustar", json={"stock_real": 5})
    assert db.query(models.SobranteInventario).count() == 1
