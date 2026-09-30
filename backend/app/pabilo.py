"""Pabilo: preguntarle al banco si un pago movil de verdad entro.

POR QUE EXISTE. Un cobro por pago movil era la palabra del cliente: mostraba
la pantalla de su banco, la cajera copiaba la referencia y listo. Una captura
retocada o una referencia de otro dia pasaban igual. Pabilo (pabilo.app) tiene
la cuenta bancaria del local conectada y responde, en segundos, si un
movimiento con esa referencia existe, cuanto fue y si ya se uso antes.

QUE HACE ESTE MODULO Y QUE NO. Solo habla con el API: arma la peticion, la
manda con la clave del servidor y traduce la respuesta --y sobre todo los
errores-- a algo que la pantalla del mostrador pueda mostrar. No guarda nada
ni decide si se cobra: eso es del router (`routers/pagos.py`), que ademas
conoce la tasa y el pedido.

LA CLAVE NO SALE DE AQUI. Pabilo la llama "secreto de servidor": con ella se
consultan movimientos de la cuenta y se gastan creditos. Va en el header desde
el backend y nunca al navegador.

COMO SE VERIFICA. La cuenta del local es Banco de Venezuela (personas), que
acepta el modo GENERIC con la sola referencia y el monto OPCIONAL. Se manda sin
monto a proposito: el banco devuelve cuanto entro y la comparacion contra lo
que se esperaba se hace aca, con tolerancia. Si se mandara el monto, un
cliente que pago Bs 1.234,50 por una cuenta de Bs 1.234,57 daria "monto no
valido" y la cajera no sabria si le faltaron siete centimos o mil bolivares.
Con el monto real en la mano, la pantalla dice exactamente cuanto entro.

CADA CONSULTA CUESTA UN CREDITO (la repetida de una misma referencia, cero).
Por eso el router comprueba primero en la base propia si la referencia ya se
uso, sin gastar.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx

from . import settings

log = logging.getLogger("erp.pabilo")

# Los codigos que Pabilo documenta (docs/errors). Se decide por `error`, nunca
# por `message`: el mensaje trae datos del intento y cambia sin aviso.
#
# Transitorios: el banco no respondio. Se le dice a la cajera que reintente
# o que cobre anotando la referencia, como antes.
REINTENTABLES = {
    "BANK_NOT_AVAILABLE",
    "BANK_TEMPORARILY_INACTIVE",
    "BANK_TOO_MANY_REQUESTS",
    "PROXY_ERROR",
    "SESSION_ALREADY_ACTIVE",
    "INTERNAL_ERROR",
    "internal_server_error",
}
# Algo que tiene que arreglar el dueno: sin creditos, clave del banco vencida.
# Reintentar no sirve y la cajera no puede hacer nada; se le avisa al dueno.
DEL_DUENO = {
    "NOT_ENOUGH_CREDITS",
    "PLAN_IS_NOT_ACTIVE",
    "REQUEST_LIMIT_REACHED",
    "API_KEY_MONTHLY_CREDIT_LIMIT_EXCEEDED",
    "CLIENT_MONTHLY_CREDIT_LIMIT_EXCEEDED",
    "USER_BANCK_BAD_PASSWORD",
    "USER_BANCK_PASSWORD_EXPIRED",
    "USER_BANCK_BLOCKED",
    "USER_BANCK_BAD_API_KEY",
    "USER_BANK_IS_DISABLED",
    "USER_BANCK_NOT_FOUND",
    "UNAUTHORIZED",
    "FORBIDDEN",
    "USER_IS_NOT_ACTIVE",
    "MISSING_CONFIG",
}

# Lo que ve la cajera por cada codigo. Corto y en su idioma: esto sale en el
# cuadro de cobro, con el cliente delante.
#
# SIN NOMBRAR A PABILO. La integracion es de Vertigo; el local ve "la
# verificacion de pagos" y a quien tiene que avisar: a Vertigo si es cosa de
# creditos o de la clave (que son de Vertigo), o a Configuracion > Pago movil
# si es la clave del banco, que la maneja el dueño (Leider, 29-sep).
MENSAJES = {
    "PAYMENT_NOT_FOUND": "El banco no encuentra ningún pago con esa referencia. Revisa los dígitos o espera un momento: a veces tarda en reflejarse.",
    "PAYMENT_AMOUNT_NOT_VALID": "La referencia existe pero el monto no coincide.",
    "PAYMENT_ALREADY_EXISTS": "Ese pago ya se usó para cobrar otra cuenta.",
    "IS_NOT_POSITIVE_PAYMENT": "Esa referencia es de un pago que SALIÓ de la cuenta, no de uno que entró.",
    "IS_NOT_POSITIVE_AMOUNT": "El monto tiene que ser mayor a cero.",
    "BAD_REQUEST": "Faltan datos para consultar ese pago.",
    "NOT_ENOUGH_CREDITS": "Se agotaron las consultas de verificación. Avísale a Vertigo; mientras, cobra anotando la referencia.",
    "PLAN_IS_NOT_ACTIVE": "La verificación de pagos está suspendida. Avísale a Vertigo; mientras, cobra anotando la referencia.",
    "REQUEST_LIMIT_REACHED": "Se agotó la cuota de consultas por este período. Avísale a Vertigo.",
    "API_KEY_MONTHLY_CREDIT_LIMIT_EXCEEDED": "Se alcanzó el tope mensual de consultas. Avísale a Vertigo.",
    "CLIENT_MONTHLY_CREDIT_LIMIT_EXCEEDED": "Se alcanzó el tope mensual de consultas. Avísale a Vertigo.",
    "USER_BANCK_BAD_PASSWORD": "La clave del banco ya no sirve. Hay que actualizarla en Configuración › Pago móvil.",
    "USER_BANCK_PASSWORD_EXPIRED": "El banco pide cambiar la clave. Cámbiala en el banco y luego en Configuración › Pago móvil.",
    "USER_BANCK_BLOCKED": "El banco bloqueó el usuario de la cuenta. Hay que desbloquearlo con el banco.",
    "USER_BANCK_BAD_API_KEY": "La credencial del banco no es válida. Revísala en Configuración › Pago móvil.",
    "USER_BANK_IS_DISABLED": "Esa cuenta bancaria está en pausa. Avísale a Vertigo.",
    "USER_BANCK_NOT_FOUND": "La cuenta bancaria configurada ya no existe. Elige otra en Configuración › Pago móvil.",
    "UNAUTHORIZED": "La verificación de pagos no está autorizada para este local. Avísale a Vertigo.",
    "FORBIDDEN": "La verificación de pagos no tiene permiso en este local. Avísale a Vertigo.",
    "BANK_NOT_AVAILABLE": "El banco no respondió. Intenta otra vez en un momento.",
    "BANK_TEMPORARILY_INACTIVE": "El banco está caído en este momento.",
    "BANK_TOO_MANY_REQUESTS": "El banco está limitando las consultas. Espera unos segundos.",
    "PROXY_ERROR": "Falló la conexión con el banco. Intenta otra vez.",
    "SESSION_ALREADY_ACTIVE": "Hay otra consulta en curso contra el banco. Espera unos segundos.",
    "SIN_CONEXION": "No se pudo llegar al verificador de pagos. Revisa la conexión a internet.",
    "TIEMPO_AGOTADO": "El banco tardó demasiado en responder.",
}


class PabiloNoConfigurado(RuntimeError):
    """No hay clave: el ERP sigue cobrando como siempre, sin verificar."""


class PabiloError(RuntimeError):
    """Pabilo dijo que no (o no respondio) en una operacion de configuracion:
    crear una cuenta, cambiarle la clave. Lleva el codigo documentado y un
    mensaje ya en el idioma del dueño."""

    def __init__(self, codigo: str, mensaje: str, status: int = 502):
        super().__init__(mensaje)
        self.codigo = codigo
        self.mensaje = mensaje
        self.status = status


# ── Lo guardado desde la pantalla ───────────────────────────────────────────
#
# El dueño pega la clave y elige la cuenta en Configuracion > Pago movil; el
# router lo guarda en la base y lo deja aqui al arrancar y cada vez que
# cambia. Pisa a las variables del servidor (.env), que siguen valiendo de
# respaldo para un despliegue que las tenga.
_ajuste: dict[str, str] = {"clave": "", "cuenta": ""}


def ajustar(clave: Optional[str] = None, cuenta: Optional[str] = None) -> None:
    """Fija lo guardado en la base. None = no tocar ese campo."""
    global _cache_cuentas
    if clave is not None and clave.strip() != _ajuste["clave"]:
        _ajuste["clave"] = clave.strip()
        # Otra clave, otras cuentas: lo cacheado ya no vale.
        _cache_cuentas = (0.0, [])
    if cuenta is not None:
        _ajuste["cuenta"] = cuenta.strip()


def clave() -> str:
    return _ajuste["clave"] or settings.PABILO_API_KEY


def origen_clave() -> str:
    if _ajuste["clave"]:
        return "pantalla"
    return "servidor" if settings.PABILO_API_KEY else ""


def cuenta_configurada() -> str:
    return _ajuste["cuenta"] or settings.PABILO_USER_BANK_ID


@dataclass
class Cuenta:
    """La cuenta bancaria conectada, con lo que la pantalla necesita saber."""

    id: str
    descripcion: str
    banco: str  # plataforma de Pabilo: banco_venezuela, mercantil...
    moneda: str
    # Los nombres de campo del API que el banco exige (REFERENCE_NUMBER,
    # PHONE_ORIGIN...), del primer tipo de verificacion disponible.
    campos: list[str] = field(default_factory=list)
    tipo: str = "GENERIC"
    # Para la pantalla de configuracion: con que se conecto y como esta.
    proveedor: str = ""
    numero: str = ""
    telefono: str = ""
    deshabilitada: bool = False
    bloqueada: bool = False


@dataclass
class Respuesta:
    """Lo que dijo Pabilo, ya clasificado.

    `ok` es que el banco ENCONTRO el pago. No dice que el monto alcance: eso lo
    decide el router comparando `monto` con lo esperado.
    """

    ok: bool
    codigo: str = ""  # el `error` de Pabilo, o "" si salio bien
    mensaje: str = ""  # para la cajera
    detalle: str = ""  # el `message` crudo, para el registro
    monto: Optional[float] = None  # lo que de verdad entro, en Bs
    pabilo_id: str = ""  # user_bank_payment.id
    es_nuevo: bool = True
    credito_costo: int = 0
    creditos_restantes: Optional[int] = None
    referencia_banco: str = ""

    @property
    def reintentable(self) -> bool:
        return self.codigo in REINTENTABLES or self.codigo in ("SIN_CONEXION", "TIEMPO_AGOTADO")

    @property
    def del_dueno(self) -> bool:
        return self.codigo in DEL_DUENO


def configurado() -> bool:
    return bool(clave())


def _headers() -> dict[str, str]:
    if not clave():
        raise PabiloNoConfigurado("No hay clave de Pabilo: ni guardada ni en PABILO_API_KEY")
    return {
        "Authorization": f"Bearer {clave()}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _cliente() -> httpx.Client:
    # Con certificados verificados, siempre. Un `verify=False` aqui dejaria
    # pasar a cualquiera que se ponga en el medio a responder "pago confirmado".
    return httpx.Client(base_url=settings.PABILO_URL, timeout=settings.PABILO_TIMEOUT)


def _error_de(cuerpo: Any, status: int) -> tuple[str, str]:
    """(codigo, message) de una respuesta que no salio bien."""
    if isinstance(cuerpo, dict):
        codigo = str(cuerpo.get("error") or "").strip()
        mensaje = str(cuerpo.get("message") or cuerpo.get("detail") or "").strip()
        if codigo:
            return codigo, mensaje
    return f"HTTP_{status}", str(cuerpo)[:300]


# ── Cuentas ─────────────────────────────────────────────────────────────────

_cache_cuentas: tuple[float, list[Cuenta]] = (0.0, [])
# Listar cuentas no gasta creditos, pero tampoco hay que hacerlo en cada cobro:
# la lista cambia cuando el dueno conecta otro banco, no cada minuto.
CACHE_CUENTAS_SEG = 300


def cuentas(forzar: bool = False) -> list[Cuenta]:
    global _cache_cuentas
    marca, lista = _cache_cuentas
    if not forzar and lista and time.monotonic() - marca < CACHE_CUENTAS_SEG:
        return lista
    # Por `_get`, como todo lo demas: asi las pruebas lo reemplazan y nada
    # sale a internet, y un 401 llega como PabiloError y no como excepcion
    # de httpx.
    status, datos = _get("/me/usersbank")
    d = _o_error(status, datos)
    resultado: list[Cuenta] = []
    for b in (d.get("user_banks", []) if isinstance(d, dict) else []):
        if b.get("to_trash"):
            continue
        tipos = [t for t in b.get("verifications_types_available", []) if not t.get("hidden")]
        tipo = tipos[0] if tipos else {"id": "GENERIC", "fields_required": [{"name": "REFERENCE_NUMBER"}]}
        numero = str((b.get("default_bank_account") or {}).get("account_number") or "")
        telefono = str((b.get("user_bank_phone") or {}).get("number") or "")
        resultado.append(
            Cuenta(
                id=str(b.get("id", "")),
                descripcion=str(b.get("description") or ""),
                banco=str(b.get("platform") or b.get("provider") or ""),
                moneda=str(b.get("currency") or "VEF"),
                campos=[str(f.get("name")) for f in tipo.get("fields_required", [])],
                tipo=str(tipo.get("id") or "GENERIC"),
                proveedor=str(b.get("provider") or ""),
                # Solo el final: la pantalla lo muestra para distinguir dos
                # cuentas del mismo banco, no para copiarlo.
                numero=("…" + numero[-4:]) if len(numero) > 4 else numero,
                telefono=telefono,
                deshabilitada=bool(b.get("is_disabled")),
                bloqueada=bool(b.get("is_block_by_bank")),
            )
        )
    _cache_cuentas = (time.monotonic(), resultado)
    return resultado


def cuenta_activa() -> Cuenta:
    """La cuenta donde cobra el local: la configurada, o la unica que hay."""
    lista = cuentas()
    elegida = cuenta_configurada()
    if elegida:
        for c in lista:
            if c.id == elegida:
                return c
        raise LookupError(
            f"La cuenta {elegida} no esta entre las de la clave "
            f"({', '.join(c.descripcion or c.id for c in lista) or 'ninguna'}). "
            "Elige otra en Configuración > Pago móvil."
        )
    if len(lista) == 1:
        return lista[0]
    if not lista:
        raise LookupError("No hay ninguna cuenta bancaria conectada para verificar pagos.")
    raise LookupError(
        "Hay varias cuentas conectadas: elige la principal en Configuración › Pago móvil ("
        + ", ".join(c.descripcion or c.id for c in lista) + ")."
    )


def cuenta_por_id(user_bank_id: str) -> Cuenta:
    """La cuenta que la caja eligio para verificar, cuando el local tiene mas
    de una conectada. Tiene que existir y estar operativa."""
    for c in cuentas():
        if c.id == user_bank_id:
            if c.deshabilitada or c.bloqueada:
                raise LookupError("Esa cuenta está en pausa o bloqueada por el banco: elige otra.")
            return c
    raise LookupError("Esa cuenta ya no está conectada: elige otra.")


# ── Verificar ───────────────────────────────────────────────────────────────

# Campo de Pabilo -> parametro del body (docs/verify-fields).
_PARAMETRO = {
    "REFERENCE_NUMBER": "bank_reference",
    "BANK_CODE_ORIGIN": "bank_origin",
    "BANK_ACCOUNT_ORIGIN": "cuentaPagador",
    "PHONE_ORIGIN": "phone_pagador",
    "DNI_ORIGIN": "dni_pagador",
    "PAYMENT_DATE": "fecha_pago",
}


def armar_cuerpo(
    cuenta: Cuenta,
    referencia: str,
    *,
    monto: Optional[float] = None,
    telefono: str = "",
    cedula: str = "",
    banco_origen: str = "",
    fecha: str = "",
) -> dict[str, Any]:
    """El body de la verificacion, con lo que ESTE banco pide.

    Solo van los campos que la cuenta declara en `fields_required` mas el
    monto si se pide; mandar de mas no ayuda y mandar de menos da 400.
    """
    cuerpo: dict[str, Any] = {"bank_reference": referencia, "movement_type": cuenta.tipo}
    if monto is not None:
        cuerpo["amount"] = round(monto, 2)
    extras = {
        "PHONE_ORIGIN": telefono,
        "BANK_CODE_ORIGIN": banco_origen,
        "PAYMENT_DATE": fecha,
    }
    for campo in cuenta.campos:
        if campo == "DNI_ORIGIN" and cedula:
            letra, numero = _partir_cedula(cedula)
            cuerpo["dni_pagador"] = {"dni_type": letra, "dni_number": numero}
        elif campo in extras and extras[campo]:
            cuerpo[_PARAMETRO[campo]] = extras[campo]
    return cuerpo


def _partir_cedula(texto: str) -> tuple[str, str]:
    limpio = texto.replace(".", "").replace("-", "").replace(" ", "").upper()
    if limpio[:1] in ("V", "E", "J", "G", "P"):
        return limpio[0], limpio[1:]
    return "V", limpio


def _post(ruta: str, cuerpo: dict[str, Any]) -> tuple[int, Any]:
    """Una llamada al API. Separada para que las pruebas la reemplacen sin
    tocar internet ni gastar creditos."""
    with _cliente() as c:
        r = c.post(ruta, json=cuerpo, headers=_headers())
    try:
        return r.status_code, r.json()
    except ValueError:
        return r.status_code, r.text


def verificar(cuenta: Cuenta, cuerpo: dict[str, Any]) -> Respuesta:
    """Pregunta al banco por el pago y clasifica lo que responda."""
    try:
        status, datos = _post(f"/userbankpayment/{cuenta.id}/betaserio", cuerpo)
    except httpx.TimeoutException:
        return Respuesta(ok=False, codigo="TIEMPO_AGOTADO", mensaje=MENSAJES["TIEMPO_AGOTADO"])
    except httpx.HTTPError as e:
        log.warning("pabilo sin conexion: %s", e)
        return Respuesta(ok=False, codigo="SIN_CONEXION", mensaje=MENSAJES["SIN_CONEXION"], detalle=str(e)[:300])

    if 200 <= status < 300 and isinstance(datos, dict):
        # Dos formas de exito (docs): plano, o envuelto en `data` cuando la
        # referencia ya se habia verificado antes.
        d = datos.get("data") if isinstance(datos.get("data"), dict) else datos
        pago = d.get("user_bank_payment") or {}
        monto = pago.get("amount")
        try:
            monto = float(monto) if monto is not None else None
        except (TypeError, ValueError):
            monto = None
        creditos = d.get("user_credits_total")
        return Respuesta(
            ok=True,
            monto=monto,
            pabilo_id=str(pago.get("id") or ""),
            es_nuevo=bool(d.get("is_new", True)),
            credito_costo=int(d.get("credit_cost") or 0),
            creditos_restantes=int(creditos) if isinstance(creditos, (int, float)) else None,
            referencia_banco=str(pago.get("bank_reference_id") or ""),
            detalle=str(datos.get("message") or ""),
        )

    codigo, mensaje = _error_de(datos, status)
    log.info("pabilo %s: %s (%s)", status, codigo, mensaje[:200])
    return Respuesta(
        ok=False,
        codigo=codigo,
        mensaje=MENSAJES.get(codigo, f"El verificador respondió {codigo}."),
        detalle=mensaje[:300],
    )


# ── Configuracion desde la pantalla: perfil, catalogo y alta de cuentas ────
#
# Todo lo de abajo lo usa Configuracion > Pago movil (routers/pagos.py). Son
# las mismas llamadas que hace el panel web de Pabilo (docs/bank-accounts,
# docs/user): con la clave del local se pueden dar de alta cuentas, pausarlas,
# cambiarles la clave del banco y borrarlas, sin salir del ERP.


def _get(ruta: str, con_clave: bool = True) -> tuple[int, Any]:
    with _cliente() as c:
        r = c.get(ruta, headers=_headers() if con_clave else {"Accept": "application/json"})
    try:
        return r.status_code, r.json()
    except ValueError:
        return r.status_code, r.text


def _put(ruta: str, cuerpo: dict[str, Any]) -> tuple[int, Any]:
    with _cliente() as c:
        r = c.put(ruta, json=cuerpo, headers=_headers())
    try:
        return r.status_code, r.json()
    except ValueError:
        return r.status_code, r.text


def _delete(ruta: str) -> tuple[int, Any]:
    with _cliente() as c:
        r = c.delete(ruta, headers=_headers())
    try:
        return r.status_code, r.json()
    except ValueError:
        return r.status_code, r.text


def _o_error(status: int, datos: Any) -> Any:
    """Devuelve `datos` si salio bien; si no, levanta PabiloError con el
    codigo documentado y un mensaje para el dueño."""
    if 200 <= status < 300:
        return datos
    codigo, detalle = _error_de(datos, status)
    mensaje = MENSAJES.get(codigo)
    if not mensaje:
        mensaje = MENSAJES_CONFIG.get(codigo) or f"El verificador respondió {codigo}."
        if detalle and codigo not in MENSAJES_CONFIG:
            mensaje = f"{mensaje} {detalle[:160]}"
    raise PabiloError(codigo, mensaje, 400 if 400 <= status < 500 else 502)


def _llamar(fn, *args):
    """Una llamada de configuracion, con los errores de red ya traducidos."""
    try:
        status, datos = fn(*args)
    except httpx.TimeoutException:
        raise PabiloError("TIEMPO_AGOTADO", MENSAJES["TIEMPO_AGOTADO"])
    except httpx.HTTPError as e:
        log.warning("pabilo sin conexion: %s", e)
        raise PabiloError("SIN_CONEXION", MENSAJES["SIN_CONEXION"])
    return _o_error(status, datos)


# Errores propios de dar de alta o tocar cuentas (docs/bank-accounts).
MENSAJES_CONFIG = {
    "PASSWORD_CHANGE_TRY_TOO_FREQUENT": "Espera al menos 30 segundos entre intentos.",
    "PASSWORD_CHANGE_TOO_FREQUENT": "La clave ya se cambió hace menos de 30 minutos. Vuelve a intentar más tarde.",
    "BAD_REQUEST": "Faltan datos o hay alguno mal escrito. Revisa el formulario.",
    "VALIDATION_ERROR": "Faltan datos o hay alguno mal escrito. Revisa el formulario.",
}


def perfil() -> dict[str, Any]:
    """Quien es el dueño de la clave: nombre, plan y creditos (GET /me)."""
    d = _llamar(_get, "/me")
    if not isinstance(d, dict):
        raise PabiloError("RESPUESTA_RARA", "El verificador respondió algo que no se entiende.")
    # La doc lo muestra plano; el API real lo envuelve en `user` (29-sep). Se
    # aceptan los dos.
    if isinstance(d.get("user"), dict):
        d = d["user"]
    return {
        "id": str(d.get("id") or ""),
        "usuario": str(d.get("username") or ""),
        "empresa": str(d.get("company_name") or d.get("full_name") or ""),
        "creditos": d.get("credits"),
        "plan_activo": bool(d.get("plan_is_active", True)),
    }


# Con que se conecta cada proveedor (docs/bank-accounts, tabla "Proveedores
# soportados"). `usuario`/`clave` son los rotulos de los dos campos fijos del
# API (`username`, `password`); `metadata` lo que ese banco pide ademas.
PROVEEDORES: dict[str, dict[str, Any]] = {
    "VE_BAN": {
        "nombre": "Banco de Venezuela · personas",
        "usuario": "Usuario de BDV en línea",
        "clave": "Contraseña de BDV en línea",
        "ayuda": "La misma con la que entras a bdvenlinea. Se guarda cifrada y se usa solo para leer los movimientos de la cuenta.",
    },
    "VE_BAN_EMP_V2": {
        "nombre": "Banco de Venezuela · empresas (API de conciliación)",
        "usuario": "Número de cuenta (20 dígitos)",
        "clave": "API Key de conciliación automática",
        "ayuda": "La API Key se pide en BDV Empresas: Gestión de productos → Solicitud de API conciliación automática. Después aparece en Consultas → Conciliación automática.",
    },
    "MERCANTIL_EMP_V1": {
        "nombre": "Mercantil · empresas",
        "usuario": "Client ID",
        "clave": "Secret Key",
        "metadata": [
            {"clave": "INTEGRATOR_ID", "rotulo": "ID del integrador"},
            {"clave": "TERMINAL_ID", "rotulo": "ID del terminal"},
            {"clave": "MERCHANT_ID", "rotulo": "ID del comercio"},
        ],
    },
    "VE_BANESCO_V1": {
        "nombre": "Banesco · empresas",
        "usuario": "Client ID",
        "clave": "Client Secret",
        "metadata": [
            {"clave": "ACCOUNT_NUMBER", "rotulo": "Número de cuenta (20 dígitos, empieza por 0134)"},
            {"clave": "DEVICE_IP", "rotulo": "IP pública autorizada", "requerido": False},
        ],
    },
    "VE_BANK_PLAZA_V1": {
        "nombre": "Banco Plaza · empresas",
        "usuario": "Client ID",
        "clave": "Client Secret",
        "metadata": [
            {"clave": "ACCOUNT_NUMBER", "rotulo": "Número de cuenta (20 dígitos, empieza por 0138)"},
        ],
    },
    "BINANCE_APP": {
        "nombre": "Binance Pay",
        "usuario": "API Key de Binance",
        "clave": "Secret Key de Binance",
    },
    "BANK_TEST": {
        "nombre": "Banco de prueba (solo Vertigo)",
        "prueba": True,
        "ayuda": "No conecta con ningún banco. Sirve para probar el cobro: la referencia 67890 siempre sale aprobada.",
    },
    "NOTIFICATION_ACCOUNT": {
        "nombre": "Notificaciones del banco (SMS / app)",
        "telefono": True,
        "ayuda": "Para bancos sin conexión directa: un teléfono Android con la app de notificaciones que instala Vertigo lee los SMS o las notificaciones del banco.",
    },
}


def catalogo() -> list[dict[str, Any]]:
    """Los bancos que Pabilo conoce (GET /v1/platforms, publico)."""
    d = _llamar(_get, "/v1/platforms", False)
    return [p for p in (d if isinstance(d, list) else []) if isinstance(p, dict)]


def opciones_de_banco() -> list[dict[str, Any]]:
    """Lo que se ofrece en el desplegable de "Agregar cuenta": un renglon por
    proveedor que sabemos conectar, con los campos que pide."""
    plataformas = catalogo()
    opciones: list[dict[str, Any]] = []
    sin_conexion_directa: list[str] = []
    for p in plataformas:
        proveedores = [x for x in (p.get("providers") or []) if x in PROVEEDORES]
        if not proveedores:
            if p.get("is_bank") and (p.get("have_notification_sms") or p.get("have_notification_app")):
                sin_conexion_directa.append(str(p.get("name") or p.get("id")))
            continue
        for prov in proveedores:
            ficha = PROVEEDORES[prov]
            opciones.append(_opcion(prov, ficha, str(p.get("id") or ""), str(p.get("currency") or "VEF"),
                                    str(p.get("bank_code") or "")))
    ficha = PROVEEDORES["NOTIFICATION_ACCOUNT"]
    ayuda = ficha["ayuda"]
    if sin_conexion_directa:
        ayuda += " Sirve para: " + ", ".join(sin_conexion_directa[:8]) + "."
    opciones.append(_opcion("NOTIFICATION_ACCOUNT", {**ficha, "ayuda": ayuda}, "notificaciones", "VEF", ""))
    # Los de verdad primero, y entre ellos el mas comun en un local de comida
    # (BDV personas) de primero; el sandbox y las notificaciones al final.
    orden = list(PROVEEDORES)
    opciones.sort(key=lambda o: (
        o["prueba"] or o["proveedor"] == "NOTIFICATION_ACCOUNT",
        o["proveedor"] == "NOTIFICATION_ACCOUNT",
        orden.index(o["proveedor"]) if o["proveedor"] in orden else 99,
    ))
    return opciones


def _opcion(prov: str, ficha: dict[str, Any], banco: str, moneda: str, codigo: str) -> dict[str, Any]:
    campos: list[dict[str, Any]] = []
    if ficha.get("usuario"):
        campos.append({"clave": "usuario", "rotulo": ficha["usuario"], "requerido": True, "secreto": False})
    if ficha.get("clave"):
        campos.append({"clave": "clave", "rotulo": ficha["clave"], "requerido": True, "secreto": True})
    if ficha.get("telefono"):
        campos.append({"clave": "telefono", "rotulo": "Teléfono que recibe los pagos", "requerido": True, "secreto": False})
        campos.append({"clave": "cedula", "rotulo": "Cédula del titular", "requerido": True, "secreto": False})
    for m in ficha.get("metadata", []):
        campos.append({"clave": "metadata." + m["clave"], "rotulo": m["rotulo"],
                       "requerido": m.get("requerido", True), "secreto": False})
    return {
        "proveedor": prov,
        "banco": banco,
        "nombre": ficha["nombre"],
        "moneda": moneda,
        "codigo_banco": codigo,
        "prueba": bool(ficha.get("prueba")),
        "ayuda": ficha.get("ayuda", ""),
        "campos": campos,
    }


def crear_cuenta(
    proveedor: str,
    descripcion: str,
    *,
    usuario: str = "",
    clave_banco: str = "",
    metadata: Optional[dict[str, str]] = None,
    telefono: str = "",
    cedula: str = "",
) -> dict[str, Any]:
    """Da de alta una cuenta bancaria en Pabilo (POST /usersbank).

    Pabilo pide el `user_id` del dueño de la clave: se resuelve con GET /me
    para no obligar al dueño a copiarlo de ningun sitio.
    """
    global _cache_cuentas
    ficha = PROVEEDORES.get(proveedor)
    if not ficha:
        raise PabiloError("PROVEEDOR_DESCONOCIDO", f"No sé conectar con «{proveedor}».", 400)
    quien = perfil()
    cuerpo: dict[str, Any] = {
        "user_id": quien["id"],
        "bank_provider": proveedor,
        "description": descripcion.strip() or ficha["nombre"],
    }
    if ficha.get("usuario"):
        if not usuario.strip() or not clave_banco:
            raise PabiloError("FALTAN_DATOS", f"Hacen falta {ficha['usuario']} y {ficha['clave']}.", 400)
        cuerpo["username"] = usuario.strip()
        cuerpo["password"] = clave_banco
    if ficha.get("telefono"):
        digitos = "".join(ch for ch in telefono if ch.isdigit())
        if len(digitos) < 10 or not cedula.strip():
            raise PabiloError("FALTAN_DATOS", "Hacen falta el teléfono que recibe los pagos y la cédula del titular.", 400)
        cuerpo["user_bank_phone"] = {"countryCode": "58", "number": digitos[-10:]}
        letra, numero = _partir_cedula(cedula)
        cuerpo["user_bank_dni"] = {"dni_type": letra, "dni_number": numero}
    pares = []
    for m in ficha.get("metadata", []):
        valor = (metadata or {}).get(m["clave"], "").strip()
        if not valor:
            if m.get("requerido", True):
                raise PabiloError("FALTAN_DATOS", f"Hace falta {m['rotulo']}.", 400)
            continue
        pares.append({"key_name": m["clave"], "key_value": valor})
    if pares:
        cuerpo["metadata"] = pares
    d = _llamar(_post, "/usersbank", cuerpo)
    _cache_cuentas = (0.0, [])
    creada = d.get("usersbank") or d.get("user_bank") or d if isinstance(d, dict) else {}
    return {"id": str(creada.get("id") or ""), "mensaje": str(d.get("message") or "") if isinstance(d, dict) else ""}


def borrar_cuenta(user_bank_id: str) -> None:
    global _cache_cuentas
    _llamar(_delete, f"/usersbank/{user_bank_id}/to-trash")
    _cache_cuentas = (0.0, [])


def cambiar_secreto(user_bank_id: str, secreto: str) -> None:
    """Nueva clave del banco (o API key) con validacion en vivo: Pabilo la
    prueba contra el banco antes de guardarla. Cuesta 0,5 creditos si sirve."""
    global _cache_cuentas
    _llamar(_put, f"/v1/usersbank/{user_bank_id}/change-secret", {"secret": secreto})
    _cache_cuentas = (0.0, [])


# ── Vueltos por pago movil (docs/transaction-change) ─────────────────────────
#
# Pabilo emite un pago movil SALIENTE ("vuelto automatico", C2P) desde la
# cuenta del local al telefono del cliente. El banco solo lo permite a
# cuentas JURIDICAS (RIF J o G) con el servicio C2P contratado: una cuenta de
# persona natural (BDV personas) no puede, por regulacion. El ERP lo sabe
# por el proveedor con que se conecto la cuenta.
PROVEEDORES_JURIDICOS = {"VE_BAN_EMP_V2", "MERCANTIL_EMP_V1", "VE_BANESCO_V1", "VE_BANK_PLAZA_V1"}

# Codigos de los bancos venezolanos a los que se puede mandar un pago movil.
BANCOS_VE: list[tuple[str, str]] = [
    ("0102", "Banco de Venezuela"),
    ("0134", "Banesco"),
    ("0105", "Mercantil"),
    ("0108", "Provincial"),
    ("0191", "BNC"),
    ("0172", "Bancamiga"),
    ("0175", "Bicentenario"),
    ("0163", "Banco del Tesoro"),
    ("0114", "Bancaribe"),
    ("0115", "Exterior"),
    ("0138", "Banco Plaza"),
    ("0151", "BFC Fondo Común"),
    ("0156", "100% Banco"),
    ("0157", "DelSur"),
    ("0166", "Banco Agrícola"),
    ("0168", "Bancrecer"),
    ("0169", "Mi Banco"),
    ("0171", "Banco Activo"),
    ("0174", "Banplus"),
    ("0177", "Banfanb"),
    ("0104", "Venezolano de Crédito"),
    ("0128", "Banco Caroní"),
    ("0137", "Sofitasa"),
    ("0146", "Bangente"),
]


def emite_vueltos(cuenta: Cuenta) -> bool:
    """Si con esta cuenta se puede mandar un pago movil de vuelto."""
    return cuenta.proveedor in PROVEEDORES_JURIDICOS


@dataclass
class VueltoEmitido:
    ok: bool
    codigo: str = ""
    mensaje: str = ""
    detalle: str = ""
    referencia: str = ""
    autorizacion: str = ""
    estado: str = ""
    pabilo_id: str = ""


MENSAJES_VUELTO = {
    "INVALID_PHONE": "El teléfono no tiene un formato reconocible: 04141234567.",
    "INSUFFICIENT_FUNDS": "La cuenta no tiene saldo para ese vuelto.",
    "C2P_NOT_SUPPORTED": "La cuenta conectada no puede mandar pagos móviles: hace falta una cuenta jurídica con el servicio C2P activo en el banco.",
    "NOT_LEGAL_ACCOUNT": "La cuenta conectada es de persona natural: el banco solo permite vueltos automáticos a cuentas jurídicas.",
}


def siguiente_factura(cuenta: Cuenta) -> str:
    """El numero de referencia interno que Pabilo asigna al vuelto."""
    datos = _llamar(_get, f"/userbankpayment/{cuenta.id}/get-next-invoice-number")
    if isinstance(datos, dict):
        for clave in ("invoice_number", "next_invoice_number", "data"):
            v = datos.get(clave)
            if isinstance(v, dict):
                v = v.get("invoice_number") or v.get("next_invoice_number")
            if v:
                return str(v)
    return str(datos)


def emitir_vuelto(
    cuenta: Cuenta,
    *,
    cedula: str,
    telefono: str,
    banco: str,
    monto_bs: float,
    factura: str,
) -> VueltoEmitido:
    """Manda el pago movil del vuelto y clasifica lo que responda."""
    tipo, numero = _partir_cedula(cedula)
    cuerpo = {
        "dni": {"code": tipo, "number": numero},
        "phone_pagador": "".join(ch for ch in telefono if ch.isdigit()),
        "amount": round(monto_bs, 2),
        "invoice_number": factura,
        "destination_bank_code": banco,
    }
    try:
        status, datos = _post(f"/v1/transactionchange/userbank/{cuenta.id}", cuerpo)
    except httpx.TimeoutException:
        return VueltoEmitido(ok=False, codigo="TIEMPO_AGOTADO", mensaje=MENSAJES["TIEMPO_AGOTADO"])
    except httpx.HTTPError as e:
        log.warning("pabilo sin conexion: %s", e)
        return VueltoEmitido(ok=False, codigo="SIN_CONEXION", mensaje=MENSAJES["SIN_CONEXION"], detalle=str(e)[:300])

    if 200 <= status < 300 and isinstance(datos, dict):
        d = datos.get("data") if isinstance(datos.get("data"), dict) else datos
        t = d.get("transaction_changes") or d.get("transaction_change") or d
        if not isinstance(t, dict):
            t = {}
        estado = str(t.get("status") or "").upper()
        ok = estado in ("", "APPROVED", "SUCCESS", "COMPLETED", "PROCESSED")
        return VueltoEmitido(
            ok=ok,
            codigo="" if ok else estado,
            mensaje="Vuelto enviado." if ok else f"El banco respondió {estado}.",
            detalle=str(datos.get("message") or "")[:300],
            referencia=str(t.get("reference") or ""),
            autorizacion=str(t.get("authorization_code") or ""),
            estado=estado or "APPROVED",
            pabilo_id=str(t.get("id") or t.get("_id") or ""),
        )
    codigo, detalle = _error_de(datos, status)
    mensaje = MENSAJES_VUELTO.get(codigo) or MENSAJES.get(codigo)
    if not mensaje:
        bajo = (detalle or "").lower()
        if "c2p" in bajo or "legal" in bajo or "jur" in bajo:
            mensaje = MENSAJES_VUELTO["C2P_NOT_SUPPORTED"]
        elif "fund" in bajo or "saldo" in bajo or "balance" in bajo:
            mensaje = MENSAJES_VUELTO["INSUFFICIENT_FUNDS"]
        else:
            mensaje = f"No se pudo mandar el vuelto ({codigo}). {detalle[:160]}".strip()
    return VueltoEmitido(ok=False, codigo=codigo, mensaje=mensaje, detalle=detalle[:300])
