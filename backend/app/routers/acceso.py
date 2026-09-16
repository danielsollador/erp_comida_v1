"""Puerta de entrada al ERP.

Uno de estos endpoints no lo llama el navegador: `/api/acceso/check` lo
consulta **nginx** antes de servir cada archivo del panel (ver
`frontend/nginx.conf.template`). Es lo que hace que el login sirva de algo mas
que de cortina: un login hecho solo en React esconde la pantalla pero no el
codigo -- el paquete de JavaScript ya se descargo para dibujar el formulario.
Validando la cookie en nginx, sin sesion se recibe la pagina de login y nada
mas.

DOS PUERTAS, UN SOLO USUARIO
----------------------------
  * `savora.vertigopro.tech` -> login -> el ERP de Savora. Es el enlace que
    tiene el local.
  * `vertigopro.tech` -> login -> depende de quien entra:
      - el equipo de Vertigo (rol `admin`) se queda en el hub: ahi ve todos
        los locales y administra cuentas;
      - quien tiene UN local es mandado a el con un PASE (un minuto, un
        local, un uso), sin volver a poner la clave y sin cookie en el hub;
      - quien tiene varios, elige.

La cookie de cada dominio es suya: no hay cookie comun a todos los subdominios
a proposito, para que llegar por el enlace directo pida sesion.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from .. import locales, settings
from ..acceso import auth, permisos, sesion, usuarios

router = APIRouter(prefix="/api/acceso", tags=["acceso"])

# El "slug" con el que se pide un pase HACIA el hub. No es un local y no puede
# chocar con ninguno: los slugs de las fichas son minusculas y guiones.
PASE_HUB = "__hub__"

IDENTIDAD_HUB = {"slug": "", "nombre": "Vertigo Pro", "dominio": "", "url": "",
                 "logo": "", "favicon": "/favicon.svg"}


class Credenciales(BaseModel):
    usuario: str = ""
    clave: str = ""


class PidoPase(BaseModel):
    local: str = ""


def _locales_del_usuario(usuario: str | None) -> list[dict]:
    """Los locales que puede ver quien esta dentro. Vertigo ve todos; el resto,
    lo que tiene asignado. Sale del servidor: si viniera del navegador
    bastaria editar la peticion para pedir el de otro."""
    if not usuario:
        return []
    rol = usuarios.rol_de(usuario)
    if rol is None:
        return []
    todos = locales.disponibles()
    if permisos.es_vertigo(rol):
        return todos
    permitidos = usuarios.locales_de(usuario) or []
    return [m for m in todos if m["slug"] in permitidos]


def _entra_al_hub(usuario: str, rol: str) -> bool:
    """Quien puede tener sesion EN el hub: Vertigo, o alguien con MAS DE UN
    local que elegir. Quien tiene uno solo no la necesita: se le manda directo,
    y un pase hacia el hub no le sirve de nada."""
    return permisos.es_vertigo(rol) or len(usuarios.locales_de(usuario) or []) > 1


def _pase_hacia(u: dict, m: dict, request: Request) -> str | None:
    base = locales.base_para(m, request.headers.get("host", ""))
    if not base:
        return None
    pase = sesion.emitir_pase(u["usuario"], u["rol"], m["slug"],
                              usuarios.generacion(u["usuario"]) or 0)
    return f"{base}/api/acceso/entrar?pase={pase}"


def _entrar(u: dict, request: Request, response: Response) -> dict:
    """Lo comun a login y setup una vez que las credenciales valen."""
    if settings.ES_HUB:
        mios = _locales_del_usuario(u["usuario"])
        if permisos.es_vertigo(u["rol"]):
            # Vertigo se queda en el hub: cartera y administracion.
            auth.poner_cookie(response, auth.abrir_acceso(u["usuario"], u["rol"]), request)
            return {"ok": True, "usuario": u["usuario"], "rol": u["rol"]}
        if not mios:
            raise HTTPException(
                403, "Tu cuenta no tiene ningún local asignado. Pídele acceso "
                     "a un administrador.")
        if len(mios) == 1:
            # Directo a su local con un pase, y sin dejar cookie aqui.
            destino = _pase_hacia(u, mios[0], request)
            if destino:
                return {"ok": True, "usuario": u["usuario"], "rol": u["rol"],
                        "redirigir": destino}
        # Varios locales (o uno sin direccion): que elija en inicio.html.
        auth.poner_cookie(response, auth.abrir_acceso(u["usuario"], u["rol"]), request)
        return {"ok": True, "usuario": u["usuario"], "rol": u["rol"]}

    if not usuarios.puede_ver(u["usuario"], settings.LOCAL_SLUG):
        # 403 y no 401: no es "identificate", es "no es tuyo".
        raise HTTPException(
            403, f"Tu cuenta no tiene acceso a {locales.actual()['nombre']}.")
    auth.poner_cookie(response, auth.abrir_acceso(u["usuario"], u["rol"]), request)
    return {"ok": True, "usuario": u["usuario"], "rol": u["rol"]}


@router.post("/setup")
def setup(datos: Credenciales, request: Request, response: Response) -> dict:
    """Crea el PRIMER usuario: el administrador de Vertigo. Solo funciona si
    no hay ninguno; en cuanto existe uno, responde 409 para siempre."""
    auth.rate_limit(request, limit=auth.LOGIN_INTENTOS,
                    window=auth.LOGIN_VENTANA, what="instalación")
    if usuarios.hay_usuarios():
        raise HTTPException(409, "El sistema ya tiene usuarios. Inicia sesión.")
    try:
        creado = usuarios.crear(datos.usuario, datos.clave, rol="admin")
    except usuarios.ErrorUsuarios as e:
        raise HTTPException(400, str(e))
    except usuarios.ErrorAlmacen as e:
        raise HTTPException(503, str(e))
    usuarios.marcar_acceso(creado["usuario"])
    return _entrar(creado, request, response)


@router.post("/login")
def login(datos: Credenciales, request: Request, response: Response) -> dict:
    # El limite va ANTES de comparar la clave.
    auth.rate_limit(request, limit=auth.LOGIN_INTENTOS,
                    window=auth.LOGIN_VENTANA, what="acceso")
    if not usuarios.hay_usuarios():
        # 409 y no 503: no esta mal configurado, todavia no se instalo.
        raise HTTPException(409, "El sistema no tiene usuarios todavía.")
    u = auth.credenciales_ok(datos.usuario, datos.clave)
    if not u:
        # Un solo mensaje para usuario malo y clave mala: decir cual fallo
        # regala la mitad de la credencial.
        raise HTTPException(401, "Usuario o contraseña incorrectos.")
    return _entrar(u, request, response)


@router.post("/pase")
def pase(datos: PidoPase, request: Request) -> dict:
    """Un pase para entrar a otro dominio sin volver a poner la clave. Dura un
    minuto, vale para ese destino y se gasta una vez."""
    s = auth.datos_acceso(request.cookies.get(auth.COOKIE_SESION))
    if not s:
        raise HTTPException(401, "Sesión requerida.")
    # El permiso se comprueba aca Y en el destino al canjearlo: dos cerraduras.
    if datos.local == PASE_HUB:
        if not _entra_al_hub(s["usuario"], s["rol"]):
            raise HTTPException(403, "Tu cuenta no entra al hub.")
    elif not usuarios.puede_ver(s["usuario"], datos.local):
        raise HTTPException(403, "Tu cuenta no tiene acceso a ese local.")
    return {"pase": sesion.emitir_pase(
        s["usuario"], s["rol"], datos.local,
        usuarios.generacion(s["usuario"]) or 0)}


@router.get("/entrar")
def entrar(request: Request, pase: Optional[str] = None):
    # `Optional` y no `str | None`: FastAPI evalua esta anotacion en tiempo de
    # ejecucion y Daniel desarrolla con Python 3.8 (ver ESTADO.md).
    """Canjea un pase por la sesion de ESTE dominio y entra.

    Redirige siempre: sin pase valido cae en el login, que es lo que toca al
    llegar por un enlace directo. Y limpia la URL: el pase no tiene por que
    quedarse en el historial aunque ya no sirva.
    """
    esperado = PASE_HUB if settings.ES_HUB else settings.LOCAL_SLUG
    datos = sesion.canjear_pase(pase, esperado, generacion_actual=usuarios.generacion)
    if not datos:
        return RedirectResponse("/login.html", status_code=303)
    if settings.ES_HUB:
        if not _entra_al_hub(datos["usuario"], datos["rol"]):
            return RedirectResponse("/login.html", status_code=303)
    elif not usuarios.puede_ver(datos["usuario"], settings.LOCAL_SLUG):
        return RedirectResponse("/login.html", status_code=303)

    r = RedirectResponse("/inicio.html" if settings.ES_HUB else "/", status_code=303)
    auth.poner_cookie(r, auth.abrir_acceso(datos["usuario"], datos["rol"]), request)
    return r


@router.post("/logout")
def logout(response: Response) -> dict:
    # No hay nada que borrar en el servidor: la sesion no se guarda. Lo que
    # echa a la persona es que se borra la cookie. No se sube la generacion a
    # proposito: salir de una pestaña no es salir de todos los dispositivos.
    response.delete_cookie(auth.COOKIE_SESION, path="/")
    return {"ok": True}


@router.get("/salir")
def salir(volver: str = ""):
    """Cierra la sesion de ESTE dominio y devuelve al login del que llamo.

    Hub y panel son dominios distintos con cookies distintas: salir del panel
    no cierra la del hub. El boton del panel encadena: cierra la suya, manda
    aqui, y esto cierra la del hub. `volver` es un SLUG, no una URL: aceptar
    una direccion seria una redireccion abierta.
    """
    destino = "/login.html"
    if volver:
        m = locales.por_slug(volver)
        base = ((m or {}).get("dominio") or (m or {}).get("url") or "").rstrip("/")
        if base:
            destino = f"{base}/login.html"
    r = RedirectResponse(destino, status_code=303)
    r.delete_cookie(auth.COOKIE_SESION, path="/")
    return r


@router.get("/check")
def check(request: Request) -> Response:
    """Lo consulta nginx (`auth_request`) por cada archivo del panel. 200 o 401
    y SIN cuerpo: nginx solo mira el codigo."""
    if auth.acceso_ok(request.cookies.get(auth.COOKIE_SESION)):
        return Response(status_code=200)
    return Response(status_code=401)


@router.get("/favicon")
def favicon():
    """El icono de la pestaña de ESTE local. El paquete del frontend es el
    mismo para todos los locales y para el hub, asi que el `index.html` no
    puede llevar uno fijo: pide este, que redirige al de la ficha (o al de
    Vertigo si el local no declara uno). Cuelga de `/api/acceso/` porque el
    navegador lo pide ANTES de que exista sesion."""
    local = IDENTIDAD_HUB if settings.ES_HUB else locales.actual()
    return RedirectResponse(local.get("favicon") or "/favicon.svg", status_code=302,
                            headers={"Cache-Control": "public, max-age=3600"})


@router.get("/estado")
def estado(request: Request, response: Response) -> dict:
    """Si la sesion sirve, y lo que la pantalla de acceso necesita ANTES de
    que haya sesion. Existe porque la cookie es HttpOnly y el frontend no la
    puede leer."""
    token = request.cookies.get(auth.COOKIE_SESION)
    nuevo = auth.conviene_renovar(token)
    if nuevo:
        auth.poner_cookie(response, nuevo, request)
    s = auth.datos_acceso(token)
    local = IDENTIDAD_HUB if settings.ES_HUB else locales.actual()
    return {
        "autenticado": bool(s),
        "es_hub": settings.ES_HUB,
        "hub_url": "" if settings.ES_HUB else settings.HUB_URL,
        # Lo que no es secreto: el nombre del local (esta en la puerta del
        # negocio), su logo y su direccion. Sirve para que el login diga a
        # donde entras y se vea de la marca del local.
        "local": {"slug": local["slug"], "nombre": local["nombre"],
                  "dominio": local.get("dominio", ""), "url": local.get("url", ""),
                  "logo": local.get("logo", ""), "favicon": local.get("favicon", "")},
        # Los locales a los que ESTE usuario puede entrar. Vacio sin sesion.
        "locales": _locales_del_usuario(s["usuario"]) if s else [],
        "usuario": s["usuario"] if s else None,
        "rol": s["rol"] if s else None,
        # Lo que puede hacer este perfil. Lo dice el servidor; el frontend no
        # deduce permisos de `rol === "admin"`.
        "puede": permisos.resumen(s["rol"]) if s else {},
        # False = instalacion pendiente: login.html muestra "crear el primer
        # usuario" en vez de "entrar".
        "configurado": usuarios.hay_usuarios(),
        # Si el servidor no puede guardar usuarios, se dice de entrada.
        "problema": usuarios.problema_almacen(),
    }
