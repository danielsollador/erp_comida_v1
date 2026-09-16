"""Usuarios del ERP: alta, baja, cambio de clave y verificacion.

Viven en `SHARED_DIR/users.json`, que en Docker es un volumen compartido entre
el panel del local y el hub: la misma cuenta entra por los dos dominios. Si no
hay ninguno, el aplicativo arranca en modo instalacion y pide crear el primero
desde el navegador en vez de quedar abierto.

Las claves se guardan con PBKDF2-HMAC-SHA256 (240.000 iteraciones, sal de 16
bytes por usuario). Biblioteca estandar a proposito: para un local con cinco
cuentas no compensa compilar bcrypt en la imagen.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import tempfile
import threading
import time
from pathlib import Path

from .. import settings
from . import permisos, roles

SHARED_DIR = Path(settings.SHARED_DIR)
USERS_FILE = SHARED_DIR / "users.json"

ITERACIONES = 240_000
LARGO_MINIMO = 8
ROLES = permisos.ROLES

_lock = threading.RLock()
# Un usuario es un identificador, no un nombre: sin espacios ni acentos.
_RE_USUARIO = re.compile(r"^[a-z0-9._-]{3,32}$")


class ErrorUsuarios(ValueError):
    """Falla de validacion que el router traduce a un 400 con mensaje util."""


class ErrorAlmacen(RuntimeError):
    """No se pudo escribir el archivo de usuarios. El router lo traduce a 503:
    no es culpa de quien llena el formulario, es el servidor el que no puede
    guardar (tipicamente, una carpeta montada con dueño root)."""


# --- hashing ---------------------------------------------------------------

def _derivar(clave: str, sal: bytes, iteraciones: int = ITERACIONES) -> str:
    return hashlib.pbkdf2_hmac("sha256", clave.encode("utf-8"), sal,
                               iteraciones).hex()


def _nuevo_hash(clave: str) -> dict:
    sal = secrets.token_bytes(16)
    return {"sal": sal.hex(), "hash": _derivar(clave, sal),
            "iteraciones": ITERACIONES}


def _coincide(clave: str, reg: dict) -> bool:
    try:
        sal = bytes.fromhex(reg["sal"])
    except (KeyError, ValueError):
        return False
    calculado = _derivar(clave, sal, int(reg.get("iteraciones", ITERACIONES)))
    return secrets.compare_digest(calculado, reg.get("hash", ""))


# --- persistencia ----------------------------------------------------------

def _ilegible() -> str | None:
    """Motivo por el que el archivo EXISTE y no se puede leer; None si no
    existe (instalacion pendiente) o se lee bien.

    Distinguirlos cierra un agujero real: si un fallo de permisos contara como
    "no hay usuarios", se reabriria la instalacion y cualquiera podria hacerse
    administrador. Un archivo ilegible deja el ERP CERRADO y dice por que.
    """
    if not USERS_FILE.exists():
        return None
    try:
        with USERS_FILE.open(encoding="utf-8") as f:
            d = json.load(f)
    except OSError as e:
        return _por_que_no_lee(e)
    except json.JSONDecodeError as e:
        return (f"El archivo de usuarios ({USERS_FILE}) esta corrupto: {e}. "
                f"Restauralo de un respaldo o borralo para volver a instalar.")
    if not isinstance(d.get("usuarios"), list):
        return (f"El archivo de usuarios ({USERS_FILE}) no tiene la forma "
                f"esperada. Restauralo de un respaldo o borralo para instalar.")
    return None


def _leer() -> dict:
    if not USERS_FILE.exists():
        return {"usuarios": []}
    try:
        with USERS_FILE.open(encoding="utf-8") as f:
            d = json.load(f)
        if not isinstance(d.get("usuarios"), list):
            return {"usuarios": []}
        return d
    except (json.JSONDecodeError, OSError):
        # Vacio para que NADIE entre con un archivo ilegible. La instalacion no
        # se reabre porque `hay_usuarios` mira si el archivo existe.
        return {"usuarios": []}


def _guardar(d: dict) -> None:
    """Escritura atomica: temporal y `replace`, para que un corte a mitad no
    borre a todos los usuarios."""
    try:
        USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(USERS_FILE.parent), suffix=".tmp")
    except OSError as e:
        raise ErrorAlmacen(_por_que_no_escribe(e)) from e
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
        os.replace(tmp, USERS_FILE)
        try:
            os.chmod(USERS_FILE, 0o600)
        except OSError:
            pass
    except OSError as e:
        raise ErrorAlmacen(_por_que_no_escribe(e)) from e
    finally:
        try:
            if os.path.exists(tmp):
                os.unlink(tmp)
        except OSError:
            pass


def _como_arreglarlo() -> str:
    return (f"docker compose exec -u root backend chown -R 10001:10001 "
            f"{USERS_FILE.parent}")


def _por_que_no_escribe(e: OSError) -> str:
    return (f"El servidor no puede escribir en {USERS_FILE.parent} "
            f"({e.strerror}). Esa carpeta tiene que pertenecer al usuario del "
            f"contenedor. En el servidor: {_como_arreglarlo()}")


def _por_que_no_lee(e: OSError) -> str:
    return (f"El servidor no puede LEER el archivo de usuarios ({USERS_FILE}): "
            f"{e.strerror}. Suele ser que quedo de root y el contenedor corre "
            f"sin privilegios. En el servidor: {_como_arreglarlo()}")


def problema_almacen() -> str | None:
    """Motivo por el que no se podria guardar NI LEER, o None si todo bien.
    Se consulta ANTES de pedirle nada a nadie."""
    ilegible = _ilegible()
    if ilegible:
        return ilegible
    try:
        USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(USERS_FILE.parent), suffix=".probe")
    except OSError as e:
        return _por_que_no_escribe(e)
    os.close(fd)
    try:
        os.unlink(tmp)
    except OSError:
        pass
    return None


# --- validacion ------------------------------------------------------------

def _norm(usuario: str | None) -> str:
    return (usuario or "").strip().lower()


def _validar_usuario(usuario: str) -> str:
    u = _norm(usuario)
    if not _RE_USUARIO.match(u):
        raise ErrorUsuarios(
            "El usuario debe tener entre 3 y 32 caracteres y solo letras "
            "minusculas, numeros, punto, guion o guion bajo.")
    return u


def _validar_clave(clave: str) -> str:
    if not clave or len(clave) < LARGO_MINIMO:
        raise ErrorUsuarios(
            f"La clave debe tener al menos {LARGO_MINIMO} caracteres.")
    return clave


def _validar_rol(rol: str | None) -> str:
    """Los cuatro de fabrica y los que el dueño haya creado (ver `roles.py`).

    Se consulta la lista viva y no una constante: un rol a medida creado hoy
    tiene que poder asignarse hoy.
    """
    r = (rol or "").strip().lower()
    validos = tuple(ROLES) + tuple(x["id"] for x in roles.listar())
    if r not in validos:
        raise ErrorUsuarios(f"Rol invalido. Debe ser uno de: {', '.join(validos)}")
    return r


def _buscar(d: dict, usuario: str) -> dict | None:
    return next((x for x in d["usuarios"] if x["usuario"] == usuario), None)


# --- API del modulo --------------------------------------------------------

def hay_usuarios() -> bool:
    """False = instalacion pendiente. Un archivo que EXISTE cuenta como "hay
    usuarios" aunque no se pueda leer: cerrado y diciendo por que es el lado
    correcto en el que equivocarse."""
    with _lock:
        if USERS_FILE.exists():
            return True
        return bool(_leer()["usuarios"])


def listar() -> list[dict]:
    """Sin hashes ni sales: esto viaja al navegador."""
    with _lock:
        return [{"usuario": u["usuario"], "rol": u.get("rol", "admin"),
                 "locales": u.get("locales", []),
                 "creado": u.get("creado"),
                 "ultimo_acceso": u.get("ultimo_acceso")}
                for u in _leer()["usuarios"]]


def crear(usuario: str, clave: str, rol: str = "admin",
          locales: list[str] | None = None) -> dict:
    """Crea un usuario. `locales` es la lista de locales que puede ver; VACIA
    significa todos (el caso del dueño y del primer usuario)."""
    u = _validar_usuario(usuario)
    _validar_clave(clave)
    rol = _validar_rol(rol)
    # Solo el equipo de Vertigo puede existir sin local asignado (ve todos).
    # Un dueño, una cajera o un cocinero SIN local no tendria a donde entrar,
    # y peor: con la regla vieja de "vacio = todos" veria los locales ajenos.
    if rol != "admin" and not locales:
        raise ErrorUsuarios(
            f"Un usuario con rol «{rol}» necesita al menos un local asignado.")
    with _lock:
        d = _leer()
        if _buscar(d, u):
            raise ErrorUsuarios(f"El usuario «{u}» ya existe.")
        reg = {"usuario": u, "rol": rol, "locales": list(locales or []),
               "creado": int(time.time()), "ultimo_acceso": None,
               **_nuevo_hash(clave)}
        d["usuarios"].append(reg)
        _guardar(d)
    return {"usuario": u, "rol": rol, "locales": list(locales or [])}


def verificar(usuario: str | None, clave: str | None) -> dict | None:
    """El usuario si la pareja es valida, o None.

    Cuando el usuario no existe igual se deriva un hash contra una sal de
    descarte: si se cortara antes, midiendo tiempos se descubriria que nombres
    existen.
    """
    u = _norm(usuario)
    with _lock:
        d = _leer()
        reg = _buscar(d, u)
        if reg is None:
            _derivar(clave or "", b"\x00" * 16)
            return None
        if not _coincide(clave or "", reg):
            return None
        reg["ultimo_acceso"] = int(time.time())
        try:
            _guardar(d)
        except ErrorAlmacen:
            pass  # anotar la hora es cosmetico; entrar no.
        return {"usuario": reg["usuario"], "rol": reg.get("rol", "admin")}


def marcar_acceso(usuario: str) -> None:
    u = _norm(usuario)
    try:
        with _lock:
            d = _leer()
            reg = _buscar(d, u)
            if reg is None:
                return
            reg["ultimo_acceso"] = int(time.time())
            _guardar(d)
    except (ErrorAlmacen, OSError):
        pass


def generacion(usuario: str | None) -> int | None:
    """La generacion del usuario, o None si no existe. Es lo que permite
    invalidar sesiones firmadas sin guardar ninguna."""
    u = _norm(usuario)
    if not u:
        return None
    reg = _buscar(_leer(), u)
    return None if reg is None else int(reg.get("generacion", 0))


def rol_de(usuario: str | None) -> str | None:
    reg = _buscar(_leer(), _norm(usuario))
    return None if reg is None else reg.get("rol", "admin")


def locales_de(usuario: str | None) -> list[str] | None:
    """Los slugs asignados; [] = todos; None = el usuario no existe."""
    reg = _buscar(_leer(), _norm(usuario))
    return None if reg is None else list(reg.get("locales") or [])


def puede_ver(usuario: str | None, local: str) -> bool:
    """Si esta persona tiene permitido el panel de ESTE local.

    Se comprueba en el backend del local, no en la pantalla que elige: cada
    local tiene su dominio y escribirlo a mano se salta cualquier pantalla.
    Lista VACIA = todos los locales.
    """
    reg = _buscar(_leer(), _norm(usuario))
    if reg is None:
        return False
    # El equipo de Vertigo ve todos los locales por su rol, sin que haya que
    # asignarle nada: una lista que mantener a mano se queda corta el dia que
    # entra un local nuevo. Para el resto, solo lo asignado.
    if permisos.es_vertigo(reg.get("rol")):
        return True
    return local in (reg.get("locales") or [])


def asignar_locales(usuario: str, locales: list[str]) -> dict:
    u = _norm(usuario)
    limpios: list[str] = []
    for m in locales or []:
        m = str(m).strip()
        if m and m not in limpios:
            limpios.append(m)
    with _lock:
        d = _leer()
        reg = _buscar(d, u)
        if reg is None:
            raise ErrorUsuarios(f"No existe el usuario «{u}».")
        reg["locales"] = limpios
        _guardar(d)
    return {"usuario": u, "rol": reg.get("rol", "admin"), "locales": limpios}


def cambiar_rol(usuario: str, rol: str) -> dict:
    """No deja bajar al ultimo administrador: un ERP sin nadie que lo
    administre solo se arregla entrando al servidor."""
    u = _norm(usuario)
    rol = _validar_rol(rol)
    with _lock:
        d = _leer()
        reg = _buscar(d, u)
        if reg is None:
            raise ErrorUsuarios(f"No existe el usuario «{u}».")
        if reg.get("rol") == "admin" and rol != "admin":
            admins = [x for x in d["usuarios"] if x.get("rol") == "admin"]
            if len(admins) <= 1:
                raise ErrorUsuarios(
                    "Es el unico administrador. Nombra a otro antes de "
                    "cambiarle el rol.")
        if rol != "admin" and not reg.get("locales"):
            raise ErrorUsuarios(
                f"Para pasarlo a «{rol}» primero asignale un local: sin local "
                f"no tendria a donde entrar.")
        reg["rol"] = rol
        # Sube la generacion: un rol mas bajo no puede seguir usando la sesion
        # emitida con el rol de antes, porque el rol viaja DENTRO del token.
        reg["generacion"] = int(reg.get("generacion", 0)) + 1
        _guardar(d)
    return {"usuario": u, "rol": rol, "locales": reg.get("locales", [])}


def cambiar_clave(usuario: str, clave_nueva: str) -> None:
    u = _norm(usuario)
    _validar_clave(clave_nueva)
    with _lock:
        d = _leer()
        reg = _buscar(d, u)
        if reg is None:
            raise ErrorUsuarios(f"No existe el usuario «{u}».")
        reg.update(_nuevo_hash(clave_nueva))
        # Quien cambia su clave suele hacerlo porque cree que se la vieron:
        # todas sus sesiones anteriores dejan de valer.
        reg["generacion"] = int(reg.get("generacion", 0)) + 1
        _guardar(d)


def borrar(usuario: str) -> None:
    u = _norm(usuario)
    with _lock:
        d = _leer()
        reg = _buscar(d, u)
        if reg is None:
            raise ErrorUsuarios(f"No existe el usuario «{u}».")
        admins = [x for x in d["usuarios"] if x.get("rol", "admin") == "admin"]
        if reg.get("rol", "admin") == "admin" and len(admins) <= 1:
            raise ErrorUsuarios(
                "Es el ultimo administrador. Crea otro antes de borrar este.")
        d["usuarios"] = [x for x in d["usuarios"] if x["usuario"] != u]
        _guardar(d)


def sembrar_desde_entorno(usuario: str | None, clave: str | None) -> bool:
    """Si no hay usuarios y el entorno trae ERP_APP_USER/ERP_APP_PASSWORD, se
    crea ese primer administrador. Se llama una vez al arrancar."""
    if not clave or hay_usuarios():
        return False
    try:
        crear(usuario or "admin", clave, rol="admin")
        return True
    except (ErrorUsuarios, ErrorAlmacen):
        return False
