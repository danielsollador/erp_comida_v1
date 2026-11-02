"""El pernil a $0,08 los 10 kilos (21-oct, en produccion).

Una compra suelta con el monto en bolivares entro sin aviso: la receta quedo
en cero, y lo unico a mano para deshacerla era un conteo, que dejo una perdida
falsa de $40 y el precio malo como "lo ultimo que se pago". Esto fija:

  - un precio absurdo (hacia abajo o hacia arriba) se pregunta ANTES de guardar;
  - una compra suelta se anula entera: stock, promedio, asiento y reposicion;
  - el costo de reposicion no toma un ultimo precio absurdo.
"""
from app import models, reposicion
from tests.conftest import saldo


def alta(client, nombre="Pernil", stock=0.0, costo=0.0):
    r = client.post(
        "/api/inventario/ingredientes",
        json={"nombre": nombre, "unidad": "kg", "stock_actual": stock, "costo_unitario": costo},
    )
    assert r.status_code == 200, r.text
    return r.json()


def comprar(client, ing_id, cantidad, total, **extra):
    return client.post(
        f"/api/inventario/ingredientes/{ing_id}/comprar",
        json={"cantidad": cantidad, "costo_total": total, "metodo_pago": "Efectivo Bs", **extra},
    )


def test_un_precio_mil_veces_menor_se_pregunta_antes_de_guardar(client, db):
    ing = alta(client, stock=10, costo=8.0)
    r = comprar(client, ing["id"], 10, 0.085)
    assert r.status_code == 409
    assert "bolívares" in r.json()["detail"]
    db.expire_all()
    assert db.query(models.CompraSuelta).count() == 0, "no se guardo nada"
    assert db.get(models.Ingrediente, ing["id"]).stock_actual == 10


def test_con_confirmar_se_anota_igual(client, db):
    ing = alta(client, stock=10, costo=8.0)
    assert comprar(client, ing["id"], 10, 0.085, confirmar=True).status_code == 200


def test_un_precio_normal_no_pregunta(client):
    ing = alta(client, stock=10, costo=8.0)
    assert comprar(client, ing["id"], 10, 70.0).status_code == 200  # $7/kg: oferta, no error
    assert comprar(client, ing["id"], 10, 95.0).status_code == 200  # $9,5/kg: inflacion


def test_un_precio_diez_veces_mayor_tambien_se_pregunta(client):
    ing = alta(client, stock=10, costo=8.0)
    assert comprar(client, ing["id"], 1, 80.0).status_code == 409  # el saco como 1


def test_la_primera_compra_no_tiene_contra_que_comparar(client):
    ing = alta(client)
    assert comprar(client, ing["id"], 10, 0.085).status_code == 200


def test_anular_deja_todo_como_antes(client, db):
    ing = alta(client, stock=10, costo=8.0)
    inventario_antes = saldo(db, "1040")
    gaveta_antes = saldo(db, "1010")
    r = comprar(client, ing["id"], 10, 0.085, confirmar=True)
    assert r.status_code == 200
    compra = db.query(models.CompraSuelta).one()

    r = client.post(f"/api/inventario/compras-sueltas/{compra.id}/anular")
    assert r.status_code == 200, r.text
    db.expire_all()
    pernil = db.get(models.Ingrediente, ing["id"])
    assert pernil.stock_actual == 10
    assert abs(pernil.costo_unitario - 8.0) < 0.01, "el promedio vuelve al de antes"
    assert saldo(db, "1040") == inventario_antes
    assert saldo(db, "1010") == gaveta_antes, "la plata vuelve a la gaveta"
    assert db.get(models.CompraSuelta, compra.id).anulada
    # Deja rastro en el kardex y ya no es "lo ultimo que se pago".
    assert any(m.tipo == "reverso" for m in db.query(models.MovimientoInventario).all())
    assert ing["id"] not in reposicion.costos_reposicion(db)
    assert all(c.get("compra_id") != compra.id for c in reposicion.historial_de_costos(db, ing["id"]))


def test_no_se_anula_dos_veces(client, db):
    ing = alta(client, stock=10, costo=8.0)
    comprar(client, ing["id"], 2, 16.0)
    compra = db.query(models.CompraSuelta).one()
    assert client.post(f"/api/inventario/compras-sueltas/{compra.id}/anular").status_code == 200
    assert client.post(f"/api/inventario/compras-sueltas/{compra.id}/anular").status_code == 409


def test_no_se_anula_si_lo_que_entro_ya_salio(client, db):
    ing = alta(client)
    comprar(client, ing["id"], 10, 80.0)
    compra = db.query(models.CompraSuelta).one()
    client.post(f"/api/inventario/ingredientes/{ing['id']}/merma", json={"cantidad": 5, "motivo": "se daño"})
    r = client.post(f"/api/inventario/compras-sueltas/{compra.id}/anular")
    assert r.status_code == 409
    assert "revierte" in r.json()["detail"]


def test_la_reposicion_ignora_un_ultimo_precio_absurdo(client, db):
    ing = alta(client, stock=10, costo=8.0)
    comprar(client, ing["id"], 10, 0.085, confirmar=True)
    db.expire_all()
    pernil = db.get(models.Ingrediente, ing["id"])
    efectivo = reposicion.costo_reposicion_efectivo(pernil, reposicion.costos_reposicion(db))
    assert efectivo > 3, f"no puede quedar en cero: {efectivo}"


def test_sin_costo_y_sin_costo_en_la_ficha_se_pregunta(client, db):
    """2-nov: la masa entro sin costo y dejo los pastelitos en cero."""
    ing = alta(client, nombre="Masa")
    r = client.post(f"/api/inventario/ingredientes/{ing['id']}/comprar",
                    json={"cantidad": 1000, "metodo_pago": "Efectivo Bs"})
    assert r.status_code == 409
    assert "$0" in r.json()["detail"]
    db.expire_all()
    assert db.query(models.CompraSuelta).count() == 0
    r = client.post(f"/api/inventario/ingredientes/{ing['id']}/comprar",
                    json={"cantidad": 1000, "metodo_pago": "Efectivo Bs", "confirmar": True})
    assert r.status_code == 200, "un regalo de verdad se anota confirmandolo"


def test_sin_costo_pero_con_costo_en_la_ficha_no_pregunta(client):
    ing = alta(client, nombre="Masa", stock=10, costo=0.08)
    r = client.post(f"/api/inventario/ingredientes/{ing['id']}/comprar",
                    json={"cantidad": 1000, "metodo_pago": "Efectivo Bs"})
    assert r.status_code == 200


def test_una_compra_en_cero_no_es_lo_ultimo_que_se_pago(client, db):
    """Corregido el costo en la ficha, el menu toma ese y no el cero."""
    ing = alta(client, nombre="Masa")
    comprar(client, ing["id"], 10, 1.0)
    client.post(f"/api/inventario/ingredientes/{ing['id']}/comprar",
                json={"cantidad": 1000, "metodo_pago": "Efectivo Bs", "confirmar": True})
    db.expire_all()
    masa = db.get(models.Ingrediente, ing["id"])
    ultimos = reposicion.costos_reposicion(db)
    assert ultimos[ing["id"]]["costo"] == 0.1, "lo ultimo CON precio"
    masa.costo_unitario = 0.08
    db.commit()
    assert reposicion.costo_reposicion_efectivo(masa, ultimos) == 0.1


def test_sin_ninguna_compra_con_precio_manda_la_ficha(client, db):
    ing = alta(client, nombre="Masa")
    client.post(f"/api/inventario/ingredientes/{ing['id']}/comprar",
                json={"cantidad": 1000, "metodo_pago": "Efectivo Bs", "confirmar": True})
    db.expire_all()
    masa = db.get(models.Ingrediente, ing["id"])
    masa.costo_unitario = 0.08
    db.commit()
    ultimos = reposicion.costos_reposicion(db)
    assert ing["id"] not in ultimos
    assert reposicion.costo_reposicion_efectivo(masa, ultimos) == 0.08


def test_corregir_el_costo_en_la_ficha_manda_sobre_la_compra_anterior(client, db):
    """2-nov: la crema de leche entro a $1,00, se corrigio a $1,60 en la
    ficha y el menu seguia con $1,00."""
    ing = alta(client, nombre="Crema de Leche")
    comprar(client, ing["id"], 48, 48.0)
    r = client.put(f"/api/inventario/ingredientes/{ing['id']}", json={"nombre": ing["nombre"], "unidad": "kg", "costo_unitario": 1.6})
    assert r.status_code == 200, r.text
    db.expire_all()
    crema = db.get(models.Ingrediente, ing["id"])
    assert reposicion.costo_reposicion_efectivo(crema, reposicion.costos_reposicion(db)) == 1.6
    # Y una compra que llegue despues vuelve a mandar.
    comprar(client, ing["id"], 10, 17.0)
    db.expire_all()
    crema = db.get(models.Ingrediente, ing["id"])
    assert reposicion.costo_reposicion_efectivo(crema, reposicion.costos_reposicion(db)) == 1.7


def test_corregir_el_costo_sin_stock_tambien_queda(client, db):
    ing = alta(client, nombre="Crema", stock=0)
    comprar(client, ing["id"], 1, 1.0)
    client.post(f"/api/inventario/ingredientes/{ing['id']}/merma", json={"cantidad": 1, "motivo": "se daño"})
    client.put(f"/api/inventario/ingredientes/{ing['id']}", json={"nombre": ing["nombre"], "unidad": "kg", "costo_unitario": 1.6})
    db.expire_all()
    crema = db.get(models.Ingrediente, ing["id"])
    assert reposicion.costos_reposicion(db)[ing["id"]]["costo"] == 1.6
    assert crema.costo_unitario == 1.6
