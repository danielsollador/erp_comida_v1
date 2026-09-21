"""Punto de venta y Zelle como metodos de pago.

Zelle es el caso que importa: entra en dolares pero NO es efectivo -no hay
billete que contar en el arqueo-, asi que necesita su propia cuenta (1021) y
no puede mezclarse con 1011 (la gaveta de dolares fisicos que si se cuenta al
cerrar caja). Mezclarlos haria que el arqueo de caja mostrara un sobrante que
nunca estuvo en la gaveta.

"Punto de venta" es solo un nombre mas claro para lo mismo que "Tarjeta": van
a la misma cuenta (1020), a proposito.
"""

from conftest import caja_esperado, caja_ventas
from conftest import caja_esperado, caja_ventas
from app import models


def saldo(db, codigo):
    cuenta = db.query(models.CuentaContable).filter_by(codigo=codigo).first()
    movs = db.query(models.MovimientoContable).filter_by(cuenta_id=cuenta.id).all()
    total = sum(m.debe - m.haber for m in movs)
    return round(total if cuenta.naturaleza == "deudora" else -total, 2)


def comanda(client, variante, cantidad=1):
    return client.post("/api/pedidos", json={
        "items": [{"variante_id": variante.id, "cantidad": cantidad}], "nota": "",
    }).json()


def test_zelle_tiene_su_propia_cuenta(client, db):
    cuenta = db.query(models.CuentaContable).filter_by(codigo="1021").first()
    assert cuenta is not None
    assert "USD" in cuenta.nombre or "Zelle" in cuenta.nombre


def test_una_venta_por_zelle_no_toca_la_gaveta_de_dolares(client, db, variante):
    p = comanda(client, variante, cantidad=2)  # $10 (a $5 la unidad)
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Zelle", "referencia": "Z-1"})

    assert saldo(db, "1021") == 10.0, "el zelle entro a su cuenta"
    assert saldo(db, "1011") == 0.0, "la gaveta fisica de dolares no se movio"


def test_punto_de_venta_va_a_la_misma_cuenta_que_tarjeta(client, db, variante):
    p1 = comanda(client, variante, cantidad=1)  # $5
    client.post(f"/api/pedidos/{p1['id']}/cobrar", json={"metodo_pago": "Tarjeta", "referencia": "T-1"})
    p2 = comanda(client, variante, cantidad=1)  # $5
    client.post(f"/api/pedidos/{p2['id']}/cobrar", json={"metodo_pago": "Punto de venta", "referencia": "P-1"})

    assert saldo(db, "1020") == 10.0, "los dos metodos suman a la misma cuenta de banco"


def test_resumen_de_caja_no_arquea_zelle_como_efectivo(client, variante):
    """CUENTAS_DE_EFECTIVO solo incluye 1010 y 1011: Zelle no puede aparecer
    como parte de lo que hay que contar fisicamente al cerrar."""
    p = comanda(client, variante, cantidad=2)
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Zelle", "referencia": "Z-1"})

    resumen = client.get("/api/caja/resumen").json()
    assert caja_esperado(client) == 0.0
    assert resumen.get("divisas_esperado", 0.0) == 0.0
