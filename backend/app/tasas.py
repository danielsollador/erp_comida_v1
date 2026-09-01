"""Gestion de la tasa de cambio del dia.

Regla de oro: **lo manual manda**. El refresco automatico escribe la tasa del
BCV y la del paralelo, pero si el dueno cargo una tasa a mano para hoy, no se
toca. Muchos locales cobran a una tasa propia (BCV redondeado, un punto medio,
la del proveedor) y el sistema tiene que respetar esa decision.
"""

import datetime
import logging
import threading
import time
from typing import Optional

from sqlalchemy.orm import Session

from . import models, rates
from .database import SessionLocal
from .timeutils import ahora, hoy

log = logging.getLogger("erp.tasas")

INTERVALO_REFRESCO_MIN = 30


def tasa_vigente(db: Session) -> Optional[models.TasaCambio]:
    """La tasa mas reciente que no sea del futuro.

    Se busca "la ultima hasta hoy" y no "la de hoy" a proposito: si el local
    abrio un lunes feriado sin internet y no hay fila de hoy, se sigue cobrando
    con la del viernes en vez de quedarse en cero.
    """
    return (
        db.query(models.TasaCambio)
        .filter(models.TasaCambio.fecha <= hoy())
        .order_by(models.TasaCambio.fecha.desc())
        .first()
    )


def refrescar(db: Session, forzar: bool = False) -> bool:
    """Baja las tasas reales y las guarda en la fila de hoy.

    Devuelve True si quedo con datos en vivo. No pisa una tasa manual salvo que
    se pida explicitamente (`forzar`), que es lo que hace el boton "volver a la
    tasa automatica".
    """
    anclas = rates.obtener_anclas(forzar=forzar)
    if not anclas:
        return False

    fecha = hoy()
    fila = db.query(models.TasaCambio).filter(models.TasaCambio.fecha == fecha).first()

    if fila and fila.origen == "manual" and not forzar:
        # El dueno mando: solo se completa el paralelo, que es referencia y no
        # afecta a que tasa se cobra.
        if anclas.get("paralelo"):
            fila.paralelo = anclas["paralelo"]
            db.commit()
        return True

    # Cada valor cae al anterior si su fuente fallo, en vez de perderse.
    bcv = anclas["bcv"]
    eur = anclas.get("eur") or (fila.eur if fila else None)
    paralelo = anclas.get("paralelo") or (fila.paralelo if fila else None)

    if fila:
        fila.bcv = bcv
        fila.eur = eur
        fila.paralelo = paralelo
        fila.origen = "auto"
        fila.actualizado_en = ahora()
    else:
        db.add(
            models.TasaCambio(
                fecha=fecha, bcv=bcv, eur=eur, paralelo=paralelo, origen="auto"
            )
        )
    db.commit()
    return True


def fijar_manual(db: Session, bcv: float, paralelo: Optional[float] = None) -> models.TasaCambio:
    """El dueno fija la tasa con la que quiere cobrar hoy."""
    fecha = hoy()
    fila = db.query(models.TasaCambio).filter(models.TasaCambio.fecha == fecha).first()
    if fila:
        fila.bcv = bcv
        if paralelo is not None:
            fila.paralelo = paralelo
        fila.origen = "manual"
        fila.actualizado_en = ahora()
    else:
        fila = models.TasaCambio(
            fecha=fecha, bcv=bcv, paralelo=paralelo, origen="manual"
        )
        db.add(fila)
    db.commit()
    db.refresh(fila)
    return fila


def historial(db: Session, dias: int = 30):
    desde = hoy() - datetime.timedelta(days=dias)
    return (
        db.query(models.TasaCambio)
        .filter(models.TasaCambio.fecha >= desde)
        .order_by(models.TasaCambio.fecha.desc())
        .all()
    )


def estado(db: Session) -> dict:
    """Todo lo que la interfaz necesita saber de la tasa, en una sola llamada."""
    fila = tasa_vigente(db)
    semana = (
        db.query(models.TasaCambio)
        .filter(models.TasaCambio.fecha <= hoy() - datetime.timedelta(days=7))
        .order_by(models.TasaCambio.fecha.desc())
        .first()
    )

    bcv = fila.bcv if fila else None
    paralelo = fila.paralelo if fila else None
    brecha = round((paralelo / bcv - 1) * 100, 1) if bcv and paralelo else None
    variacion = (
        round((bcv / semana.bcv - 1) * 100, 2) if bcv and semana and semana.bcv else None
    )
    anclas = rates.obtener_anclas() or {}

    return {
        "fecha": fila.fecha.isoformat() if fila else hoy().isoformat(),
        "bcv": bcv,
        "eur": fila.eur if fila else None,
        "paralelo": paralelo,
        "brecha_pct": brecha,
        "variacion_semana_pct": variacion,
        "origen": fila.origen if fila else None,
        "actualizado_en": fila.actualizado_en.isoformat() if fila and fila.actualizado_en else None,
        "en_vivo": bool(anclas),
        "fuente_actualizada": anclas.get("actualizado"),
        "desactualizada": bool(fila and fila.fecha < hoy()),
    }


def _loop_refresco():
    while True:
        db = SessionLocal()
        try:
            refrescar(db)
        except Exception as e:  # nunca debe tumbar el servidor
            log.warning("fallo el refresco de tasas: %s", e)
        finally:
            db.close()
        time.sleep(INTERVALO_REFRESCO_MIN * 60)


def iniciar_refresco_automatico():
    hilo = threading.Thread(target=_loop_refresco, daemon=True)
    hilo.start()
