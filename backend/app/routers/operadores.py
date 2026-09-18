"""Quien esta en la caja, y en cual.

No es un sistema de seguridad: no hay contrasenas y no se bloquea nada. Es
trazabilidad. En un mostrador con una tablet compartida, un login con clave se
convierte en "todos usan el del dueno" y no se gana nada; lo que si sirve es
que cada pedido, cada anulacion, cada retiro y cada cierre queden con un nombre
y una caja detras, para que el dueno pueda revisarlo despues.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas
from ..acceso import auth, permisos
from ..database import get_db

router = APIRouter(prefix="/api/operadores", tags=["operadores"])


def del_turno(db: Session, request: Request, operador_id: Optional[int] = None) -> Optional[models.Operador]:
    """El operador de ESTA accion: quien tiene la sesion abierta.

    Desde que el ERP tiene login, "quien esta en la caja" ya no se elige en un
    desplegable: es quien entro con su clave. A cada usuario le corresponde un
    operador con su mismo nombre, que se crea la primera vez que hace algo y se
    reactiva si estaba dado de baja. Asi los pedidos, cierres y retiros siguen
    apuntando a la tabla de operadores --con su historial intacto-- y el nombre
    que aparece es el de la cuenta con la que se entro.

    El `operador_id` que mande la tablet solo se usa si NO hay sesion (una
    instalacion vieja sin login), y ni asi puede ser uno inactivo.
    """
    usuario = auth.quien(request)
    if not usuario:
        return resolver(db, operador_id)
    operador = (
        db.query(models.Operador)
        .filter(func.lower(models.Operador.nombre) == usuario.lower())
        .first()
    )
    if operador is None:
        rol = getattr(request.state, "sesion", {}).get("rol")
        operador = models.Operador(
            nombre=usuario,
            rol="dueno" if permisos.administra(rol) else "cajero",
            activo=True,
        )
        db.add(operador)
        db.flush()
    elif not operador.activo:
        operador.activo = True
    return operador


def resolver(db: Session, operador_id: Optional[int]) -> Optional[models.Operador]:
    """Valida el operador que dice la tablet. None es valido: instalaciones
    viejas y pantallas que todavia no eligieron turno siguen funcionando."""
    if operador_id is None:
        return None
    operador = db.query(models.Operador).filter(models.Operador.id == operador_id).first()
    if operador is None:
        raise HTTPException(status_code=404, detail="Ese operador no existe")
    if not operador.activo:
        raise HTTPException(status_code=409, detail=f"{operador.nombre} ya no está activo")
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
        raise HTTPException(status_code=400, detail="El nombre no puede estar vacío")
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
        raise HTTPException(status_code=400, detail="El nombre no puede estar vacío")
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
