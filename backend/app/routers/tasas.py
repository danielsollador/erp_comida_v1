from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import schemas, tasas
from ..database import get_db
from ..rango import Rango

router = APIRouter(prefix="/api/tasas", tags=["tasas"])


@router.get("", response_model=schemas.EstadoTasa)
def estado(db: Session = Depends(get_db)):
    """Tasa vigente, brecha con el paralelo y si hay conexion a las fuentes."""
    return tasas.estado(db)


@router.post("/refrescar", response_model=schemas.EstadoTasa)
def refrescar(forzar: bool = False, db: Session = Depends(get_db)):
    """Vuelve a consultar BCV y Binance ahora mismo.

    `forzar=true` ademas devuelve el dia a modo automatico, pisando una tasa
    que se haya cargado a mano.
    """
    ok = tasas.refrescar(db, forzar=forzar)
    if not ok:
        raise HTTPException(
            status_code=503,
            detail="No hay conexion con el BCV ni con las fuentes de respaldo. "
            "Puedes cargar la tasa a mano mientras tanto.",
        )
    return tasas.estado(db)


@router.put("", response_model=schemas.EstadoTasa)
def fijar(body: schemas.TasaManual, db: Session = Depends(get_db)):
    """Fija a mano la tasa con la que se cobra hoy. Manda sobre lo automatico."""
    if body.bcv <= 0:
        raise HTTPException(status_code=400, detail="La tasa debe ser mayor que cero")
    tasas.fijar_manual(db, body.bcv, body.paralelo)
    return tasas.estado(db)


@router.get("/historial", response_model=List[schemas.PuntoTasa])
def historial(rango: Rango = Depends(), db: Session = Depends(get_db)):
    """La tasa dia por dia. Sin rango, los ultimos 30 dias."""
    inicio, fin, _ = rango.resolver(dias=30)
    return [
        schemas.PuntoTasa(
            fecha=t.fecha.isoformat(),
            bcv=t.bcv,
            paralelo=t.paralelo,
            origen=t.origen or "auto",
        )
        for t in tasas.historial(db, inicio.date(), fin.date())
    ]
