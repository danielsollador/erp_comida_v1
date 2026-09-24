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
MENSAJES = {
    "PAYMENT_NOT_FOUND": "El banco no encuentra ningún pago con esa referencia. Revisa los dígitos o espera un momento: a veces tarda en reflejarse.",
    "PAYMENT_AMOUNT_NOT_VALID": "La referencia existe pero el monto no coincide.",
    "PAYMENT_ALREADY_EXISTS": "Ese pago ya se usó para cobrar otra cuenta.",
    "IS_NOT_POSITIVE_PAYMENT": "Esa referencia es de un pago que SALIÓ de la cuenta, no de uno que entró.",
    "IS_NOT_POSITIVE_AMOUNT": "El monto tiene que ser mayor a cero.",
    "BAD_REQUEST": "Faltan datos para consultar ese pago.",
    "NOT_ENOUGH_CREDITS": "Se acabaron los créditos de Pabilo. Avísale al dueño; mientras, cobra anotando la referencia.",
    "PLAN_IS_NOT_ACTIVE": "El plan de Pabilo está vencido. Avísale al dueño; mientras, cobra anotando la referencia.",
    "REQUEST_LIMIT_REACHED": "Se agotó la cuota de consultas de Pabilo por este período.",
    "API_KEY_MONTHLY_CREDIT_LIMIT_EXCEEDED": "Se alcanzó el tope mensual de consultas de Pabilo.",
    "CLIENT_MONTHLY_CREDIT_LIMIT_EXCEEDED": "Se alcanzó el tope mensual de consultas de Pabilo.",
    "USER_BANCK_BAD_PASSWORD": "La clave del banco guardada en Pabilo ya no sirve. El dueño tiene que actualizarla.",
    "USER_BANCK_PASSWORD_EXPIRED": "El banco pide cambiar la clave. El dueño tiene que actualizarla en Pabilo.",
    "USER_BANCK_BLOCKED": "El banco bloqueó el usuario de la cuenta. Hay que desbloquearlo con el banco.",
    "USER_BANCK_BAD_API_KEY": "La credencial del banco en Pabilo no es válida.",
    "USER_BANK_IS_DISABLED": "La cuenta bancaria está deshabilitada en Pabilo.",
    "USER_BANCK_NOT_FOUND": "La cuenta bancaria configurada no existe en Pabilo. Revisa PABILO_USER_BANK_ID.",
    "UNAUTHORIZED": "La clave de Pabilo no es válida o fue revocada.",
    "FORBIDDEN": "La clave de Pabilo no tiene permiso para verificar pagos.",
    "BANK_NOT_AVAILABLE": "El banco no respondió. Intenta otra vez en un momento.",
    "BANK_TEMPORARILY_INACTIVE": "El banco está caído en este momento.",
    "BANK_TOO_MANY_REQUESTS": "El banco está limitando las consultas. Espera unos segundos.",
    "PROXY_ERROR": "Falló la conexión con el banco. Intenta otra vez.",
    "SESSION_ALREADY_ACTIVE": "Hay otra consulta en curso contra el banco. Espera unos segundos.",
    "SIN_CONEXION": "No se pudo llegar a Pabilo. Revisa la conexión a internet.",
    "TIEMPO_AGOTADO": "El banco tardó demasiado en responder.",
}


class PabiloNoConfigurado(RuntimeError):
    """No hay clave: el ERP sigue cobrando como siempre, sin verificar."""


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
    return bool(settings.PABILO_API_KEY)


def _headers() -> dict[str, str]:
    if not settings.PABILO_API_KEY:
        raise PabiloNoConfigurado("PABILO_API_KEY no esta definida")
    return {
        "Authorization": f"Bearer {settings.PABILO_API_KEY}",
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
    with _cliente() as c:
        r = c.get("/me/usersbank", headers=_headers())
    r.raise_for_status()
    resultado: list[Cuenta] = []
    for b in r.json().get("user_banks", []):
        if b.get("to_trash"):
            continue
        tipos = [t for t in b.get("verifications_types_available", []) if not t.get("hidden")]
        tipo = tipos[0] if tipos else {"id": "GENERIC", "fields_required": [{"name": "REFERENCE_NUMBER"}]}
        resultado.append(
            Cuenta(
                id=str(b.get("id", "")),
                descripcion=str(b.get("description") or ""),
                banco=str(b.get("platform") or b.get("provider") or ""),
                moneda=str(b.get("currency") or "VEF"),
                campos=[str(f.get("name")) for f in tipo.get("fields_required", [])],
                tipo=str(tipo.get("id") or "GENERIC"),
            )
        )
    _cache_cuentas = (time.monotonic(), resultado)
    return resultado


def cuenta_activa() -> Cuenta:
    """La cuenta donde cobra el local: la configurada, o la unica que hay."""
    lista = cuentas()
    if settings.PABILO_USER_BANK_ID:
        for c in lista:
            if c.id == settings.PABILO_USER_BANK_ID:
                return c
        raise LookupError(
            f"La cuenta {settings.PABILO_USER_BANK_ID} no esta entre las de la clave "
            f"({', '.join(c.descripcion or c.id for c in lista) or 'ninguna'})."
        )
    if len(lista) == 1:
        return lista[0]
    if not lista:
        raise LookupError("La clave de Pabilo no tiene ninguna cuenta bancaria conectada.")
    raise LookupError(
        "La clave tiene varias cuentas; define PABILO_USER_BANK_ID con la del local: "
        + ", ".join(f"{c.descripcion or '?'}={c.id}" for c in lista)
    )


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
        mensaje=MENSAJES.get(codigo, f"Pabilo respondió {codigo}."),
        detalle=mensaje[:300],
    )
