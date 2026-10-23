"""Registrar el telefono para las notificaciones push (ver app/push.py).

La app lo llama al entrar (con el permiso ya dado) y al salir. El token no
es secreto en el sentido de una clave, pero solo sirve para mandarle avisos
a ESE telefono: se guarda atado a quien tiene la sesion.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import push
from ..acceso import auth
from ..database import get_db

router = APIRouter(prefix="/api/push", tags=["push"])


class Dispositivo(BaseModel):
    token: str
    plataforma: str = ""


@router.post("/dispositivo")
def registrar(datos: Dispositivo, request: Request, db: Session = Depends(get_db)) -> dict:
    s = auth.sesion_actual(request)
    token = datos.token.strip()
    if not push.es_token(token):
        raise HTTPException(status_code=400, detail="Ese no es un token de notificaciones.")
    push.registrar(db, s["usuario"], token, datos.plataforma)
    db.commit()
    return {"ok": True}


@router.post("/dispositivo/quitar")
def quitar(datos: Dispositivo, request: Request, db: Session = Depends(get_db)) -> dict:
    """Al salir de la cuenta: ese telefono deja de recibir avisos de esta persona."""
    auth.sesion_actual(request)
    push.quitar(db, datos.token.strip())
    db.commit()
    return {"ok": True}
