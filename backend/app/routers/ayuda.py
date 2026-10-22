"""El chat de ayuda (ver asistente_ayuda.py). Abierto a todo el que tenga
sesión, sea el rol que sea: la cocina también pregunta (ver
`permisos.PARA_TODOS`)."""

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from .. import asistente_ayuda, pregunta_negocio, schemas
from ..database import get_db

router = APIRouter(prefix="/api/ayuda", tags=["ayuda"])


@router.get("", response_model=schemas.EstadoAyuda)
def estado(request: Request):
    activo = asistente_ayuda.activo()
    rol = request.state.sesion["rol"]
    return schemas.EstadoAyuda(activo=activo, negocio=activo and pregunta_negocio.puede_preguntar(rol))


@router.post("", response_model=schemas.RespuestaAyuda)
def preguntar(datos: schemas.PreguntaAyuda, request: Request):
    # Sincrona a proposito: corre en un hilo aparte y la IA tarda segundos.
    # El rol sale de la sesion, no del navegador.
    rol = request.state.sesion["rol"]
    return asistente_ayuda.responder(datos.pregunta, datos.historial, rol, datos.pantalla)


@router.post("/negocio", response_model=schemas.RespuestaNegocio)
def preguntar_al_negocio(datos: schemas.PreguntaAyuda, request: Request, db: Session = Depends(get_db)):
    """Pregúntale a tu negocio: la IA elige la consulta, el sistema la
    calcula con los permisos de quien pregunta (ver pregunta_negocio.py)."""
    rol = request.state.sesion["rol"]
    return pregunta_negocio.responder(db, datos.pregunta, datos.historial, rol)
