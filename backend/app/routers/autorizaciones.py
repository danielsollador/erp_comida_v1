"""Solicitudes de autorizacion: pedirla desde la caja, resolverla desde la app.

El flujo (ver `autorizaciones.py`):

  1. La cajera POST /api/autorizaciones  -> pendiente, y por WebSocket llega
     `autorizacion_pendiente` SOLO a las sesiones con rol que autoriza.
  2. El dueño POST /{id}/aprobar (o /rechazar) desde el aviso de su app.
     Por WebSocket sale `autorizacion_resuelta` para todos: la caja que
     esperaba se entera al instante.
  3. La cajera manda la operacion con `autorizacion: {solicitud_id}` y el
     endpoint de la operacion la gasta.
"""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import autorizaciones, models, schemas
from ..acceso import auth, permisos, usuarios
from ..database import get_db
from ..ws_manager import manager

router = APIRouter(prefix="/api/autorizaciones", tags=["autorizaciones"])


def _nombre(s: dict) -> str:
    return usuarios.nombre_visible(usuarios.ficha(s["usuario"]) or s)


def _quien_autoriza(request: Request) -> dict:
    s = auth.sesion_actual(request)
    if not permisos.autoriza(s.get("rol")):
        raise HTTPException(status_code=403, detail="Tu rol no autoriza operaciones.")
    return s


def _es_autorizante(sesion: dict) -> bool:
    return permisos.autoriza(sesion.get("rol"))


def _json(s) -> dict:
    return schemas.SolicitudAutorizacion.model_validate(s).model_dump(mode="json")


@router.get("", response_model=List[schemas.SolicitudAutorizacion])
def listar(request: Request, db: Session = Depends(get_db)):
    """Las pendientes. Quien autoriza ve todas; el resto, solo las suyas."""
    s = auth.sesion_actual(request)
    filas = autorizaciones.pendientes(db)
    db.commit()
    if not permisos.autoriza(s.get("rol")):
        filas = [f for f in filas if f.solicitante == s["usuario"]]
    return filas


@router.get("/historial", response_model=List[schemas.SolicitudAutorizacion])
def historial(request: Request, limite: int = 50, db: Session = Depends(get_db)):
    """Las ultimas solicitudes, resueltas o no: es el buzon de notificaciones.

    Quien autoriza ve todas las del local (lo que le pidieron y que
    respondio, aunque no tuviera la aplicacion abierta cuando llego); el
    resto ve solo las que pidio.
    """
    s = auth.sesion_actual(request)
    autorizaciones.pendientes(db)  # marca vencidas las que pasaron de hora
    q = db.query(models.SolicitudAutorizacion)
    if not permisos.autoriza(s.get("rol")):
        q = q.filter(models.SolicitudAutorizacion.solicitante == s["usuario"])
    filas = q.order_by(models.SolicitudAutorizacion.creada.desc()).limit(max(1, min(limite, 200))).all()
    db.commit()
    return filas


@router.get("/conectados")
def conectados(request: Request) -> dict:
    """Cuantas personas que autorizan tienen la aplicacion abierta ahora. Es
    lo que la caja necesita saber antes de quedarse esperando."""
    auth.sesion_actual(request)
    return {"autorizantes": manager.cuantos(_es_autorizante)}


@router.post("", response_model=schemas.SolicitudAutorizacion)
async def solicitar(
    datos: schemas.SolicitudAutorizacionCreate, request: Request, db: Session = Depends(get_db)
):
    s = auth.sesion_actual(request)
    sol = autorizaciones.crear(db, datos, s["usuario"], _nombre(s))
    db.commit()
    db.refresh(sol)
    await manager.broadcast("autorizacion_pendiente", _json(sol), filtro=_es_autorizante)
    return sol


@router.get("/{solicitud_id}", response_model=schemas.SolicitudAutorizacion)
def ver(solicitud_id: int, request: Request, db: Session = Depends(get_db)):
    s = auth.sesion_actual(request)
    sol = autorizaciones.obtener(db, solicitud_id)
    if sol.solicitante != s["usuario"] and not permisos.autoriza(s.get("rol")):
        raise HTTPException(status_code=404, detail="Esa solicitud no existe.")
    db.commit()
    return sol


async def _resolver(solicitud_id: int, request: Request, db: Session, aprobar: bool):
    s = _quien_autoriza(request)
    sol = autorizaciones.resolver(db, solicitud_id, _nombre(s), aprobar)
    db.commit()
    db.refresh(sol)
    await manager.broadcast("autorizacion_resuelta", _json(sol))
    return sol


@router.post("/{solicitud_id}/aprobar", response_model=schemas.SolicitudAutorizacion)
async def aprobar(solicitud_id: int, request: Request, db: Session = Depends(get_db)):
    return await _resolver(solicitud_id, request, db, aprobar=True)


@router.post("/{solicitud_id}/rechazar", response_model=schemas.SolicitudAutorizacion)
async def rechazar(solicitud_id: int, request: Request, db: Session = Depends(get_db)):
    return await _resolver(solicitud_id, request, db, aprobar=False)


@router.delete("/{solicitud_id}", response_model=schemas.SolicitudAutorizacion)
async def cancelar(solicitud_id: int, request: Request, db: Session = Depends(get_db)):
    """Quien la pidio se arrepiente (o cerro la ventana)."""
    s = auth.sesion_actual(request)
    sol = autorizaciones.obtener(db, solicitud_id)
    if sol.solicitante != s["usuario"] and not permisos.autoriza(s.get("rol")):
        raise HTTPException(status_code=404, detail="Esa solicitud no existe.")
    sol = autorizaciones.cancelar(db, solicitud_id)
    db.commit()
    db.refresh(sol)
    await manager.broadcast("autorizacion_resuelta", _json(sol))
    return sol
