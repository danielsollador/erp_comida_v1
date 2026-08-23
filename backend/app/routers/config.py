from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/config", tags=["config"])


def _get_or_create(db: Session) -> models.Configuracion:
    config = db.query(models.Configuracion).first()
    if not config:
        config = models.Configuracion(tasa_bcv=0)
        db.add(config)
        db.commit()
        db.refresh(config)
    return config


@router.get("", response_model=schemas.Configuracion)
def obtener_config(db: Session = Depends(get_db)):
    return _get_or_create(db)


@router.put("", response_model=schemas.Configuracion)
def actualizar_config(body: schemas.Configuracion, db: Session = Depends(get_db)):
    config = _get_or_create(db)
    config.tasa_bcv = body.tasa_bcv
    db.commit()
    db.refresh(config)
    return config
