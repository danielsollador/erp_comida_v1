import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..ws_manager import manager

router = APIRouter(prefix="/api/pedidos", tags=["pedidos"])


@router.get("", response_model=List[schemas.Pedido])
def listar_pedidos(estado: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(models.Pedido)
    if estado:
        query = query.filter(models.Pedido.estado == estado)
    return query.order_by(models.Pedido.id.desc()).all()


def _siguiente_numero(db: Session) -> int:
    hoy = datetime.datetime.utcnow().date()
    inicio = datetime.datetime(hoy.year, hoy.month, hoy.day)
    count = db.query(models.Pedido).filter(models.Pedido.creado_en >= inicio).count()
    return count + 1


@router.post("", response_model=schemas.Pedido)
async def crear_pedido(pedido: schemas.PedidoCreate, db: Session = Depends(get_db)):
    if not pedido.items:
        raise HTTPException(status_code=400, detail="El pedido necesita al menos un item")

    productos = {
        p.id: p
        for p in db.query(models.Producto).filter(
            models.Producto.id.in_([i.producto_id for i in pedido.items])
        )
    }

    db_pedido = models.Pedido(numero=_siguiente_numero(db), nota=pedido.nota)
    db.add(db_pedido)
    db.flush()

    for item in pedido.items:
        producto = productos.get(item.producto_id)
        if not producto:
            raise HTTPException(status_code=404, detail=f"Producto {item.producto_id} no existe")
        db.add(
            models.PedidoItem(
                pedido_id=db_pedido.id,
                producto_id=producto.id,
                nombre=producto.nombre,
                precio_unitario=producto.precio,
                cantidad=item.cantidad,
                nota=item.nota,
            )
        )

    db.commit()
    db.refresh(db_pedido)

    resultado = schemas.Pedido.model_validate(db_pedido)
    await manager.broadcast("pedido_nuevo", resultado.model_dump())
    return resultado


@router.post("/items/{item_id}/preparado", response_model=schemas.Pedido)
async def marcar_item_preparado(item_id: int, db: Session = Depends(get_db)):
    item = db.query(models.PedidoItem).filter(models.PedidoItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item no encontrado")
    item.preparado = not item.preparado
    db.commit()

    pedido = db.query(models.Pedido).filter(models.Pedido.id == item.pedido_id).first()
    if pedido.items and all(i.preparado for i in pedido.items) and pedido.estado == "pendiente":
        pedido.estado = "listo"
        db.commit()
        db.refresh(pedido)

    resultado = schemas.Pedido.model_validate(pedido)
    await manager.broadcast("pedido_actualizado", resultado.model_dump())
    return resultado


@router.post("/{pedido_id}/cobrar", response_model=schemas.Pedido)
async def cobrar_pedido(pedido_id: int, body: schemas.CobrarRequest, db: Session = Depends(get_db)):
    pedido = db.query(models.Pedido).filter(models.Pedido.id == pedido_id).first()
    if not pedido:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    pedido.estado = "pagado"
    pedido.metodo_pago = body.metodo_pago
    pedido.cerrado_en = datetime.datetime.utcnow()
    db.commit()
    db.refresh(pedido)

    resultado = schemas.Pedido.model_validate(pedido)
    await manager.broadcast("pedido_pagado", resultado.model_dump())
    return resultado


@router.post("/{pedido_id}/anular", response_model=schemas.Pedido)
async def anular_pedido(pedido_id: int, db: Session = Depends(get_db)):
    pedido = db.query(models.Pedido).filter(models.Pedido.id == pedido_id).first()
    if not pedido:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    pedido.estado = "anulado"
    db.commit()
    db.refresh(pedido)

    resultado = schemas.Pedido.model_validate(pedido)
    await manager.broadcast("pedido_actualizado", resultado.model_dump())
    return resultado
