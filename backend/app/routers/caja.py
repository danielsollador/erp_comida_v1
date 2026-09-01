import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import contabilidad, models, schemas
from ..database import get_db
from ..timeutils import hoy, inicio_del_dia

router = APIRouter(prefix="/api/caja", tags=["caja"])


def _rango_hoy():
    inicio = inicio_del_dia(hoy())
    return inicio, inicio + datetime.timedelta(days=1)


def _pedidos_pagados_hoy(db: Session):
    inicio, fin = _rango_hoy()
    return (
        db.query(models.Pedido)
        .filter(
            models.Pedido.estado == "pagado",
            models.Pedido.cerrado_en >= inicio,
            models.Pedido.cerrado_en < fin,
        )
        .all()
    )


def _gastos_efectivo_hoy(db: Session) -> float:
    inicio, fin = _rango_hoy()
    gastos = (
        db.query(models.Gasto)
        .filter(models.Gasto.fecha >= inicio, models.Gasto.fecha < fin)
        .all()
    )
    return sum(g.monto for g in gastos)


@router.get("/resumen", response_model=schemas.ResumenCaja)
def resumen_caja(db: Session = Depends(get_db)):
    pedidos = _pedidos_pagados_hoy(db)
    por_metodo: dict = {}
    total = 0.0
    for pedido in pedidos:
        metodo = pedido.metodo_pago or "Sin especificar"
        por_metodo[metodo] = por_metodo.get(metodo, 0) + pedido.total
        total += pedido.total

    # Lo que debe haber fisicamente en la gaveta = efectivo cobrado - gastos pagados en efectivo.
    efectivo_esperado = por_metodo.get("Efectivo", 0) - _gastos_efectivo_hoy(db)

    return schemas.ResumenCaja(
        fecha=hoy().isoformat(),
        total_ventas=round(total, 2),
        por_metodo_pago={k: round(v, 2) for k, v in por_metodo.items()},
        efectivo_esperado=round(efectivo_esperado, 2),
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
    return _a_schema(db_cierre)


def _a_schema(c: models.CierreCaja) -> schemas.CierreCaja:
    return schemas.CierreCaja(
        id=c.id,
        fecha=c.fecha.isoformat(),
        total_sistema=c.total_sistema,
        efectivo_esperado=c.efectivo_esperado,
        efectivo_contado=c.efectivo_contado,
        diferencia=c.diferencia,
        nota=c.nota,
    )


@router.get("/cierres", response_model=List[schemas.CierreCaja])
def listar_cierres(db: Session = Depends(get_db)):
    cierres = db.query(models.CierreCaja).order_by(models.CierreCaja.id.desc()).limit(30).all()
    return [_a_schema(c) for c in cierres]


@router.get("/gastos", response_model=List[schemas.Gasto])
def listar_gastos(dias: int = 30, db: Session = Depends(get_db)):
    desde = inicio_del_dia(hoy()) - datetime.timedelta(days=dias)
    return (
        db.query(models.Gasto)
        .filter(models.Gasto.fecha >= desde)
        .order_by(models.Gasto.id.desc())
        .all()
    )


@router.post("/gastos", response_model=schemas.Gasto)
def crear_gasto(gasto: schemas.GastoCreate, db: Session = Depends(get_db)):
    if gasto.monto <= 0:
        raise HTTPException(status_code=400, detail="El monto debe ser mayor a cero")
    db_gasto = models.Gasto(**gasto.model_dump())
    db.add(db_gasto)
    db.flush()
    contabilidad.registrar_gasto(db, db_gasto)
    db.commit()
    db.refresh(db_gasto)
    return db_gasto


@router.delete("/gastos/{gasto_id}")
def eliminar_gasto(gasto_id: int, db: Session = Depends(get_db)):
    db_gasto = db.query(models.Gasto).filter(models.Gasto.id == gasto_id).first()
    if not db_gasto:
        raise HTTPException(status_code=404, detail="Gasto no encontrado")
    # Sin esto el asiento contable del gasto queda huerfano en los libros.
    db.query(models.AsientoContable).filter(
        models.AsientoContable.origen == "gasto", models.AsientoContable.referencia_id == gasto_id
    ).delete()
    db.delete(db_gasto)
    db.commit()
    return {"ok": True}
