"""Alertas de precio: los endpoints. La logica vive en `alertas_precio.py`."""

import json
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session, joinedload

from .. import alertas_precio, models, schemas
from ..acceso import auth
from ..database import get_db
from ..timeutils import ahora

router = APIRouter(prefix="/api/compras", tags=["compras"])


def alerta_a_schema(a: models.AlertaPrecio) -> schemas.AlertaPrecio:
    return schemas.AlertaPrecio(
        id=a.id, fecha=a.fecha, factura_id=a.factura_id,
        numero_factura=a.factura.numero_factura if a.factura else "",
        ingrediente_id=a.ingrediente_id,
        ingrediente_nombre=a.ingrediente.nombre if a.ingrediente else "",
        unidad=a.ingrediente.unidad if a.ingrediente else "",
        proveedor_nombre=a.proveedor_nombre or "",
        costo_anterior=a.costo_anterior, costo_nuevo=a.costo_nuevo,
        variacion_pct=a.variacion_pct, base=a.base, tipo=a.tipo,
        productos=[schemas.ProductoAfectado(**p) for p in json.loads(a.productos or "[]")],
        alternativa_proveedor=a.alternativa_proveedor or "",
        alternativa_costo=a.alternativa_costo, alternativa_fecha=a.alternativa_fecha,
        visto=bool(a.visto), visto_por=a.visto_por or "", visto_en=a.visto_en,
    )


@router.post("/facturas/{factura_id}/alertas", response_model=List[schemas.AlertaPrecio])
def alertas_de_factura(factura_id: int, db: Session = Depends(get_db)):
    """Despues de guardar la factura. Pedirlo dos veces no duplica nada."""
    factura = (
        db.query(models.FacturaCompra)
        .options(joinedload(models.FacturaCompra.items))
        .filter_by(id=factura_id)
        .first()
    )
    if factura is None:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    return [alerta_a_schema(a) for a in alertas_precio.generar(db, factura)]


@router.get("/alertas", response_model=List[schemas.AlertaPrecio])
def listar_alertas(pendientes: bool = False, db: Session = Depends(get_db)):
    q = db.query(models.AlertaPrecio).options(
        joinedload(models.AlertaPrecio.ingrediente), joinedload(models.AlertaPrecio.factura)
    )
    if pendientes:
        q = q.filter(models.AlertaPrecio.visto.is_(False))
    return [alerta_a_schema(a) for a in q.order_by(models.AlertaPrecio.id.desc()).limit(200).all()]


@router.post("/alertas/{alerta_id}/visto", response_model=schemas.AlertaPrecio)
def marcar_visto(alerta_id: int, request: Request, db: Session = Depends(get_db)):
    a = db.query(models.AlertaPrecio).filter_by(id=alerta_id).first()
    if a is None:
        raise HTTPException(status_code=404, detail="No existe")
    if not a.visto:
        a.visto = True
        a.visto_por = auth.quien(request) or ""
        a.visto_en = ahora()
        db.commit()
        db.refresh(a)
    return alerta_a_schema(a)
