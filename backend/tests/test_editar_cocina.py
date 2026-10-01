"""Al editar una comanda se puede corregir, renglon por renglon, que va a cocina.

Leider (2-oct): "por algun error pude omitir enviar algo a cocina y debo
modificarlo" desde Guardar cambios, con todos los renglones a la vista.
Mismas reglas que corregir cocina aparte: a cocina vuelve a la cola sin
hacer; a vitrina solo lo que la cocina no termino; la plata y el inventario
no se mueven por eso.
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


def por_variante(pedido, variante_id):
    return next(i for i in pedido["items"] if i["variante_id"] == variante_id)


def abrir(client, pedido_id):
    r = client.post(f"/api/pedidos/{pedido_id}/edicion")
    assert r.status_code == 200, r.text


def test_lo_que_se_marco_de_vitrina_por_error_va_a_cocina_al_editar(client, variante, db):
    refresco = otra(db)
    p = client.post("/api/pedidos", json={"cliente": "Ana", "items": [
        {"variante_id": variante.id, "cantidad": 2, "a_cocina": False},
        {"variante_id": refresco.id, "cantidad": 1, "a_cocina": False},
    ]}).json()
    assert p["estado"] == "listo"
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})

    abrir(client, p["id"])
    r = client.put(f"/api/pedidos/{p['id']}", json={"items": [
        {"variante_id": variante.id, "cantidad": 2, "a_cocina": True},
        {"variante_id": refresco.id, "cantidad": 1, "a_cocina": False},
    ]})
    assert r.status_code == 200, r.text
    q = r.json()
    e = por_variante(q, variante.id)
    assert e["a_cocina"] is True and e["preparado"] is False
    assert por_variante(q, refresco.id)["a_cocina"] is False
    assert q["a_cocina"] is True and q["estado"] == "pagado"
    assert q["total"] == p["total"]
    assert "a cocina" in q["ediciones"][-1]["detalle"]

    en_cocina = client.get("/api/pedidos?en_cocina=true").json()
    assert any(x["id"] == p["id"] for x in en_cocina)


def test_una_comanda_de_vitrina_sin_cobrar_vuelve_a_pendiente(client, variante):
    p = client.post("/api/pedidos", json={"cliente": "Ana", "items": [
        {"variante_id": variante.id, "cantidad": 1, "a_cocina": False},
    ]}).json()
    assert p["estado"] == "listo"
    abrir(client, p["id"])
    q = client.put(f"/api/pedidos/{p['id']}", json={"items": [
        {"variante_id": variante.id, "cantidad": 1, "a_cocina": True},
    ]}).json()
    assert q["estado"] == "pendiente" and q["listo_en"] is None


def test_sin_decir_nada_el_renglon_queda_como_estaba(client, variante, db):
    refresco = otra(db)
    p = client.post("/api/pedidos", json={"cliente": "Ana", "items": [
        {"variante_id": variante.id, "cantidad": 1, "a_cocina": False},
    ]}).json()
    abrir(client, p["id"])
    # Se agrega un refresco; de la empanada no se dice nada.
    q = client.put(f"/api/pedidos/{p['id']}", json={"items": [
        {"variante_id": variante.id, "cantidad": 1},
        {"variante_id": refresco.id, "cantidad": 1, "a_cocina": False},
    ]}).json()
    assert por_variante(q, variante.id)["a_cocina"] is False


def test_lo_que_la_cocina_termino_no_pasa_a_vitrina(client, variante):
    p = client.post("/api/pedidos", json={"cliente": "Ana", "items": [
        {"variante_id": variante.id, "cantidad": 1},
    ]}).json()
    client.post(f"/api/pedidos/{p['id']}/marcar-listo")
    abrir(client, p["id"])
    r = client.put(f"/api/pedidos/{p['id']}", json={"items": [
        {"variante_id": variante.id, "cantidad": 1, "a_cocina": False},
    ]})
    assert r.status_code == 409
    assert "no pasa a vitrina" in r.json()["detail"]


def test_de_cocina_a_vitrina_antes_de_que_la_toquen(client, variante):
    p = client.post("/api/pedidos", json={"cliente": "Ana", "items": [
        {"variante_id": variante.id, "cantidad": 1},
    ]}).json()
    assert p["estado"] == "pendiente"
    abrir(client, p["id"])
    q = client.put(f"/api/pedidos/{p['id']}", json={"items": [
        {"variante_id": variante.id, "cantidad": 1, "a_cocina": False},
    ]}).json()
    e = por_variante(q, variante.id)
    assert e["a_cocina"] is False and e["preparado"] is True
    assert q["estado"] == "listo"
    assert "de vitrina" in q["ediciones"][-1]["detalle"]
    assert not any(x["id"] == p["id"] for x in client.get("/api/pedidos?en_cocina=true").json())


def test_la_plata_y_el_inventario_no_se_mueven(client, variante, insumo, db):
    p = client.post("/api/pedidos", json={"cliente": "Ana", "items": [
        {"variante_id": variante.id, "cantidad": 1, "a_cocina": False},
    ]}).json()
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo $"})
    db.refresh(insumo)
    stock = insumo.stock_actual
    abrir(client, p["id"])
    q = client.put(f"/api/pedidos/{p['id']}", json={"items": [
        {"variante_id": variante.id, "cantidad": 1, "a_cocina": True},
    ]}).json()
    db.refresh(insumo)
    assert insumo.stock_actual == stock
    assert len(q["pagos"]) == 1 and q["ediciones"][-1]["diferencia"] == 0
