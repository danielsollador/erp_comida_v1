"""Roles a medida: los que crea el dueño cuando los cuatro de fábrica no le sirven.

Viven en `SHARED_DIR/roles.json`, al lado de `users.json` y en el mismo volumen
compartido con el hub: la cuenta y su rol tienen que significar lo mismo entren
por el dominio que entren.

CADA ROL ES DE UN LOCAL. Este archivo es compartido --el hub y todos los
paneles leen el mismo-- asi que un rol sin dueño seria un rol que el dueño de
un local le ve (y le puede borrar) al vecino. Cada rol guarda el `local` donde
se creo; `de_local` es lo que se ofrece y lo que se deja tocar. Ojo: el
PERMISO no se filtra por local (`buscar`, `modulos_de`): si una cuenta tiene
ese rol, tiene que funcionar entre en el panel que entre, o se quedaria sin
poder hacer nada sin que nada lo explique.

UN ROL ES UNA LISTA DE MODULOS, y nada más. No hay permisos sueltos por
pantalla ni por botón: si el rol tiene "inventario", entra a Inventario y hace
lo que se hace en Inventario. Se eligió así porque es lo que el dueño puede
decidir sin equivocarse --"el mesonero ve el punto de venta y la cocina, nada
más"-- y porque es lo que se puede MOSTRAR: la pantalla de Usuarios lista los
módulos de cada rol, que es la pregunta que se hace quien reparte llaves.

Lo que el rol no nombra, no lo puede tocar: la comprobación es `permisos.
permitido`, en el middleware, y niega por defecto.
"""
from __future__ import annotations

import json
import re
import threading
from pathlib import Path

from .. import settings
from . import archivo

RUTA = Path(settings.SHARED_DIR) / "roles.json"

_lock = threading.RLock()
_RE_ID = re.compile(r"^[a-z0-9._-]{3,32}$")


class ErrorRoles(ValueError):
    """Falla de validacion que el router traduce a un 400 con mensaje util."""


def _documento() -> dict:
    """El archivo entero: los roles a medida y los recortes de los de fabrica."""
    try:
        d = json.loads(RUTA.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return d if isinstance(d, dict) else {}


def _leer() -> list[dict]:
    roles = _documento().get("roles")
    return [r for r in (roles or []) if isinstance(r, dict) and r.get("id")]


def _leer_ajustes() -> list[dict]:
    ajustes = _documento().get("ajustes")
    return [a for a in (ajustes or []) if isinstance(a, dict) and a.get("rol")]


def _guardar(roles: list[dict] | None = None, ajustes: list[dict] | None = None) -> None:
    """Escribe sin pisar la otra mitad del archivo."""
    doc = _documento()
    if roles is not None:
        doc["roles"] = roles
    if ajustes is not None:
        doc["ajustes"] = ajustes
    doc.setdefault("roles", [])
    RUTA.parent.mkdir(parents=True, exist_ok=True)
    tmp = RUTA.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    archivo.reemplazar(tmp, RUTA)


def listar() -> list[dict]:
    """TODOS los roles a medida del despliegue. Solo para Vertigo; para
    ofrecerlos dentro de un local, `de_local`."""
    with _lock:
        return _leer()


def de_local(local: str | None) -> list[dict]:
    """Los roles a medida de ESE local.

    Uno sin `local` no es de ninguno --se creo desde el hub, o antes de que los
    roles tuvieran dueño-- y solo lo ve Vertigo: ante la duda, lo menos.
    """
    if not local:
        return []
    return [r for r in listar() if r.get("local") == local]


def es_de_local(rol_id: str | None, local: str | None) -> bool:
    rol = buscar(rol_id)
    return bool(rol and local and rol.get("local") == local)


def buscar(rol_id: str | None) -> dict | None:
    objetivo = (rol_id or "").strip().lower()
    if not objetivo:
        return None
    return next((r for r in listar() if r["id"] == objetivo), None)


def existe(rol_id: str | None) -> bool:
    return buscar(rol_id) is not None


def modulos_de(rol_id: str | None) -> tuple[str, ...]:
    """Los modulos de un rol a medida. Vacio si no existe: sin modulos no se
    puede hacer nada, que es la respuesta segura ante un rol desconocido."""
    rol = buscar(rol_id)
    return tuple(rol.get("modulos") or ()) if rol else ()


# ── Los recortes de los roles de fabrica ────────────────────────────────────
#
# Un rol de fabrica no se reescribe: se guarda APARTE con que modulos lo dejo
# ESTE local. Asi "Caja" sigue significando lo mismo en el codigo y en los
# otros locales, el recorte se puede deshacer entero, y el archivo compartido
# no mezcla los ajustes de un local con los de otro.


def ajuste(rol: str | None, local: str | None) -> tuple[str, ...] | None:
    """Con que modulos dejo este local ese rol de fabrica. None = sin tocar."""
    r = (rol or "").strip().lower()
    if not r or not local:
        return None
    for a in _leer_ajustes():
        if a.get("rol") == r and a.get("local") == local:
            return tuple(a.get("modulos") or ())
    return None


def ajustar(rol: str, local: str | None, modulos: list[str],
            validos: tuple[str, ...]) -> tuple[str, ...]:
    if not local:
        raise ErrorRoles("Un rol de fabrica se ajusta desde el panel de un local.")
    limpios = [m for m in dict.fromkeys(modulos or []) if m in validos]
    if not limpios:
        raise ErrorRoles("Elige al menos un modulo al que pueda entrar.")
    with _lock:
        otros = [a for a in _leer_ajustes()
                 if not (a.get("rol") == rol and a.get("local") == local)]
        _guardar(ajustes=otros + [{"rol": rol, "local": local, "modulos": limpios}])
    return tuple(limpios)


def restaurar(rol: str, local: str | None) -> bool:
    """Deja el rol como viene de fabrica. False si no estaba tocado."""
    with _lock:
        ajustes = _leer_ajustes()
        quedan = [a for a in ajustes
                  if not (a.get("rol") == rol and a.get("local") == local)]
        if len(quedan) == len(ajustes):
            return False
        _guardar(ajustes=quedan)
        return True


def crear(rol_id: str, nombre: str, descripcion: str, modulos: list[str],
          reservados: tuple[str, ...], validos: tuple[str, ...],
          local: str | None = None) -> dict:
    """Da de alta un rol. `reservados` son los nombres de fabrica y `validos`
    los modulos que existen; los dos los pone `permisos`, para no tener que
    importarlo desde aqui y armar un ciclo. `local` es de quien es el rol."""
    rol_id = (rol_id or "").strip().lower().replace(" ", "-")
    nombre = (nombre or "").strip()
    if not _RE_ID.match(rol_id):
        raise ErrorRoles(
            "El identificador va en minusculas, sin espacios ni acentos, de 3 a 32 caracteres."
        )
    if rol_id in reservados:
        raise ErrorRoles(f"«{rol_id}» es uno de los roles de fabrica: elige otro nombre.")
    if not nombre:
        raise ErrorRoles("El rol necesita un nombre.")

    limpios = [m for m in dict.fromkeys(modulos or []) if m in validos]
    if not limpios:
        raise ErrorRoles("Elige al menos un modulo al que pueda entrar.")

    with _lock:
        roles = _leer()
        if any(r["id"] == rol_id for r in roles):
            raise ErrorRoles(f"Ya existe un rol «{rol_id}».")
        rol = {"id": rol_id, "nombre": nombre, "descripcion": descripcion.strip(),
               "modulos": limpios, "local": local or ""}
        roles.append(rol)
        _guardar(roles)
        return rol


def actualizar(rol_id: str, nombre: str, descripcion: str, modulos: list[str],
               validos: tuple[str, ...]) -> dict:
    limpios = [m for m in dict.fromkeys(modulos or []) if m in validos]
    if not limpios:
        raise ErrorRoles("Elige al menos un modulo al que pueda entrar.")
    with _lock:
        roles = _leer()
        rol = next((r for r in roles if r["id"] == (rol_id or "").strip().lower()), None)
        if rol is None:
            raise ErrorRoles(f"No existe el rol «{rol_id}».")
        rol["nombre"] = (nombre or rol["nombre"]).strip()
        rol["descripcion"] = descripcion.strip()
        rol["modulos"] = limpios
        _guardar(roles)
        return rol


def borrar(rol_id: str, en_uso: bool) -> None:
    """Borra un rol a medida. `en_uso` lo calcula el router mirando las
    cuentas: dejar cuentas con un rol que ya no existe las dejaria sin poder
    hacer nada y sin decir por que."""
    objetivo = (rol_id or "").strip().lower()
    if en_uso:
        raise ErrorRoles(
            "Hay cuentas con este rol. Cambialas de rol primero y vuelve a borrarlo."
        )
    with _lock:
        roles = _leer()
        quedan = [r for r in roles if r["id"] != objetivo]
        if len(quedan) == len(roles):
            raise ErrorRoles(f"No existe el rol «{objetivo}».")
        _guardar(quedan)
