"""Roles a medida: un rol es la lista de modulos a los que entra.

Leider (16-sep): "en los roles dices en la descripcion lo que hace pero no los
modulos a los que tiene acceso, y es lo que importa. Tambien tienes que poner
una opcion para crear un rol".

Un rol nuevo reparte llaves del negocio, asi que lo que se prueba aqui no es
que la pantalla lo liste: es que la cerradura del middleware NIEGUE todo lo
que el rol no nombro.
"""
from __future__ import annotations

import re

import pytest
from fastapi.testclient import TestClient

from app import settings
from app.acceso import permisos, roles, usuarios
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
        # Y los recortes de los roles de fabrica: un rol ajustado se evalua
        # por otro camino, y arrastrarlo al test siguiente lo mediria mal.
        for rol in permisos.AJUSTABLES:
            roles.restaurar(rol, settings.LOCAL_SLUG)

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


# ── La jerarquia: lo de Vertigo no existe para el negocio ────────────────────
#
# Leider (16-sep): "hay jerarquias. Esta la parte interna, que es lo que maneja
# Vertigo, y esta la parte externa. Cuando pones los roles no me puedes dejar
# un rol de Vertigo, porque eso no lo debe ver el externo... el dueño nunca
# puede ver nada que este por fuera de su negocio".
#
# Dentro del local el rol mas alto es `dueno`. Por encima solo esta Vertigo, y
# desde abajo no se ve: ni el rol, ni su gente, ni los otros locales, ni los
# roles que otro local se invento.

DUENA = ("duena-roles", "clave-de-duena-larga")
OTRA = ("duena-otro", "clave-de-otra-larga")
OTRO_LOCAL = "otro-local"


@pytest.fixture()
def duena(clientes):
    """Una dueña de este local, con su propia sesion."""
    usuarios.crear(DUENA[0], DUENA[1], rol="dueno", locales=[settings.LOCAL_SLUG])
    yield entrar(clientes(), *DUENA)
    try:
        usuarios.borrar(DUENA[0])
    except usuarios.ErrorUsuarios:
        pass


def test_el_rol_de_vertigo_no_existe_para_el_negocio(admin, duena):
    de_vertigo = admin.get("/api/usuarios").json()["roles"]
    assert [r["rol"] for r in de_vertigo] == ["admin", "dueno", "caja", "cocina"]
    # Marcado como interno: es lo que la pantalla usa para apartarlo.
    assert [r["interno"] for r in de_vertigo] == [True, False, False, False]

    respuesta = duena.get("/api/usuarios")
    del_negocio = respuesta.json()["roles"]
    assert [r["rol"] for r in del_negocio] == ["dueno", "caja", "cocina"]
    assert not any(r["interno"] for r in del_negocio)
    # No es que la pantalla lo esconda: la palabra no viaja.
    assert "vertigo" not in respuesta.text.lower()
    assert "admin" not in respuesta.text.lower()


def test_la_duena_no_asciende_a_nadie_a_vertigo(duena):
    assert duena.post("/api/usuarios", json={
        "usuario": "colado", "clave": "clave-larga-x", "rol": "admin"}).status_code == 403
    r = duena.post("/api/usuarios", json={
        "usuario": "cajera-suya", "clave": "clave-larga-y", "rol": "caja"})
    assert r.status_code == 200, r.text
    assert duena.put("/api/usuarios/cajera-suya/rol", json={"rol": "admin"}).status_code == 403
    usuarios.borrar("cajera-suya")


def test_la_duena_crea_su_rol_y_le_queda_bajo_el_suyo(duena):
    ficha = _crear_rol(duena, ["pos", "cocina"])
    assert ficha["interno"] is False
    d = duena.get("/api/usuarios").json()
    # El orden es la jerarquia: ella arriba, lo que se invento al final.
    assert [r["rol"] for r in d["roles"]] == ["dueno", "caja", "cocina", "mesonero"]


def test_el_rol_a_medida_es_del_local_donde_nacio(admin, clientes, monkeypatch):
    """`roles.json` es UNO para el hub y todos los paneles. Sin dueño, el rol
    que se invento un local se lo veria --y se lo podria borrar-- el vecino."""
    _crear_rol(admin, ["pos"])
    assert roles.buscar("mesonero")["local"] == settings.LOCAL_SLUG

    monkeypatch.setattr(settings, "LOCAL_SLUG", OTRO_LOCAL)
    usuarios.crear(OTRA[0], OTRA[1], rol="dueno", locales=[OTRO_LOCAL])
    otra = entrar(clientes(), *OTRA)
    try:
        assert "mesonero" not in [r["rol"] for r in otra.get("/api/usuarios").json()["roles"]]
        # Ni lo edita ni lo borra: aqui ese rol no existe. 404 y no 403, que
        # un 403 ya seria contarle que existe.
        assert otra.delete("/api/usuarios/roles/mesonero").status_code == 404
        assert otra.put("/api/usuarios/roles/mesonero", json={
            "nombre": "Mio", "descripcion": "", "modulos": ["contabilidad"]}).status_code == 404
        assert roles.buscar("mesonero")["modulos"] == ["pos"]
    finally:
        usuarios.borrar(OTRA[0])


def test_el_permiso_no_se_filtra_por_local(admin, clientes, monkeypatch):
    """La VISIBILIDAD del rol es de su local; el PERMISO no. Si se filtrara,
    la misma cuenta entrando por otra puerta se quedaria sin poder hacer nada
    y sin nada que lo explicara."""
    _crear_rol(admin, ["pos"])
    usuarios.crear(MESONERO[0], MESONERO[1], rol="mesonero",
                   locales=["savora", OTRO_LOCAL])
    monkeypatch.setattr(settings, "LOCAL_SLUG", OTRO_LOCAL)
    meson = entrar(clientes(), *MESONERO)
    assert meson.get("/api/pedidos").status_code == 200


# ── Editar un rol ───────────────────────────────────────────────────────────
#
# Leider (16-sep): "los roles se deberian poder editar por el admin y por el
# dueño". Uno a medida se reescribe entero. A uno de fabrica no: se le guarda
# el recorte de modulos de ESTE local, que ademas se puede deshacer.

CAJERA = ("cajera-roles", "clave-de-cajera-larga")


def _modulos_de(cliente, rol):
    ficha = next(r for r in cliente.get("/api/usuarios").json()["roles"] if r["rol"] == rol)
    return ficha, [m["id"] for m in ficha["modulos"]]


def test_editar_un_rol_a_medida_cambia_lo_que_puede(admin, clientes):
    _crear_rol(admin, ["pos"])
    usuarios.crear(MESONERO[0], MESONERO[1], rol="mesonero", locales=["savora"])
    meson = entrar(clientes(), *MESONERO)
    assert meson.get("/api/contabilidad/plan-cuentas").status_code == 403

    r = admin.put("/api/usuarios/roles/mesonero", json={
        "nombre": "Mesonero de sala", "descripcion": "Toma pedidos y lleva los libros",
        "modulos": ["pos", "contabilidad"]})
    assert r.status_code == 200, r.text
    assert r.json()["nombre"] == "Mesonero de sala"
    # No es la pantalla la que cambia: es la cerradura.
    assert meson.get("/api/contabilidad/plan-cuentas").status_code == 200


def test_la_duena_recorta_un_rol_de_fabrica_y_lo_puede_deshacer(duena, clientes):
    usuarios.crear(CAJERA[0], CAJERA[1], rol="caja", locales=[settings.LOCAL_SLUG])
    caja = entrar(clientes(), *CAJERA)
    assert caja.get("/api/compras/facturas").status_code == 200

    ficha, modulos = _modulos_de(duena, "caja")
    assert (ficha["editable"], ficha["ajustado"]) == (True, False)
    quedan = [m for m in modulos if m != "compras"]

    r = duena.put("/api/usuarios/roles/caja",
                  json={"nombre": "", "descripcion": "", "modulos": quedan})
    assert r.status_code == 200, r.text
    assert r.json()["ajustado"] is True
    assert [m["id"] for m in r.json()["modulos"]] == quedan

    assert caja.get("/api/compras/facturas").status_code == 403
    assert caja.get("/api/pedidos").status_code == 200, "el resto del rol sigue igual"

    assert duena.delete("/api/usuarios/roles/caja/ajuste").status_code == 200
    assert caja.get("/api/compras/facturas").status_code == 200
    # Deshacer dos veces no tiene sentido y se dice.
    assert duena.delete("/api/usuarios/roles/caja/ajuste").status_code == 400
    usuarios.borrar(CAJERA[0])


def test_el_rol_mas_alto_y_el_de_vertigo_no_se_recortan(duena):
    """Quitarle un modulo a `dueno` seria la unica forma de que nadie dentro
    del local pudiera volver a ponerselo."""
    r = duena.put("/api/usuarios/roles/dueno",
                  json={"nombre": "", "descripcion": "", "modulos": ["pos"]})
    assert r.status_code == 400
    assert "alto" in r.text
    # El de Vertigo, para ella, ni existe.
    assert duena.put("/api/usuarios/roles/admin",
                     json={"nombre": "", "descripcion": "", "modulos": ["pos"]}).status_code == 404


def test_el_recorte_es_de_este_local_y_no_del_vecino(admin, clientes, monkeypatch):
    quedan = ["pos", "caja"]
    assert admin.put("/api/usuarios/roles/caja",
                     json={"nombre": "", "descripcion": "", "modulos": quedan}).status_code == 200

    monkeypatch.setattr(settings, "LOCAL_SLUG", OTRO_LOCAL)
    usuarios.crear(OTRA[0], OTRA[1], rol="dueno", locales=[OTRO_LOCAL])
    otra = entrar(clientes(), *OTRA)
    try:
        ficha, modulos = _modulos_de(otra, "caja")
        assert ficha["ajustado"] is False
        assert len(modulos) > len(quedan), "el recorte del vecino no se le aplica"
    finally:
        usuarios.borrar(OTRA[0])


def _rutas_reales():
    """Los (metodo, ruta) que la API sirve de verdad, con los parametros
    rellenos. Sin el propio acceso, la salud ni la clave y el PIN propios: el
    middleware no los evalua."""
    salida = set()
    for r in app.routes:
        ruta = getattr(r, "path", "")
        if (not ruta.startswith("/api/") or ruta.startswith("/api/acceso")
                or ruta == "/api/health" or ruta.startswith("/api/usuarios/mi/")):
            continue
        concreta = re.sub(r"\{[^}]+\}", "1", ruta)
        for metodo in getattr(r, "methods", None) or ():
            if metodo not in ("HEAD", "OPTIONS"):
                salida.add((metodo, concreta))
    assert len(salida) >= 60, "la lista de rutas se quedo corta: revisar el filtro"
    return sorted(salida)


@pytest.mark.parametrize("rol", permisos.AJUSTABLES)
def test_recortar_un_rol_no_le_quita_nada_que_no_se_le_quito(rol):
    """Guardar el rol SIN cambiar una casilla tiene que dejarlo igual.

    Al recortarlo cambia el motor que lo evalua: del camino de siempre al que
    niega por defecto. Si algo que el rol hace hoy no estuviera declarado en
    ningun modulo, dejaria de poder hacerlo en cuanto alguien abre la pantalla
    y pulsa Guardar -- y nadie ataria una cosa con la otra en pleno servicio.
    """
    perdidas = []
    for metodo, ruta in _rutas_reales():
        de_siempre = permisos.permitido(rol, metodo, ruta)
        libre = metodo in ("GET", "HEAD") and ruta.startswith(permisos.LECTURA_LIBRE)
        if de_siempre and not (libre or permisos._por_modulos(rol, metodo, ruta)):
            perdidas.append(f"{metodo} {ruta}")
    assert not perdidas, f"«{rol}» perderia: {perdidas}"
