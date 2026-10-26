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
