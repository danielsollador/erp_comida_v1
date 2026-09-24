"""El envio cobra lo que se diga en cada pedido, y el pago de una venta ya
cobrada se puede corregir sin reescribir la contabilidad."""
from app import models, seed

from conftest import caja_cerrar, libros_cuadrados, saldo  # noqa: F401


def delivery(db):
    """El envio del menu: la categoria de envios la asegura el arranque."""
    seed.asegurar_categoria_envios(db)
    cat = seed.categoria_envios(db)
    return (
        db.query(models.Variante)
        .join(models.Producto, models.Variante.producto_id == models.Producto.id)
        .filter(models.Producto.categoria_id == cat.id)
        .first()
    )


# ── Delivery ─────────────────────────────────────────────────────────────────

def test_el_envio_cobra_el_monto_que_se_le_dice(client, db, variante):
    envio = delivery(db)
    r = client.post("/api/pedidos", json={"cliente": "Ana", "items": [
        {"variante_id": variante.id, "cantidad": 1},
        {"variante_id": envio.id, "cantidad": 1, "precio_libre": 4.25},
    ]})
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["total"] == 9.25
    renglon = next(i for i in p["items"] if i["variante_id"] == envio.id)
    assert renglon["precio_unitario"] == 4.25
    assert renglon["a_cocina"] is False


def test_el_resto_del_menu_no_acepta_otro_precio(client, variante):
    r = client.post("/api/pedidos", json={"cliente": "Ana", "items": [
        {"variante_id": variante.id, "cantidad": 1, "precio_libre": 0.5},
    ]})
    assert r.json()["total"] == 5.0


def test_el_envio_sin_monto_no_entra(client, db):
    envio = delivery(db)
    r = client.post("/api/pedidos", json={"cliente": "Ana", "items": [
        {"variante_id": envio.id, "cantidad": 1, "precio_libre": 0},
    ]})
    assert r.status_code == 400


def test_dos_envios_de_distinto_monto_se_editan_por_separado(client, db, variante):
    envio = delivery(db)
    p = client.post("/api/pedidos", json={"cliente": "Ana", "items": [
        {"variante_id": variante.id, "cantidad": 1},
        {"variante_id": envio.id, "cantidad": 1, "precio_libre": 2},
    ]}).json()
    r = client.put(f"/api/pedidos/{p['id']}", json={"items": [
        {"variante_id": variante.id, "cantidad": 1},
        {"variante_id": envio.id, "cantidad": 1, "precio_libre": 2},
        {"variante_id": envio.id, "cantidad": 1, "precio_libre": 3.5},
    ]})
    assert r.status_code == 200, r.text
    assert r.json()["total"] == 10.5
    precios = sorted(i["precio_unitario"] for i in r.json()["items"] if i["variante_id"] == envio.id)
    assert precios == [2, 3.5]


# ── Corregir el pago ─────────────────────────────────────────────────────────

def cobrada(client, variante, **cobro):
    p = client.post("/api/pedidos", json={
        "cliente": "Ana", "items": [{"variante_id": variante.id, "cantidad": 2}],
    }).json()
    cuerpo = {"metodo_pago": "Punto de venta", "referencia": "111", **cobro}
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json=cuerpo)
    assert r.status_code == 200, r.text
    return r.json()


def test_corregir_la_referencia(client, variante, db):
    v = cobrada(client, variante)
    pago = v["pagos"][0]
    r = client.put(f"/api/pedidos/{v['id']}/pagos", json={"pagos": [
        {"id": pago["id"], "metodo": "Punto de venta", "monto": 10.0, "referencia": "999"},
    ]})
    assert r.status_code == 200, r.text
    assert r.json()["pagos"][0]["referencia"] == "999"
    # Solo la referencia: nada se movio de cuenta.
    assert db.query(models.AsientoContable).filter_by(origen="correccion_pago").count() == 0


def test_corregir_la_forma_mueve_la_plata_de_cuenta(client, variante, db):
    v = cobrada(client, variante)
    punto_antes = saldo(db, "1020")
    efectivo_antes = saldo(db, "1010")
    pago = v["pagos"][0]
    r = client.put(f"/api/pedidos/{v['id']}/pagos", json={"pagos": [
        {"id": pago["id"], "metodo": "Efectivo Bs", "monto": 6.0},
        {"metodo": "Punto de venta", "monto": 4.0, "referencia": "222"},
    ]})
    assert r.status_code == 200, r.text
    assert r.json()["metodo_pago"] == "Mixto"
    assert round(saldo(db, "1020") - punto_antes, 2) == -6.0
    assert round(saldo(db, "1010") - efectivo_antes, 2) == 6.0
    assert r.json()["ediciones"][-1]["detalle"].startswith("pago corregido")

    # Y el cierre del dia lo ve donde entro de verdad.
    resumen = client.get("/api/caja/resumen").json()
    fila = {l["metodo"]: l for l in resumen["desglose"]}
    assert fila["Efectivo Bs"]["ventas"] == 6.0 and fila["Efectivo Bs"]["otros"] == 0
    assert fila["Punto de venta"]["ventas"] == 4.0


def test_lo_cobrado_no_cambia(client, variante):
    v = cobrada(client, variante)
    r = client.put(f"/api/pedidos/{v['id']}/pagos", json={"pagos": [
        {"metodo": "Efectivo Bs", "monto": 8.0},
    ]})
    assert r.status_code == 400 and "suman" in r.json()["detail"]


def test_con_la_caja_cerrada_no_se_corrige(client, variante):
    v = cobrada(client, variante)
    r = caja_cerrar(client, efectivo=0, divisas=0)
    assert r.status_code == 200, r.text
    r = client.put(f"/api/pedidos/{v['id']}/pagos", json={"pagos": [
        {"metodo": "Efectivo Bs", "monto": 10.0},
    ]})
    assert r.status_code == 409 and "ya se cerró" in r.json()["detail"]


def test_el_pago_con_vuelto_no_se_mueve(client, variante):
    v = cobrada(client, variante, metodo_pago="Efectivo $", pagos=[
        {"metodo": "Efectivo $", "monto": 10.0, "recibido": 20.0, "vuelto_metodo": "Efectivo Bs"},
    ])
    pago = v["pagos"][0]
    r = client.put(f"/api/pedidos/{v['id']}/pagos", json={"pagos": [
        {"id": pago["id"], "metodo": "Punto de venta", "monto": 10.0, "referencia": "1"},
    ]})
    assert r.status_code == 409 and "vuelto" in r.json()["detail"]


def test_el_fiado_no_se_corrige_aqui(client, variante):
    p = client.post("/api/pedidos", json={
        "cliente": "Ana", "items": [{"variante_id": variante.id, "cantidad": 1}],
    }).json()
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Fiado", "cliente": "Ana"})
    r = client.put(f"/api/pedidos/{p['id']}/pagos", json={"pagos": [
        {"metodo": "Efectivo Bs", "monto": 5.0},
    ]})
    assert r.status_code == 409


def test_a_quien_no_autoriza_mover_la_plata_le_pide_firma(db, variante):
    """Cambiar de gaveta la plata de una venta cobrada es justo como se tapa un
    faltante: pide la misma firma que editar la venta. La referencia sola no."""
    from fastapi.testclient import TestClient

    from app import settings
    from app.acceso import usuarios
    from app.database import get_db
    from app.main import app
    from conftest import entrar

    cajera = ("cajera_pagos", "clave-de-la-cajera-larga")
    try:
        usuarios.crear(cajera[0], cajera[1], rol="caja", locales=[settings.LOCAL_SLUG],
                       nombre="Carla", apellido="Caja")
    except usuarios.ErrorUsuarios:
        pass
    app.dependency_overrides[get_db] = lambda: db
    try:
        with TestClient(app) as c:
            entrar(c, *cajera)
            v = cobrada(c, variante)
            pago = v["pagos"][0]
            r = c.put(f"/api/pedidos/{v['id']}/pagos", json={"pagos": [
                {"id": pago["id"], "metodo": "Efectivo Bs", "monto": 10.0},
            ]})
            assert r.status_code == 403
            r = c.put(f"/api/pedidos/{v['id']}/pagos", json={"pagos": [
                {"id": pago["id"], "metodo": "Punto de venta", "monto": 10.0, "referencia": "5"},
            ]})
            assert r.status_code == 200, r.text
    finally:
        app.dependency_overrides.clear()
        try:
            usuarios.borrar(cajera[0])
        except usuarios.ErrorUsuarios:
            pass
