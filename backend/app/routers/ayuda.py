"""El chat de ayuda (ver asistente_ayuda.py). Abierto a todo el que tenga
sesión, sea el rol que sea: la cocina también pregunta (ver
`permisos.PARA_TODOS`)."""

from fastapi import APIRouter, Request

from .. import asistente_ayuda, schemas

router = APIRouter(prefix="/api/ayuda", tags=["ayuda"])


@router.get("", response_model=schemas.EstadoLector)
def estado():
    return schemas.EstadoLector(activo=asistente_ayuda.activo(), lector="gemini" if asistente_ayuda.activo() else "")


@router.post("", response_model=schemas.RespuestaAyuda)
def preguntar(datos: schemas.PreguntaAyuda, request: Request):
    # Sincrona a proposito: corre en un hilo aparte y la IA tarda segundos.
    # El rol sale de la sesion, no del navegador.
    rol = request.state.sesion["rol"]
    return asistente_ayuda.responder(datos.pregunta, datos.historial, rol, datos.pantalla)
