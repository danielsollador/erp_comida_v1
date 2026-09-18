import datetime
import os
import shutil

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .. import backup

router = APIRouter(prefix="/api/respaldos", tags=["respaldos"])


class ConfirmacionRestaurar(BaseModel):
    # Restaurar borra lo hecho desde el respaldo. No se dispara con un GET ni
    # con un POST vacio: el front tiene que mandar la confirmacion explicita
    # despues de mostrar cuantos pedidos y cuanta plata se pierden.
    confirmar: bool = False


def _ruta(nombre: str) -> str:
    try:
        return backup.ruta_de(nombre)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("")
def listar():
    return backup.listar_respaldos()


@router.get("/estado")
def estado():
    return backup.estado()


@router.get("/restauraciones")
def historial_restauraciones():
    return backup.restauraciones()


@router.post("/crear")
def crear():
    ruta = backup.crear_respaldo(motivo="manual")
    return {"ok": True, "archivo": os.path.basename(ruta)}


@router.get("/{nombre}/descargar")
def descargar(nombre: str):
    ruta = _ruta(nombre)
    if not os.path.isfile(ruta):
        raise HTTPException(status_code=404, detail="Respaldo no encontrado")
    # Sacar una copia de la maquina es la unica defensa contra perder el equipo
    # entero. Se anota para poder avisar cuando lleva semanas sin hacerse.
    backup.registrar_descarga(nombre)
    return FileResponse(ruta, filename=nombre, media_type="application/octet-stream")


@router.get("/{nombre}/previsualizar")
def previsualizar(nombre: str):
    """Que pasa si restauro este: cuanto se pierde. No cambia nada."""
    resultado = backup.que_se_pierde(_ruta(nombre))
    if not resultado["valido"]:
        raise HTTPException(status_code=400, detail=resultado["motivo"])
    return resultado


@router.post("/{nombre}/restaurar")
def restaurar(nombre: str, cuerpo: ConfirmacionRestaurar):
    if not cuerpo.confirmar:
        raise HTTPException(status_code=400, detail="Falta confirmar la restauración")
    resultado = backup.restaurar(_ruta(nombre), nombre)
    if not resultado["ok"]:
        raise HTTPException(status_code=400, detail=resultado["motivo"])
    return resultado


@router.post("/restaurar-archivo")
async def restaurar_desde_archivo(archivo: UploadFile = File(...), confirmar: bool = False):
    """Restaurar desde un archivo que trae el dueno (USB, telefono, correo).

    Si murio el disco, la lista de respaldos de esta maquina esta vacia: el
    unico respaldo que existe es el que alguien se llevo. Sin esto, ese archivo
    no tiene por donde entrar.
    """
    if not confirmar:
        raise HTTPException(status_code=400, detail="Falta confirmar la restauración")

    marca = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    # La extension la decide el motor: `.dump` de PostgreSQL en produccion.
    destino = os.path.join(backup.BACKUP_DIR, f"{backup.PREFIJO}{marca}_subido{backup.EXTENSION}")
    os.makedirs(backup.BACKUP_DIR, exist_ok=True)
    try:
        with open(destino, "wb") as f:
            shutil.copyfileobj(archivo.file, f)
    finally:
        await archivo.close()

    validacion = backup.validar_respaldo(destino)
    if not validacion["valido"]:
        os.remove(destino)  # no dejar basura en la lista de respaldos
        raise HTTPException(status_code=400, detail=validacion["motivo"])

    resultado = backup.restaurar(destino, archivo.filename or os.path.basename(destino))
    if not resultado["ok"]:
        raise HTTPException(status_code=400, detail=resultado["motivo"])
    return resultado
