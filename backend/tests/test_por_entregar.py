"""Lo cobrado y ya cocinado se queda un rato en el mostrador.

Leider (21-sep): "cada comanda que ya fue cobrada y ademas ya fue cocinada
tiene que prevalecer por lo menos 60 minutos dentro de las comandas para que
asi el cajero pueda seguirla viendo y ver a quien darle el producto".

El agujero era este: al terminar de cocinar una venta ya cobrada, la comanda
no cumplia ninguna de las dos consultas del mostrador --no le falta cocinar, y
su estado es "pagado" y no "listo"-- asi que desaparecia de la pantalla en el
mismo instante en que la comida quedaba en la barra, que es justo cuando hace
falta saber de quien es.

Tambien se prueba `del_dia`, que es lo que mira el cajero cuando el cliente
pregunta si ya se le cobro.
"""
import datetime

from app import models
from app.routers.pedidos import MINUTOS_PARA_ENTREGAR
from app.timeutils import ahora


def comanda(client, variante, cantidad=1, cliente=""):
    r = client.post("/api/pedidos", json={
        "items": [{"variante_id": variante.id, "cantidad": cantidad}],
        "nota": "",
        "cliente": cliente,
    })
    assert r.status_code == 200, r.text
    return r.json()


def cobrar(client, pedido):
    r = client.post(f"/api/pedidos/{pedido['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})
    assert r.status_code == 200, r.text
    return r.json()


def por_entregar(client):
    return {p["id"] for p in client.get("/api/pedidos?por_entregar=true").json()}


def del_dia(client):
    return client.get("/api/pedidos?del_dia=true").json()


def test_cobrada_y_cocinada_se_queda_a_la_vista(client, variante):
    p = comanda(client, variante, cliente="Sra. Carmen")
    cobrar(client, p)
    # Mientras falte cocinar NO es para entregar: esa ya se ve por el otro lado.
    assert p["id"] not in por_entregar(client)

    client.post(f"/api/pedidos/{p['id']}/marcar-listo")
    assert p["id"] in por_entregar(client), "la comida esta en la barra y nadie sabe de quien es"
    # Y con el nombre, que es lo unico que sirve para entregarla.
    fila = next(x for x in client.get("/api/pedidos?por_entregar=true").json() if x["id"] == p["id"])
    assert fila["cliente"] == "Sra. Carmen"


def test_sin_cobrar_no_es_para_entregar(client, variante):
    """Cocinada pero sin cobrar es lo contrario: hay que cobrarla, y para eso
    ya sale por `estado=listo`. Si tambien saliera aqui, el mostrador la
    pintaria dos veces y con dos colores distintos."""
    p = comanda(client, variante)
    client.post(f"/api/pedidos/{p['id']}/marcar-listo")
    assert p["id"] not in por_entregar(client)


def test_a_la_hora_deja_de_estorbar(client, variante, db):
    """Se queda una hora, no para siempre: con veinte entregas por turno la
    pantalla acabaria siendo el historico del dia."""
    p = comanda(client, variante)
    cobrar(client, p)
    client.post(f"/api/pedidos/{p['id']}/marcar-listo")
    assert p["id"] in por_entregar(client)

    fila = db.query(models.Pedido).filter(models.Pedido.id == p["id"]).first()
    viejo = ahora() - datetime.timedelta(minutes=MINUTOS_PARA_ENTREGAR + 1)
    fila.listo_en = viejo
    fila.cerrado_en = viejo
    db.commit()
    assert p["id"] not in por_entregar(client)


def test_el_reloj_arranca_cuando_sale_la_comida_no_cuando_se_cobra(client, variante, db):
    """Se cobra al llegar y se cocina despues. Si el reloj fuera el del cobro,
    un pedido que tardo cuarenta minutos en salir se veria solo veinte."""
    p = comanda(client, variante)
    cobrar(client, p)
    fila = db.query(models.Pedido).filter(models.Pedido.id == p["id"]).first()
    fila.cerrado_en = ahora() - datetime.timedelta(minutes=MINUTOS_PARA_ENTREGAR + 5)
    db.commit()

    client.post(f"/api/pedidos/{p['id']}/marcar-listo")
    assert p["id"] in por_entregar(client), "acaba de salir de la cocina: tiene que verse"


def test_una_devolucion_no_se_queda_esperando_a_nadie(client, variante, db):
    p = comanda(client, variante)
    cobrar(client, p)
    client.post(f"/api/pedidos/{p['id']}/marcar-listo")
    fila = db.query(models.Pedido).filter(models.Pedido.id == p["id"]).first()
    fila.devuelto = True
    db.commit()
    assert p["id"] not in por_entregar(client)


def test_marcar_los_renglones_uno_a_uno_tambien_deja_la_hora(client, variante):
    """La cocina tiene dos botones --el renglon y la comanda entera-- y los dos
    tienen que dejar escrito cuando quedo hecha."""
    p = comanda(client, variante)
    cobrar(client, p)
    for item in p["items"]:
        client.post(f"/api/pedidos/items/{item['id']}/preparado")
    assert p["id"] in por_entregar(client)


def test_las_ventas_del_dia_traen_el_nombre(client, variante):
    """Lo que el cajero consulta desde el mostrador cuando el cliente pregunta
    si ya se le cobro."""
    uno = comanda(client, variante, cliente="Pedro")
    cobrar(client, uno)
    sin_cobrar = comanda(client, variante, cliente="Ana")

    ventas = del_dia(client)
    ids = {v["id"] for v in ventas}
    assert uno["id"] in ids
    assert sin_cobrar["id"] not in ids, "todavia no se ha cobrado: no es una venta"
    assert next(v for v in ventas if v["id"] == uno["id"])["cliente"] == "Pedro"


def test_entregarla_la_saca_de_la_barra(client, variante):
    """Leider (22-sep): "si esta listo para entregar, una equis por si lo
    quieres borrar". No borra la venta: marca la hora de entrega y la tarjeta
    sale del mostrador sin esperar la hora."""
    p = comanda(client, variante, cliente="Ana")
    cobrar(client, p)
    client.post(f"/api/pedidos/{p['id']}/marcar-listo")
    assert p["id"] in por_entregar(client)

    r = client.post(f"/api/pedidos/{p['id']}/entregado")
    assert r.status_code == 200, r.text
    assert r.json()["entregado_en"] is not None
    assert p["id"] not in por_entregar(client)
    # La venta sigue siendo una venta: cobrada y en las ventas del dia.
    assert r.json()["estado"] == "pagado"
    assert p["id"] in {v["id"] for v in del_dia(client)}


def test_entregar_dos_veces_no_cambia_la_hora(client, variante):
    """Un doble toque no puede mover el dato: la hora de entrega es un hecho."""
    p = comanda(client, variante)
    cobrar(client, p)
    client.post(f"/api/pedidos/{p['id']}/marcar-listo")
    primera = client.post(f"/api/pedidos/{p['id']}/entregado").json()["entregado_en"]
    segunda = client.post(f"/api/pedidos/{p['id']}/entregado").json()["entregado_en"]
    assert primera == segunda
