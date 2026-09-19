"""Cocina y punto de venta trabajan sobre la misma comanda, y ahora se ven.

Hasta aca eran dos pantallas ciegas la una a la otra: la cajera le agregaba un
renglon a una comanda que el cocinero ya tenia en el sarten, o el cocinero la
marcaba lista mientras le estaban cambiando los renglones. Ganaba el ultimo en
guardar y nadie se enteraba de nada.

Son dos candados que se excluyen, uno por cada lado del mostrador, mas la
regla de plata: editar una venta YA COBRADA solo se puede si alguien con
cuenta pone su clave y dice por donde entro (o salio) la diferencia.
"""
import datetime

from app import models
from app.routers.pedidos import MINUTOS_EDITANDO

from conftest import CLAVE_TEST, USUARIO_TEST, libros, libros_cuadrados  # noqa: F401


def comanda(client, variante, cantidad=1):
    r = client.post("/api/pedidos", json={
        "items": [{"variante_id": variante.id, "cantidad": cantidad}], "nota": "",
    })
    assert r.status_code == 200, r.text
    return r.json()


def editar(client, pedido_id, items, **extra):
    return client.put(f"/api/pedidos/{pedido_id}", json={"items": items, **extra})


def otra_variante(db, precio=3.0, insumo=None, nombre="Refresco"):
    """Algo mas del menu.

    Sin `insumo` no lleva receta -- un refresco, que no se cocina y por eso
    nace ya preparado. Con `insumo` si se cocina, que es lo que hace falta
    para probar una comanda con una parte hecha y otra no.
    """
    categoria = db.query(models.Categoria).first()
    producto = models.Producto(categoria_id=categoria.id, nombre=nombre)
    db.add(producto)
    db.flush()
    v = models.Variante(producto_id=producto.id, nombre="Regular", precio=precio)
    db.add(v)
    db.flush()
    if insumo is not None:
        db.add(models.RecetaItem(variante_id=v.id, ingrediente_id=insumo.id,
                                 cantidad_por_unidad=0.1))
    db.commit()
    db.refresh(v)
    return v


# ── Los dos candados ────────────────────────────────────────────────────────

def test_cuando_la_cocina_agarra_la_comanda_la_caja_ya_no_la_edita(client, variante):
    p = comanda(client, variante)
    assert client.post(f"/api/pedidos/{p['id']}/cocinando").status_code == 200

    r = client.post(f"/api/pedidos/{p['id']}/edicion")
    assert r.status_code == 409
    assert "preparando" in r.json()["detail"]

    # Y tampoco se puede guardar saltandose el paso de abrir.
    assert editar(client, p["id"], [{"variante_id": variante.id, "cantidad": 3}]).status_code == 409


def test_marcar_un_renglon_preparado_ya_es_agarrar_la_comanda(client, variante, insumo, db):
    """El boton que la cocina de verdad aprieta es este, no el de "empezar".

    Si el candado dependiera solo del boton aparte, en la practica no se
    pondria nunca: el cocinero marca renglones, no estados.
    """
    otra = otra_variante(db, precio=4.0, insumo=insumo, nombre="Pastelito")
    r = client.post("/api/pedidos", json={"items": [
        {"variante_id": variante.id, "cantidad": 1},
        {"variante_id": otra.id, "cantidad": 1},
    ], "nota": ""})
    p = r.json()
    client.post(f"/api/pedidos/items/{p['items'][0]['id']}/preparado")

    traido = client.get("/api/pedidos").json()[0]
    assert traido["cocinando_desde"], "marcar un renglon tiene que dejar constancia"
    # Falta el otro renglon: la comanda sigue en el sarten.
    assert client.post(f"/api/pedidos/{p['id']}/edicion").status_code == 409


def test_soltar_la_comanda_devuelve_la_edicion(client, variante):
    """Un toque por error no puede dejar la comanda trancada para siempre."""
    p = comanda(client, variante)
    client.post(f"/api/pedidos/{p['id']}/cocinando")
    client.post(f"/api/pedidos/{p['id']}/cocinando")
    assert client.post(f"/api/pedidos/{p['id']}/edicion").status_code == 200


def test_mientras_la_caja_edita_la_cocina_no_toca_la_comanda(client, variante):
    p = comanda(client, variante)
    assert client.post(f"/api/pedidos/{p['id']}/edicion").status_code == 200

    r = client.post(f"/api/pedidos/items/{p['items'][0]['id']}/preparado")
    assert r.status_code == 409
    assert "editando" in r.json()["detail"]
    assert client.post(f"/api/pedidos/{p['id']}/marcar-listo").status_code == 409
    assert client.post(f"/api/pedidos/{p['id']}/cocinando").status_code == 409

    client.delete(f"/api/pedidos/{p['id']}/edicion")
    assert client.post(f"/api/pedidos/items/{p['items'][0]['id']}/preparado").status_code == 200


def test_el_candado_de_edicion_vence_solo(client, variante, db):
    """Si la cajera abre la edicion y se va, la cocina no puede quedar esperando
    para siempre: la comida se enfria antes que cualquier candado."""
    p = comanda(client, variante)
    client.post(f"/api/pedidos/{p['id']}/edicion")

    fila = db.query(models.Pedido).filter(models.Pedido.id == p["id"]).first()
    fila.editando_desde = fila.editando_desde - datetime.timedelta(minutes=MINUTOS_EDITANDO + 1)
    db.commit()

    assert client.post(f"/api/pedidos/items/{p['items'][0]['id']}/preparado").status_code == 200


def test_guardar_libera_el_candado(client, variante):
    p = comanda(client, variante)
    client.post(f"/api/pedidos/{p['id']}/edicion")
    editar(client, p["id"], [{"variante_id": variante.id, "cantidad": 2}])
    assert client.post(f"/api/pedidos/items/{p['items'][0]['id']}/preparado").status_code == 200


# ── Editar sin plata de por medio ───────────────────────────────────────────

def test_editar_un_pedido_sin_cobrar_no_pide_nada(client, variante):
    """Todavia no entro plata: cambiar los renglones es tomar bien el pedido."""
    p = comanda(client, variante)
    r = editar(client, p["id"], [{"variante_id": variante.id, "cantidad": 3}])
    assert r.status_code == 200, r.text
    assert r.json()["total"] == 15.0
    assert len(r.json()["items"]) == 1 and r.json()["items"][0]["cantidad"] == 3


def test_editar_mueve_el_inventario_por_la_diferencia(client, variante, insumo, db):
    """Lo que se agrega sale del stock y lo que se quita vuelve.

    Y se compara contra lo que de VERDAD salio al tomar la comanda, no contra
    lo que diria la receta de hoy: si la receta cambio mientras tanto,
    recalcularla haria aparecer o desaparecer inventario de la nada.
    """
    p = comanda(client, variante, cantidad=2)
    db.refresh(insumo)
    tras_la_comanda = insumo.stock_actual  # 10 - 2 * 0.125

    editar(client, p["id"], [{"variante_id": variante.id, "cantidad": 5}])
    db.refresh(insumo)
    assert round(insumo.stock_actual, 4) == round(tras_la_comanda - 3 * 0.125, 4)

    editar(client, p["id"], [{"variante_id": variante.id, "cantidad": 1}])
    db.refresh(insumo)
    assert round(insumo.stock_actual, 4) == round(10 - 1 * 0.125, 4)

    # Y lo anotado como consumido queda igual a lo que el pedido dice AHORA:
    # es lo que van a leer anular y devolver si despues pasa cualquiera.
    consumos = db.query(models.PedidoConsumo).filter_by(pedido_id=p["id"]).all()
    assert round(sum(c.cantidad for c in consumos), 4) == 0.125


def test_no_se_puede_editar_por_encima_del_inventario(client, variante):
    p = comanda(client, variante)
    r = editar(client, p["id"], [{"variante_id": variante.id, "cantidad": 500}])
    assert r.status_code == 409
    assert "No alcanza el inventario" in r.json()["detail"]


def test_un_pedido_no_puede_quedar_vacio(client, variante):
    """Vaciarlo es anularlo, y anular tiene sus propias consecuencias
    (devolver el inventario o reconocer la merma). Que se use la puerta."""
    p = comanda(client, variante)
    r = editar(client, p["id"], [])
    assert r.status_code == 400
    assert "anúlalo" in r.json()["detail"]


def test_subir_la_cantidad_devuelve_el_renglon_a_la_cola_de_cocina(client, variante, db):
    """Dos empanadas cuando ya estaba marcada una: hay comida nueva que hacer."""
    p = comanda(client, variante)
    fila = db.query(models.PedidoItem).filter_by(pedido_id=p["id"]).first()
    fila.preparado = True
    db.commit()

    r = editar(client, p["id"], [{"variante_id": variante.id, "cantidad": 2}])
    assert r.json()["items"][0]["preparado"] is False


def test_el_precio_de_lo_que_ya_estaba_no_se_recalcula(client, variante, db):
    """Al cliente ya se le dijo cuanto costaba lo suyo. Que el menu suba
    mientras espera no puede cambiarle el precio por la espalda."""
    p = comanda(client, variante, cantidad=2)
    variante.precio = 9.0
    db.commit()

    otra = otra_variante(db, precio=3.0)
    r = editar(client, p["id"], [
        {"variante_id": variante.id, "cantidad": 2},
        {"variante_id": otra.id, "cantidad": 1},
    ])
    assert r.status_code == 200, r.text
    assert r.json()["total"] == 13.0, "2 x 5 (el precio de antes) + 1 x 3 (el de hoy)"


# ── Editar una venta ya cobrada ─────────────────────────────────────────────

def cobrada(client, variante, cantidad=1):
    p = comanda(client, variante, cantidad)
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})
    assert r.status_code == 200, r.text
    return r.json()


def test_si_la_edicion_no_mueve_plata_no_pide_clave(client, variante, db):
    """Cambiar una empanada por otra del mismo precio no le mueve un centavo a
    nadie: pedir clave ahi es entrenar a la gente para que la clave no
    signifique nada."""
    otra = otra_variante(db, precio=5.0)
    p = cobrada(client, variante)
    r = editar(client, p["id"], [{"variante_id": otra.id, "cantidad": 1}])
    assert r.status_code == 200, r.text
    assert r.json()["editado"] is True


def test_una_venta_cobrada_que_cambia_de_monto_exige_clave(client, variante, db):
    otra = otra_variante(db, precio=3.0)
    p = cobrada(client, variante)

    r = editar(client, p["id"], [
        {"variante_id": variante.id, "cantidad": 1},
        {"variante_id": otra.id, "cantidad": 1},
    ])
    assert r.status_code == 403
    assert "clave" in r.json()["detail"]


def test_con_la_clave_mala_no_pasa(client, variante, db):
    otra = otra_variante(db, precio=3.0)
    p = cobrada(client, variante)
    r = editar(
        client, p["id"],
        [{"variante_id": variante.id, "cantidad": 1}, {"variante_id": otra.id, "cantidad": 1}],
        autorizacion={"usuario": USUARIO_TEST, "clave": "la-que-no-es"},
        pagos=[{"metodo": "Efectivo Bs", "monto": 3.0}],
    )
    assert r.status_code == 403
    assert r.json()["detail"] == "Usuario o clave incorrectos"


def test_la_diferencia_tiene_que_decir_por_donde_entro(client, variante, db):
    """Que la venta suba $3 sin decir como se cobraron deja la gaveta diciendo
    una cosa y los libros otra."""
    otra = otra_variante(db, precio=3.0)
    p = cobrada(client, variante)
    r = editar(
        client, p["id"],
        [{"variante_id": variante.id, "cantidad": 1}, {"variante_id": otra.id, "cantidad": 1}],
        autorizacion={"usuario": USUARIO_TEST, "clave": CLAVE_TEST},
    )
    assert r.status_code == 400
    assert "cómo se cobró" in r.json()["detail"]


def test_los_pagos_tienen_que_sumar_la_diferencia(client, variante, db):
    otra = otra_variante(db, precio=3.0)
    p = cobrada(client, variante)
    r = editar(
        client, p["id"],
        [{"variante_id": variante.id, "cantidad": 1}, {"variante_id": otra.id, "cantidad": 1}],
        autorizacion={"usuario": USUARIO_TEST, "clave": CLAVE_TEST},
        pagos=[{"metodo": "Efectivo Bs", "monto": 1.0}],
    )
    assert r.status_code == 400
    assert "suman $1.00" in r.json()["detail"]


def test_la_diferencia_no_se_fia(client, variante, db):
    otra = otra_variante(db, precio=3.0)
    p = cobrada(client, variante)
    r = editar(
        client, p["id"],
        [{"variante_id": variante.id, "cantidad": 1}, {"variante_id": otra.id, "cantidad": 1}],
        autorizacion={"usuario": USUARIO_TEST, "clave": CLAVE_TEST},
        pagos=[{"metodo": "Fiado", "monto": 3.0}],
    )
    assert r.status_code == 400
    assert "no se puede fiar" in r.json()["detail"]


def test_cobrar_de_mas_deja_los_libros_cuadrados(client, variante, db, libros):
    otra = otra_variante(db, precio=3.0)
    p = cobrada(client, variante)
    r = editar(
        client, p["id"],
        [{"variante_id": variante.id, "cantidad": 1}, {"variante_id": otra.id, "cantidad": 1}],
        autorizacion={"usuario": USUARIO_TEST, "clave": CLAVE_TEST},
        pagos=[{"metodo": "Efectivo Bs", "monto": 3.0}],
        motivo="El cliente pidio un refresco despues",
    )
    assert r.status_code == 200, r.text
    assert r.json()["total"] == 8.0
    # La plata que entro de mas queda anotada como un pago mas del pedido: es
    # lo que hace que el cierre de caja espere los $3 en la gaveta.
    assert round(sum(x["monto"] for x in r.json()["pagos"]), 2) == 8.0
    libros_cuadrados(client, db)


def test_devolverle_plata_al_cliente_sale_de_la_gaveta(client, variante, db, libros):
    """Le cobraron dos empanadas y solo pidio una: la diferencia se le devuelve
    y la gaveta tiene que esperar $5 menos, no seguir contandolos."""
    p = cobrada(client, variante, cantidad=2)
    r = editar(
        client, p["id"], [{"variante_id": variante.id, "cantidad": 1}],
        autorizacion={"usuario": USUARIO_TEST, "clave": CLAVE_TEST},
        pagos=[{"metodo": "Efectivo Bs", "monto": 5.0}],
        motivo="Se cobro de mas",
    )
    assert r.status_code == 200, r.text
    assert r.json()["total"] == 5.0
    assert round(sum(x["monto"] for x in r.json()["pagos"]), 2) == 5.0
    libros_cuadrados(client, db)


def test_una_venta_facturada_no_se_edita_de_monto(client, variante, db):
    """Cambiarle el total a una factura ya emitida se corrige con una nota de
    credito, no retocando el Libro de Ventas por detras."""
    otra = otra_variante(db, precio=3.0)
    p = comanda(client, variante)
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={
        "metodo_pago": "Efectivo Bs", "facturado": True, "numero_factura": "00012",
    })
    r = editar(
        client, p["id"],
        [{"variante_id": variante.id, "cantidad": 1}, {"variante_id": otra.id, "cantidad": 1}],
        autorizacion={"usuario": USUARIO_TEST, "clave": CLAVE_TEST},
        pagos=[{"metodo": "Efectivo Bs", "monto": 3.0}],
    )
    assert r.status_code == 409
    assert "nota de crédito" in r.json()["detail"]


def test_una_venta_de_otro_dia_ya_entro_al_cierre(client, variante, db):
    p = cobrada(client, variante)
    fila = db.query(models.Pedido).filter(models.Pedido.id == p["id"]).first()
    fila.cerrado_en = fila.cerrado_en - datetime.timedelta(days=1)
    db.commit()

    r = editar(client, p["id"], [{"variante_id": variante.id, "cantidad": 2}])
    assert r.status_code == 409
    assert "cierre de caja" in r.json()["detail"]


# ── El rastro que queda ─────────────────────────────────────────────────────

def test_queda_escrito_que_cambio_y_quien_lo_autorizo(client, variante, db):
    """La etiqueta "editado" sola no dice nada. Lo que el dueño necesita saber
    es que se cambio, cuanta plata se movio y quien firmo."""
    otra = otra_variante(db, precio=3.0)
    p = cobrada(client, variante)
    r = editar(
        client, p["id"],
        [{"variante_id": variante.id, "cantidad": 1}, {"variante_id": otra.id, "cantidad": 1}],
        autorizacion={"usuario": USUARIO_TEST, "clave": CLAVE_TEST},
        pagos=[{"metodo": "Efectivo Bs", "monto": 3.0}],
        motivo="Pidio un refresco",
    )
    assert r.status_code == 200, r.text
    pedido = r.json()
    assert pedido["editado"] is True and pedido["editado_en"]

    edicion = pedido["ediciones"][-1]
    assert "+1 Refresco" in edicion["detalle"]
    assert edicion["total_antes"] == 5.0 and edicion["total_despues"] == 8.0
    assert edicion["diferencia"] == 3.0
    assert edicion["metodo_pago"] == "Efectivo Bs"
    assert edicion["autorizado_por"] == USUARIO_TEST
    assert edicion["motivo"] == "Pidio un refresco"


def test_lo_que_se_quita_queda_nombrado(client, variante, db):
    otra = otra_variante(db, precio=3.0)
    p = comanda(client, variante)
    editar(client, p["id"], [
        {"variante_id": variante.id, "cantidad": 1}, {"variante_id": otra.id, "cantidad": 2},
    ])
    r = editar(client, p["id"], [{"variante_id": variante.id, "cantidad": 1}])
    assert "quitado Refresco (x2)" in r.json()["ediciones"][-1]["detalle"]


def test_editar_sin_cambiar_nada_no_ensucia_el_historial(client, variante):
    p = comanda(client, variante, cantidad=2)
    r = editar(client, p["id"], [{"variante_id": variante.id, "cantidad": 2}])
    assert r.status_code == 400
    assert "ningún cambio" in r.json()["detail"]


# ── Lo que ya se cocino ─────────────────────────────────────────────────────

def test_la_cocina_suelta_la_comanda_cuando_termina(client, variante):
    """El candado dura lo que dura la cocinada.

    `cocinando_desde` no se limpia solo: sin mirar los renglones, una comanda
    despachada hace horas seguiria bloqueada para siempre y la caja no podria
    corregir nunca una venta ya cobrada.
    """
    p = comanda(client, variante)
    client.post(f"/api/pedidos/{p['id']}/cocinando")
    assert client.post(f"/api/pedidos/{p['id']}/edicion").status_code == 409

    client.post(f"/api/pedidos/{p['id']}/marcar-listo")
    assert client.post(f"/api/pedidos/{p['id']}/edicion").status_code == 200


def test_quitar_comida_ya_hecha_es_merma_y_no_vuelve_al_inventario(client, variante, insumo, db):
    """Lo que salio del sarten no vuelve al deposito porque el cliente cambie
    de idea: se boto, y eso es una perdida que hay que reconocer."""
    p = comanda(client, variante, cantidad=2)
    client.post(f"/api/pedidos/{p['id']}/marcar-listo")
    db.refresh(insumo)
    tras_cocinar = insumo.stock_actual

    r = editar(client, p["id"], [{"variante_id": variante.id, "cantidad": 1}])
    assert r.status_code == 200, r.text

    db.refresh(insumo)
    assert insumo.stock_actual == tras_cocinar, "la empanada hecha no vuelve a ser carne"

    merma = db.query(models.Merma).filter(models.Merma.motivo.contains("editado")).all()
    assert len(merma) == 1 and round(merma[0].cantidad, 4) == 0.125


def test_quitar_comida_sin_hacer_si_devuelve_el_inventario(client, variante, insumo, db):
    p = comanda(client, variante, cantidad=2)
    db.refresh(insumo)
    tras_la_comanda = insumo.stock_actual

    editar(client, p["id"], [{"variante_id": variante.id, "cantidad": 1}])
    db.refresh(insumo)
    assert round(insumo.stock_actual, 4) == round(tras_la_comanda + 0.125, 4)
    assert db.query(models.Merma).count() == 0


def test_quitar_lo_hecho_y_agregar_crudo_no_se_compensa(client, variante, insumo, db):
    """El caso que rompe restar consumos en bruto: quitar una empanada YA HECHA
    y agregar dos crudas da un neto que parece inocente y esconde la que se
    boto. Son dos flujos distintos y cada uno va a un sitio distinto."""
    p = comanda(client, variante, cantidad=2)
    client.post(f"/api/pedidos/{p['id']}/marcar-listo")
    db.refresh(insumo)
    tras_cocinar = insumo.stock_actual

    # De 2 hechas a 3: una mas que sacar del deposito, ninguna que botar.
    editar(client, p["id"], [{"variante_id": variante.id, "cantidad": 3}])
    db.refresh(insumo)
    assert round(insumo.stock_actual, 4) == round(tras_cocinar - 0.125, 4)
    assert db.query(models.Merma).count() == 0


def test_botar_comida_de_una_venta_cobrada_deja_los_libros_cuadrados(
    client, variante, db, libros
):
    """La baja de costo de ventas no puede irse entera al inventario: la comida
    esta en la basura, no en el deposito."""
    p = cobrada(client, variante, cantidad=2)
    client.post(f"/api/pedidos/{p['id']}/marcar-listo")

    r = editar(
        client, p["id"], [{"variante_id": variante.id, "cantidad": 1}],
        autorizacion={"usuario": USUARIO_TEST, "clave": CLAVE_TEST},
        pagos=[{"metodo": "Efectivo Bs", "monto": 5.0}],
        motivo="El cliente solo queria una",
    )
    assert r.status_code == 200, r.text
    libros_cuadrados(client, db)


def test_una_venta_fiada_con_saldo_no_se_edita_de_monto(client, variante, db):
    """Lo fiado no es plata en la gaveta: es una deuda con su saldo y sus
    abonos. Cambiar el monto por un lado y sacar el vuelto de la caja por otro
    dejaria al cliente debiendo lo de antes."""
    otra = otra_variante(db, precio=3.0)
    p = comanda(client, variante)
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={
        "metodo_pago": "Fiado", "cliente": "Sra. Rosa",
        "pagos": [{"metodo": "Fiado", "monto": 5.0}],
    })
    assert r.status_code == 200, r.text

    r = editar(
        client, p["id"],
        [{"variante_id": variante.id, "cantidad": 1}, {"variante_id": otra.id, "cantidad": 1}],
        autorizacion={"usuario": USUARIO_TEST, "clave": CLAVE_TEST},
        pagos=[{"metodo": "Efectivo Bs", "monto": 3.0}],
    )
    assert r.status_code == 409
    assert "fiada" in r.json()["detail"]

    # Cambiar renglones sin mover plata sigue siendo legitimo: no toca la deuda.
    igual = otra_variante(db, precio=5.0, nombre="Arepa")
    assert editar(client, p["id"], [{"variante_id": igual.id, "cantidad": 1}]).status_code == 200
