"""Por dónde entra la mercancía al depósito, y qué asienta cada puerta.

Leider (24-sep), mirando "+ Compra" y "+ Nueva mercancía": "esa mercancía que
estamos agregando pareciera que no pasa por factura, ni por compras. Entonces
necesitamos definir cómo es la agregación de inventario exacta".

Tenía razón y el hueco era real: dar de alta un insumo con existencia subía el
stock y el "Valor en depósito" SIN asentar nada. Diez kilos a $2 dejaban $20 de
inventario físico contra $0 contable, y el Balance no lo delataba porque nunca
hubo contrapartida que descuadrar.

Son TRES puertas y cada una asienta distinto. Esto las fija:

  factura (Compras)   -> 1040 + IVA 1030 + pago/2010. La única con crédito fiscal.
  compra suelta       -> 1040 contra la gaveta. Sin IVA: no hay factura.
  existencia al alta  -> 1040 contra capital 3010. No es compra: ya estaba.

Y la invariante que las une: el inventario FÍSICO (stock x costo) y el
inventario CONTABLE (cuenta 1040) no se pueden separar.
"""

from app import models


def saldo(db, codigo):
    cuenta = db.query(models.CuentaContable).filter_by(codigo=codigo).first()
    movs = db.query(models.MovimientoContable).filter_by(cuenta_id=cuenta.id).all()
    total = sum(m.debe - m.haber for m in movs)
    return round(total if cuenta.naturaleza == "deudora" else -total, 2)


def inventario_fisico(db):
    """Lo que dice el depósito: existencia por su costo."""
    return round(
        sum((i.stock_actual or 0) * (i.costo_unitario or 0) for i in db.query(models.Ingrediente).all()),
        2,
    )


def alta(client, nombre="Harina", stock=0.0, costo=0.0, unidad="kg"):
    r = client.post(
        "/api/inventario/ingredientes",
        json={"nombre": nombre, "unidad": unidad, "stock_actual": stock, "costo_unitario": costo},
    )
    assert r.status_code == 200, r.text
    return r.json()


# ── Puerta 1: existencia declarada al dar de alta ─────────────────────────


def test_la_existencia_declarada_entra_contra_el_capital(client, db):
    ing = alta(client, stock=10, costo=2.0)
    assert ing["stock_actual"] == 10

    assert inventario_fisico(db) == 20.0
    assert saldo(db, "1040") == 20.0, "el inventario contable tiene que seguir al fisico"
    assert saldo(db, "3010") == 20.0, "la contrapartida es el capital: no salio plata hoy"


def test_no_es_una_compra_no_saca_plata_ni_da_iva(client, db):
    alta(client, stock=10, costo=2.0)
    assert saldo(db, "1010") == 0.0, "no salio nada de la gaveta"
    assert saldo(db, "1030") == 0.0, "sin factura no hay credito fiscal"


def test_dar_de_alta_sin_existencia_no_asienta_nada(client, db):
    alta(client, stock=0, costo=2.0)
    assert db.query(models.AsientoContable).count() == 0


def test_existencia_sin_costo_no_inventa_valor(client, db):
    """Diez kilos a costo cero valen cero: se anotan en el kardex, no en los
    libros. Inventarse un precio seria peor que dejarlo en cero."""
    alta(client, stock=10, costo=0)
    assert saldo(db, "1040") == 0.0
    assert inventario_fisico(db) == 0.0


# ── Puerta 2: compra suelta ───────────────────────────────────────────────


def test_la_compra_suelta_sale_de_la_gaveta_y_no_da_iva(client, db):
    ing = alta(client, stock=0, costo=0)
    r = client.post(
        f"/api/inventario/ingredientes/{ing['id']}/comprar",
        json={"cantidad": 5, "costo_total": 10.0, "metodo_pago": "Efectivo Bs"},
    )
    assert r.status_code == 200, r.text
    assert saldo(db, "1040") == 10.0
    assert saldo(db, "1010") == -10.0, "la plata salio de la gaveta de bolivares"
    assert saldo(db, "1030") == 0.0, "sin factura no hay credito fiscal"


# ── La invariante que las une ─────────────────────────────────────────────


def test_las_dos_puertas_juntas_dejan_los_libros_cuadrados(client, db):
    """El caso exacto que Leider detecto: alta con existencia y despues una
    compra suelta sobre el mismo insumo."""
    ing = alta(client, stock=10, costo=2.0)
    client.post(
        f"/api/inventario/ingredientes/{ing['id']}/comprar",
        json={"cantidad": 5, "costo_total": 10.0, "metodo_pago": "Efectivo Bs"},
    )
    db.expire_all()
    assert inventario_fisico(db) == 30.0
    assert saldo(db, "1040") == 30.0, "antes quedaba en 10: faltaban los 20 del alta"


def test_cada_puerta_deja_su_rastro(client, db):
    """Un asiento por puerta, con su origen: asi el dueño puede auditar de
    donde salio cada kilo del deposito."""
    ing = alta(client, stock=10, costo=2.0)
    client.post(
        f"/api/inventario/ingredientes/{ing['id']}/comprar",
        json={"cantidad": 5, "costo_total": 10.0, "metodo_pago": "Efectivo Bs"},
    )
    origenes = [a.origen for a in db.query(models.AsientoContable).all()]
    # `compra_insumo` es como la contabilidad llama a la compra suelta.
    assert "alta_insumo" in origenes and "compra_insumo" in origenes
