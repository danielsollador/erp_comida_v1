import json

from app import models
"""Abrir la caja: contar el fondo antes de vender.

POR QUE IMPORTA. Sin apertura, lo que se espera al cerrar sale del saldo
contable, y ese saldo arrastra cualquier error viejo: una compra pagada en
efectivo antes de que existiera el sistema deja la gaveta en negativo y el
arqueo de esta noche reporta un faltante que nadie se robo. Contar al abrir
convierte el cierre en la resta de un solo dia.

Estas pruebas fijan las cuatro cosas de las que depende eso:

  1. El fondo contado manda sobre lo que digan los libros.
  2. La diferencia se asienta, y la primera vez va al capital del dueno --no a
     perdidas-- porque esa plata ya era suya.
  3. La fila del desglose SUMA A LA VISTA: fondo + entro - salio = esperado.
  4. No se abre dos veces, ni despues de cerrar.
"""

from conftest import caja_cerrar, caja_esperado


def vender(client, variante, metodo="Efectivo Bs", cantidad=1):
    p = client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": cantidad}], "nota": ""},
    ).json()
    referencia = "" if metodo.startswith("Efectivo") else "REF-000"
    r = client.post(
        f"/api/pedidos/{p['id']}/cobrar",
        json={"metodo_pago": metodo, "referencia": referencia},
    )
    assert r.status_code == 200, r.text
    return p


def abrir(client, bolivares=None, divisas=None, **extra):
    fondos = []
    if bolivares is not None:
        fondos.append({"metodo": "Efectivo Bs", "cuenta": "1010", "fondo": bolivares})
    if divisas is not None:
        fondos.append({"metodo": "Efectivo $", "cuenta": "1011", "fondo": divisas})
    return client.post("/api/caja/abrir", json={"fondos": fondos, **extra})


def linea(client, metodo="Efectivo Bs"):
    d = client.get("/api/caja/resumen").json()
    return next(l for l in d["desglose"] if l["metodo"] == metodo)


def test_la_caja_arranca_cerrada(client):
    e = client.get("/api/caja/estado-apertura").json()
    assert e["abierta"] is False
    assert e["puede_abrir"] is True
    # Trae las gavetas a contar, en cero: el formulario NO viene rellenado con
    # lo que dicen los libros. Rellenarlo volveria el conteo un tramite de
    # darle a aceptar, que es justo lo que la apertura intenta evitar.
    assert [f["metodo"] for f in e["fondos"]] == ["Efectivo Bs", "Efectivo $"]
    assert all(f["fondo"] == 0 for f in e["fondos"])


def test_el_fondo_contado_manda_sobre_los_libros(client, variante):
    """La gaveta tiene 50 aunque los libros digan cero: gana lo que hay."""
    r = abrir(client, bolivares=50)
    assert r.status_code == 200, r.text
    assert r.json()["abierta"] is True

    l = linea(client)
    assert l["fondo"] == 50
    assert l["fondo_declarado"] is True
    assert caja_esperado(client) == 50


def test_la_primera_apertura_va_al_capital_no_a_perdidas(client):
    """Esa plata ya era del dueno: meterla como ingreso inflaria la ganancia y
    pagaria impuesto sobre algo que nunca se vendio."""
    abrir(client, bolivares=50)
    asientos = client.get("/api/contabilidad/asientos").json()
    apertura = [a for a in asientos if a["origen"] == "apertura_dia"]
    assert len(apertura) == 1
    cuentas = {m["cuenta_codigo"]: m for m in apertura[0]["movimientos"]}
    assert cuentas["1010"]["debe"] == 50
    assert cuentas["3010"]["haber"] == 50


def test_la_fila_suma_a_la_vista(client, variante):
    """fondo + entro - salio = esperado. Es el contrato del desglose: un total
    que no sale de las columnas de al lado obliga a creer en vez de verificar.
    """
    abrir(client, bolivares=20)
    vender(client, variante, "Efectivo Bs")
    client.post(
        "/api/caja/gastos",
        json={"descripcion": "Bombona", "monto": 3, "categoria": "Otros",
              "metodo_pago": "Efectivo Bs"},
    )

    l = linea(client)
    assert l["fondo"] == 20
    assert round(l["fondo"] + l["ventas"] - l["salidas"] + l["otros"], 2) == l["esperado"]
    assert l["salidas"] == 3


def test_abrir_no_descuadra_las_ventas(client, variante):
    """El fondo NO es una venta. Si se colara en `cobrado`, el sistema diria
    que se vendio de mas y el cuadre contra ventas quedaria roto para siempre.
    """
    abrir(client, bolivares=40)
    vender(client, variante, "Efectivo Bs")
    d = client.get("/api/caja/resumen").json()
    assert d["cuadra_ventas"] is True
    assert d["cobrado"] == d["a_cobrar"]


def test_no_se_abre_dos_veces_el_mismo_dia(client):
    assert abrir(client, bolivares=10).status_code == 200
    r = abrir(client, bolivares=99)
    assert r.status_code == 409
    assert "ya se abrió" in r.json()["detail"]
    # Y el segundo intento no dejo rastro: el fondo sigue siendo el primero.
    assert linea(client)["fondo"] == 10


def test_no_se_abre_una_caja_ya_cerrada(client, variante):
    """El cierre congelo lo esperado y asento la diferencia. Cambiarle el punto
    de partida despues dejaria ese cierre apuntando a un numero que ya no
    existe."""
    vender(client, variante, "Efectivo Bs")
    assert caja_cerrar(client, efectivo=caja_esperado(client)).status_code == 200
    r = abrir(client, bolivares=10)
    assert r.status_code == 409
    assert "ya se cerró" in r.json()["detail"]


def test_abrir_sin_contar_nada_no_abre(client):
    r = client.post("/api/caja/abrir", json={"fondos": []})
    assert r.status_code == 400
    assert "al menos una gaveta" in r.json()["detail"]


def test_el_fondo_no_puede_ser_negativo(client):
    assert abrir(client, bolivares=-5).status_code == 400


def test_cerrar_cuenta_desde_el_fondo_contado(client, variante):
    """Todo junto: se abre con 20, se vende 1, se cuenta lo que hay y cuadra."""
    abrir(client, bolivares=20)
    vender(client, variante, "Efectivo Bs")
    esperado = caja_esperado(client)
    r = caja_cerrar(client, efectivo=esperado)
    assert r.status_code == 200, r.text
    assert r.json()["diferencia"] == 0


def test_el_fondo_en_dolares_se_declara_por_billete(client, db):
    """Leider (21-sep): "si dices que en efectivo tienes 50 dolares, tienes
    que especificar en billetes de que o en monedas". El desglose se guarda
    tal como se conto, y tiene que sumar el fondo: uno que no cuadra parece
    contado y no lo esta."""
    r = client.post("/api/caja/abrir", json={"fondos": [
        {"metodo": "Efectivo $", "cuenta": "1011", "fondo": 50.0,
         "desglose": {"20": 2, "5": 1, "sueltos": 5.0}},
    ]})
    assert r.status_code == 200, r.text
    fila = db.query(models.AperturaCaja).filter_by(metodo="Efectivo $").first()
    assert json.loads(fila.desglose) == {"20": 2, "5": 1, "sueltos": 5.0}


def test_un_desglose_que_no_suma_el_fondo_se_rechaza(client):
    r = client.post("/api/caja/abrir", json={"fondos": [
        {"metodo": "Efectivo $", "cuenta": "1011", "fondo": 50.0, "desglose": {"20": 2}},
    ]})
    assert r.status_code == 400
    assert "suma 40.00" in r.json()["detail"]
