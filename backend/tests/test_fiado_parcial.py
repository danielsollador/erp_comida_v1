"""Abonos: el fiado que se paga por partes.

Antes el fiado tenia dos estados, se debe todo o no se debe nada, y en la
calle no funciona asi: la senora abona 5 el martes y 3 el viernes. Sin donde
anotarlo, la cajera cobraba el total de golpe o llevaba la cuenta en un
cuaderno que los libros no ven.

Lo que se prueba aca no es que el numero baje, sino que los libros sigan
diciendo la verdad mientras baja: lo abonado esta en la gaveta por donde
entro, lo que falta sigue en cuentas por cobrar, y devolver la comida a mitad
de camino devuelve lo que se pago sin inventar una deuda.
"""

from app import models
from conftest import libros_cuadrados


def saldo(db, codigo):
    cuenta = db.query(models.CuentaContable).filter_by(codigo=codigo).first()
    movs = db.query(models.MovimientoContable).filter_by(cuenta_id=cuenta.id).all()
    total = sum(m.debe - m.haber for m in movs)
    return round(total if cuenta.naturaleza == "deudora" else -total, 2)


def fiar(client, variante, cantidad=2, cliente="Sra. Carmen"):
    """Una venta que queda a credito. Con cantidad=2 son $10."""
    p = client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": cantidad}], "nota": ""},
    ).json()
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Fiado", "cliente": cliente})
    return p


def deuda(client, pedido_id):
    return next((d for d in client.get("/api/caja/fiado").json() if d["pedido_id"] == pedido_id), None)


def test_un_abono_baja_la_deuda_y_la_deja_viva(client, db, variante):
    p = fiar(client, variante)

    r = client.post(f"/api/caja/fiado/{p['id']}/cobrar",
                    json={"metodo_pago": "Efectivo Bs", "monto": 4.0})
    assert r.status_code == 200
    assert r.json()["queda"] == 6.0
    assert r.json()["saldado"] is False

    d = deuda(client, p["id"])
    assert d is not None, "un fiado a medio pagar tiene que seguir en la lista de cobros"
    assert d["monto"] == 6.0, "la lista debe mostrar lo que falta, no lo que se vendio"
    assert d["original"] == 10.0 and d["abonado"] == 4.0

    assert saldo(db, "1010") == 4.0, "lo abonado tiene que estar en la gaveta"
    assert saldo(db, "1015") == 6.0, "lo que falta sigue siendo cuenta por cobrar"


def test_varios_abonos_hasta_saldar(client, db, variante):
    p = fiar(client, variante)
    client.post(f"/api/caja/fiado/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs", "monto": 3.0})
    client.post(f"/api/caja/fiado/{p['id']}/cobrar", json={"metodo_pago": "Pago movil", "monto": 3.0})
    r = client.post(f"/api/caja/fiado/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs", "monto": 4.0})

    assert r.json()["saldado"] is True and r.json()["queda"] == 0.0
    assert deuda(client, p["id"]) is None
    assert saldo(db, "1015") == 0.0
    # Cada abono entro por su via: 3 + 4 en efectivo, 3 al banco.
    assert saldo(db, "1010") == 7.0
    assert saldo(db, "1020") == 3.0
    assert client.post(f"/api/caja/fiado/{p['id']}/cobrar",
                       json={"metodo_pago": "Efectivo Bs"}).status_code == 409


def test_sin_monto_se_cobra_todo_lo_que_queda(client, db, variante):
    """El caso comun -viene y paga todo- no tiene que cambiar."""
    p = fiar(client, variante)
    client.post(f"/api/caja/fiado/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs", "monto": 2.5})
    r = client.post(f"/api/caja/fiado/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})
    assert r.json()["cobrado"] == 7.5 and r.json()["saldado"] is True
    assert saldo(db, "1015") == 0.0


def test_no_se_puede_abonar_mas_de_lo_que_se_debe(client, db, variante):
    p = fiar(client, variante)
    client.post(f"/api/caja/fiado/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs", "monto": 6.0})

    r = client.post(f"/api/caja/fiado/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs", "monto": 9.0})
    assert r.status_code == 400
    assert "solo debe 4.00" in r.json()["detail"]
    assert saldo(db, "1015") == 4.0, "un cobro rechazado no puede haber tocado los libros"


def test_un_abono_de_cero_o_negativo_no_pasa(client, variante):
    p = fiar(client, variante)
    for malo in (0, -3):
        r = client.post(f"/api/caja/fiado/{p['id']}/cobrar",
                        json={"metodo_pago": "Efectivo Bs", "monto": malo})
        assert r.status_code == 400


def test_el_ultimo_centavo_no_deja_la_deuda_viva(client, db, variante):
    """Un redondeo no puede dejar a alguien debiendo para siempre."""
    p = fiar(client, variante)
    client.post(f"/api/caja/fiado/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs", "monto": 9.999})
    assert deuda(client, p["id"]) is None
    assert saldo(db, "1015") == 0.0


def test_el_asiento_del_abono_dice_que_es_abono_y_cuanto_queda(client, variante):
    """Quien lea el mayor en seis meses tiene que entender por que 1015 bajo 4
    y no 10, sin ir a buscar el pedido."""
    p = fiar(client, variante)
    client.post(f"/api/caja/fiado/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs", "monto": 4.0})
    asientos = client.get("/api/contabilidad/asientos").json()
    abono = [a for a in asientos if "bono" in a["descripcion"]]
    assert abono, [a["descripcion"] for a in asientos]
    assert "queda 6.00" in abono[0]["descripcion"]


def test_devolver_un_fiado_a_medio_pagar(client, db, libros, variante):
    """El caso que no existia: abono 4, despues trae la comida de vuelta.

    Hay que devolverle sus 4 -de la gaveta donde entraron- y borrarle los 6
    que aun debia. Ni se le queda la plata ni queda debiendo algo que ya no
    compro.
    """
    p = fiar(client, variante)
    client.post(f"/api/caja/fiado/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs", "monto": 4.0})
    caja_antes = saldo(db, "1010")

    r = client.post(f"/api/pedidos/{p['id']}/devolver",
                    json={"motivo": "estaba fria", "recuperable": False})
    assert r.status_code == 200, r.text

    assert round(caja_antes - saldo(db, "1010"), 2) == 4.0, "se le devuelve lo que abono"
    assert saldo(db, "1015") == 0.0, "y deja de deber el resto"
    assert deuda(client, p["id"]) is None
    libros_cuadrados(client, db)


def test_un_pedido_devuelto_ya_no_se_cobra(client, libros, variante):
    p = fiar(client, variante)
    client.post(f"/api/pedidos/{p['id']}/devolver", json={"motivo": "estaba fria"})
    r = client.post(f"/api/caja/fiado/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})
    assert r.status_code == 409


def test_el_resumen_de_caja_cuenta_solo_lo_que_falta(client, variante):
    p = fiar(client, variante)
    client.post(f"/api/caja/fiado/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs", "monto": 4.0})
    assert client.get("/api/caja/resumen").json()["fiado_por_cobrar"] == 6.0
