import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import combos, contabilidad, models, schemas, tasas
from ..database import get_db
from ..timeutils import ahora, hoy, inicio_del_dia
from ..ws_manager import manager

router = APIRouter(prefix="/api/pedidos", tags=["pedidos"])


@router.get("", response_model=List[schemas.Pedido])
def listar_pedidos(estado: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(models.Pedido)
    if estado:
        query = query.filter(models.Pedido.estado == estado)
    return query.order_by(models.Pedido.id.desc()).all()


def _siguiente_numero(db: Session) -> int:
    inicio = inicio_del_dia(hoy())
    count = db.query(models.Pedido).filter(models.Pedido.creado_en >= inicio).count()
    return count + 1


def _costo_por_variante(variante_ids: List[int], db: Session) -> Dict[int, float]:
    """Costo de insumos de cada variante segun su receta y el costo actual."""
    recetas = (
        db.query(models.RecetaItem).filter(models.RecetaItem.variante_id.in_(variante_ids)).all()
    )
    costos: Dict[int, float] = {}
    for receta in recetas:
        aporte = receta.cantidad_por_unidad * (receta.ingrediente.costo_unitario or 0)
        costos[receta.variante_id] = costos.get(receta.variante_id, 0) + aporte
    return costos


@router.post("", response_model=schemas.Pedido)
async def crear_pedido(pedido: schemas.PedidoCreate, db: Session = Depends(get_db)):
    if not pedido.items:
        raise HTTPException(status_code=400, detail="El pedido necesita al menos un item")

    variantes = {
        v.id: v
        for v in db.query(models.Variante).filter(
            models.Variante.id.in_([i.variante_id for i in pedido.items])
        )
    }

    costos = _costo_por_variante(list(variantes.keys()), db)

    db_pedido = models.Pedido(numero=_siguiente_numero(db), nota=pedido.nota)
    db.add(db_pedido)
    db.flush()

    for item in pedido.items:
        variante = variantes.get(item.variante_id)
        if not variante:
            raise HTTPException(status_code=404, detail=f"Variante {item.variante_id} no existe")
        nombre = variante.producto.nombre
        if variante.nombre and variante.nombre.lower() != "regular":
            nombre = f"{nombre} - {variante.nombre}"
        db.add(
            models.PedidoItem(
                pedido_id=db_pedido.id,
                variante_id=variante.id,
                nombre=nombre,
                precio_unitario=variante.precio,
                costo_unitario=round(costos.get(variante.id, 0), 4),
                cantidad=item.cantidad,
                nota=item.nota,
            )
        )

    db.commit()
    db.refresh(db_pedido)

    resultado = schemas.Pedido.model_validate(db_pedido)
    await manager.broadcast("pedido_nuevo", resultado.model_dump(mode="json"))
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
    await manager.broadcast("pedido_actualizado", resultado.model_dump(mode="json"))
    return resultado


@router.post("/{pedido_id}/marcar-listo", response_model=schemas.Pedido)
async def marcar_pedido_listo(pedido_id: int, db: Session = Depends(get_db)):
    pedido = db.query(models.Pedido).filter(models.Pedido.id == pedido_id).first()
    if not pedido:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    for item in pedido.items:
        item.preparado = True
    pedido.estado = "listo"
    db.commit()
    db.refresh(pedido)

    resultado = schemas.Pedido.model_validate(pedido)
    await manager.broadcast("pedido_actualizado", resultado.model_dump(mode="json"))
    return resultado


def _descontar_insumos(pedido: models.Pedido, db: Session) -> None:
    variante_ids = [item.variante_id for item in pedido.items]
    recetas = (
        db.query(models.RecetaItem).filter(models.RecetaItem.variante_id.in_(variante_ids)).all()
    )
    recetas_por_variante: Dict[int, List[models.RecetaItem]] = {}
    for receta in recetas:
        recetas_por_variante.setdefault(receta.variante_id, []).append(receta)

    for item in pedido.items:
        for receta in recetas_por_variante.get(item.variante_id, []):
            receta.ingrediente.stock_actual -= receta.cantidad_por_unidad * item.cantidad


@router.post("/{pedido_id}/cobrar", response_model=schemas.Pedido)
async def cobrar_pedido(pedido_id: int, body: schemas.CobrarRequest, db: Session = Depends(get_db)):
    pedido = db.query(models.Pedido).filter(models.Pedido.id == pedido_id).first()
    if not pedido:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    # Sin esta guarda, un doble toque en "Cobrar" descuenta el inventario dos veces.
    if pedido.estado == "pagado":
        raise HTTPException(status_code=409, detail="Este pedido ya fue cobrado")
    if pedido.estado == "anulado":
        raise HTTPException(status_code=409, detail="No se puede cobrar un pedido anulado")

    pedido.estado = "pagado"
    pedido.metodo_pago = body.metodo_pago
    pedido.cerrado_en = ahora()
    # Se congela la tasa del momento del cobro: el reporte en bolivares de la
    # semana pasada tiene que seguir mostrando los Bs que entraron entonces, no
    # los que darian los mismos dolares a la tasa de hoy.
    vigente = tasas.tasa_vigente(db)
    pedido.tasa_bcv = vigente.bcv if vigente else None
    _descontar_insumos(pedido, db)
    contabilidad.registrar_venta(db, pedido)
    db.commit()
    db.refresh(pedido)

    resultado = schemas.Pedido.model_validate(pedido)
    await manager.broadcast("pedido_pagado", resultado.model_dump(mode="json"))
    return resultado


@router.post("/{pedido_id}/anular", response_model=schemas.Pedido)
async def anular_pedido(pedido_id: int, db: Session = Depends(get_db)):
    pedido = db.query(models.Pedido).filter(models.Pedido.id == pedido_id).first()
    if not pedido:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    # Anular algo ya cobrado descuadraria la caja del dia en silencio.
    if pedido.estado == "pagado":
        raise HTTPException(
            status_code=409,
            detail="Este pedido ya fue cobrado. Para devolver el dinero registra la salida en Gastos.",
        )

    pedido.estado = "anulado"
    db.commit()
    db.refresh(pedido)

    resultado = schemas.Pedido.model_validate(pedido)
    await manager.broadcast("pedido_actualizado", resultado.model_dump(mode="json"))
    return resultado


@router.get("/sugerencias", response_model=List[schemas.Sugerencia])
def sugerencias(variantes: str = "", db: Session = Depends(get_db)):
    """Que ofrecerle al cliente para completar la comanda que se esta armando.

    `variantes` llega como lista separada por comas ("3,7") porque el POS la
    arma desde las teclas del carrito en cada toque.
    """
    try:
        ids = [int(v) for v in variantes.split(",") if v.strip()]
    except ValueError:
        raise HTTPException(status_code=400, detail="Lista de variantes invalida")
    if not ids:
        return []
    return combos.sugerir(db, ids)
