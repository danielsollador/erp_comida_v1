"""La comanda que se manda dos veces.

La wifi del local se cae justo despues de que la tablet mando el pedido. La
cajera no tiene forma de saber si llego: le da otra vez. Sin proteccion salen
dos comandas iguales a cocina, se descuenta el inventario dos veces y alguien
se come una empanada que nadie pago.

El cobro ya estaba protegido por el estado del pedido (cobrar dos veces da
409). Lo que faltaba era la creacion.
"""

from app import models


def comanda(client, variante, clave=None, cantidad=1):
    cuerpo = {"items": [{"variante_id": variante.id, "cantidad": cantidad}], "nota": ""}
    if clave:
        cuerpo["clave_cliente"] = clave
    return client.post("/api/pedidos", json=cuerpo)


def test_la_misma_clave_no_crea_dos_pedidos(client, db, variante):
    primero = comanda(client, variante, clave="tablet-caja-0001").json()
    segundo = comanda(client, variante, clave="tablet-caja-0001").json()

    assert primero["id"] == segundo["id"], "el reintento tiene que devolver el mismo pedido"
    assert primero["numero"] == segundo["numero"]
    assert db.query(models.Pedido).count() == 1


def test_el_reintento_no_descuenta_el_inventario_otra_vez(client, db, variante, insumo):
    antes = insumo.stock_actual
    comanda(client, variante, clave="tablet-caja-0002")
    db.refresh(insumo)
    despues_del_primero = insumo.stock_actual
    assert despues_del_primero < antes, "el primer pedido si descuenta"

    comanda(client, variante, clave="tablet-caja-0002")
    db.refresh(insumo)
    assert insumo.stock_actual == despues_del_primero, "el reintento no puede volver a descontar"


def test_sin_clave_todo_sigue_como_antes(client, db, variante):
    """Dos pedidos iguales seguidos son normales: dos clientes pidiendo lo
    mismo. Sin clave no hay forma de distinguirlos de un reintento, y el
    sistema tiene que seguir creando los dos."""
    a = comanda(client, variante).json()
    b = comanda(client, variante).json()
    assert a["id"] != b["id"]
    assert db.query(models.Pedido).count() == 2


def test_claves_distintas_crean_pedidos_distintos(client, db, variante):
    a = comanda(client, variante, clave="tablet-caja-0003").json()
    b = comanda(client, variante, clave="tablet-caja-0004").json()
    assert a["id"] != b["id"]
    assert db.query(models.Pedido).count() == 2


def test_dos_tablets_no_chocan_por_casualidad(client, db, variante):
    """Cada tablet genera su clave; el indice es UNIQUE en toda la tabla, asi
    que si dos generaran la misma el segundo pedido se perderia en silencio.
    Se documenta el comportamiento para que quede a la vista: la clave la
    genera crypto.randomUUID(), no un contador por tablet."""
    a = comanda(client, variante, clave="repetida").json()
    b = comanda(client, variante, clave="repetida").json()
    assert a["id"] == b["id"]
