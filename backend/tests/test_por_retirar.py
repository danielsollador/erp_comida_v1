""""Ahora lo vengo a buscar" (17-oct).

El dueño: aunque se cobre y se haga, a veces el cliente dice que vuelve luego
y el pedido se pierde. Se perdia por dos lados: a la hora de estar lista la
tarjeta sale sola del mostrador, y una equis tocada en la tarjeta que no era
no tenia vuelta atras.

Lo normal no cambia (lo listo sale solo a la hora). Lo que se agrega:
  - "Lo viene a buscar": esa no vence; sale solo cuando se entrega.
  - "Entregados hoy": lo que ya salio, para rescatar con "No se entrego".
"""
import datetime

from app import models
from app.routers.pedidos import MINUTOS_PARA_ENTREGAR
from app.timeutils import ahora
from tests.test_por_entregar import cobrar, comanda, por_entregar


def lista(client, variante, cliente="Fernando"):
    p = comanda(client, variante, cliente=cliente)
    cobrar(client, p)
    client.post(f"/api/pedidos/{p['id']}/marcar-listo")
    return p


def entregados(client):
    return {p["id"] for p in client.get("/api/pedidos?entregados_hoy=true").json()}


def envejecer(db, pedido_id):
    fila = db.get(models.Pedido, pedido_id)
    # Una hora y un minuto, pero hoy: lo de ayer no es "entregado hoy".
    viejo = max(ahora() - datetime.timedelta(minutes=MINUTOS_PARA_ENTREGAR + 1),
                ahora().replace(hour=0, minute=0, second=1, microsecond=0))
    fila.listo_en = viejo
    fila.cerrado_en = viejo
    db.commit()


def test_lo_que_viene_a_buscar_no_sale_solo(client, variante, db):
    p = lista(client, variante)
    r = client.post(f"/api/pedidos/{p['id']}/por-retirar", json={})
    assert r.status_code == 200, r.text
    assert r.json()["por_retirar_en"] is not None

    envejecer(db, p["id"])
    if ahora() - datetime.timedelta(minutes=MINUTOS_PARA_ENTREGAR + 1) < ahora().replace(hour=0, minute=0):
        return  # recien pasada la medianoche no hay "una hora de hoy" que probar
    assert p["id"] in por_entregar(client), "el cliente dijo que volvia: no puede desaparecer"
    assert p["id"] not in entregados(client)


def test_sin_nombre_no_se_puede_dejar_para_buscar(client, variante):
    p = lista(client, variante, cliente="")
    r = client.post(f"/api/pedidos/{p['id']}/por-retirar", json={})
    assert r.status_code == 400
    assert "nombre" in r.json()["detail"]

    r = client.post(f"/api/pedidos/{p['id']}/por-retirar", json={"cliente": "  Ana  "})
    assert r.status_code == 200, r.text
    assert r.json()["cliente"] == "Ana"


def test_al_entregarlo_sale_y_queda_en_entregados_de_hoy(client, variante):
    p = lista(client, variante)
    client.post(f"/api/pedidos/{p['id']}/por-retirar", json={})
    client.post(f"/api/pedidos/{p['id']}/entregado")
    assert p["id"] not in por_entregar(client)
    assert p["id"] in entregados(client)


def test_lo_que_salio_solo_por_la_hora_se_ve_en_entregados(client, variante, db):
    p = lista(client, variante)
    envejecer(db, p["id"])
    if ahora() - datetime.timedelta(minutes=MINUTOS_PARA_ENTREGAR + 1) < ahora().replace(hour=0, minute=0):
        return
    assert p["id"] not in por_entregar(client)
    assert p["id"] in entregados(client)


def test_no_se_entrego_lo_devuelve_y_ya_no_vence(client, variante, db):
    """La equis en la tarjeta que no era, o la que salio sola sin que el
    cliente viniera: vuelve al mostrador como "por retirar"."""
    p = lista(client, variante)
    client.post(f"/api/pedidos/{p['id']}/entregado")
    assert p["id"] not in por_entregar(client)

    r = client.post(f"/api/pedidos/{p['id']}/no-entregado")
    assert r.status_code == 200, r.text
    assert r.json()["entregado_en"] is None
    assert r.json()["por_retirar_en"] is not None
    envejecer(db, p["id"])
    assert p["id"] in por_entregar(client)
    assert p["id"] not in entregados(client)


def test_quitar_la_marca_vuelve_a_lo_normal(client, variante):
    p = lista(client, variante)
    client.post(f"/api/pedidos/{p['id']}/por-retirar", json={})
    r = client.post(f"/api/pedidos/{p['id']}/por-retirar", json={"quitar": True})
    assert r.status_code == 200, r.text
    assert r.json()["por_retirar_en"] is None


def test_una_venta_sin_cobrar_no_se_devuelve_al_mostrador(client, variante):
    p = comanda(client, variante, cliente="Ana")
    r = client.post(f"/api/pedidos/{p['id']}/no-entregado")
    assert r.status_code == 400


def test_lo_que_falta_cocinar_no_esta_en_entregados(client, variante):
    p = comanda(client, variante, cliente="Ana")
    cobrar(client, p)
    assert p["id"] not in entregados(client)
