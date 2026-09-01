import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import contabilidad, models, schemas
from ..database import get_db
from ..timeutils import ahora, hoy, inicio_del_dia

router = APIRouter(prefix="/api/compras", tags=["compras"])


@router.get("/facturas", response_model=List[schemas.FacturaCompra])
def listar_facturas(dias: int = 60, db: Session = Depends(get_db)):
    desde = inicio_del_dia(hoy()) - datetime.timedelta(days=dias)
    return (
        db.query(models.FacturaCompra)
        .filter(models.FacturaCompra.fecha >= desde)
        .order_by(models.FacturaCompra.id.desc())
        .all()
    )


@router.post("/facturas", response_model=schemas.FacturaCompra)
def crear_factura(factura: schemas.FacturaCompraCreate, db: Session = Depends(get_db)):
    if factura.base_imponible <= 0:
        raise HTTPException(status_code=400, detail="La base imponible debe ser mayor a cero")
    if factura.iva < 0:
        raise HTTPException(status_code=400, detail="El IVA no puede ser negativo")

    datos = factura.model_dump()
    fecha = datos.pop("fecha") or ahora()
    db_factura = models.FacturaCompra(fecha=fecha, **datos)
    db.add(db_factura)
    db.flush()
    contabilidad.registrar_factura_compra(db, db_factura)
    db.commit()
    db.refresh(db_factura)
    return db_factura


@router.delete("/facturas/{factura_id}")
def eliminar_factura(factura_id: int, db: Session = Depends(get_db)):
    db_factura = db.query(models.FacturaCompra).filter(models.FacturaCompra.id == factura_id).first()
    if not db_factura:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    # Sin esto el asiento contable de la factura queda huerfano en los libros.
    db.query(models.AsientoContable).filter(
        models.AsientoContable.origen == "factura_compra",
        models.AsientoContable.referencia_id == factura_id,
    ).delete()
    db.delete(db_factura)
    db.commit()
    return {"ok": True}
