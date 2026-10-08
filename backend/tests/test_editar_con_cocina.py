"""Editar una comanda que la cocina ya empezo o termino (Leider, 8-oct).

Desde el 8-oct un pedido sin cobrar se edita siempre, aunque la cocina lo
este preparando. Estas pruebas recorren lo que eso tiene que garantizar:

  - a la cocina solo le llega lo NUEVO: lo que ya hizo no vuelve a la cola;
  - lo que la cocina ya hizo no se quita (es comida en la barra);
  - lo que todavia no hizo si se quita, y vuelve al deposito;
  - editar varias veces seguidas no duplica ni mezcla lo hecho con lo nuevo;
  - la pantalla de cocina y el mostrador ven la comanda donde corresponde.
"""
import pytest

from app import models


def otra_cocinada(db, insumo, nombre="Pastelito", precio=2.0):
    """Otro producto del menu que SI se cocina (lleva receta), en la misma
    categoria que la empanada (la primera de la base puede ser Envios)."""
    categoria = db.query(models.Categoria).filter_by(nombre="Comida").first()
    producto = models.Producto(categoria_id=categoria.id, nombre=nombre)
    db.add(producto)
    db.flush()
    v = models.Variante(producto_id=producto.id, nombre="Pollo", precio=precio)
    db.add(v)
    db.flush()
    db.add(models.RecetaItem(variante_id=v.id, ingrediente_id=insumo.id, cantidad_por_unidad=0.05))
    db.commit()
    db.refresh(v)
    return v


def tomar(client, items, **extra):
    r = client.post("/api/pedidos", json={"items": items, "nota": "", **extra})
    assert r.status_code == 200, r.text
    return r.json()


def editar(client, pedido_id, items, **extra):
    assert client.post(f"/api/pedidos/{pedido_id}/edicion").status_code == 200
    return client.put(f"/api/pedidos/{pedido_id}", json={"items": items, **extra})


def hecho_y_pendiente(pedido, variante_id):
    filas = [i for i in pedido["items"] if i["variante_id"] == variante_id]
    return (
        sum(i["cantidad"] for i in filas if i["preparado"]),
        sum(i["cantidad"] for i in filas if not i["preparado"]),
    )


def cocinar(client, pedido, variante_id):
    """La cocina marca como hecho todo lo de ese producto."""
    for i in pedido["items"]:
        if i["variante_id"] == variante_id and not i["preparado"]:
            assert client.post(f"/api/pedidos/items/{i['id']}/preparado").status_code == 200
    return client.get(f"/api/pedidos/{pedido['id']}").json()


def en_cocina(client):
    return {p["id"]: p for p in client.get("/api/pedidos?en_cocina=true").json()}


def stock(db, insumo):
    db.expire_all()
    return round(db.get(models.Ingrediente, insumo.id).stock_actual, 4)


# ── Con la cocina a medias ───────────────────────────────────────────────────

def test_a_medias_lo_nuevo_de_lo_hecho_va_aparte_y_lo_pendiente_se_suma(client, variante, insumo, db):
    pastelito = otra_cocinada(db, insumo)
    p = tomar(client, [
        {"variante_id": variante.id, "cantidad": 2},
        {"variante_id": pastelito.id, "cantidad": 3},
    ])
    p = cocinar(client, p, variante.id)  # las empanadas listas, los pastelitos no
    assert p["cocinando_desde"], "la cocina la tiene"

    r = editar(client, p["id"], [
        {"variante_id": variante.id, "cantidad": 3},   # +1 empanada
        {"variante_id": pastelito.id, "cantidad": 5},  # +2 pastelitos
    ])
    assert r.status_code == 200, r.text
    q = r.json()
    # La empanada hecha se queda hecha; la nueva va aparte, por hacer.
    assert hecho_y_pendiente(q, variante.id) == (2, 1)
    # Los pastelitos no estaban hechos: se suman al mismo renglon.
    assert hecho_y_pendiente(q, pastelito.id) == (0, 5)
    assert len([i for i in q["items"] if i["variante_id"] == pastelito.id]) == 1
    # La cocina sigue teniendola: no vuelve a empezar de cero.
    assert q["cocinando_desde"]
    assert q["id"] in en_cocina(client)


def test_a_medias_lo_ya_hecho_no_se_quita(client, variante, insumo, db):
    """La regla del 21-sep vale aunque la cocina no haya terminado todo: lo que
    ya cocino es comida en la barra. Antes del 8-oct ni se podia editar con la
    cocina trabajando; al abrirlo, quitar lo hecho tiene que seguir prohibido."""
    pastelito = otra_cocinada(db, insumo)
    p = tomar(client, [
        {"variante_id": variante.id, "cantidad": 2},
        {"variante_id": pastelito.id, "cantidad": 1},
    ])
    p = cocinar(client, p, variante.id)

    r = editar(client, p["id"], [
        {"variante_id": variante.id, "cantidad": 1},
        {"variante_id": pastelito.id, "cantidad": 1},
    ])
    assert r.status_code == 409
    assert "ya no se quita" in r.json()["detail"]


def test_a_medias_se_quita_lo_que_la_cocina_no_ha_hecho_y_vuelve_al_deposito(client, variante, insumo, db):
    pastelito = otra_cocinada(db, insumo)
    p = tomar(client, [
        {"variante_id": variante.id, "cantidad": 1},
        {"variante_id": pastelito.id, "cantidad": 4},
    ])
    p = cocinar(client, p, variante.id)
    antes = stock(db, insumo)

    r = editar(client, p["id"], [
        {"variante_id": variante.id, "cantidad": 1},
        {"variante_id": pastelito.id, "cantidad": 1},
    ])
    assert r.status_code == 200, r.text
    assert hecho_y_pendiente(r.json(), pastelito.id) == (0, 1)
    # 3 pastelitos x 0,05 kg utilizables al 80 % = 0,1875 kg vuelven.
    assert stock(db, insumo) == round(antes + 3 * 0.05 / 0.8, 4)
    # Y nada quedo como merma: no se boto comida.
    assert db.query(models.Merma).count() == 0


def test_quitar_todo_lo_pendiente_la_deja_lista(client, variante, insumo, db):
    pastelito = otra_cocinada(db, insumo)
    p = tomar(client, [
        {"variante_id": variante.id, "cantidad": 1},
        {"variante_id": pastelito.id, "cantidad": 2},
    ])
    p = cocinar(client, p, variante.id)

    q = editar(client, p["id"], [{"variante_id": variante.id, "cantidad": 1}]).json()
    assert q["estado"] == "listo"
    assert q["id"] not in en_cocina(client)


# ── Ya terminada ─────────────────────────────────────────────────────────────

def test_terminada_y_editada_vuelve_a_la_cocina_solo_con_lo_nuevo(client, variante, insumo, db):
    pastelito = otra_cocinada(db, insumo)
    p = tomar(client, [{"variante_id": variante.id, "cantidad": 4}])
    p = cocinar(client, p, variante.id)
    assert p["estado"] == "listo"
    assert p["id"] not in en_cocina(client)

    q = editar(client, p["id"], [
        {"variante_id": variante.id, "cantidad": 5},
        {"variante_id": pastelito.id, "cantidad": 2},
    ]).json()
    assert q["estado"] == "pendiente"
    assert q["cocinando_desde"] is None, "vuelve a la cola como nueva"
    assert hecho_y_pendiente(q, variante.id) == (4, 1)
    assert hecho_y_pendiente(q, pastelito.id) == (0, 2)
    # Lo que la pantalla de cocina tiene por hacer: 1 empanada y 2 pastelitos.
    cocina = en_cocina(client)[q["id"]]
    por_hacer = sorted((i["nombre"], i["cantidad"]) for i in cocina["items"] if not i["preparado"])
    assert por_hacer == [("Empanada - Carne", 1), ("Pastelito - Pollo", 2)]


def test_editar_cinco_veces_no_mezcla_lo_hecho_con_lo_nuevo(client, variante, insumo, db):
    p = tomar(client, [{"variante_id": variante.id, "cantidad": 2}])
    p = cocinar(client, p, variante.id)                      # 2 hechas

    q = editar(client, p["id"], [{"variante_id": variante.id, "cantidad": 3}]).json()
    assert hecho_y_pendiente(q, variante.id) == (2, 1)
    q = editar(client, p["id"], [{"variante_id": variante.id, "cantidad": 4}]).json()
    assert hecho_y_pendiente(q, variante.id) == (2, 2)       # se suma a la que espera
    q = cocinar(client, q, variante.id)                      # la cocina hace las 2
    assert hecho_y_pendiente(q, variante.id) == (4, 0)
    q = editar(client, p["id"], [{"variante_id": variante.id, "cantidad": 5}]).json()
    assert hecho_y_pendiente(q, variante.id) == (4, 1)       # solo la nueva
    q = editar(client, p["id"], [{"variante_id": variante.id, "cantidad": 4}]).json()
    assert hecho_y_pendiente(q, variante.id) == (4, 0)       # se quito la que no estaba hecha
    r = editar(client, p["id"], [{"variante_id": variante.id, "cantidad": 3}])
    assert r.status_code == 409                              # lo hecho no se quita
    # El total es el de 4, ni uno mas ni uno menos.
    assert client.get(f"/api/pedidos/{p['id']}").json()["total"] == 20.0


def test_el_inventario_solo_mueve_lo_agregado(client, variante, insumo, db):
    p = tomar(client, [{"variante_id": variante.id, "cantidad": 2}])
    p = cocinar(client, p, variante.id)
    antes = stock(db, insumo)
    editar(client, p["id"], [{"variante_id": variante.id, "cantidad": 3}])
    # Una empanada mas: 0,1 kg utilizable al 80 % = 0,125 kg. No 3.
    assert stock(db, insumo) == round(antes - 0.1 / 0.8, 4)


# ── Cobrada ──────────────────────────────────────────────────────────────────

def test_cobrada_y_entregada_que_se_agranda_vuelve_a_cocina_y_al_mostrador(client, variante, insumo, db):
    p = tomar(client, [{"variante_id": variante.id, "cantidad": 1}])
    p = cocinar(client, p, variante.id)
    assert client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"}).status_code == 200
    assert client.post(f"/api/pedidos/{p['id']}/entregado").status_code == 200

    r = editar(
        client, p["id"], [{"variante_id": variante.id, "cantidad": 2}],
        pagos=[{"metodo": "Efectivo Bs", "monto": 5.0}],
    )
    assert r.status_code == 200, r.text
    q = r.json()
    assert q["estado"] == "pagado"
    assert hecho_y_pendiente(q, variante.id) == (1, 1)
    assert q["id"] in en_cocina(client), "la empanada nueva tiene que llegar a cocina"
    # Cuando la cocina la termine, tiene que volver a "por entregar": el
    # cliente se llevo la primera, la segunda todavia no.
    cocinar(client, q, variante.id)
    por_entregar = {x["id"] for x in client.get("/api/pedidos?por_entregar=true").json()}
    assert q["id"] in por_entregar


def test_entregada_a_la_que_se_le_agrega_algo_de_vitrina_vuelve_al_mostrador(client, variante, db):
    categoria = db.query(models.Categoria).filter_by(nombre="Comida").first()
    producto = models.Producto(categoria_id=categoria.id, nombre="Refresco")
    db.add(producto)
    db.flush()
    refresco = models.Variante(producto_id=producto.id, nombre="Lata", precio=1.0)
    db.add(refresco)
    db.commit()

    p = tomar(client, [{"variante_id": variante.id, "cantidad": 1}])
    p = cocinar(client, p, variante.id)
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})
    client.post(f"/api/pedidos/{p['id']}/entregado")

    r = editar(
        client, p["id"],
        [{"variante_id": variante.id, "cantidad": 1}, {"variante_id": refresco.id, "cantidad": 1, "a_cocina": False}],
        pagos=[{"metodo": "Efectivo Bs", "monto": 1.0}],
    )
    assert r.status_code == 200, r.text
    assert r.json()["id"] not in en_cocina(client)
    por_entregar = {x["id"] for x in client.get("/api/pedidos?por_entregar=true").json()}
    assert p["id"] in por_entregar
