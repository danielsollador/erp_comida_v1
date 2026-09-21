"""Con cuanta plata arranca el negocio en cada gaveta.

POR QUE EXISTE. Los libros empiezan en cero pero el local no: el dia que se
estrena el sistema ya hay billetes en la gaveta. Mientras nadie lo declare, la
primera compra pagada en efectivo saca plata de una cuenta vacia y la deja en
negativo -- que es exactamente lo que le paso a Savora (1010 en -6,66 despues
de pagarle a dos proveedores en efectivo antes de la primera venta).

No es cosmetico: el cierre calcula lo que deberia haber como
`saldo anterior + entradas - salidas`. Con el saldo anterior corrido, el
primer arqueo reporta un sobrante que no existe y lo asienta como ingreso.
"""

from app import contabilidad


def saldo(db, codigo):
    return round(contabilidad.saldo_de_cuenta(db, codigo), 2)


def test_declarar_el_efectivo_inicial_sube_la_gaveta(client, db):
    assert saldo(db, "1010") == 0

    r = client.post("/api/caja/apertura", json={"cuenta": "1010", "monto": 50.0})
    assert r.status_code == 200, r.text
    assert r.json()["saldo"] == 50.0
    assert saldo(db, "1010") == 50.0


def test_va_contra_el_capital_y_no_contra_ingresos(client, db):
    """Esa plata no la genero el negocio vendiendo: ya era del dueño. Meterla
    como ingreso inflaria la ganancia y pagaria impuesto sobre algo que nunca
    se vendio."""
    client.post("/api/caja/apertura", json={"cuenta": "1010", "monto": 50.0})
    assert saldo(db, "3010") == 50.0
    assert saldo(db, "4010") == 0


def test_rescata_una_gaveta_que_quedo_en_negativo(client, db, variante):
    """El caso real: se le paga a un proveedor en efectivo antes de vender."""
    client.post(
        "/api/caja/gastos",
        json={"descripcion": "Bombona", "categoria": "Servicios", "monto": 10.0, "metodo_pago": "Efectivo Bs"},
    )
    assert saldo(db, "1010") == -10.0

    estado = client.get("/api/caja/apertura").json()
    bolivares = next(d for d in estado if d["cuenta"] == "1010")
    assert bolivares["urge"] is True
    assert bolivares["declarada"] is False

    client.post("/api/caja/apertura", json={"cuenta": "1010", "monto": 80.0})
    assert saldo(db, "1010") == 70.0

    estado = client.get("/api/caja/apertura").json()
    bolivares = next(d for d in estado if d["cuenta"] == "1010")
    assert bolivares["declarada"] is True
    assert bolivares["urge"] is False


def test_el_cierre_deja_de_reportar_un_sobrante_que_no_existe(client, db):
    """La consecuencia que de verdad importa."""
    client.post(
        "/api/caja/gastos",
        json={"descripcion": "Bombona", "categoria": "Servicios", "monto": 10.0, "metodo_pago": "Efectivo Bs"},
    )
    # Sin declarar: el sistema cree que deberia haber -10, asi que contar los
    # 70 reales que hay en la gaveta da un "sobrante" de 80.
    def esperado_efectivo():
        d = client.get("/api/caja/resumen").json()
        return next(l for l in d["desglose"] if l["metodo"] == "Efectivo Bs")["esperado"]

    assert esperado_efectivo() == -10.0

    client.post("/api/caja/apertura", json={"cuenta": "1010", "monto": 80.0})

    assert esperado_efectivo() == 70.0

    r = client.post("/api/caja/cerrar", json={"conteos": [{"metodo": "Efectivo Bs", "contado": 70.0}]})
    assert r.status_code == 200, r.text
    assert r.json()["diferencia"] == 0.0


def test_no_se_declara_dos_veces(client, db):
    """Declararlo dos veces duplicaria el capital."""
    client.post("/api/caja/apertura", json={"cuenta": "1010", "monto": 50.0})
    r = client.post("/api/caja/apertura", json={"cuenta": "1010", "monto": 50.0})
    assert r.status_code == 409
    assert saldo(db, "1010") == 50.0


def test_cada_gaveta_se_declara_aparte(client, db):
    client.post("/api/caja/apertura", json={"cuenta": "1010", "monto": 50.0})
    r = client.post("/api/caja/apertura", json={"cuenta": "1011", "monto": 20.0})
    assert r.status_code == 200, r.text
    assert saldo(db, "1010") == 50.0
    assert saldo(db, "1011") == 20.0


def test_una_cuenta_que_no_se_arquea_no_se_declara(client):
    """El fiado (1015) no es una gaveta: ahi no hay billetes que contar."""
    r = client.post("/api/caja/apertura", json={"cuenta": "1015", "monto": 10.0})
    assert r.status_code == 400


def test_un_monto_negativo_no_se_acepta(client):
    r = client.post("/api/caja/apertura", json={"cuenta": "1010", "monto": -5.0})
    assert r.status_code == 400
