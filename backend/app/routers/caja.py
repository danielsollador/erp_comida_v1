import datetime
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/caja", tags=["caja"])


def _pedidos_pagados_hoy(db: Session):
    hoy = datetime.datetime.utcnow().date()
    inicio = datetime.datetime(hoy.year, hoy.month, hoy.day)
    return (
        db.query(models.Pedido)
        .filter(models.Pedido.estado == "pagado", models.Pedido.cerrado_en >= inicio)
        .all()
    )


@router.get("/resumen", response_model=schemas.ResumenCaja)
def resumen_caja(db: Session = Depends(get_db)):
    pedidos = _pedidos_pagados_hoy(db)
    por_metodo: dict = {}
    total = 0.0
    for pedido in pedidos:
        metodo = pedido.metodo_pago or "Sin especificar"
        por_metodo[metodo] = por_metodo.get(metodo, 0) + pedido.total
        total += pedido.total

    return schemas.ResumenCaja(
        fecha=datetime.datetime.utcnow().date().isoformat(),
        total_ventas=round(total, 2),
        por_metodo_pago={k: round(v, 2) for k, v in por_metodo.items()},
        efectivo_esperado=round(por_metodo.get("Efectivo", 0), 2),
        cantidad_pedidos=len(pedidos),
    )


@router.post("/cerrar", response_model=schemas.CierreCaja)
def cerrar_caja(body: schemas.CierreCajaRequest, db: Session = Depends(get_db)):
    resumen = resumen_caja(db)
    diferencia = round(body.efectivo_contado - resumen.efectivo_esperado, 2)
    db_cierre = models.CierreCaja(
        total_sistema=resumen.total_ventas,
        efectivo_esperado=resumen.efectivo_esperado,
        efectivo_contado=body.efectivo_contado,
        diferencia=diferencia,
        nota=body.nota,
    )
    db.add(db_cierre)
    db.commit()
    db.refresh(db_cierre)
    return schemas.CierreCaja(
        id=db_cierre.id,
        fecha=db_cierre.fecha.isoformat(),
        total_sistema=db_cierre.total_sistema,
        efectivo_esperado=db_cierre.efectivo_esperado,
        efectivo_contado=db_cierre.efectivo_contado,
        diferencia=db_cierre.diferencia,
        nota=db_cierre.nota,
    )


@router.get("/cierres", response_model=List[schemas.CierreCaja])
def listar_cierres(db: Session = Depends(get_db)):
    cierres = db.query(models.CierreCaja).order_by(models.CierreCaja.id.desc()).limit(30).all()
    return [
        schemas.CierreCaja(
            id=c.id,
            fecha=c.fecha.isoformat(),
            total_sistema=c.total_sistema,
            efectivo_esperado=c.efectivo_esperado,
            efectivo_contado=c.efectivo_contado,
            diferencia=c.diferencia,
            nota=c.nota,
        )
        for c in cierres
    ]
