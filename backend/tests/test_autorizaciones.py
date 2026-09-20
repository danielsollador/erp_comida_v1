"""Autorizar con PIN o desde la aplicacion, y quien puede hacerlo.

Leider (20-sep): "poner su usuario y su contraseña es demasiado lento... el
PIN tiene que estar para cada usuario... y si el dueño no está, que le llegue
una notificación y pueda aceptar desde su aplicación".

Lo que se prueba es la cerradura: que el PIN identifique a UNA persona con un
rol que autoriza, que una solicitud aprobada sirva una sola vez y para lo que
se pidio, y que la casilla del rol sea la que manda.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import settings
from app.acceso import permisos, roles, usuarios
from app.database import get_db
from app.main import app
from tests.conftest import entrar

LOCAL = settings.LOCAL_SLUG
DUENA = ("daniela", "clave-de-daniela-larga")
CAJERA = ("maria", "clave-de-maria-larga")


@pytest.fixture(scope="module", autouse=True)
def _gente():
    """Una dueña y una cajera con nombre. Se borran al terminar el modulo: el
    almacen de usuarios es de alcance sesion y otros tests cuentan los dueños
    del local."""
    for (u, c), rol, nombre in ((DUENA, "dueno", ("Daniela", "Prueba")),
                                (CAJERA, "caja", ("María", "Caja"))):
        try:
            usuarios.crear(u, c, rol=rol, locales=[LOCAL], nombre=nombre[0], apellido=nombre[1])
        except usuarios.ErrorUsuarios:
            pass
    yield
    for u, _ in (DUENA, CAJERA):
        try:
            usuarios.borrar(u)
        except usuarios.ErrorUsuarios:
            pass


@pytest.fixture()
def clientes(db):
    app.dependency_overrides[get_db] = lambda: db
    abiertos = []

    def nuevo(quien=None):
        c = TestClient(app)
        c.__enter__()
        abiertos.append(c)
        return entrar(c, *quien) if quien else entrar(c)

    yield nuevo
    for c in abiertos:
        c.__exit__(None, None, None)
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def _sin_pin_ni_ajustes():
    yield
    for u, _ in (DUENA, CAJERA):
        usuarios.quitar_pin(u)
    roles.restaurar("caja", LOCAL)
    if roles.autoriza_ajustado("caja", LOCAL) is not None:
        roles.fijar_autoriza("caja", LOCAL, False)


def cobrada(cliente, variante):
    p = cliente.post("/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 2}]}).json()
    r = cliente.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})
    assert r.status_code == 200, r.text
    return r.json()


def quitar_una(cliente, pedido, variante, autorizacion):
    """Deja una sola empanada: se le devuelven $5 al cliente."""
    return cliente.put(
        f"/api/pedidos/{pedido['id']}",
        json={
            "items": [{"variante_id": variante.id, "cantidad": 1}],
            "autorizacion": autorizacion,
            "pagos": [{"metodo": "Efectivo Bs", "monto": 5.0}],
        },
    )


# ── el PIN ───────────────────────────────────────────────────────────────────


def test_el_pin_identifica_a_la_persona_sin_decir_quien_es(clientes):
    admin = clientes()
    r = admin.post(f"/api/usuarios/{DUENA[0]}/pin", json={"pin": "2468"})
    assert r.status_code == 200, r.text
    assert r.json()["tiene_pin"] is True
    assert usuarios.verificar_pin("2468", LOCAL)["usuario"] == DUENA[0]
    assert usuarios.verificar_pin("2469", LOCAL) is None
    assert usuarios.verificar_pin("24", LOCAL) is None


def test_dos_personas_no_pueden_tener_el_mismo_pin(clientes):
    admin = clientes()
    assert admin.post(f"/api/usuarios/{DUENA[0]}/pin", json={"pin": "1357"}).status_code == 200
    # El admin de Vertigo tambien autoriza: intenta el mismo PIN.
    r = admin.post("/api/usuarios/admin/pin", json={"pin": "1357"})
    assert r.status_code == 400 and "otra persona" in r.json()["detail"]
    usuarios.quitar_pin("admin")


def test_la_cajera_no_puede_tener_pin_si_su_rol_no_autoriza(clientes):
    admin = clientes()
    r = admin.post(f"/api/usuarios/{CAJERA[0]}/pin", json={"pin": "1111"})
    assert r.status_code == 400 and "no autoriza" in r.json()["detail"]
    # Ni ponerselo ella misma.
    cajera = clientes(CAJERA)
    r = cajera.post("/api/usuarios/mi/pin", json={"clave_actual": CAJERA[1], "pin": "1111"})
    assert r.status_code == 403


def test_la_duena_se_pone_su_pin_con_su_contrasena(clientes):
    duena = clientes(DUENA)
    assert duena.post("/api/usuarios/mi/pin", json={"clave_actual": "mala", "pin": "9999"}).status_code == 401
    r = duena.post("/api/usuarios/mi/pin", json={"clave_actual": DUENA[1], "pin": "9999"})
    assert r.status_code == 200, r.text
    assert duena.get("/api/acceso/estado").json()["tiene_pin"] is True
    assert duena.post("/api/usuarios/mi/pin", json={"clave_actual": DUENA[1], "pin": "12a4"}).status_code == 400


def test_editar_una_venta_cobrada_con_el_pin_de_la_duena(clientes, variante):
    usuarios.poner_pin(DUENA[0], "2468")
    cajera = clientes(CAJERA)
    p = cobrada(cajera, variante)

    r = quitar_una(cajera, p, variante, {"pin": "0000"})
    assert r.status_code == 403 and r.json()["detail"] == "PIN incorrecto."

    r = quitar_una(cajera, p, variante, {"pin": "2468"})
    assert r.status_code == 200, r.text
    assert r.json()["ediciones"][-1]["autorizado_por"] == "Daniela Prueba"


def test_diez_pin_malos_bloquean_un_rato(clientes, variante):
    usuarios.poner_pin(DUENA[0], "2468")
    cajera = clientes(CAJERA)
    p = cobrada(cajera, variante)
    for _ in range(10):
        assert quitar_una(cajera, p, variante, {"pin": "0000"}).status_code == 403
    # El undecimo ya no se evalua: 429 aunque el PIN sea el bueno.
    assert quitar_una(cajera, p, variante, {"pin": "2468"}).status_code == 429


def test_la_forma_vieja_sigue_valiendo_pero_solo_para_quien_autoriza(clientes, variante):
    cajera = clientes(CAJERA)
    p = cobrada(cajera, variante)
    r = quitar_una(cajera, p, variante, {"usuario": CAJERA[0], "clave": CAJERA[1]})
    assert r.status_code == 403 and "no autoriza" in r.json()["detail"]
    r = quitar_una(cajera, p, variante, {"usuario": DUENA[0], "clave": DUENA[1]})
    assert r.status_code == 200, r.text


# ── la solicitud desde la aplicacion ────────────────────────────────────────


def test_pedir_autorizacion_y_que_la_duena_apruebe_desde_su_app(clientes, variante):
    cajera = clientes(CAJERA)
    duena = clientes(DUENA)
    p = cobrada(cajera, variante)

    r = cajera.post("/api/autorizaciones", json={
        "accion": "editar_venta", "detalle": "Quitar 1 Empanada", "monto": 5.0, "pedido_id": p["id"]})
    assert r.status_code == 200, r.text
    sol = r.json()
    assert sol["estado"] == "pendiente" and sol["solicitante_nombre"] == "María Caja"

    # Le aparece a la dueña; a la cajera solo la suya.
    assert [x["id"] for x in duena.get("/api/autorizaciones").json()] == [sol["id"]]
    assert [x["id"] for x in cajera.get("/api/autorizaciones").json()] == [sol["id"]]

    # Sin aprobar, no sirve.
    r = quitar_una(cajera, p, variante, {"solicitud_id": sol["id"]})
    assert r.status_code == 403 and "no está aprobada" in r.json()["detail"]

    # La cajera no puede aprobarse a si misma.
    assert cajera.post(f"/api/autorizaciones/{sol['id']}/aprobar").status_code == 403

    r = duena.post(f"/api/autorizaciones/{sol['id']}/aprobar")
    assert r.status_code == 200 and r.json()["estado"] == "aprobada"
    assert r.json()["resuelta_por"] == "Daniela Prueba"

    r = quitar_una(cajera, p, variante, {"solicitud_id": sol["id"]})
    assert r.status_code == 200, r.text
    assert r.json()["ediciones"][-1]["autorizado_por"] == "Daniela Prueba"

    # Una aprobacion se gasta una vez: volver a poner la segunda empanada
    # (otros $5 que mover) con la misma solicitud no pasa.
    assert cajera.get(f"/api/autorizaciones/{sol['id']}").json()["estado"] == "usada"
    r = cajera.put(
        f"/api/pedidos/{p['id']}",
        json={"items": [{"variante_id": variante.id, "cantidad": 2}],
              "autorizacion": {"solicitud_id": sol["id"]},
              "pagos": [{"metodo": "Efectivo Bs", "monto": 5.0}]},
    )
    assert r.status_code == 403 and "usada" in r.json()["detail"]


def test_una_solicitud_rechazada_o_de_otro_pedido_no_sirve(clientes, variante):
    cajera = clientes(CAJERA)
    duena = clientes(DUENA)
    p = cobrada(cajera, variante)
    otro = cobrada(cajera, variante)

    sol = cajera.post("/api/autorizaciones", json={"accion": "editar_venta", "pedido_id": p["id"]}).json()
    assert duena.post(f"/api/autorizaciones/{sol['id']}/rechazar").json()["estado"] == "rechazada"
    assert quitar_una(cajera, p, variante, {"solicitud_id": sol["id"]}).status_code == 403
    # Ya resuelta, no se vuelve a resolver.
    assert duena.post(f"/api/autorizaciones/{sol['id']}/aprobar").status_code == 409

    sol2 = cajera.post("/api/autorizaciones", json={"accion": "editar_venta", "pedido_id": p["id"]}).json()
    duena.post(f"/api/autorizaciones/{sol2['id']}/aprobar")
    r = quitar_una(cajera, otro, variante, {"solicitud_id": sol2["id"]})
    assert r.status_code == 403 and "otra operación" in r.json()["detail"]


# ── la casilla del rol ───────────────────────────────────────────────────────


def test_el_rol_caja_puede_pasar_a_autorizar_desde_la_pantalla_de_roles(clientes):
    admin = clientes()
    assert permisos.autoriza("caja") is False
    modulos = list(permisos.MODULOS_POR_ROL["caja"])
    r = admin.put("/api/usuarios/roles/caja", json={"modulos": modulos, "autoriza": True})
    assert r.status_code == 200, r.text
    assert r.json()["autoriza"] is True and r.json()["autoriza_fijo"] is False
    assert permisos.autoriza("caja") is True
    # Y ahora la cajera si puede tener PIN.
    assert admin.post(f"/api/usuarios/{CAJERA[0]}/pin", json={"pin": "4321"}).status_code == 200
    assert admin.get("/api/acceso/estado").json()["puede"]["autoriza"] is True


def test_un_rol_a_medida_nace_con_o_sin_autorizacion(clientes):
    admin = clientes()
    r = admin.post("/api/usuarios/roles", json={
        "nombre": "Encargado", "modulos": ["pos", "caja"], "autoriza": True})
    assert r.status_code == 200, r.text
    assert r.json()["autoriza"] is True and permisos.autoriza("encargado") is True
    r = admin.put("/api/usuarios/roles/encargado", json={
        "nombre": "Encargado", "descripcion": "", "modulos": ["pos"], "autoriza": False})
    assert r.json()["autoriza"] is False and permisos.autoriza("encargado") is False
    admin.delete("/api/usuarios/roles/encargado")


def test_el_dueno_autoriza_siempre(clientes):
    admin = clientes()
    fichas = {r["rol"]: r for r in admin.get("/api/usuarios").json()["roles"]}
    assert fichas["dueno"]["autoriza"] is True and fichas["dueno"]["autoriza_fijo"] is True
    assert fichas["cocina"]["autoriza"] is False


# ── el nombre ────────────────────────────────────────────────────────────────


def test_el_estado_saluda_por_el_nombre_y_no_por_el_usuario(clientes):
    duena = clientes(DUENA)
    d = duena.get("/api/acceso/estado").json()
    assert d["usuario"] == "daniela" and d["nombre"] == "Daniela"
    assert d["nombre_visible"] == "Daniela Prueba"
    admin = clientes()
    assert admin.get("/api/acceso/estado").json()["nombre_visible"] == "admin"


def test_crear_un_usuario_con_nombre_y_cambiarselo(clientes):
    admin = clientes()
    r = admin.post("/api/usuarios", json={
        "usuario": "pedro", "clave": "clave-de-pedro-larga", "rol": "caja",
        "nombre": "  Pedro   José ", "apellido": "Pérez"})
    assert r.status_code == 200, r.text
    assert r.json()["nombre"] == "Pedro José" and r.json()["tiene_pin"] is False
    r = admin.put("/api/usuarios/pedro/nombre", json={"nombre": "Pedro", "apellido": "P."})
    assert r.status_code == 200 and r.json()["apellido"] == "P."
    assert usuarios.nombre_visible(usuarios.ficha("pedro")) == "Pedro P."
    admin.delete("/api/usuarios/pedro")
