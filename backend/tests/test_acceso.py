"""La puerta del ERP: login, roles, pases entre dominios y quien hizo que.

Aca esta concentrado todo lo que puede fallar en silencio:

  * que un endpoint nuevo quede fuera de la puerta -- se recorre la lista REAL
    de rutas, asi que uno agregado sin pensar aparece aca;
  * que un cocinero pueda cobrar, una cajera leer la contabilidad, o un dueño
    tocar las cuentas de otro local o las de Vertigo;
  * que un pase valga como sesion (seria una sesion de doce horas tirada en
    el historial del navegador), o al reves;
  * que la cocina en tiempo real se pueda escuchar sin haber entrado.
"""
from __future__ import annotations

import re
import time
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import settings
from app.acceso import auth, permisos, sesion, usuarios
from app.database import get_db
from app.main import app
from tests.conftest import CLAVE_TEST, USUARIO_TEST, entrar

RAIZ = Path(__file__).resolve().parent.parent.parent
LOCAL = settings.LOCAL_SLUG  # "savora"

DUENA = ("duena", "clave-de-duena-larga")
CAJERA = ("cajera", "clave-de-caja-larga")
COCINERO = ("cocinero", "clave-de-cocina-larga")


@pytest.fixture(scope="module", autouse=True)
def _gente():
    """Una cuenta por rol, ademas del admin de Vertigo que ya crea conftest."""
    for (u, c), rol in ((DUENA, "dueno"), (CAJERA, "caja"), (COCINERO, "cocina")):
        try:
            usuarios.crear(u, c, rol=rol, locales=[LOCAL])
        except usuarios.ErrorUsuarios:
            pass


@pytest.fixture()
def como_duena(fuera):
    return entrar(fuera, *DUENA)


@pytest.fixture()
def como_caja(fuera):
    return entrar(fuera, *CAJERA)


@pytest.fixture()
def como_cocina(fuera):
    return entrar(fuera, *COCINERO)


@pytest.fixture()
def sin_usuarios(db, monkeypatch, tmp_path):
    """Un ERP recien instalado, sin ninguna cuenta todavia."""
    monkeypatch.setattr(usuarios, "USERS_FILE", tmp_path / "users.json")
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _comanda(cliente, variante):
    r = cliente.post("/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 1}]})
    assert r.status_code == 200, r.text
    return r.json()


# ── La puerta cierra ─────────────────────────────────────────────────────────

def _rutas_get_sin_parametros():
    """Todas las rutas GET bajo /api que no sean del acceso ni la salud."""
    salida = set()
    for r in app.routes:
        ruta = getattr(r, "path", "")
        metodos = getattr(r, "methods", None) or set()
        if not ruta.startswith("/api/") or "{" in ruta or "GET" not in metodos:
            continue
        if ruta.startswith("/api/acceso") or ruta == "/api/health":
            continue
        salida.add(ruta)
    assert len(salida) >= 20, "la lista de rutas se quedo corta: revisar el filtro"
    return sorted(salida)


@pytest.mark.parametrize("ruta", _rutas_get_sin_parametros())
def test_sin_sesion_no_se_lee_nada(fuera, ruta):
    assert fuera.get(ruta).status_code == 401, f"{ruta} responde sin sesion"


def test_con_sesion_si(client):
    assert client.get("/api/menu/categorias").status_code == 200


def test_la_salud_queda_abierta(fuera):
    """La consulta Docker antes de que exista ninguna sesion."""
    assert fuera.get("/api/health").status_code == 200


def test_la_documentacion_de_la_api_pide_sesion(fuera):
    assert fuera.get("/docs").status_code == 401
    assert fuera.get("/openapi.json").status_code == 401


def test_la_cocina_en_tiempo_real_pide_sesion(fuera):
    """El WebSocket no pasa por el middleware HTTP: se comprueba aparte."""
    with pytest.raises(WebSocketDisconnect):
        with fuera.websocket_connect("/ws"):
            pass


def test_con_sesion_el_websocket_abre(client):
    with client.websocket_connect("/ws"):
        pass


# ── Entrar y salir ───────────────────────────────────────────────────────────

def test_las_credenciales_correctas_abren_sesion(fuera):
    r = fuera.post("/api/acceso/login", json={"usuario": USUARIO_TEST, "clave": CLAVE_TEST})
    assert r.status_code == 200
    assert auth.COOKIE_SESION in r.cookies
    assert r.json()["rol"] == "admin"


def test_el_usuario_no_distingue_mayusculas(fuera):
    """Escribir "Admin" en una tablet con mayuscula automatica no puede dejar
    a nadie fuera."""
    r = fuera.post("/api/acceso/login", json={"usuario": "Admin", "clave": CLAVE_TEST})
    assert r.status_code == 200


@pytest.mark.parametrize("usuario,clave", [
    ("admin", "otra"), ("nadie", CLAVE_TEST), ("", ""), ("admin", ""),
    ("admin", CLAVE_TEST.upper()),
])
def test_las_credenciales_malas_no_abren_sesion(fuera, usuario, clave):
    r = fuera.post("/api/acceso/login", json={"usuario": usuario, "clave": clave})
    assert r.status_code == 401
    assert auth.COOKIE_SESION not in r.cookies


def test_el_error_no_dice_cual_de_las_dos_fallo(fuera):
    a = fuera.post("/api/acceso/login", json={"usuario": "admin", "clave": "mala"}).json()["detail"]
    b = fuera.post("/api/acceso/login", json={"usuario": "nadie", "clave": CLAVE_TEST}).json()["detail"]
    assert a == b


def test_salir_invalida_la_sesion(client):
    assert client.get("/api/menu/categorias").status_code == 200
    assert client.post("/api/acceso/logout").status_code == 200
    assert client.get("/api/menu/categorias").status_code == 401


def test_un_token_inventado_no_vale(fuera):
    fuera.cookies.set(auth.COOKIE_SESION, "esto-no-es-un-token")
    assert fuera.get("/api/menu/categorias").status_code == 401


def test_la_cookie_es_httponly_y_declara_samesite(fuera):
    r = fuera.post("/api/acceso/login", json={"usuario": USUARIO_TEST, "clave": CLAVE_TEST})
    cab = r.headers.get("set-cookie", "").lower()
    assert "httponly" in cab
    assert "samesite" in cab
    # En http (desarrollo) NO es secure: forzarlo deja el login en bucle.
    assert "secure" not in cab


def test_detras_de_https_la_cookie_es_secure(fuera):
    r = fuera.post("/api/acceso/login", json={"usuario": USUARIO_TEST, "clave": CLAVE_TEST},
                   headers={"x-forwarded-proto": "https"})
    assert "secure" in r.headers.get("set-cookie", "").lower()


def test_los_intentos_estan_limitados(fuera):
    codigos = [fuera.post("/api/acceso/login",
                          json={"usuario": "admin", "clave": f"mala{i}"}).status_code
               for i in range(auth.LOGIN_INTENTOS + 3)]
    assert codigos[0] == 401
    assert 429 in codigos, "se pueden probar claves sin limite"
    # Y bloqueado, la clave buena tampoco pasa.
    r = fuera.post("/api/acceso/login", json={"usuario": USUARIO_TEST, "clave": CLAVE_TEST})
    assert r.status_code == 429


def test_el_check_que_consulta_nginx(fuera, client):
    r = fuera.get("/api/acceso/check")
    assert r.status_code == 401 and not r.content
    assert client.get("/api/acceso/check").status_code == 200


def test_el_estado_dice_quien_eres_y_que_puedes(fuera, client):
    assert fuera.get("/api/acceso/estado").json()["autenticado"] is False
    d = client.get("/api/acceso/estado").json()
    assert d["autenticado"] is True and d["usuario"] == "admin"
    assert {k: v for k, v in d["puede"].items() if k != "modulos"} == {
        "vertigo": True, "administrar": True, "operar": True, "cocina": True}
    # Y a que modulos entra: con esto la barra lateral muestra solo lo suyo.
    assert "contabilidad" in d["puede"]["modulos"] and "pos" in d["puede"]["modulos"]
    assert d["local"]["slug"] == LOCAL
    assert d["local"]["logo"] == "/logo-savora.png"
    assert d["es_hub"] is False
    c = entrar(fuera, *COCINERO).get("/api/acceso/estado").json()
    assert {k: v for k, v in c["puede"].items() if k != "modulos"} == {
        "vertigo": False, "administrar": False, "operar": False, "cocina": True}
    assert c["puede"]["modulos"] == ["cocina"]


def test_el_favicon_es_el_del_local(fuera):
    r = fuera.get("/api/acceso/favicon", follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == "/favicon-savora.png"


def test_usar_el_erp_renueva_la_sesion(fuera):
    """El POS es una SPA: nadie recarga en un turno. Una peticion de datos
    cualquiera tiene que refrescar la cookie cuando lleva un rato."""
    real = time.time
    try:
        time.time = lambda: real() - int(sesion.INACTIVIDAD / 2)
        viejo = sesion.emitir("admin", "admin", usuarios.generacion("admin"))
    finally:
        time.time = real
    r = fuera.get("/api/menu/categorias", cookies={auth.COOKIE_SESION: viejo})
    assert r.status_code == 200
    assert auth.COOKIE_SESION in r.cookies, "trabajar no renueva la sesion"


def test_una_sesion_abandonada_caduca(fuera):
    real = time.time
    try:
        time.time = lambda: real() - sesion.INACTIVIDAD - 60
        muerta = sesion.emitir("admin", "admin", usuarios.generacion("admin"))
    finally:
        time.time = real
    assert fuera.get("/api/menu/categorias", cookies={auth.COOKIE_SESION: muerta}).status_code == 401


def test_cambiar_la_clave_echa_las_sesiones_viejas(fuera):
    """Quien cambia su clave suele hacerlo porque cree que se la vieron."""
    try:
        usuarios.crear("temporal", "clave-temporal-larga", rol="caja", locales=[LOCAL])
    except usuarios.ErrorUsuarios:
        pass
    c = entrar(fuera, "temporal", "clave-temporal-larga")
    assert c.get("/api/menu/categorias").status_code == 200
    usuarios.cambiar_clave("temporal", "otra-clave-larga-nueva")
    assert c.get("/api/menu/categorias").status_code == 401
    usuarios.borrar("temporal")


# ── Instalacion ──────────────────────────────────────────────────────────────

def test_sin_usuarios_el_erp_queda_cerrado_y_pide_instalar(sin_usuarios):
    assert sin_usuarios.get("/api/menu/categorias").status_code == 401
    assert sin_usuarios.get("/api/acceso/estado").json()["configurado"] is False
    r = sin_usuarios.post("/api/acceso/login", json={"usuario": "admin", "clave": "loquesea"})
    assert r.status_code == 409


def test_la_instalacion_crea_el_primer_admin_una_sola_vez(sin_usuarios):
    r = sin_usuarios.post("/api/acceso/setup", json={"usuario": "corta", "clave": "corta"})
    assert r.status_code == 400
    r = sin_usuarios.post("/api/acceso/setup", json={"usuario": "jefa", "clave": "clave-larga-1"})
    assert r.status_code == 200
    assert auth.COOKIE_SESION in r.cookies
    assert sin_usuarios.get("/api/menu/categorias").status_code == 200
    r = sin_usuarios.post("/api/acceso/setup", json={"usuario": "colado", "clave": "clave-larga-2"})
    assert r.status_code == 409


# ── Roles ────────────────────────────────────────────────────────────────────

def test_cocina_ve_comandas_y_las_marca_pero_no_vende(como_cocina, variante, client):
    p = _comanda(client, variante)
    assert como_cocina.get("/api/pedidos").status_code == 200
    assert como_cocina.get("/api/menu/categorias").status_code == 200
    assert como_cocina.get("/api/tasas").status_code == 200
    item = p["items"][0]["id"]
    assert como_cocina.post(f"/api/pedidos/items/{item}/preparado").status_code == 200
    assert como_cocina.post(f"/api/pedidos/{p['id']}/marcar-listo").status_code == 200
    # Lo que NO: crear, cobrar, anular, reportes, contabilidad.
    r = como_cocina.post("/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 1}]})
    assert r.status_code == 403
    assert como_cocina.post(f"/api/pedidos/{p['id']}/cobrar",
                            json={"metodo_pago": "Efectivo"}).status_code == 403
    assert como_cocina.post(f"/api/pedidos/{p['id']}/anular").status_code == 403
    assert como_cocina.get("/api/reportes/resumen?periodo=dia").status_code == 403
    assert como_cocina.get("/api/contabilidad/plan-cuentas").status_code == 403
    assert como_cocina.get("/api/inventario/ingredientes").status_code == 403


def test_caja_opera_pero_no_administra(como_caja, variante):
    p = _comanda(como_caja, variante)
    assert como_caja.post(f"/api/pedidos/{p['id']}/cobrar",
                          json={"metodo_pago": "Efectivo"}).status_code == 200
    assert como_caja.get("/api/reportes/resumen?periodo=dia").status_code == 200
    assert como_caja.get("/api/inventario/ingredientes").status_code == 200
    assert como_caja.get("/api/caja/resumen").status_code == 200
    assert como_caja.get("/api/puntos-venta").status_code == 200
    for ruta in ("/api/contabilidad/plan-cuentas", "/api/impuestos/config",
                 "/api/respaldos", "/api/usuarios", "/api/agencia"):
        assert como_caja.get(ruta).status_code == 403, ruta
    # Las cajas fisicas las crea quien administra, no la cajera.
    assert como_caja.post("/api/puntos-venta", json={"nombre": "Piso 2"}).status_code == 403
    # Su propia clave si la puede cambiar (llega al endpoint: 401 por clave
    # actual mala, no 403 por rol).
    r = como_caja.post("/api/usuarios/mi/clave",
                       json={"clave_actual": "mala", "clave_nueva": "otra-clave-larga"})
    assert r.status_code == 401


def test_la_duena_administra_su_local(como_duena):
    """Contabilidad, impuestos, respaldos y las cuentas de SU gente."""
    assert como_duena.get("/api/contabilidad/plan-cuentas").status_code == 200
    assert como_duena.get("/api/impuestos/config").status_code == 200
    assert como_duena.get("/api/respaldos").status_code == 200
    d = como_duena.get("/api/usuarios").json()
    # Ve a su gente, NO al equipo de Vertigo.
    assert {u["usuario"] for u in d["usuarios"]} >= {"duena", "cajera", "cocinero"}
    assert "admin" not in {u["usuario"] for u in d["usuarios"]}
    assert [r["rol"] for r in d["roles"]] == ["dueno", "caja", "cocina"]
    assert d["reparte_locales"] is False
    # Pero la cartera de la plataforma no es suya.
    assert como_duena.get("/api/agencia").status_code == 403


def test_la_duena_no_fabrica_administradores_ni_toca_a_vertigo(como_duena):
    r = como_duena.post("/api/usuarios", json={"usuario": "colado", "clave": "clave-larga-x", "rol": "admin"})
    assert r.status_code == 403
    # Al admin de Vertigo ni lo ve: 404, no 403 (no tiene por que saber que existe).
    assert como_duena.delete("/api/usuarios/admin").status_code == 404
    assert como_duena.post("/api/usuarios/admin/clave", json={"clave": "clave-larga-y"}).status_code == 404
    assert como_duena.put("/api/usuarios/cajera/locales", json={"locales": []}).status_code == 403


def test_lo_que_crea_la_duena_nace_en_su_local(como_duena):
    r = como_duena.post("/api/usuarios", json={"usuario": "nueva", "clave": "clave-larga-nueva",
                                               "rol": "caja", "locales": ["otro-local"]})
    assert r.status_code == 200, r.text
    # Mande lo que mande, queda en el local de ella.
    assert r.json()["locales"] == [LOCAL]
    usuarios.borrar("nueva")


def test_vertigo_administra_todo(client):
    assert client.get("/api/contabilidad/plan-cuentas").status_code == 200
    d = client.get("/api/usuarios").json()
    assert d["yo"] == "admin"
    assert {u["usuario"] for u in d["usuarios"]} >= {"admin", "duena", "cajera", "cocinero"}
    assert [r["rol"] for r in d["roles"]] == list(permisos.ROLES)
    assert d["reparte_locales"] is True


def test_el_rol_viaja_en_la_sesion_no_en_la_peticion(como_cocina):
    """Mandar rol=admin en el cuerpo no convierte a nadie en admin."""
    r = como_cocina.post("/api/usuarios", json={"usuario": "x", "clave": "clave-larga-x", "rol": "admin"})
    assert r.status_code == 403


def test_bajar_de_rol_echa_la_sesion_con_el_rol_viejo(fuera):
    """El rol va DENTRO del token: al bajarlo, el token viejo sigue diciendo
    'dueno'. Subir la generacion es lo que lo invalida."""
    try:
        usuarios.crear("segundo", "clave-segundo-larga", rol="dueno", locales=[LOCAL])
    except usuarios.ErrorUsuarios:
        pass
    c = entrar(fuera, "segundo", "clave-segundo-larga")
    assert c.get("/api/contabilidad/plan-cuentas").status_code == 200
    usuarios.cambiar_rol("segundo", "cocina")
    assert c.get("/api/contabilidad/plan-cuentas").status_code == 401
    usuarios.borrar("segundo")


def test_nadie_que_no_sea_vertigo_existe_sin_local():
    with pytest.raises(usuarios.ErrorUsuarios):
        usuarios.crear("suelto", "clave-suelta-larga", rol="dueno")
    with pytest.raises(usuarios.ErrorUsuarios):
        usuarios.crear("suelta", "clave-suelta-larga", rol="caja", locales=[])


def test_no_se_puede_borrar_ni_bajar_al_ultimo_admin():
    with pytest.raises(usuarios.ErrorUsuarios):
        usuarios.borrar("admin")
    with pytest.raises(usuarios.ErrorUsuarios):
        usuarios.cambiar_rol("admin", "caja")


# ── Quien hizo que ───────────────────────────────────────────────────────────

def test_cada_pedido_dice_quien_lo_tomo_cobro_y_anulo(client, como_caja, variante):
    """El operador ya no se elige en un desplegable: es quien entro."""
    p = _comanda(como_caja, variante)
    assert p["operador"] == "cajera"
    cobrado = client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo"}).json()
    assert cobrado["operador"] == "admin"

    otro = _comanda(client, variante)
    anulado = como_caja.post(f"/api/pedidos/{otro['id']}/anular").json()
    assert anulado["anulado_por"] == "cajera"


def test_un_operador_id_de_la_tablet_no_manda_sobre_la_sesion(client, como_caja, variante, db):
    """Mandar el id de otro operador en el cuerpo no cambia quien cobro."""
    from app import models

    otro = models.Operador(nombre="fantasma", rol="cajero", activo=True)
    db.add(otro)
    db.commit()
    p = _comanda(como_caja, variante)
    cobrado = como_caja.post(f"/api/pedidos/{p['id']}/cobrar",
                             json={"metodo_pago": "Efectivo", "operador_id": otro.id}).json()
    assert cobrado["operador"] == "cajera"


def test_el_cierre_de_caja_dice_quien_lo_hizo(como_caja):
    r = como_caja.post("/api/caja/cerrar", json={"efectivo_contado": 0, "nota": ""})
    assert r.status_code == 200, r.text
    assert r.json()["operador"] == "cajera"


# ── Pases entre dominios ─────────────────────────────────────────────────────

def _gen(_u):
    return 0


def test_una_sesion_no_sirve_de_pase_ni_un_pase_de_sesion():
    token = sesion.emitir("leider", "admin", 0)
    assert sesion.canjear_pase(token, LOCAL, _gen) is None
    pase = sesion.emitir_pase("leider", "admin", LOCAL, 0)
    assert sesion.leer(pase, _gen) is None


def test_el_pase_vale_para_un_local_y_una_vez():
    pase = sesion.emitir_pase("leider", "admin", LOCAL, 0)
    assert sesion.canjear_pase(pase, "otro-local", _gen) is None
    assert sesion.canjear_pase(pase, LOCAL, _gen) is not None
    assert sesion.canjear_pase(pase, LOCAL, _gen) is None, "se canjeo dos veces"


def test_el_pase_caduca_y_no_vale_si_revocaron_al_usuario():
    pase = sesion.emitir_pase("leider", "admin", LOCAL, 0)
    assert sesion.canjear_pase(pase, LOCAL, lambda u: 1) is None
    real = sesion.time.time
    try:
        sesion.time.time = lambda: real() + sesion.PASE_TTL + 5
        assert sesion.canjear_pase(pase, LOCAL, _gen) is None
    finally:
        sesion.time.time = real


def test_el_hub_manda_a_la_duena_a_su_local_con_un_pase(fuera, monkeypatch):
    """vertigopro.tech -> login -> savora.vertigopro.tech, sin volver a poner
    la clave. La cookie del hub no se deja: su sesion es del otro dominio."""
    monkeypatch.setattr(settings, "ES_HUB", True)
    r = fuera.post("/api/acceso/login", json={"usuario": DUENA[0], "clave": DUENA[1]})
    assert r.status_code == 200, r.text
    assert auth.COOKIE_SESION not in r.cookies
    destino = r.json()["redirigir"]
    assert destino.startswith("https://savora.vertigopro.tech/api/acceso/entrar?pase="), destino

    # Visto desde localhost, manda a la direccion de desarrollo.
    r = fuera.post("/api/acceso/login", json={"usuario": DUENA[0], "clave": DUENA[1]},
                   headers={"host": "localhost:8091"})
    assert r.json()["redirigir"].startswith("http://localhost:8090/api/acceso/entrar?pase=")

    # El hub no tiene datos: ni con sesion.
    assert fuera.get("/api/menu/categorias").status_code == 404

    # Y el panel canjea el pase por su propia cookie, una sola vez.
    monkeypatch.setattr(settings, "ES_HUB", False)
    pase = re.search(r"pase=([^&]+)", destino).group(1)
    r = fuera.get(f"/api/acceso/entrar?pase={pase}", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/"
    assert auth.COOKIE_SESION in r.cookies
    r = fuera.get(f"/api/acceso/entrar?pase={pase}", follow_redirects=False)
    assert r.headers["location"] == "/login.html"


def test_vertigo_se_queda_en_el_hub_y_ve_la_cartera(fuera, monkeypatch):
    monkeypatch.setattr(settings, "ES_HUB", True)
    r = fuera.post("/api/acceso/login", json={"usuario": USUARIO_TEST, "clave": CLAVE_TEST})
    assert r.status_code == 200, r.text
    assert auth.COOKIE_SESION in r.cookies
    assert "redirigir" not in r.json()
    d = fuera.get("/api/acceso/estado").json()
    assert d["es_hub"] is True and d["local"]["nombre"] == "Vertigo Pro"
    assert [m["slug"] for m in d["locales"]] == [LOCAL]
    cartera = fuera.get("/api/agencia")
    assert cartera.status_code == 200, cartera.text
    local = cartera.json()["locales"][0]
    assert local["slug"] == LOCAL
    assert local["duenos"] == ["duena"]
    assert local["por_rol"] == {"dueno": 1, "caja": 1, "cocina": 1}
    assert "admin" in cartera.json()["vertigo"]
    # Y la administracion de cuentas, con todos a la vista.
    todos = fuera.get("/api/usuarios").json()
    assert {u["usuario"] for u in todos["usuarios"]} >= {"admin", "duena", "cajera", "cocinero"}


def test_vertigo_vuelve_del_panel_al_hub_sin_clave(fuera, client, monkeypatch):
    pase = client.post("/api/acceso/pase", json={"local": "__hub__"})
    assert pase.status_code == 200, pase.text
    monkeypatch.setattr(settings, "ES_HUB", True)
    r = fuera.get(f"/api/acceso/entrar?pase={pase.json()['pase']}", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/inicio.html"
    assert auth.COOKIE_SESION in r.cookies


def test_una_cajera_no_consigue_pase_hacia_el_hub(como_caja):
    """Con un solo local no tiene nada que hacer alli."""
    assert como_caja.post("/api/acceso/pase", json={"local": "__hub__"}).status_code == 403


def test_un_pase_de_otro_local_no_abre_este(fuera, client):
    pase = client.post("/api/acceso/pase", json={"local": "otro-local"})
    # Vertigo ve todos los locales, asi que el pase se emite...
    assert pase.status_code == 200
    # ...pero ESTE panel solo canjea los suyos.
    r = fuera.get(f"/api/acceso/entrar?pase={pase.json()['pase']}", follow_redirects=False)
    assert r.headers["location"] == "/login.html"
    assert auth.COOKIE_SESION not in r.cookies


def test_salir_no_acepta_una_url_como_destino(fuera):
    """`volver` es un slug del catalogo, no una direccion: si no, un enlace del
    dominio del ERP llevaria a cualquier sitio."""
    r = fuera.get("/api/acceso/salir?volver=https://sitio-falso.com", follow_redirects=False)
    assert r.headers["location"] == "/login.html"
    r = fuera.get(f"/api/acceso/salir?volver={LOCAL}", follow_redirects=False)
    assert r.headers["location"] == "https://savora.vertigopro.tech/login.html"


# ── Lo que se lee del repo ───────────────────────────────────────────────────

FRONT = RAIZ / "frontend"


def test_nginx_cierra_el_panel_y_abre_solo_el_login():
    t = (FRONT / "nginx.conf.template").read_text(encoding="utf-8")
    assert "auth_request /_auth" in t, "nginx no comprueba la sesion antes de servir el panel"
    assert "proxy_pass $destino/api/acceso/check" in t
    assert "${BACKEND_HOST}" in t, "el backend esta escrito a mano en nginx"
    assert re.search(r"location = /login\.html \{\s*auth_request off", t)
    assert re.search(r"location /api/acceso/ \{\s*auth_request off", t)
    assert "real_ip_header X-Forwarded-For" in t
    for cab in ("X-Content-Type-Options", "X-Frame-Options", "Strict-Transport-Security"):
        assert f"add_header {cab}" in t


def test_el_login_no_arrastra_el_paquete_de_react():
    """login.html es lo unico que se sirve sin sesion: si cargara el paquete,
    servirlo filtraria el aplicativo completo."""
    for pagina in ("login.html", "inicio.html"):
        html = (FRONT / "public" / pagina).read_text(encoding="utf-8")
        assert "/src/" not in html and "/assets/" not in html, pagina
        assert "/api/acceso/estado" in html


def test_los_iconos_y_logos_del_local_existen_y_nginx_los_sirve_sin_sesion():
    """La ficha apunta a archivos que tienen que estar en el paquete, y nginx
    tiene que servirlos ANTES de que exista sesion: el login los muestra."""
    from app import locales

    ficha = locales.actual()
    for campo in ("logo", "favicon"):
        assert (FRONT / "public" / ficha[campo].lstrip("/")).is_file(), ficha[campo]
    t = (FRONT / "nginx.conf.template").read_text(encoding="utf-8")
    publica = re.search(r"location ~\* \^/\((.+?)\)\$ \{\s*auth_request off", t)
    assert publica, "nginx no tiene una regla publica para iconos y logos"
    patron = re.compile("^/(" + publica.group(1) + ")$")
    for campo in ("logo", "favicon"):
        assert patron.match(ficha[campo]), f"nginx pediria sesion para {ficha[campo]}"


def test_en_produccion_nada_escucha_en_la_ip_publica():
    """Todo entra por Traefik con TLS. Un `ports:` sin direccion delante lo
    publica en TODAS las interfaces, o sea en la IP del servidor: seria el ERP
    --o la base-- a la vista de internet.

    Con `127.0.0.1:` delante si se permite: ese puerto no existe fuera de la
    maquina y la unica forma de llegar es estando ya dentro (por SSH). Es lo
    que hace falta para mirar la base con una herramienta visual por un tunel.
    Se comprueba el prefijo, que es justo lo que distingue una cosa de la otra
    y lo facil de olvidar al agregar un puerto.
    """
    yaml.SafeLoader.add_constructor("!override", lambda l, n: l.construct_sequence(n))
    yaml.SafeLoader.add_constructor("!reset", lambda l, n: None)
    texto = (RAIZ / "docker-compose.prod.yml").read_text(encoding="utf-8")
    prod = yaml.safe_load(texto)
    base = yaml.safe_load((RAIZ / "docker-compose.yml").read_text(encoding="utf-8"))

    def loopback(puertos, servicio, de_donde):
        for publicado in puertos or []:
            assert str(publicado).startswith("127.0.0.1:"), (
                f"{servicio} publica {publicado} en {de_donde}: eso lo deja en la IP "
                "del servidor. Ponle 127.0.0.1: delante, o quitalo."
            )

    # 1. Lo que el overlay de produccion publica, solo al loopback.
    for nombre, svc in (prod.get("services") or {}).items():
        loopback((svc or {}).get("ports"), nombre, "produccion")

    # 2. Lo que publica el archivo BASE (el 8090 del desarrollo) tiene que
    #    quedar anulado en produccion. `ports` se SUMA entre archivos: sin el
    #    `!override`, el panel seguiria asomado al puerto 8090 del servidor.
    for nombre, svc in (base.get("services") or {}).items():
        if not (svc or {}).get("ports"):
            continue
        en_prod = (prod.get("services") or {}).get(nombre) or {}
        assert "ports" in en_prod, f"{nombre} publica puertos en base y produccion no los anula"
        assert f"{nombre}:" in texto and "ports: !override" in texto, (
            f"{nombre} necesita `ports: !override` en produccion: una lista normal se suma "
            "a la del archivo base en vez de reemplazarla"
        )
        loopback(en_prod.get("ports"), nombre, "produccion")
    assert "postgresql+psycopg://" in (RAIZ / "docker-compose.yml").read_text(encoding="utf-8")
    texto = (RAIZ / "docker-compose.prod.yml").read_text(encoding="utf-8")
    assert "Host(`savora.vertigopro.tech`)" in texto
    assert "Host(`vertigopro.tech`)" in texto
    assert "ERP_DB_SCHEMA: HUB" in texto, "el hub tiene que trabajar en su propio esquema"
