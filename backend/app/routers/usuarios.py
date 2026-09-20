"""Administracion de usuarios.

Todo exige sesion (la garantiza el middleware) y, salvo cambiar la clave
propia, rol que administre. Pero administrar no es lo mismo para todos:

  * Vertigo (`admin`) ve y toca TODAS las cuentas, de todos los locales, y es
    el unico que fabrica administradores y reparte locales.
  * Un dueño ve y toca solo las cuentas de SU local --dueños, caja y cocina--
    y lo que crea nace asignado a su local. No ve a Vertigo ni a la gente de
    otros locales: la cartera de la plataforma no es suya. Tampoco ve el rol
    de Vertigo en ninguna lista, ni los roles a medida de otro local.

El rol viaja en la sesion, no en la peticion.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from .. import locales, settings
from ..acceso import auth, permisos, roles, usuarios

router = APIRouter(prefix="/api/usuarios", tags=["usuarios"])


def _traducir(e: Exception) -> HTTPException:
    """400 si el formulario esta mal, 503 si el que no puede es el servidor."""
    if isinstance(e, usuarios.ErrorAlmacen):
        return HTTPException(503, str(e))
    return HTTPException(400, str(e))


class NuevoUsuario(BaseModel):
    usuario: str = ""
    clave: str = ""
    # Como se llama la persona. El usuario es para entrar; el nombre, para
    # saludarla y para que "autorizó Daniela" se lea como una persona.
    nombre: str = ""
    apellido: str = ""
    # `caja` por defecto: es el perfil de casi todas las cuentas de un local.
    rol: str = "caja"
    # Que locales puede ver. Solo Vertigo lo decide; un dueño no lo manda.
    # `Optional[List]` y no `list | None`: pydantic evalua la anotacion en
    # tiempo de ejecucion y Daniel desarrolla con Python 3.8.
    locales: Optional[List[str]] = None


class CambioRol(BaseModel):
    rol: str = "caja"


class NuevoRol(BaseModel):
    """Un rol a medida: un nombre y los modulos a los que entra."""

    id: str = ""
    nombre: str = ""
    descripcion: str = ""
    modulos: List[str] = []
    # Si quien tiene el rol autoriza operaciones (PIN y solicitudes).
    autoriza: bool = False


class CambioLocales(BaseModel):
    locales: List[str] = []


class CambioClave(BaseModel):
    clave: str = ""


class CambioClavePropia(BaseModel):
    clave_actual: str = ""
    clave_nueva: str = ""


class CambioNombre(BaseModel):
    nombre: str = ""
    apellido: str = ""


class CambioPin(BaseModel):
    pin: str = ""


class CambioPinPropio(BaseModel):
    """El PIN propio se pone con la contraseña delante: un POS abierto no
    puede servir para que otro se ponga un PIN a nombre del dueño."""
    clave_actual: str = ""
    pin: str = ""


# ── El alcance de quien administra ─────────────────────────────────────────

def _local_de_aqui() -> str | None:
    """El local de ESTE panel, o None en el hub (que no es de ningun local)."""
    return None if settings.ES_HUB else settings.LOCAL_SLUG


def _alcanza(s: dict, objetivo: dict | None) -> bool:
    """Si quien administra puede tocar ESTA cuenta.

    Vertigo alcanza a todos. Un dueño alcanza a quien tenga su local asignado
    y no sea de Vertigo -- que un dueño pueda borrar o degradar al
    administrador de la plataforma seria ponerle la llave del edificio.
    """
    if objetivo is None:
        return False
    if permisos.es_vertigo(s["rol"]):
        return True
    aqui = _local_de_aqui()
    return (aqui is not None
            and not permisos.es_vertigo(objetivo.get("rol"))
            and aqui in (objetivo.get("locales") or []))


def _ficha(usuario: str) -> dict | None:
    u = usuario.strip().lower()
    return next((x for x in usuarios.listar() if x["usuario"] == u), None)


def _objetivo(s: dict, usuario: str) -> dict:
    """La ficha del usuario sobre el que se actua, o 404 si no esta al alcance.
    404 y no 403 a proposito: un dueño no tiene por que saber que existe la
    gente de otros locales."""
    ficha = _ficha(usuario)
    if not _alcanza(s, ficha):
        raise HTTPException(404, f"No existe el usuario «{usuario.strip().lower()}».")
    return ficha


def _ficha_rol(rol: str) -> dict:
    """Un rol tal como lo muestra la pantalla de Usuarios."""
    return {
        "rol": rol,
        "nombre": permisos.nombre_de(rol),
        "descripcion": permisos.descripcion_de(rol),
        "modulos": [{"id": m, "nombre": permisos.MODULOS[m]["nombre"]}
                    for m in permisos.modulos_de(rol)],
        "a_medida": permisos.es_a_medida(rol),
        # Si se le pueden cambiar los modulos desde la pantalla, y si este
        # local ya se los cambio (para poder devolverlo a como venia).
        "editable": permisos.es_ajustable(rol),
        "ajustado": permisos.esta_ajustado(rol),
        # De la plataforma y no del negocio: la pantalla lo aparta del resto.
        # Solo llega hasta aqui si quien mira es Vertigo (ver `listar`).
        "interno": permisos.es_vertigo(rol),
        # Si autoriza operaciones delicadas. Dueño siempre; el resto lo decide
        # el local con la casilla de la pantalla de Roles.
        "autoriza": permisos.autoriza(rol),
        "autoriza_fijo": permisos.normalizar(rol) in ("admin", "dueno"),
    }


def _rol_a_medida_al_alcance(s: dict, rol_id: str) -> str:
    """El rol a medida sobre el que se puede actuar, o 404.

    404 y no 403, igual que con las cuentas: el rol que se invento otro local
    no es que este prohibido, es que aqui no existe.
    """
    objetivo = (rol_id or "").strip().lower()
    if permisos.es_vertigo(s["rol"]):
        if roles.buscar(objetivo) is None:
            raise HTTPException(404, f"No existe el rol «{objetivo}».")
    elif not roles.es_de_local(objetivo, _local_de_aqui()):
        raise HTTPException(404, f"No existe el rol «{objetivo}».")
    return objetivo


def _rol_asignable(s: dict, rol: str) -> str:
    rol = (rol or "").strip().lower()
    if rol not in permisos.roles_que_puede_asignar(s["rol"], _local_de_aqui()):
        raise HTTPException(403, f"Tu usuario no puede asignar el rol «{rol}».")
    return rol


@router.get("")
def listar(request: Request) -> dict:
    s = auth.exigir_admin(request)
    todos = usuarios.listar()
    asignables = permisos.roles_que_puede_asignar(s["rol"], _local_de_aqui())
    # El nombre del rol viaja con cada cuenta: el de alguien puede no estar
    # entre los asignables (Vertigo le puso uno que aqui no se reparte) y el
    # selector de la pantalla se quedaria en blanco sobre su propia gente.
    visibles = [{**u, "rol_nombre": permisos.nombre_de(u.get("rol"))}
                for u in todos if _alcanza(s, u)]
    if permisos.es_vertigo(s["rol"]):
        fichas = locales.disponibles()
    else:
        fichas = [m for m in locales.disponibles() if m["slug"] == _local_de_aqui()]
    return {
        "usuarios": visibles,
        "yo": s["usuario"],
        # Cada rol con LOS MODULOS a los que entra: es lo que se pregunta
        # quien reparte una llave, y lo que una frase de descripcion no dice.
        "roles": [_ficha_rol(r) for r in asignables],
        # El catalogo para armar uno nuevo.
        "modulos": [{"id": m, "nombre": permisos.MODULOS[m]["nombre"]}
                    for m in permisos.MODULOS_A_MEDIDA],
        "locales": [{"slug": m["slug"], "nombre": m["nombre"]} for m in fichas],
        # Si quien mira puede repartir locales (solo Vertigo).
        "reparte_locales": permisos.es_vertigo(s["rol"]),
    }


@router.post("/roles")
def crear_rol(datos: NuevoRol, request: Request) -> dict:
    """Un rol a medida, cuando los de fabrica no encajan: un mesonero que solo
    toma pedidos, un encargado sin acceso a la contabilidad."""
    s = auth.exigir_admin(request)
    try:
        return _ficha_rol(
            roles.crear(datos.id or datos.nombre, datos.nombre, datos.descripcion,
                        datos.modulos, permisos.ROLES, permisos.MODULOS_A_MEDIDA,
                        # Nace del local donde se creo. Vertigo, desde el hub,
                        # crea roles sin local: suyos y de nadie mas.
                        local=_local_de_aqui(), autoriza=datos.autoriza)["id"]
        )
    except roles.ErrorRoles as e:
        raise HTTPException(400, str(e))


@router.put("/roles/{rol_id}")
def editar_rol(rol_id: str, datos: NuevoRol, request: Request) -> dict:
    """Cambia un rol. Uno a medida se reescribe entero; a uno de fabrica se le
    guarda el recorte de modulos de ESTE local, sin tocar el original."""
    s = auth.exigir_admin(request)
    objetivo = (rol_id or "").strip().lower()
    # Si no es de los que reparte, aqui no existe: ni el de Vertigo ni el que
    # se invento otro local.
    if objetivo not in permisos.roles_que_puede_asignar(s["rol"], _local_de_aqui()):
        raise HTTPException(404, f"No existe el rol «{objetivo}».")
    if not permisos.es_ajustable(objetivo):
        raise HTTPException(
            400, f"«{permisos.nombre_de(objetivo)}» no se puede recortar: es el rol más "
                 "alto del negocio y el único que reparte usuarios. Si le quitas un módulo, "
                 "nadie aquí dentro podría volver a ponérselo.")
    try:
        if objetivo in permisos.ROLES:
            roles.ajustar(objetivo, _local_de_aqui(), datos.modulos,
                          permisos.MODULOS_A_MEDIDA)
            roles.fijar_autoriza(objetivo, _local_de_aqui(), datos.autoriza)
            return _ficha_rol(objetivo)
        return _ficha_rol(
            roles.actualizar(objetivo, datos.nombre, datos.descripcion, datos.modulos,
                             permisos.MODULOS_A_MEDIDA, autoriza=datos.autoriza)["id"]
        )
    except roles.ErrorRoles as e:
        raise HTTPException(400, str(e))


@router.delete("/roles/{rol_id}/ajuste")
def restaurar_rol(rol_id: str, request: Request) -> dict:
    """Devuelve un rol de fabrica a los modulos con los que viene."""
    s = auth.exigir_admin(request)
    objetivo = (rol_id or "").strip().lower()
    if objetivo not in permisos.roles_que_puede_asignar(s["rol"], _local_de_aqui()):
        raise HTTPException(404, f"No existe el rol «{objetivo}».")
    if not roles.restaurar(objetivo, _local_de_aqui()):
        raise HTTPException(400, "Ese rol no está recortado: ya está como viene de fábrica.")
    return _ficha_rol(objetivo)


@router.delete("/roles/{rol_id}")
def borrar_rol(rol_id: str, request: Request) -> dict:
    s = auth.exigir_admin(request)
    objetivo = _rol_a_medida_al_alcance(s, rol_id)
    en_uso = any(u.get("rol") == objetivo for u in usuarios.listar())
    try:
        roles.borrar(objetivo, en_uso)
    except roles.ErrorRoles as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


@router.post("")
def crear(datos: NuevoUsuario, request: Request) -> dict:
    s = auth.exigir_admin(request)
    rol = _rol_asignable(s, datos.rol)
    aqui = _local_de_aqui()
    if permisos.es_vertigo(s["rol"]):
        # Vertigo elige. Sin lista y en un panel, el local de ese panel; sin
        # lista y en el hub, un admin nace sin locales (ve todos) y cualquier
        # otro rol tiene que traerlos.
        asignados = datos.locales if datos.locales is not None else ([aqui] if aqui else [])
    else:
        # Un dueño solo puebla SU local, mande lo que mande.
        asignados = [aqui] if aqui else []
    try:
        return usuarios.crear(datos.usuario, datos.clave, rol, asignados,
                              datos.nombre, datos.apellido)
    except (usuarios.ErrorUsuarios, usuarios.ErrorAlmacen) as e:
        raise _traducir(e)


@router.put("/{usuario}/rol")
def cambiar_rol(usuario: str, datos: CambioRol, request: Request) -> dict:
    s = auth.exigir_admin(request)
    if usuario.strip().lower() == s["usuario"]:
        raise HTTPException(400, "No puedes cambiarte el rol a ti mismo.")
    _objetivo(s, usuario)
    rol = _rol_asignable(s, datos.rol)
    try:
        return usuarios.cambiar_rol(usuario, rol)
    except (usuarios.ErrorUsuarios, usuarios.ErrorAlmacen) as e:
        raise _traducir(e)


@router.put("/{usuario}/locales")
def cambiar_locales(usuario: str, datos: CambioLocales, request: Request) -> dict:
    """Repartir locales es de Vertigo: un dueño no puede darle a nadie acceso
    a otro local, ni quitarselo."""
    s = auth.exigir_vertigo(request)
    _objetivo(s, usuario)
    try:
        return usuarios.asignar_locales(usuario, datos.locales)
    except (usuarios.ErrorUsuarios, usuarios.ErrorAlmacen) as e:
        raise _traducir(e)


@router.delete("/{usuario}")
def borrar(usuario: str, request: Request) -> dict:
    s = auth.exigir_admin(request)
    if usuario.strip().lower() == s["usuario"]:
        raise HTTPException(400, "No puedes borrar tu propio usuario.")
    _objetivo(s, usuario)
    try:
        usuarios.borrar(usuario)
    except (usuarios.ErrorUsuarios, usuarios.ErrorAlmacen) as e:
        raise _traducir(e)
    return {"ok": True}


# ATENCION AL ORDEN: esta ruta va ANTES que "/{usuario}/clave", porque esa
# tambien casa con "/mi/clave" tomando "mi" como nombre de usuario.
@router.post("/mi/clave")
def cambiar_mi_clave(datos: CambioClavePropia, request: Request) -> dict:
    """Cambiar la propia clave, sea el rol que sea. Pide la actual aunque haya
    sesion: si alguien deja el POS abierto, otro no puede quedarse con la
    cuenta."""
    s = auth.sesion_actual(request)
    auth.rate_limit(request, limit=auth.LOGIN_INTENTOS,
                    window=auth.LOGIN_VENTANA, what="cambio de clave")
    if not usuarios.verificar(s["usuario"], datos.clave_actual):
        raise HTTPException(401, "La clave actual no es correcta.")
    try:
        usuarios.cambiar_clave(s["usuario"], datos.clave_nueva)
    except (usuarios.ErrorUsuarios, usuarios.ErrorAlmacen) as e:
        raise _traducir(e)
    return {"ok": True}


@router.put("/mi/nombre")
def cambiar_mi_nombre(datos: CambioNombre, request: Request) -> dict:
    """Cada quien escribe como se llama. No hace falta la contrasena: es su
    nombre para mostrar, no una llave, y lo que ata sus acciones al historial
    es el usuario con el que entro, que no cambia."""
    s = auth.sesion_actual(request)
    try:
        return usuarios.cambiar_nombre(s["usuario"], datos.nombre, datos.apellido)
    except (usuarios.ErrorUsuarios, usuarios.ErrorAlmacen) as e:
        raise _traducir(e)


@router.post("/mi/pin")
def poner_mi_pin(datos: CambioPinPropio, request: Request) -> dict:
    """El PIN propio. Solo para quien tiene un rol que autoriza: a los demas
    no les sirve de nada y seria una llave suelta."""
    s = auth.sesion_actual(request)
    if not permisos.autoriza(s["rol"]):
        raise HTTPException(
            403, "Tu rol no autoriza operaciones, así que no necesita PIN. "
                 "Quien administra puede marcarlo en Roles.")
    auth.rate_limit(request, limit=auth.LOGIN_INTENTOS,
                    window=auth.LOGIN_VENTANA, what="cambio de PIN")
    if not usuarios.verificar(s["usuario"], datos.clave_actual):
        raise HTTPException(401, "La contraseña no es correcta.")
    try:
        return usuarios.poner_pin(s["usuario"], datos.pin)
    except (usuarios.ErrorUsuarios, usuarios.ErrorAlmacen) as e:
        raise _traducir(e)


@router.delete("/mi/pin")
def quitar_mi_pin(request: Request) -> dict:
    s = auth.sesion_actual(request)
    try:
        return usuarios.quitar_pin(s["usuario"])
    except (usuarios.ErrorUsuarios, usuarios.ErrorAlmacen) as e:
        raise _traducir(e)


@router.post("/{usuario}/clave")
def cambiar_clave(usuario: str, datos: CambioClave, request: Request) -> dict:
    """Quien administra reinicia la clave de alguien a su alcance. No pide la
    actual."""
    s = auth.exigir_admin(request)
    _objetivo(s, usuario)
    try:
        usuarios.cambiar_clave(usuario, datos.clave)
    except (usuarios.ErrorUsuarios, usuarios.ErrorAlmacen) as e:
        raise _traducir(e)
    return {"ok": True}


@router.put("/{usuario}/nombre")
def cambiar_nombre(usuario: str, datos: CambioNombre, request: Request) -> dict:
    s = auth.exigir_admin(request)
    _objetivo(s, usuario)
    try:
        return usuarios.cambiar_nombre(usuario, datos.nombre, datos.apellido)
    except (usuarios.ErrorUsuarios, usuarios.ErrorAlmacen) as e:
        raise _traducir(e)


@router.post("/{usuario}/pin")
def poner_pin(usuario: str, datos: CambioPin, request: Request) -> dict:
    """Quien administra le pone (o le cambia) el PIN a alguien a su alcance,
    siempre que el rol de esa persona autorice."""
    s = auth.exigir_admin(request)
    ficha = _objetivo(s, usuario)
    if not permisos.autoriza(ficha.get("rol")):
        raise HTTPException(
            400, f"El rol «{permisos.nombre_de(ficha.get('rol'))}» no autoriza operaciones. "
                 "Márcalo en Roles primero y después ponle el PIN.")
    try:
        return usuarios.poner_pin(usuario, datos.pin)
    except (usuarios.ErrorUsuarios, usuarios.ErrorAlmacen) as e:
        raise _traducir(e)


@router.delete("/{usuario}/pin")
def quitar_pin(usuario: str, request: Request) -> dict:
    s = auth.exigir_admin(request)
    _objetivo(s, usuario)
    try:
        return usuarios.quitar_pin(usuario)
    except (usuarios.ErrorUsuarios, usuarios.ErrorAlmacen) as e:
        raise _traducir(e)
