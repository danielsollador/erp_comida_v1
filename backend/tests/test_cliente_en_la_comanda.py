"""El nombre del cliente se anota al TOMAR la comanda, no solo al cobrar.

POR QUE. Con ocho comandas vivas en el mostrador, "#14" no le dice a nadie de
quien es: el cajero termina cantando numeros y la cocina no sabe para quien
cocina. Y para fiar hace falta un nombre, que antes solo se podia escribir en
el cuadro de cobro -- con el cliente enfrente esperando.

Lo delicado no es guardarlo: es que el cobro NO lo borre. El punto de venta
manda el campo `cliente` en todos los cobros, vacio incluido, asi que una
asignacion directa le borraba el nombre a una comanda que si lo tenia. Con
fiado eso era quedarse sin a quien cobrarle.
"""


def comanda(client, variante, cliente="", cantidad=1):
    r = client.post(
        "/api/pedidos",
        json={
            "items": [{"variante_id": variante.id, "cantidad": cantidad}],
            "nota": "",
            "cliente": cliente,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_el_nombre_viaja_con_la_comanda(client, variante):
    p = comanda(client, variante, cliente="Sra. Carmen")
    assert p["cliente"] == "Sra. Carmen"

    # Y se sigue viendo al releer el pedido, que es de donde lo saca la
    # pantalla de cocina y la tarjeta del mostrador.
    activos = client.get("/api/pedidos").json()
    mio = next(x for x in activos if x["id"] == p["id"])
    assert mio["cliente"] == "Sra. Carmen"


def test_sin_nombre_la_comanda_entra_igual(client, variante):
    """Opcional a proposito: en un mostrador con cola, obligar a escribir un
    nombre por cada refresco seria un freno."""
    p = comanda(client, variante)
    assert p["cliente"] == ""


def test_cobrar_sin_nombre_no_borra_el_que_ya_tenia(client, variante):
    p = comanda(client, variante, cliente="Sra. Carmen")

    # El POS manda `cliente` siempre; en un cobro normal va vacio.
    r = client.post(
        f"/api/pedidos/{p['id']}/cobrar",
        json={"metodo_pago": "Efectivo Bs", "cliente": ""},
    )
    assert r.status_code == 200, r.text
    assert r.json()["cliente"] == "Sra. Carmen"


def test_el_nombre_del_cobro_corrige_el_de_la_comanda(client, variante):
    """Ahi es donde se arregla un nombre mal escuchado."""
    p = comanda(client, variante, cliente="Carmen")
    r = client.post(
        f"/api/pedidos/{p['id']}/cobrar",
        json={"metodo_pago": "Efectivo Bs", "cliente": "Carmen Pérez"},
    )
    assert r.json()["cliente"] == "Carmen Pérez"


def test_se_puede_fiar_con_el_nombre_de_la_comanda(client, variante):
    """Si ya se anoto al tomar el pedido, fiar no lo vuelve a pedir."""
    p = comanda(client, variante, cliente="Sra. Carmen")
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Fiado"})
    assert r.status_code == 200, r.text

    deudas = client.get("/api/caja/fiado").json()
    assert [d["cliente"] for d in deudas if d["pedido_id"] == p["id"]] == ["Sra. Carmen"]


def test_fiar_sin_nombre_por_ningun_lado_sigue_prohibido(client, variante):
    """Sin nombre la deuda nace huerfana: no hay a quien cobrarle."""
    p = comanda(client, variante)
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Fiado"})
    assert r.status_code == 400
    assert "nombre" in r.json()["detail"].lower()
