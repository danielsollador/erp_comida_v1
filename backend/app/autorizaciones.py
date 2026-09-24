"""Autorizar una operacion delicada: con PIN en el mostrador, o desde la app.

POR QUE EXISTE. Editar una venta ya cobrada mueve plata de la gaveta y pedia
usuario y contraseña de alguien con cuenta. Dos problemas: teclear usuario y
contraseña en una tablet con un cliente esperando es lento, y el dueño --que
es quien deberia autorizar-- muchas veces no esta en el local.

QUIEN YA AUTORIZA, NO FIRMA NADA. Si la sesion que esta haciendo la
operacion tiene un rol que autoriza, eso es la firma y no se pide mas (ver
`firma_propia`). Lo contrario era pedirle a la dueña, parada en su propia
caja, el PIN de la dueña.

DOS FORMAS DE FIRMAR CUANDO QUIEN OPERA NO AUTORIZA:

  PIN         Cuatro a seis digitos, propios de cada persona con un rol que
              autoriza. El PIN solo identifica a quien lo puso: no hace falta
              decir quien es. Como es corto, la defensa no es el hash sino el
              limite de intentos por IP (ver `PIN_INTENTOS`).

  SOLICITUD   La cajera pide autorizacion; a quien tiene rol que autoriza le
              llega un aviso en su aplicacion (por WebSocket) y aprueba o
              rechaza desde alli, sin PIN: ya entro con su clave y esa sesion
              es su firma. La aprobacion vale quince minutos y se gasta una
              vez, y queda en `TRX910_USU_AUTORIZACION` con quien la pidio,
              quien la resolvio y para que.

La forma vieja (usuario + clave) se sigue aceptando por compatibilidad, pero
tambien exige que el rol autorice: la firma es de quien tiene la autoridad, no
de quien tiene una cuenta.

QUE ROLES AUTORIZAN lo decide el dueño en la pantalla de Usuarios, rol por rol
(`permisos.autoriza`). Dueño siempre; caja y cocina no, salvo que el local lo
marque.
"""
from __future__ import annotations

import datetime
from typing import List, Optional

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from . import models, schemas, settings
from .acceso import auth, permisos, usuarios
from .timeutils import ahora

# Cuanto vale una solicitud: pendiente sin resolver, o aprobada sin usarse.
# Quince minutos es lo que dura una conversacion con el cliente en el
# mostrador; una aprobacion de la mañana no puede servir para una edicion de
# la noche.
VIGENCIA = datetime.timedelta(minutes=15)

# Un PIN de cuatro digitos tiene diez mil combinaciones: sin esto se adivina
# en minutos. Diez fallos cada cinco minutos por IP es mas de lo que una
# persona se equivoca y menos de lo que necesita un script.
PIN_INTENTOS = 10
PIN_VENTANA = 5 * 60

# Las operaciones que piden firma, con el texto que ve quien autoriza.
ACCIONES = {
    "editar_venta": "Editar una venta ya cobrada",
    "corregir_pago": "Corregir la forma de pago de una venta",
}

PENDIENTE, APROBADA, RECHAZADA, CANCELADA, USADA, VENCIDA = (
    "pendiente", "aprobada", "rechazada", "cancelada", "usada", "vencida",
)


def _local() -> Optional[str]:
    return None if settings.ES_HUB else settings.LOCAL_SLUG


def _vencida(s: models.SolicitudAutorizacion) -> bool:
    return ahora() - s.creada > VIGENCIA


def pendientes(db: Session) -> List[models.SolicitudAutorizacion]:
    """Las que esperan respuesta. Las que ya pasaron de hora se marcan
    vencidas aqui mismo: no hace falta un reloj aparte para tres filas."""
    filas = (
        db.query(models.SolicitudAutorizacion)
        .filter(models.SolicitudAutorizacion.estado == PENDIENTE)
        .order_by(models.SolicitudAutorizacion.creada)
        .all()
    )
    vivas = []
    for s in filas:
        if _vencida(s):
            s.estado = VENCIDA
        else:
            vivas.append(s)
    return vivas


def crear(
    db: Session, datos: schemas.SolicitudAutorizacionCreate, solicitante: str, nombre: str
) -> models.SolicitudAutorizacion:
    if datos.accion not in ACCIONES:
        raise HTTPException(status_code=400, detail="No sé qué operación es esa.")
    if datos.pedido_id is not None and db.get(models.Pedido, datos.pedido_id) is None:
        raise HTTPException(status_code=404, detail="Ese pedido no existe.")
    s = models.SolicitudAutorizacion(
        accion=datos.accion,
        detalle=(datos.detalle or "").strip()[:300],
        monto=round(datos.monto or 0, 2),
        pedido_id=datos.pedido_id,
        solicitante=solicitante,
        solicitante_nombre=nombre,
    )
    db.add(s)
    db.flush()
    return s


def obtener(db: Session, solicitud_id: int) -> models.SolicitudAutorizacion:
    s = db.get(models.SolicitudAutorizacion, solicitud_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Esa solicitud no existe.")
    if s.estado == PENDIENTE and _vencida(s):
        s.estado = VENCIDA
    return s


def resolver(
    db: Session, solicitud_id: int, quien: str, aprobar: bool
) -> models.SolicitudAutorizacion:
    s = obtener(db, solicitud_id)
    if s.estado != PENDIENTE:
        raise HTTPException(
            status_code=409, detail=f"Esa solicitud ya no está pendiente: está {s.estado}."
        )
    s.estado = APROBADA if aprobar else RECHAZADA
    s.resuelta_por = quien
    s.resuelta_en = ahora()
    return s


def cancelar(db: Session, solicitud_id: int) -> models.SolicitudAutorizacion:
    s = obtener(db, solicitud_id)
    if s.estado == PENDIENTE:
        s.estado = CANCELADA
        s.resuelta_en = ahora()
    return s


def _consumir(db: Session, solicitud_id: int, accion: str, pedido_id: Optional[int]) -> str:
    """Gasta una solicitud aprobada y devuelve quien la aprobo."""
    s = obtener(db, solicitud_id)
    if s.estado != APROBADA:
        raise HTTPException(
            status_code=403,
            detail=f"La solicitud #{s.id} no está aprobada (está {s.estado}).",
        )
    # Aprobada para ESTO. Una aprobacion para editar el pedido 12 no sirve
    # para el 13: seria pedir permiso por una cosa y usarlo para otra.
    if s.accion != accion or (pedido_id is not None and s.pedido_id not in (None, pedido_id)):
        raise HTTPException(
            status_code=403, detail=f"La solicitud #{s.id} se aprobó para otra operación."
        )
    if s.resuelta_en and ahora() - s.resuelta_en > VIGENCIA:
        s.estado = VENCIDA
        raise HTTPException(
            status_code=403, detail=f"La aprobación de la solicitud #{s.id} ya venció. Pide otra."
        )
    s.estado = USADA
    s.usada_en = ahora()
    return s.resuelta_por or "autorizado desde la app"


def firma_propia(request: Request) -> Optional[str]:
    """Quien esta operando, si su rol ya autoriza. None si no.

    Pedirle el PIN a quien tiene la autoridad no agrega ningun control: entro
    con su clave y esa sesion es su firma, la misma que vale cuando aprueba
    desde su aplicacion sin teclear nada. Lo unico que lograba era enseñarle
    a todo el mundo que la firma es un tramite. Lo que importa queda igual de
    escrito: el nombre de quien autorizo se guarda en la operacion.
    """
    s = getattr(request.state, "sesion", None)
    if not s or not permisos.autoriza(s.get("rol")):
        return None
    return usuarios.nombre_visible(usuarios.ficha(s.get("usuario"))) or s.get("usuario") or ""


SIN_FIRMA = (
    "Hace falta el PIN de alguien autorizado, o que apruebe la solicitud "
    "desde su aplicación."
)


def firmar(
    db: Session,
    request: Request,
    autorizacion: Optional[schemas.Autorizacion],
    accion: str,
    pedido_id: Optional[int] = None,
) -> str:
    """El nombre de quien autoriza, o un 403 que dice que falta."""
    # Antes que nada: quien opera puede ser quien autoriza.
    propia = firma_propia(request)
    if propia:
        return propia

    if autorizacion is None:
        raise HTTPException(status_code=403, detail=SIN_FIRMA)

    if autorizacion.solicitud_id:
        return _consumir(db, autorizacion.solicitud_id, accion, pedido_id)

    if autorizacion.pin:
        auth.exigir_pocos_fallos(request, PIN_INTENTOS, PIN_VENTANA, what="PIN")
        ficha = usuarios.verificar_pin(autorizacion.pin, _local())
        if not ficha or not permisos.autoriza(ficha["rol"]):
            auth.anotar_fallo(request, what="PIN")
            raise HTTPException(status_code=403, detail="PIN incorrecto.")
        return usuarios.nombre_visible(ficha)

    if autorizacion.usuario and autorizacion.clave:
        cuenta = usuarios.verificar(autorizacion.usuario, autorizacion.clave)
        if not cuenta:
            raise HTTPException(status_code=403, detail="Usuario o clave incorrectos")
        if not permisos.autoriza(cuenta["rol"]):
            raise HTTPException(
                status_code=403,
                detail=f"El rol de «{cuenta['usuario']}» no autoriza operaciones.",
            )
        return usuarios.nombre_visible(cuenta)

    raise HTTPException(status_code=403, detail=SIN_FIRMA)
