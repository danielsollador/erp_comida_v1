"""Las salvaguardas de todo lo que mueve plata (QA de noviembre, specs/qa.md).

Tres piezas, las mismas para todos los modulos:

  FIRMA        Anular, dar de baja, corregir un cierre, borrar algo de un dia
               cerrado o cambiar la tasa piden la firma de quien autoriza (R5).
               Quien autoriza no firma nada: su sesion es la firma. Si falta,
               el servidor responde 428 con lo que hay que firmar y la web
               abre el cuadro de PIN o de "pedir permiso" sola, y repite la
               operacion con la cabecera `X-Autorizacion`.

  CONFIRMAR    Lo que se sale de lo normal (un monto cinco veces mayor que el
               habitual, una fecha vieja, un fondo absurdo) responde 428 con la
               pregunta; la web la muestra y repite con `X-Confirmado` (R4).

  UN ENVIO     El mismo pago mandado dos veces seguidas (doble toque, mala
               señal) se registra una vez: el segundo pide confirmar (R2).
               Lo aplica el middleware de `main.py` a las rutas de dinero.

428 (Precondition Required) y no 403: no es que no se pueda, es que falta
algo que la misma pantalla puede pedir sin mandar a nadie a otro lado.
"""
from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from typing import Optional

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from . import autorizaciones, schemas

CABECERA_FIRMA = "X-Autorizacion"


def numero(n: float) -> str:
    """2.500,00: como se lee en Venezuela, en los mensajes al usuario."""
    return f"{n:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


def usd(n: float) -> str:
    return "$" + numero(n)

CABECERA_CONFIRMADO = "X-Confirmado"


def confirmados(request: Request) -> set[str]:
    return {c.strip() for c in (request.headers.get(CABECERA_CONFIRMADO) or "").split(",") if c.strip()}


def pedir_confirmacion(request: Request, clave: str, mensaje: str) -> None:
    """Sigue si quien opera ya confirmo `clave`; si no, 428 con la pregunta."""
    if clave in confirmados(request):
        return
    raise HTTPException(status_code=428, detail={"codigo": "confirmar", "clave": clave, "mensaje": mensaje})


def _firma_de_cabecera(request: Request) -> Optional[schemas.Autorizacion]:
    crudo = request.headers.get(CABECERA_FIRMA)
    if not crudo:
        return None
    try:
        return schemas.Autorizacion.model_validate(json.loads(crudo))
    except Exception:
        raise HTTPException(status_code=400, detail="La firma llegó dañada. Vuelve a firmar.")


def exigir_firma(
    db: Session,
    request: Request,
    accion: str,
    detalle: str,
    monto: float = 0,
    pedido_id: Optional[int] = None,
    autorizacion: Optional[schemas.Autorizacion] = None,
) -> str:
    """El nombre de quien autorizo. Si falta la firma, 428 con lo que se firma."""
    propia = autorizaciones.firma_propia(request)
    if propia:
        return propia
    firma = autorizacion or _firma_de_cabecera(request)
    if firma is None:
        raise HTTPException(
            status_code=428,
            detail={
                "codigo": "firma",
                "accion": accion,
                "detalle": detalle,
                "monto": round(monto or 0, 2),
                "mensaje": f"{autorizaciones.ACCIONES.get(accion, detalle)}: " + autorizaciones.SIN_FIRMA,
            },
        )
    return autorizaciones.firmar(db, request, firma, accion=accion, pedido_id=pedido_id)


# ── Un solo envio ────────────────────────────────────────────────────────────

# Las rutas que CREAN un movimiento de plata sin otra defensa contra el
# repetido: retirar, gastar, pagar, cargar una factura. Las que actuan sobre
# algo que ya existe (pagar la factura 12, anular el cierre 5) ya tienen la
# suya --el estado de la fila, bloqueada--; los cobros de deudas traen su
# propia clave (`clave_cliente`), y los pedidos tambien: dos clientes seguidos
# piden el mismo cafe.
RUTAS_DE_DINERO = {
    "/api/caja/retiros", "/api/caja/gastos", "/api/caja/traspasos",
    "/api/egresos", "/api/egresos/islr/enterar",
    "/api/compras/facturas", "/api/contabilidad/asientos", "/api/impuestos/retenciones-iva/enterar",
}
# La compra suelta de una mercancia (sin factura): su ruta lleva el id.
COMPRA_SUELTA = re.compile(r"^/api/inventario/ingredientes/\d+/comprar$")
VENTANA_SEGUNDOS = 10

_lock = threading.Lock()
_vistos: dict[str, tuple[str, float]] = {}


def aplica(metodo: str, ruta: str) -> bool:
    ruta = ruta.rstrip("/")
    return metodo == "POST" and (ruta in RUTAS_DE_DINERO or bool(COMPRA_SUELTA.match(ruta)))


def huella(usuario: str, metodo: str, ruta: str, cuerpo: bytes) -> str:
    return hashlib.sha256(f"{usuario}|{metodo}|{ruta}|".encode() + cuerpo).hexdigest()


def tomar(clave: str) -> bool:
    """True si este envio es el primero (o el anterior ya paso de la ventana)."""
    ahora = time.monotonic()
    with _lock:
        for k in [k for k, (_, t) in _vistos.items() if ahora - t > VENTANA_SEGUNDOS]:
            del _vistos[k]
        if clave in _vistos:
            return False
        _vistos[clave] = ("en_curso", ahora)
        return True


def soltar(clave: str, salio_bien: bool) -> None:
    """Un envio que fallo no cuenta: el reintento tiene que poder pasar."""
    with _lock:
        if salio_bien:
            _vistos[clave] = ("hecho", time.monotonic())
        else:
            _vistos.pop(clave, None)


MENSAJE_REPETIDO = (
    "Esto mismo se acaba de registrar hace unos segundos. Si de verdad es otro "
    "igual, confírmalo; si fue un doble toque, no hace falta hacer nada."
)
