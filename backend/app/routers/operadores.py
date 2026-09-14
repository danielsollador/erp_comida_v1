"""Quien esta en la caja, y en cual.

No es un sistema de seguridad: no hay contrasenas y no se bloquea nada. Es
trazabilidad. En un mostrador con una tablet compartida, un login con clave se
convierte en "todos usan el del dueno" y no se gana nada; lo que si sirve es
que cada pedido, cada anulacion, cada retiro y cada cierre queden con un nombre
y una caja detras, para que el dueno pueda revisarlo despues.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/operadores", tags=["operadores"])


def resolver(db: Session, operador_id: Optional[int]) -> Optional[models.Operador]:
    """Valida el operador que dice la tablet. None es valido: instalaciones
    viejas y pantallas que todavia no eligieron turno siguen funcionando."""
    if operador_id is None:
        return None
    operador = db.query(models.Operador).filter(models.Operador.id == operador_id).first()
    if operador is None:
        raise HTTPException(status_code=404, detail="Ese operador no existe")
    if not operador.activo:
        raise HTTPException(status_code=409, detail=f"{operador.nombre} ya no esta activo")
    return operador


@router.get("", response_model=List[schemas.Operador])
def listar(incluir_inactivos: bool = False, db: Session = Depends(get_db)):
    consulta = db.query(models.Operador)
    if not incluir_inactivos:
        consulta = consulta.filter(models.Operador.activo.is_(True))
    return consulta.order_by(models.Operador.nombre).all()


@router.post("", response_model=schemas.Operador)
def crear(body: schemas.OperadorCreate, db: Session = Depends(get_db)):
    if not body.nombre.strip():
        raise HTTPException(status_code=400, detail="El nombre no puede estar vacio")
    operador = models.Operador(
        nombre=body.nombre.strip(), rol=body.rol, punto_venta=body.punto_venta
    )
    db.add(operador)
    db.commit()
    db.refresh(operador)
    return operador


@router.put("/{operador_id}", response_model=schemas.Operador)
def actualizar(operador_id: int, body: schemas.OperadorCreate, db: Session = Depends(get_db)):
    operador = db.query(models.Operador).filter(models.Operador.id == operador_id).first()
    if not operador:
        raise HTTPException(status_code=404, detail="Operador no encontrado")
    operador.nombre = body.nombre.strip() or operador.nombre
    operador.rol = body.rol
    operador.punto_venta = body.punto_venta
    db.commit()
    db.refresh(operador)
    return operador


@router.delete("/{operador_id}")
def desactivar(operador_id: int, db: Session = Depends(get_db)):
    """Se desactiva, no se borra: sus pedidos y cierres siguen apuntando aca."""
    operador = db.query(models.Operador).filter(models.Operador.id == operador_id).first()
    if not operador:
        raise HTTPException(status_code=404, detail="Operador no encontrado")
    operador.activo = False
    db.commit()
    return {"ok": True}


# --------------------------------------------------------------- puntos de venta
puntos = APIRouter(prefix="/api/puntos-venta", tags=["operadores"])


def resolver_punto(db: Session, punto_id: Optional[int]) -> Optional[models.PuntoVenta]:
    if punto_id is None:
        return None
    punto = db.query(models.PuntoVenta).filter(models.PuntoVenta.id == punto_id).first()
    if punto is None:
        raise HTTPException(status_code=404, detail="Ese punto de venta no existe")
    return punto


@puntos.get("", response_model=List[schemas.PuntoVenta])
def listar_puntos(db: Session = Depends(get_db)):
    return (
        db.query(models.PuntoVenta)
        .filter(models.PuntoVenta.activo.is_(True))
        .order_by(models.PuntoVenta.id)
        .all()
    )


@puntos.post("", response_model=schemas.PuntoVenta)
def crear_punto(body: schemas.PuntoVentaCreate, db: Session = Depends(get_db)):
    if not body.nombre.strip():
        raise HTTPException(status_code=400, detail="El nombre no puede estar vacio")
    punto = models.PuntoVenta(nombre=body.nombre.strip())
    db.add(punto)
    db.commit()
    db.refresh(punto)
    return punto


@puntos.delete("/{punto_id}")
def desactivar_punto(punto_id: int, db: Session = Depends(get_db)):
    punto = db.query(models.PuntoVenta).filter(models.PuntoVenta.id == punto_id).first()
    if not punto:
        raise HTTPException(status_code=404, detail="Punto de venta no encontrado")
    punto.activo = False
    db.commit()
    return {"ok": True}
