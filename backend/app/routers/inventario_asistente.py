"""Cargar el inventario con IA: leer, revisar y guardar (ver
asistente_inventario.py). Aparte de inventario.py para no crecerlo mas."""

from typing import List

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from .. import asistente_inventario as asistente
from .. import schemas
from ..database import get_db
from .compras_lectura import TAMANO_MAXIMO, TIPOS_DE_IMAGEN

router = APIRouter(prefix="/api/inventario/asistente", tags=["inventario"])

# Varias hojas del cuaderno, pero no un album: cada foto pesa en lo que tarda.
MAXIMO_DE_FOTOS = 6


@router.get("", response_model=schemas.EstadoLector)
def estado():
    nombre = asistente.lector_activo()
    return schemas.EstadoLector(activo=nombre is not None, lector=nombre or "")


@router.post("/leer", response_model=schemas.PropuestaRevisada)
def leer(
    texto: str = Form(""),
    fotos: List[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
):
    # Sincrona a proposito, como la lectura de facturas: corre en un hilo
    # aparte y la IA puede tardar.
    if len(fotos) > MAXIMO_DE_FOTOS:
        raise HTTPException(status_code=413, detail=f"Hasta {MAXIMO_DE_FOTOS} fotos a la vez.")
    archivos = []
    for f in fotos:
        tipo = (f.content_type or "").lower()
        if tipo not in TIPOS_DE_IMAGEN:
            raise HTTPException(status_code=415, detail="Las fotos tienen que ser JPG, PNG o WEBP.")
        dato = f.file.read(TAMANO_MAXIMO + 1)
        if len(dato) > TAMANO_MAXIMO:
            raise HTTPException(status_code=413, detail="Una foto pesa demasiado (máximo 8 MB).")
        if dato:
            archivos.append((dato, tipo))
    try:
        lectura = asistente.leer(db, texto, archivos)
    except asistente.ErrorDeLectura as e:
        raise HTTPException(status_code=422, detail=str(e))
    return asistente.revisar(db, lectura.propuesta, lector=lectura.modelo)


@router.post("/revisar", response_model=schemas.PropuestaRevisada)
def revisar(propuesta: schemas.PropuestaCarga, db: Session = Depends(get_db)):
    """Lo mismo que devuelve `leer`, para la propuesta ya corregida en
    pantalla: vuelve a cruzarla con lo que existe."""
    return asistente.revisar(db, propuesta)


@router.post("/guardar", response_model=schemas.ResultadoCarga)
def guardar(carga: schemas.PropuestaCarga, db: Session = Depends(get_db)):
    return asistente.guardar(db, carga)
