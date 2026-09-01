from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import schemas, tasas
from ..database import get_db

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("", response_model=schemas.Configuracion)
def obtener_config(db: Session = Depends(get_db)):
    """Tasa vigente, para las pantallas que solo necesitan el numero.

    Se sirve desde la tabla de tasas y no desde una fila de configuracion
    aparte: dos lugares guardando "la tasa" terminan siempre discrepando.
    """
    vigente = tasas.tasa_vigente(db)
    return schemas.Configuracion(tasa_bcv=vigente.bcv if vigente else 0)


@router.put("", response_model=schemas.Configuracion)
def actualizar_config(body: schemas.Configuracion, db: Session = Depends(get_db)):
    """Cargar la tasa a mano desde Caja. Equivale a fijarla en el modulo de tasa."""
    if body.tasa_bcv > 0:
        tasas.fijar_manual(db, body.tasa_bcv)
    vigente = tasas.tasa_vigente(db)
    return schemas.Configuracion(tasa_bcv=vigente.bcv if vigente else 0)
