"""El tablero de cocina muestra el trabajo de ahora, no el historico.

Sin limite de tiempo, un pedido que nadie marco como preparado se quedaba en
la pantalla de cocina para siempre. Con un mes de ventas cargadas eran 981
comandas: eso ya no es un tablero, es un archivo, y el cocinero deja de
mirarlo.

El otro lado del mismo problema: la portada contaba `estado='pendiente'` (2) y
la pantalla de cocina contaba otra cosa (981). Un numero en la portada que no
coincide con la pantalla a la que lleva es peor que no tener numero.
"""
import datetime

from app.routers.pedidos import HORAS_EN_COCINA


def comanda(client, variante, cantidad=1):
    return client.post("/api/pedidos", json={
        "items": [{"variante_id": variante.id, "cantidad": cantidad}], "nota": "",
    }).json()


def en_cocina(client):
    return {p["id"] for p in client.get("/api/pedidos?en_cocina=true").json()}


def _envejecer(db, pedido_id, horas):
    from app import models
    p = db.query(models.Pedido).filter(models.Pedido.id == pedido_id).first()
    p.creado_en = p.creado_en - datetime.timedelta(hours=horas)
    db.commit()


def test_una_comanda_vieja_sin_preparar_sale_del_tablero(client, variante, db):
    p = comanda(client, variante)
    assert p["id"] in en_cocina(client), "recien hecha tiene que estar"

    _envejecer(db, p["id"], HORAS_EN_COCINA + 1)
    assert p["id"] not in en_cocina(client), (
        "una comanda de ayer que nadie marco no es trabajo pendiente, es olvido")


def test_la_comanda_de_anoche_sigue_en_el_tablero_pasada_la_medianoche(client, variante, db):
    """El caso que hace que el corte NO pueda ser "hoy": un pedido de las 23:50
    todavia se esta cocinando a las 00:10 y no puede desaparecer de la pantalla."""
    p = comanda(client, variante)
    _envejecer(db, p["id"], 2)
    assert p["id"] in en_cocina(client)


def test_marcar_preparado_saca_el_pedido_aunque_sea_reciente(client, variante, db):
    """Lo que saca una comanda del tablero es prepararla, no que se venza."""
    p = comanda(client, variante)
    for item in p["items"]:
        client.post(f"/api/pedidos/items/{item['id']}/preparado")
    assert p["id"] not in en_cocina(client)


def test_un_pedido_anulado_nunca_esta_en_cocina(client, variante):
    p = comanda(client, variante)
    client.post(f"/api/pedidos/{p['id']}/anular", json={"comida_preparada": False})
    assert p["id"] not in en_cocina(client)


def test_el_kpi_de_la_portada_cuenta_lo_mismo_que_la_pantalla(client, variante):
    """La portada usaba `estado='pendiente'`; cobrar deja el pedido en 'pagado'
    aunque la comida no se haya tocado, asi que los dos numeros se separaban."""
    p = comanda(client, variante)
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})

    pendientes = client.get("/api/pedidos?estado=pendiente").json()
    tablero = client.get("/api/pedidos?en_cocina=true").json()

    assert p["id"] not in {x["id"] for x in pendientes}, "cobrarlo lo saca de 'pendiente'"
    assert p["id"] in {x["id"] for x in tablero}, "pero la comida sigue sin hacerse"
    assert len(tablero) != len(pendientes), (
        "justo por esto la portada tiene que pedir el mismo listado que la pantalla")


def test_una_venta_devuelta_sale_del_tablero(client, variante):
    """El cliente trajo la comida de vuelta: no hay nada que cocinar.

    Se quedaba ahi para siempre porque cumplia las dos condiciones sin ser lo
    que la condicion buscaba: sigue en estado "pagado" --la plata entro y
    salio de verdad-- y sus renglones nunca se marcaron preparados.
    """
    p = comanda(client, variante)
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})
    assert p["id"] in en_cocina(client)

    r = client.post(f"/api/pedidos/{p['id']}/devolver", json={"recuperable": True})
    assert r.status_code == 200, r.text
    assert p["id"] not in en_cocina(client)
