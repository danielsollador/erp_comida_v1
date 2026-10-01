"""Corregir despues, renglon por renglon, que va a cocina y que es de vitrina.

El caso real (29-sep): la cajera marco de vitrina unos pastelitos que habia
que hacer, cobro, y la cocina nunca los vio.
"""
from app import models


def otra(db, nombre="Refresco", precio=2.0):
    categoria = db.query(models.Categoria).first()
    p = models.Producto(categoria_id=categoria.id, nombre=nombre)
    db.add(p)
    db.flush()
    v = models.Variante(producto_id=p.id, nombre="Regular", precio=precio)
    db.add(v)
    db.commit()
    db.refresh(v)
    return v


def por_nombre(pedido, nombre):
    return next(i for i in pedido["items"] if i["nombre"] == nombre)


def test_lo_que_se_marco_de_vitrina_por_error_llega_a_cocina(client, variante, db):
    refresco = otra(db)
    p = client.post("/api/pedidos", json={"cliente": "Ana", "items": [
        {"variante_id": variante.id, "cantidad": 2, "a_cocina": False},
        {"variante_id": refresco.id, "cantidad": 1, "a_cocina": False},
    ]}).json()
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})
    empanada = next(i for i in p["items"] if i["nombre"] != "Refresco")

    r = client.put(f"/api/pedidos/{p['id']}/cocina", json={"items": [
        {"id": empanada["id"], "a_cocina": True},
    ]})
    assert r.status_code == 200, r.text
    q = r.json()
    e = next(i for i in q["items"] if i["id"] == empanada["id"])
    assert e["a_cocina"] is True and e["preparado"] is False
    # El refresco no se toco: sigue de vitrina.
    assert por_nombre(q, "Refresco")["a_cocina"] is False
    assert q["a_cocina"] is True and q["estado"] == "pagado"
    assert q["ediciones"][-1]["detalle"].startswith("a cocina")

    # Y la cocina lo ve.
    en_cocina = client.get("/api/pedidos?en_cocina=true").json()
    assert any(x["id"] == p["id"] for x in en_cocina)


def test_la_plata_y_el_inventario_no_se_mueven(client, variante, insumo, db):
    p = client.post("/api/pedidos", json={"cliente": "Ana", "items": [
        {"variante_id": variante.id, "cantidad": 1, "a_cocina": False},
    ]}).json()
    db.refresh(insumo)
    stock = insumo.stock_actual
    client.put(f"/api/pedidos/{p['id']}/cocina", json={"items": [
        {"id": p["items"][0]["id"], "a_cocina": True},
    ]})
    db.refresh(insumo)
    assert insumo.stock_actual == stock
    q = client.get(f"/api/pedidos/{p['id']}").json()
    assert q["total"] == p["total"] and q["estado"] == "pendiente"


def test_lo_que_la_cocina_ya_hizo_no_pasa_a_vitrina(client, variante):
    p = client.post("/api/pedidos", json={"cliente": "Ana", "items": [
        {"variante_id": variante.id, "cantidad": 1, "a_cocina": True},
    ]}).json()
    client.post(f"/api/pedidos/{p['id']}/marcar-listo")
    r = client.put(f"/api/pedidos/{p['id']}/cocina", json={"items": [
        {"id": p["items"][0]["id"], "a_cocina": False},
    ]})
    assert r.status_code == 409


def test_lo_que_aun_no_toca_la_cocina_si_pasa_a_vitrina(client, variante):
    p = client.post("/api/pedidos", json={"cliente": "Ana", "items": [
        {"variante_id": variante.id, "cantidad": 1, "a_cocina": True},
    ]}).json()
    r = client.put(f"/api/pedidos/{p['id']}/cocina", json={"items": [
        {"id": p["items"][0]["id"], "a_cocina": False},
    ]})
    assert r.status_code == 200, r.text
    q = r.json()
    assert q["items"][0]["preparado"] is True and q["estado"] == "listo"


def test_un_pedido_entregado_ya_no_se_cambia(client, variante):
    p = client.post("/api/pedidos", json={"cliente": "Ana", "items": [
        {"variante_id": variante.id, "cantidad": 1, "a_cocina": False},
    ]}).json()
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})
    client.post(f"/api/pedidos/{p['id']}/entregado")
    r = client.put(f"/api/pedidos/{p['id']}/cocina", json={"items": [
        {"id": p["items"][0]["id"], "a_cocina": True},
    ]})
    assert r.status_code == 409
