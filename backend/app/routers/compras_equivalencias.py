"""Memoria por proveedor: los endpoints. La logica vive en `equivalencias.py`."""

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import equivalencias, models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/compras/equivalencias", tags=["compras"])


@router.post("/buscar", response_model=List[schemas.SugerenciaRenglon])
def buscar(body: schemas.BuscarEquivalenciasRequest, db: Session = Depends(get_db)):
    """Para cada renglon leido, lo que ese proveedor ya trajo antes. Solo consulta."""
    return equivalencias.buscar(db, body)


@router.post("/aprender")
def aprender(body: schemas.AprenderEquivalenciasRequest, db: Session = Depends(get_db)):
    """Despues de guardar una factura leida de una foto."""
    return {"aprendidas": equivalencias.aprender(db, body)}


@router.get("", response_model=List[schemas.Equivalencia])
def listar(db: Session = Depends(get_db)):
    filas = (
        db.query(models.EquivalenciaProveedor)
        .options(joinedload(models.EquivalenciaProveedor.ingrediente))
        .order_by(models.EquivalenciaProveedor.proveedor_rif, models.EquivalenciaProveedor.descripcion)
        .all()
    )
    return [
        schemas.Equivalencia(
            id=e.id, proveedor_rif=e.proveedor_rif, proveedor_nombre=e.proveedor_nombre or "",
            descripcion=e.descripcion,
            unidad_papel=e.unidad_papel or "", ingrediente_id=e.ingrediente_id,
            ingrediente_nombre=e.ingrediente.nombre, unidad=e.ingrediente.unidad,
            factor=e.factor, veces=e.veces, actualizado=e.actualizado,
        )
        for e in filas
    ]


@router.delete("/{equivalencia_id}")
def olvidar(equivalencia_id: int, db: Session = Depends(get_db)):
    """Una asociacion mal aprendida se olvida; la proxima factura la reaprende."""
    e = db.query(models.EquivalenciaProveedor).filter_by(id=equivalencia_id).first()
    if e is None:
        raise HTTPException(status_code=404, detail="No existe")
    db.delete(e)
    db.commit()
    return {"ok": True}
