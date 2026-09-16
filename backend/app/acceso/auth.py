"""La cookie de sesion, la puerta y el limite de intentos por IP.

La cookie es HttpOnly a proposito: JavaScript no la puede leer, asi que ni una
extension ni un XSS se la llevan. Y viaja en cookie y no en cabecera porque asi
nginx la puede validar ANTES de servir el codigo del panel (ver
`frontend/nginx.conf.template`): una cabecera solo la pone JavaScript, y para
eso el navegador ya tendria que haber descargado el JavaScript.
"""
from __future__ import annotations

import threading
import time

from fastapi import HTTPException, Request

from .. import settings
from . import permisos, sesion, usuarios

COOKIE_SESION = "erp_acceso"

ACCESO_TTL = sesion.TTL

# 20 intentos cada 5 minutos: invisible para una persona, suficiente contra un
# script. Con claves de 8 caracteres minimo el limite no es el muro principal.
LOGIN_INTENTOS = 20
LOGIN_VENTANA = 5 * 60


def credenciales_ok(usuario: str | None, clave: str | None) -> dict | None:
    return usuarios.verificar(usuario, clave)


def abrir_acceso(usuario: str, rol: str) -> str:
    return sesion.emitir(usuario, rol, usuarios.generacion(usuario) or 0)


def _de_este_local(d: dict | None) -> dict | None:
    """La sesion, pero solo si su dueño puede ver ESTE local.

    Una firma valida no es un permiso: el secreto es comun al hub y a todos los
    locales --tiene que serlo--, asi que la cookie de alguien asignado a otro
    local es una firma perfecta aqui. El permiso se comprueba en el backend que
    TIENE los datos. En el hub no hay datos: basta con que el usuario exista.
    """
    if d is None:
        return None
    if settings.ES_HUB:
        # En el hub entra Vertigo (administra la cartera) y quien tenga MAS DE
        # UN local (para elegir). Quien tiene uno solo nunca recibe cookie del
        # hub: el login lo manda directo a su local con un pase, y alli no
        # tiene nada que hacer.
        asignados = usuarios.locales_de(d["usuario"])
        if asignados is None:
            return None
        return d if permisos.es_vertigo(d["rol"]) or len(asignados) > 1 else None
    return d if usuarios.puede_ver(d["usuario"], settings.LOCAL_SLUG) else None


def datos_acceso(token: str | None) -> dict | None:
    d = _de_este_local(sesion.leer(token, generacion_actual=usuarios.generacion))
    return None if d is None else {"usuario": d["usuario"], "rol": d["rol"]}


def acceso_ok(token: str | None) -> bool:
    """Lo consulta nginx por cada archivo del panel: tiene que ser barato, y
    verificar un HMAC son microsegundos."""
    return _de_este_local(
        sesion.leer(token, generacion_actual=usuarios.generacion)) is not None


def poner_cookie(response, token: str, request) -> None:
    """UNA sola definicion de la cookie. `secure` se decide por el esquema real
    (detras de Traefik llega en X-Forwarded-Proto); forzarlo rompe el login en
    http://localhost sin ningun mensaje."""
    reenviado = request.headers.get("x-forwarded-proto", "")
    response.set_cookie(
        COOKIE_SESION, token,
        max_age=ACCESO_TTL,
        httponly=True,
        samesite="lax",
        secure=(reenviado or request.url.scheme) == "https",
        path="/",
    )


def conviene_renovar(token: str | None) -> str | None:
    d = sesion.leer(token, generacion_actual=usuarios.generacion)
    if d is None or not sesion.hay_que_renovar(d):
        return None
    return sesion.emitir(d["usuario"], d["rol"], d["generacion"])


def quien(request: Request) -> str | None:
    """El usuario de la sesion actual, que el middleware deja en
    `request.state`. Para anotar quien cobro, quien anulo, quien cerro caja."""
    s = getattr(request.state, "sesion", None)
    return s["usuario"] if s else None


def sesion_actual(request: Request) -> dict:
    s = getattr(request.state, "sesion", None) or datos_acceso(
        request.cookies.get(COOKIE_SESION))
    if not s:
        raise HTTPException(401, "Sesión requerida.")
    return s


def exigir_admin(request: Request) -> dict:
    """Quien administra ESTE local: admin de Vertigo o dueño."""
    s = sesion_actual(request)
    if not permisos.administra(s.get("rol")):
        raise HTTPException(403, "Hace falta rol de administrador o dueño.")
    return s


def exigir_vertigo(request: Request) -> dict:
    """Solo el equipo de la plataforma: la cartera de locales."""
    s = sesion_actual(request)
    if not permisos.es_vertigo(s.get("rol")):
        raise HTTPException(403, "Esto es de la administracion de Vertigo.")
    return s


# --- Limite de intentos por IP ------------------------------------------------
# Ventana deslizante en memoria. Alcanza para un contenedor.

_hits: dict[str, list[float]] = {}
_lock = threading.Lock()


def _ip_cliente(request: Request) -> str:
    """De `X-Real-IP`, que la pone NUESTRO nginx tras resolver la IP real. No
    de `X-Forwarded-For`, que la puede escribir el cliente y detras de Traefik
    en red de host valia siempre la pasarela de Docker: un solo cubo para todo
    el mundo."""
    real = request.headers.get("x-real-ip", "").strip()
    if real:
        return real
    return request.client.host if request.client else "?"


def rate_limit(request: Request, limit: int, window: int, what: str) -> None:
    ip = _ip_cliente(request)
    now = time.time()
    with _lock:
        recent = [t for t in _hits.get(ip, []) if now - t < window]
        if len(recent) >= limit:
            espera = int(window - (now - recent[0])) + 1
            raise HTTPException(
                429, f"Demasiados intentos de {what}. Reintenta en {espera} s.")
        recent.append(now)
        _hits[ip] = recent
        if len(_hits) > 2000:
            for k in [k for k, v in _hits.items() if not v or now - v[-1] > window]:
                _hits.pop(k, None)
