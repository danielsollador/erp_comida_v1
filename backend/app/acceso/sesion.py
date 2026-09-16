"""Sesiones del ERP: firmadas, no guardadas.

Una sesion FIRMADA no se guarda en ninguna parte: el token lleva dentro quien
eres, tu rol y hasta cuando vale, mas una firma que solo se puede producir con
el secreto compartido. Cualquier proceso que tenga ese secreto la valida sin
consultar nada. Por eso una misma sesion sirve en el panel del local y en el
hub del dominio raiz, y por eso un redespliegue no echa a nadie.

Lo que se pierde es poder revocarla antes de que caduque. Se resuelve con una
GENERACION por usuario, guardada en users.json: el token lleva la generacion
con la que se emitio y al validarlo se compara con la actual. Cambiar la clave
o borrar al usuario la sube, y todos sus tokens anteriores mueren en el acto.

EL PASE. Sirve para pasar del hub (vertigopro.tech) al panel del local
(savora.vertigopro.tech) sin volver a poner la clave y SIN una cookie comun a
todos los subdominios -- con esa, abrir el enlace directo del panel entraria
sin pedir nada. El pase dura un minuto, vale para UN local y se gasta UNA vez;
el panel de destino lo cambia por su propia cookie.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import secrets
import threading
import time
from pathlib import Path

from .. import settings

log = logging.getLogger("erp.sesion")

# Doce horas: una jornada larga de restaurante. Se renueva sola al usarla.
TTL = 12 * 60 * 60
# Cuatro horas sin tocarla y caduca aunque no haya pasado la jornada.
INACTIVIDAD = 4 * 60 * 60
# Un pase viaja en la URL y queda en el historial: por eso dura un minuto.
PASE_TTL = 60


def _dir_compartido() -> Path:
    return Path(settings.SHARED_DIR)


def _secreto() -> bytes:
    """La clave con la que se firman los tokens.

    Del entorno si esta (`ERP_SESSION_SECRET`), y si no de un archivo en la
    carpeta compartida que se crea la primera vez. Las dos vias tienen que dar
    lo MISMO en el hub y en el panel, o un pase emitido en uno no vale en el
    otro. En Docker la carpeta es un volumen compartido por ambos.
    """
    del_entorno = settings.SESSION_SECRET
    if del_entorno:
        return del_entorno.encode("utf-8")

    carpeta = _dir_compartido()
    archivo = carpeta / "session_secret"
    try:
        if archivo.exists():
            valor = archivo.read_text(encoding="utf-8").strip()
            if valor:
                return valor.encode("utf-8")
        carpeta.mkdir(parents=True, exist_ok=True)
        valor = secrets.token_urlsafe(48)
        archivo.write_text(valor, encoding="utf-8")
        try:
            archivo.chmod(0o600)
        except OSError:
            pass  # Windows y algunos volumenes no lo soportan.
        log.info("secreto de sesion creado en %s", archivo)
        return valor.encode("utf-8")
    except OSError as e:
        log.error(
            "no se pudo leer ni crear el secreto de sesion (%s). Las sesiones "
            "NO sobreviviran a un reinicio ni valdran entre hub y panel. "
            "Define ERP_SESSION_SECRET en el entorno.", e)
        return _SECRETO_DE_EMERGENCIA


_SECRETO_DE_EMERGENCIA = secrets.token_urlsafe(48).encode("utf-8")
_CLAVE: bytes | None = None


def clave() -> bytes:
    global _CLAVE
    if _CLAVE is None:
        _CLAVE = _secreto()
    return _CLAVE


def _b64(datos: bytes) -> str:
    return base64.urlsafe_b64encode(datos).decode("ascii").rstrip("=")


def _desb64(texto: str) -> bytes:
    return base64.urlsafe_b64decode(texto + "=" * (-len(texto) % 4))


def _firmar(cuerpo: dict) -> str:
    crudo = _b64(json.dumps(cuerpo, separators=(",", ":")).encode("utf-8"))
    firma = hmac.new(clave(), crudo.encode("ascii"), hashlib.sha256).digest()
    return f"{crudo}.{_b64(firma)}"


def emitir(usuario: str, rol: str, generacion: int = 0) -> str:
    """El token de sesion. Las credenciales ya se validaron antes."""
    ahora = int(time.time())
    return _firmar({"u": usuario, "r": rol, "g": generacion,
                    "iat": ahora, "exp": ahora + TTL})


_LOCK_PASES = threading.Lock()
# Pases ya gastados, hasta que caduquen. No hace falta que sobreviva a un
# reinicio: un pase dura un minuto y el reinicio invalida los que hubiera.
_GASTADOS: dict[str, float] = {}


def emitir_pase(usuario: str, rol: str, local: str, generacion: int = 0) -> str:
    """Un pase para entrar a UN local, valido un minuto y una sola vez."""
    ahora = int(time.time())
    return _firmar({"u": usuario, "r": rol, "g": generacion, "m": local,
                    "iat": ahora, "exp": ahora + PASE_TTL, "t": "pase",
                    # Identificador aleatorio para poder marcarlo como gastado:
                    # sin el, dos pases del mismo usuario en el mismo segundo
                    # serian el mismo texto y gastar uno anularia el otro.
                    "n": secrets.token_urlsafe(9)})


def canjear_pase(pase: str | None, local: str, generacion_actual=None) -> dict | None:
    """Valida el pase y lo GASTA. Devuelve la sesion, o None.

    Comprueba tambien que sea para ESTE local: un pase para otro local no se
    canjea aqui aunque la firma sea buena.
    """
    datos = leer(pase, generacion_actual, tipo="pase")
    if datos is None or datos.get("local") != local:
        return None

    ahora = time.time()
    with _LOCK_PASES:
        for k, cuando in list(_GASTADOS.items()):
            if ahora - cuando > PASE_TTL * 2:
                _GASTADOS.pop(k, None)
        nonce = datos.get("nonce")
        if not nonce or nonce in _GASTADOS:
            return None
        _GASTADOS[nonce] = ahora
    return datos


def leer(token: str | None, generacion_actual=None,
         tipo: str | None = None) -> dict | None:
    """Devuelve los datos del token si vale, y None si no.

    `generacion_actual` es una funcion que recibe el usuario y devuelve su
    generacion. Se pasa como parametro para que este modulo no dependa del de
    usuarios y no haya un ciclo de importacion.
    """
    if not token or "." not in token:
        return None
    crudo, _, firma_recibida = token.partition(".")

    # Comparacion en tiempo constante: con `==` el tiempo de respuesta filtra
    # cuantos bytes iniciales acerto quien esta probando firmas.
    esperada = _b64(hmac.new(clave(), crudo.encode("ascii"),
                             hashlib.sha256).digest())
    if not hmac.compare_digest(esperada, firma_recibida):
        return None

    try:
        cuerpo = json.loads(_desb64(crudo))
    except (ValueError, json.JSONDecodeError):
        return None

    # UN PASE NO ES UNA SESION. Los dos los firma el mismo secreto, asi que sin
    # esto un pase (un minuto, un local) serviria como cookie de doce horas, y
    # una sesion valdria como pase para cualquier local.
    if cuerpo.get("t") != tipo:
        return None

    ahora = time.time()
    if ahora > cuerpo.get("exp", 0):
        return None
    # La inactividad se mide contra la emision porque el token se vuelve a
    # emitir en cada peticion que lo usa (ver `hay_que_renovar`).
    if tipo is None and ahora - cuerpo.get("iat", 0) > INACTIVIDAD:
        return None

    usuario = cuerpo.get("u")
    if not usuario:
        return None
    if generacion_actual is not None:
        actual = generacion_actual(usuario)
        # None = el usuario ya no existe. Su token no vale.
        if actual is None or actual != cuerpo.get("g", 0):
            return None

    return {"usuario": usuario, "rol": cuerpo.get("r", "cocina"),
            "generacion": cuerpo.get("g", 0), "emitido": cuerpo.get("iat", 0),
            "local": cuerpo.get("m"), "nonce": cuerpo.get("n")}


def hay_que_renovar(datos: dict) -> bool:
    """Si conviene volver a emitir el token en esta respuesta.

    No en cada peticion --el POS hace varias por pantalla-- sino cuando lleva
    mas de un cuarto de la ventana de inactividad. Quien esta trabajando no se
    cae nunca; quien dejo la pestaña abierta, si.
    """
    return time.time() - datos.get("emitido", 0) > INACTIVIDAD / 4
