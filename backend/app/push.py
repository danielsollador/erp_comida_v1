"""Notificaciones push al telefono: las que llegan aunque la app este cerrada.

POR QUE EXISTE. El aviso por WebSocket (la campana) solo llega si la app esta
abierta. Leider (22-oct) pidio dos avisos que tienen que llegar igual:

  1. AUTORIZACIONES. La caja pide permiso y al dueño le suena el telefono.
  2. CAJA SIN CERRAR. Si a la hora del aviso (21:30 por defecto) hubo ventas
     y nadie ha cuadrado la caja del dia, se le recuerda al dueño.

COMO. La app registra su token de Expo (`ExponentPushToken[...]`) en
`/api/push/dispositivo` al entrar, y lo borra al salir. Para mandar se usa el
servicio de Expo (exp.host), que reparte a Apple y a Google: asi el servidor
no guarda llaves de Apple ni de Firebase. Los tokens viven en la base de CADA
local: un dueño con dos locales recibe de cada uno solo lo de ese local.

A QUIEN. A las personas cuyo rol autoriza (`permisos.autoriza`): dueño y
Vertigo siempre, y los roles que el local marque. Es la misma regla de la
campana: lo que te pide permiso es lo que te avisa.

Nunca tumba nada: si Expo no contesta, se registra en el log y la operacion
de la caja sigue igual. El aviso es un extra, no parte de la venta.
"""
from __future__ import annotations

import datetime
import logging
import os
import threading
import time
from typing import Iterable, List, Optional

import httpx
from sqlalchemy.orm import Session

from . import models
from .acceso import permisos, usuarios
from .database import SessionLocal
from .timeutils import ahora, hoy, inicio_del_dia

log = logging.getLogger("push")

URL_EXPO = "https://exp.host/--/api/v2/push/send"
# Expo recibe hasta cien mensajes por llamada.
LOTE = 100


def _hora(texto: str, defecto: datetime.time) -> datetime.time:
    try:
        h, m = texto.strip().split(":")
        return datetime.time(int(h), int(m))
    except (ValueError, AttributeError):
        return defecto


# A que hora se recuerda la caja sin cerrar (hora del negocio). Un local que
# cierra mas tarde lo cambia en el compose con ERP_HORA_AVISO_CAJA=23:00.
HORA_AVISO_CAJA = _hora(os.getenv("ERP_HORA_AVISO_CAJA", "21:30"), datetime.time(21, 30))


def es_token(token: str) -> bool:
    return token.startswith(("ExponentPushToken[", "ExpoPushToken[")) and token.endswith("]")


# ── Dispositivos ────────────────────────────────────────────────────────────


def registrar(db: Session, usuario: str, token: str, plataforma: str = "") -> models.DispositivoPush:
    """Un telefono es de quien entro por ultima vez en el: si la cajera le
    presta el telefono al dueño, los avisos pasan a ser del dueño."""
    fila = db.query(models.DispositivoPush).filter(models.DispositivoPush.token == token).first()
    if fila is None:
        fila = models.DispositivoPush(token=token)
        db.add(fila)
    fila.usuario = usuario
    fila.plataforma = (plataforma or "")[:20]
    fila.actualizado = ahora()
    db.flush()
    return fila


def quitar(db: Session, token: str) -> None:
    db.query(models.DispositivoPush).filter(models.DispositivoPush.token == token).delete()


def tokens_de_autorizantes(db: Session, excepto: Optional[str] = None) -> List[str]:
    """Los telefonos de quienes autorizan. `excepto`: quien pidio el permiso
    no se avisa a si mismo (si su rol autoriza, ni siquiera lo pidio)."""
    filas = db.query(models.DispositivoPush).all()
    return [
        f.token
        for f in filas
        if f.usuario != excepto and permisos.autoriza(usuarios.rol_de(f.usuario))
    ]


# ── Enviar ──────────────────────────────────────────────────────────────────


def _mandar(mensajes: List[dict]) -> List[dict]:
    """La llamada a Expo. Aparte para que las pruebas la reemplacen."""
    respuesta = httpx.post(URL_EXPO, json=mensajes, timeout=10, headers={"Accept": "application/json"})
    respuesta.raise_for_status()
    return respuesta.json().get("data", [])


def enviar(tokens: Iterable[str], titulo: str, cuerpo: str, ruta: str = "/notificaciones") -> int:
    """Manda el aviso y borra los telefonos que Expo dice que ya no existen
    (app desinstalada o permiso quitado). Devuelve cuantos salieron."""
    tokens = [t for t in dict.fromkeys(tokens) if es_token(t)]
    if not tokens:
        return 0
    salieron = 0
    muertos: List[str] = []
    for i in range(0, len(tokens), LOTE):
        lote = tokens[i : i + LOTE]
        mensajes = [
            {"to": t, "title": titulo, "body": cuerpo, "sound": "default", "priority": "high", "data": {"ruta": ruta}}
            for t in lote
        ]
        try:
            tickets = _mandar(mensajes)
        except Exception as e:  # noqa: BLE001 -- un aviso nunca tumba nada
            log.warning("push: no se pudo mandar a Expo: %s", e)
            continue
        for token, ticket in zip(lote, tickets):
            if ticket.get("status") == "ok":
                salieron += 1
            elif (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
                muertos.append(token)
    if muertos:
        with SessionLocal() as db:
            for t in muertos:
                quitar(db, t)
            db.commit()
    return salieron


# ── 1. Autorizaciones ───────────────────────────────────────────────────────


def avisar_autorizacion(tokens: List[str], solicitante: str, que: str, monto: float) -> None:
    """Lo que ve el dueño en la pantalla bloqueada. Corre despues de
    responderle a la caja (BackgroundTasks): la cajera no espera a Expo."""
    cuanto = f" · ${monto:,.2f}" if monto else ""
    enviar(tokens, "Piden tu permiso", f"{solicitante}: {que}{cuanto}", ruta="/notificaciones")


# ── 2. Caja sin cerrar ──────────────────────────────────────────────────────


def caja_pendiente(db: Session, dia: datetime.date) -> int:
    """Cuantos pedidos se cobraron ese dia si la caja NO se ha cerrado; 0 si
    ya se cerro o si no hubo ventas (un dia sin ventas no se cuadra)."""
    inicio = inicio_del_dia(dia)
    fin = inicio + datetime.timedelta(days=1)
    cerrada = (
        db.query(models.CierreCaja.id)
        .filter(
            models.CierreCaja.fecha >= inicio,
            models.CierreCaja.fecha < fin,
            models.CierreCaja.anulado.is_(False),
        )
        .first()
    )
    if cerrada:
        return 0
    return (
        db.query(models.Pedido.id)
        .filter(models.Pedido.estado == "pagado", models.Pedido.cerrado_en >= inicio, models.Pedido.cerrado_en < fin)
        .count()
    )


def revisar_caja(db: Session, dia: Optional[datetime.date] = None) -> int:
    dia = dia or hoy()
    pedidos = caja_pendiente(db, dia)
    if not pedidos:
        return 0
    tokens = tokens_de_autorizantes(db)
    texto = f"Hoy se cobraron {pedidos} pedido{'s' if pedidos != 1 else ''} y nadie ha cuadrado la caja."
    return enviar(tokens, "La caja de hoy sigue abierta", texto, ruta="/caja")


def _segundos_hasta_el_aviso() -> float:
    momento = ahora()
    proxima = datetime.datetime.combine(momento.date(), HORA_AVISO_CAJA)
    if proxima <= momento:
        proxima += datetime.timedelta(days=1)
    return (proxima - momento).total_seconds()


def _loop() -> None:
    while True:
        time.sleep(_segundos_hasta_el_aviso())
        try:
            with SessionLocal() as db:
                n = revisar_caja(db)
            log.info("push: aviso de caja sin cerrar a %d telefono(s)", n)
        except Exception as e:  # noqa: BLE001 -- nunca debe tumbar el servidor
            log.warning("push: fallo el aviso de caja: %s", e)
        # Que no se repita en el mismo minuto si el reloj va justo.
        time.sleep(61)


def iniciar_aviso_de_caja() -> None:
    threading.Thread(target=_loop, daemon=True, name="aviso-caja").start()
