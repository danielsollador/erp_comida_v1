"""Roles a medida: un rol es la lista de modulos a los que entra.

Leider (16-sep): "en los roles dices en la descripcion lo que hace pero no los
modulos a los que tiene acceso, y es lo que importa. Tambien tienes que poner
una opcion para crear un rol".

Un rol nuevo reparte llaves del negocio, asi que lo que se prueba aqui no es
que la pantalla lo liste: es que la cerradura del middleware NIEGUE todo lo
que el rol no nombro.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.acceso import roles, usuarios
from app.database import get_db
from app.main import app
from tests.conftest import entrar

MESONERO = ("mesonero", "clave-de-mesonero-larga")


@pytest.fixture()
def clientes(db):
    """Fabrica de clientes, uno por persona.

    La sesion vive en la cookie del cliente: si el mesonero entrara por el
    mismo cliente que el dueño, le pisaria la sesion y el test mediria otra
    cosa que la que dice medir.
    """
    app.dependency_overrides[get_db] = lambda: db
    abiertos = []

    def nuevo():
        c = TestClient(app)
        c.__enter__()
        abiertos.append(c)
        return c

    yield nuevo
    for c in abiertos:
        c.__exit__(None, None, None)
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture()
def admin(clientes):
    return entrar(clientes())


@pytest.fixture(autouse=True)
def _sin_roles_previos():
    """Cada test arranca sin roles a medida ni mesonero: el almacen de
    usuarios es de alcance sesion, y lo que sobreviva de un test volveria al
    siguiente verde por casualidad."""
    def limpiar():
        try:
            usuarios.borrar(MESONERO[0])
        except usuarios.ErrorUsuarios:
            pass
        for r in roles.listar():
            roles.borrar(r["id"], en_uso=False)

    limpiar()
    yield
    limpiar()


def _crear_rol(cliente, modulos, rol_id="mesonero", nombre="Mesonero"):
    r = cliente.post(
        "/api/usuarios/roles",
        json={"id": rol_id, "nombre": nombre, "descripcion": "Toma pedidos", "modulos": modulos},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_el_rol_nuevo_dice_a_que_modulos_entra(admin):
    ficha = _crear_rol(admin, ["pos", "cocina"])
    assert ficha["rol"] == "mesonero"
    assert ficha["a_medida"] is True
    assert [m["id"] for m in ficha["modulos"]] == ["pos", "cocina"]
    # Y se ofrece al crear cuentas, junto a los de fabrica.
    lista = admin.get("/api/usuarios").json()
    assert "mesonero" in [r["rol"] for r in lista["roles"]]
    # Los de fabrica tambien dicen sus modulos, que era lo que faltaba.
    caja = next(r for r in lista["roles"] if r["rol"] == "caja")
    assert "pos" in [m["id"] for m in caja["modulos"]]
    assert "contabilidad" not in [m["id"] for m in caja["modulos"]]


def test_la_cuenta_con_rol_a_medida_solo_entra_a_lo_suyo(admin, clientes):
    _crear_rol(admin, ["pos", "cocina"])
    usuarios.crear(MESONERO[0], MESONERO[1], rol="mesonero", locales=["savora"])
    meson = entrar(clientes(), *MESONERO)

    # Lo suyo, si.
    assert meson.get("/api/pedidos").status_code == 200
    assert meson.get("/api/menu/categorias").status_code == 200
    # Lo que su rol no nombro, no. Niega por defecto.
    for ruta in ("/api/contabilidad/plan-cuentas", "/api/reportes/resumen",
                 "/api/compras/facturas", "/api/respaldos", "/api/usuarios"):
        assert meson.get(ruta).status_code == 403, f"{ruta} quedo abierta"
    # Tampoco escribir donde no le toca.
    assert meson.post("/api/inventario/ingredientes",
                      json={"nombre": "X", "unidad": "kg"}).status_code == 403

    # Y el frontend recibe la lista de modulos para mostrar solo esos.
    estado = meson.get("/api/acceso/estado").json()
    assert estado["puede"]["modulos"] == ["pos", "cocina"]
    assert estado["puede"]["administrar"] is False


def test_un_modulo_agregado_al_rol_abre_su_pantalla(admin, clientes):
    _crear_rol(admin, ["pos"])
    usuarios.crear(MESONERO[0], MESONERO[1], rol="mesonero", locales=["savora"])
    meson = entrar(clientes(), *MESONERO)
    assert meson.get("/api/reportes/resumen").status_code == 403

    r = admin.put(
        "/api/usuarios/roles/mesonero",
        json={"nombre": "Mesonero", "descripcion": "", "modulos": ["pos", "reportes"]},
    )
    assert r.status_code == 200, r.text
    assert meson.get("/api/reportes/resumen").status_code == 200


def test_un_rol_a_medida_no_puede_repartir_cuentas(admin):
    """`usuarios` no esta entre los modulos que se pueden elegir: repartir
    llaves es del dueño, y ademas el router de usuarios exige rol de
    administrador aparte del middleware."""
    catalogo = [m["id"] for m in admin.get("/api/usuarios").json()["modulos"]]
    assert "usuarios" not in catalogo
    ficha = _crear_rol(admin, ["pos", "usuarios"])
    assert [m["id"] for m in ficha["modulos"]] == ["pos"]


@pytest.mark.parametrize("datos, motivo", [
    ({"id": "caja", "nombre": "Caja mia", "modulos": ["pos"]}, "nombre de fabrica"),
    ({"id": "x", "nombre": "X", "modulos": ["pos"]}, "identificador muy corto"),
    ({"id": "valido", "nombre": "V", "modulos": []}, "sin modulos"),
    ({"id": "valido", "nombre": "V", "modulos": ["inventado"]}, "modulo que no existe"),
    ({"id": "valido", "nombre": "", "modulos": ["pos"]}, "sin nombre"),
])
def test_lo_que_no_se_acepta_como_rol(admin, datos, motivo):
    r = admin.post("/api/usuarios/roles", json={"descripcion": "", **datos})
    assert r.status_code == 400, f"se acepto un rol con {motivo}: {r.text}"


def test_no_se_borra_un_rol_que_alguien_esta_usando(admin):
    _crear_rol(admin, ["pos"])
    usuarios.crear(MESONERO[0], MESONERO[1], rol="mesonero", locales=["savora"])

    r = admin.delete("/api/usuarios/roles/mesonero")
    assert r.status_code == 400
    assert "cuentas con este rol" in r.text.lower()

    # Cambiada la cuenta de rol, ya se puede.
    assert admin.put("/api/usuarios/mesonero/rol", json={"rol": "caja"}).status_code == 200
    assert admin.delete("/api/usuarios/roles/mesonero").status_code == 200
    assert roles.listar() == []


def test_la_cuenta_cuyo_rol_desaparece_no_hereda_permisos(admin, clientes):
    """Si el rol se borra a mano del archivo, la cuenta no puede quedar con
    todo abierto: cae en el rol mas restringido."""
    _crear_rol(admin, ["pos", "contabilidad"])
    usuarios.crear(MESONERO[0], MESONERO[1], rol="mesonero", locales=["savora"])
    meson = entrar(clientes(), *MESONERO)
    assert meson.get("/api/contabilidad/plan-cuentas").status_code == 200

    roles.borrar("mesonero", en_uso=False)
    assert meson.get("/api/contabilidad/plan-cuentas").status_code == 403
    assert meson.get("/api/pedidos").status_code == 200  # lo que puede la cocina
