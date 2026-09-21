"""Tier 1: la plata que se contaba mal todos los dias.

Dolares en efectivo, vuelto, descuentos, propinas y fiado. Todos comparten la
misma raiz: el sistema solo sabia representar "entro plata por una via y toda
esa plata es venta del negocio".
"""

from conftest import caja_cerrar, caja_esperado, caja_ventas

from app import models


def saldo(db, codigo):
    cuenta = db.query(models.CuentaContable).filter_by(codigo=codigo).first()
    movs = db.query(models.MovimientoContable).filter_by(cuenta_id=cuenta.id).all()
    total = sum(m.debe - m.haber for m in movs)
    return round(total if cuenta.naturaleza == "deudora" else -total, 2)


def comanda(client, variante, cantidad=1):
    return client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": cantidad}], "nota": ""},
    ).json()


def gaveta(client, codigo):
    resumen = client.get("/api/caja/resumen").json()
    # El cierre pasó a contarse por forma de pago: la fila de 1010 es la de
    # "Efectivo Bs" y la de 1011 la de "Efectivo $".
    metodo = {"1010": "Efectivo Bs", "1011": "Efectivo $"}[codigo]
    return next(l for l in resumen["desglose"] if l["metodo"] == metodo)


# ------------------------------------------- H110: dolares vs bolivares
def test_el_efectivo_en_divisas_va_a_su_propia_gaveta(client, db, variante):
    """Con un solo "Efectivo" el sistema decia "esperado $10" tanto si en la
    gaveta habia un billete verde como si habia Bs 400: imposible arquear."""
    p = comanda(client, variante, cantidad=2)  # $10
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo $"})

    assert saldo(db, "1011") == 10.0, "entro a la caja en divisas"
    assert saldo(db, "1010") == 0.0, "no toco la caja en bolivares"
    assert gaveta(client, "1011")["esperado"] == 10.0
    assert gaveta(client, "1010")["esperado"] == 0.0


def test_las_dos_gavetas_se_cuentan_por_separado_al_cerrar(client, db, variante):
    p1 = comanda(client, variante, cantidad=2)
    client.post(f"/api/pedidos/{p1['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})
    p2 = comanda(client, variante, cantidad=4)
    client.post(f"/api/pedidos/{p2['id']}/cobrar", json={"metodo_pago": "Efectivo $"})

    cierre = caja_cerrar(client, 10.0, 18.0).json()
    assert cierre["diferencia"] == 0.0, "los bolivares cuadran"
    assert cierre["divisas_esperado"] == 20.0
    assert cierre["divisas_diferencia"] == -2.0, "faltan 2 dolares en la otra gaveta"


def test_el_historico_sigue_entrando_a_bolivares(client, db, variante):
    """"Efectivo" a secas se conserva: renombrarlo dejaria huerfano todo lo ya
    cargado."""
    p = comanda(client, variante, cantidad=2)
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo"})
    assert saldo(db, "1010") == 10.0


# ------------------------------------------- H111: el vuelto
def test_el_vuelto_en_la_misma_moneda_no_infla_la_gaveta(client, db, variante):
    p = comanda(client, variante, cantidad=2)  # $10
    client.post(
        f"/api/pedidos/{p['id']}/cobrar",
        json={
            "metodo_pago": "Efectivo Bs",
            "pagos": [{"metodo": "Efectivo Bs", "monto": 10.0, "recibido": 20.0}],
        },
    )
    assert saldo(db, "1010") == 10.0, "entraron 20 y salieron 10"
    assert gaveta(client, "1010")["esperado"] == 10.0


def test_pagar_en_divisas_con_vuelto_en_bolivares_mueve_las_dos_gavetas(client, db, variante):
    """El caso venezolano de todos los dias, y el que no dejaba ningun rastro:
    entran 20 dolares y salen bolivares."""
    p = comanda(client, variante, cantidad=2)  # $10
    client.post(
        f"/api/pedidos/{p['id']}/cobrar",
        json={
            "metodo_pago": "Efectivo $",
            "pagos": [
                {
                    "metodo": "Efectivo $",
                    "monto": 10.0,
                    "recibido": 20.0,
                    "vuelto_metodo": "Efectivo Bs",
                }
            ],
        },
    )
    assert saldo(db, "1011") == 20.0, "el billete de 20 entero entro a divisas"
    assert saldo(db, "1010") == -10.0, "el vuelto salio de bolivares"
    assert gaveta(client, "1011")["esperado"] == 20.0
    assert gaveta(client, "1010")["esperado"] == -10.0


def test_no_se_puede_recibir_menos_que_el_pago(client, variante):
    p = comanda(client, variante, cantidad=2)
    r = client.post(
        f"/api/pedidos/{p['id']}/cobrar",
        json={
            "metodo_pago": "Efectivo Bs",
            "pagos": [{"metodo": "Efectivo Bs", "monto": 10.0, "recibido": 5.0}],
        },
    )
    assert r.status_code == 400


# ------------------------------------------- H112: descuentos
def test_el_descuento_baja_lo_que_paga_ESE_cliente_y_nadie_mas(client, db, variante):
    """Antes habia que bajarle el precio al menu, que se lo bajaba a todos."""
    p = comanda(client, variante, cantidad=2)  # $10 de lista
    cobrado = client.post(
        f"/api/pedidos/{p['id']}/cobrar",
        json={"metodo_pago": "Efectivo Bs", "descuento": 2.0, "motivo_descuento": "cliente fijo"},
    ).json()

    assert cobrado["total"] == 8.0
    assert cobrado["subtotal"] == 10.0
    assert saldo(db, "1010") == 8.0
    # el precio del menu no se movio: el siguiente cliente paga $5
    assert client.get("/api/menu/categorias").json()[0]["productos"][0]["variantes"][0][
        "precio"
    ] == 5.0
    # y no quedo registrado como cambio de precio
    assert client.get(f"/api/menu/variantes/{variante.id}/precios").json() == []


def test_la_venta_bruta_se_conserva_y_el_descuento_se_ve_aparte(client, db, variante):
    p = comanda(client, variante, cantidad=2)
    client.post(
        f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs", "descuento": 2.0}
    )
    assert saldo(db, "4010") == 10.0, "la venta se reconoce bruta"
    assert saldo(db, "4020") == -2.0, "y el descuento aparte (contra-cuenta)"
    er = client.get("/api/contabilidad/estado-resultados?periodo=mes").json()
    assert er["ingresos"] == 8.0, "el ingreso neto es lo que de verdad se cobro"


def test_el_iva_se_calcula_sobre_lo_cobrado_no_sobre_el_precio_de_lista(client, db, variante):
    """Declarar IVA sobre un precio que no se cobro es pagar de mas."""
    p = comanda(client, variante, cantidad=2)
    client.post(
        f"/api/pedidos/{p['id']}/cobrar",
        json={
            "metodo_pago": "Efectivo Bs",
            "descuento": 2.0,
            "facturado": True,
            "numero_factura": "00-1",
        },
    )
    libro = client.get("/api/impuestos/libro-ventas?periodo=mes").json()
    assert libro["total_general"] == 8.0
    assert round(libro["total_base"] + libro["total_iva"], 2) == 8.0


def test_no_se_puede_descontar_mas_que_el_pedido(client, variante):
    p = comanda(client, variante, cantidad=2)
    r = client.post(
        f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs", "descuento": 50.0}
    )
    assert r.status_code == 400


# ------------------------------------------- H114: propinas
def test_la_propina_entra_a_la_gaveta_pero_no_es_venta(client, db, variante):
    """Si queda en la gaveta sin registrarse, el cierre la reporta como
    sobrante y termina como ingreso del negocio: impuesto sobre plata ajena."""
    p = comanda(client, variante, cantidad=2)  # $10
    cobrado = client.post(
        f"/api/pedidos/{p['id']}/cobrar",
        json={
            "metodo_pago": "Efectivo Bs",
            "propina": 2.0,
            "pagos": [{"metodo": "Efectivo Bs", "monto": 12.0}],
        },
    ).json()

    assert cobrado["total"] == 10.0, "la venta sigue siendo la comida"
    assert cobrado["propina"] == 2.0
    assert saldo(db, "1010") == 12.0, "en la gaveta hay 12"
    assert saldo(db, "4010") == 10.0, "pero solo 10 son venta"
    assert saldo(db, "2040") == 2.0, "los otros 2 se le deben al empleado"

    er = client.get("/api/contabilidad/estado-resultados?periodo=mes").json()
    assert er["ingresos"] == 10.0, "la propina no infla la utilidad"


def test_el_cierre_espera_la_propina_en_la_gaveta(client, variante):
    p = comanda(client, variante, cantidad=2)
    client.post(
        f"/api/pedidos/{p['id']}/cobrar",
        json={
            "metodo_pago": "Efectivo Bs",
            "propina": 2.0,
            "pagos": [{"metodo": "Efectivo Bs", "monto": 12.0}],
        },
    )
    cierre = caja_cerrar(client, 12.0).json()
    assert cierre["diferencia"] == 0.0, "contar 12 cuadra: 10 de venta + 2 de propina"


def test_entregar_la_propina_cancela_la_deuda_con_el_empleado(client, db, variante):
    p = comanda(client, variante, cantidad=2)
    client.post(
        f"/api/pedidos/{p['id']}/cobrar",
        json={
            "metodo_pago": "Efectivo Bs",
            "propina": 2.0,
            "pagos": [{"metodo": "Efectivo Bs", "monto": 12.0}],
        },
    )
    assert client.get("/api/caja/propinas").json()["por_entregar"] == 2.0

    r = client.post(
        "/api/caja/propinas/entregar",
        json={"monto": 2.0, "metodo_pago": "Efectivo Bs", "nota": "turno de hoy"},
    )
    assert r.status_code == 200
    assert saldo(db, "2040") == 0.0
    assert saldo(db, "1010") == 10.0, "salio de la gaveta"
    er = client.get("/api/contabilidad/estado-resultados?periodo=mes").json()
    assert er["gastos"] == 0.0, "entregarla no es un gasto: nunca fue ingreso"


def test_no_se_entrega_mas_propina_de_la_que_hay(client, variante):
    r = client.post("/api/caja/propinas/entregar", json={"monto": 50.0})
    assert r.status_code == 400


# ------------------------------------------- H113: fiado
def test_fiar_no_mete_plata_en_la_caja_pero_registra_la_venta(client, db, variante):
    """Antes obligaba a elegir entre no registrar la venta (y descuadrar el
    inventario) o marcarla cobrada (y descuadrar la caja)."""
    p = comanda(client, variante, cantidad=2)  # $10
    cobrado = client.post(
        f"/api/pedidos/{p['id']}/cobrar",
        json={"metodo_pago": "Fiado", "cliente": "Sra. Carmen"},
    ).json()

    assert cobrado["estado"] == "pagado"
    assert cobrado["cliente"] == "Sra. Carmen"
    assert saldo(db, "1010") == 0.0, "no entro plata a la gaveta"
    assert saldo(db, "1015") == 10.0, "nacio una cuenta por cobrar"
    assert saldo(db, "4010") == 10.0, "pero la venta si se reconocio"
    assert caja_esperado(client) == 0.0


def test_no_se_puede_fiar_sin_nombre(client, variante):
    p = comanda(client, variante, cantidad=2)
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Fiado"})
    assert r.status_code == 400
    assert "nombre" in r.json()["detail"]


def test_el_fiado_aparece_en_la_lista_de_lo_que_deben(client, variante):
    p = comanda(client, variante, cantidad=2)
    client.post(
        f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Fiado", "cliente": "Sra. Carmen"}
    )
    deudas = client.get("/api/caja/fiado").json()
    assert len(deudas) == 1
    assert deudas[0]["cliente"] == "Sra. Carmen"
    assert deudas[0]["monto"] == 10.0


def test_cobrar_el_fiado_convierte_la_deuda_en_plata(client, db, variante):
    p = comanda(client, variante, cantidad=2)
    client.post(
        f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Fiado", "cliente": "Sra. Carmen"}
    )
    r = client.post(f"/api/caja/fiado/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})
    assert r.status_code == 200
    assert saldo(db, "1015") == 0.0
    assert saldo(db, "1010") == 10.0
    assert client.get("/api/caja/fiado").json() == []
    assert client.post(
        f"/api/caja/fiado/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"}
    ).status_code == 409


def test_pago_mixto_con_parte_fiada(client, db, variante):
    """La mitad ahora y la mitad el viernes: pasa de verdad."""
    p = comanda(client, variante, cantidad=2)  # $10
    client.post(
        f"/api/pedidos/{p['id']}/cobrar",
        json={
            "metodo_pago": "Mixto",
            "cliente": "Sra. Carmen",
            "pagos": [
                {"metodo": "Efectivo Bs", "monto": 4.0},
                {"metodo": "Fiado", "monto": 6.0},
            ],
        },
    )
    assert saldo(db, "1010") == 4.0
    assert saldo(db, "1015") == 6.0
    assert client.get("/api/caja/fiado").json()[0]["monto"] == 6.0
