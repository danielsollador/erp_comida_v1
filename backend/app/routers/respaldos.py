import os

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from .. import backup

router = APIRouter(prefix="/api/respaldos", tags=["respaldos"])


@router.get("")
def listar():
    return backup.listar_respaldos()


@router.post("/crear")
def crear():
    ruta = backup.crear_respaldo()
    return {"ok": True, "archivo": os.path.basename(ruta)}


@router.get("/{nombre}/descargar")
def descargar(nombre: str):
    # Sin ".." ni rutas: nombre debe ser exactamente un archivo dentro de backups/.
    if "/" in nombre or "\\" in nombre or ".." in nombre:
        raise HTTPException(status_code=400, detail="Nombre de archivo invalido")
    ruta = os.path.join(backup.BACKUP_DIR, nombre)
    if not os.path.isfile(ruta):
        raise HTTPException(status_code=404, detail="Respaldo no encontrado")
    return FileResponse(ruta, filename=nombre, media_type="application/octet-stream")
