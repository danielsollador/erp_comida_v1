import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import combos, contabilidad, costeo, impuestos, models, schemas, tasas
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
    """Numero de comanda del dia. Sigue al ultimo asignado, no a la cantidad de
    pedidos: contar pedidos repetia el numero apenas se anulaba o borraba uno,
    y en cocina dos comandas con el mismo numero es un problema real."""
    inicio = inicio_del_dia(hoy())
    ultimo = (
        db.query(models.Pedido)
        .filter(models.Pedido.creado_en >= inicio)
        .order_by(models.Pedido.numero.desc())
        .first()
    )
    return (ultimo.numero + 1) if ultimo else 1


def _costo_por_variante(variante_ids: List[int], db: Session) -> Dict[int, float]:
    """Costo real de insumos de cada variante, segun su receta.

    Usa costo_efectivo (costo_unitario ajustado por rendimiento de cocina), no
    costo_unitario a secas - si 1kg de carne rinde 85% despues de limpiarla,
    el costo real por kg utilizable es mayor al precio de compra, y el margen
    que se le muestra al dueno tiene que reflejar eso.
    """
    recetas = (
        db.query(models.RecetaItem).filter(models.RecetaItem.variante_id.in_(variante_ids)).all()
    )
    costos: Dict[int, float] = {}
    for receta in recetas:
        aporte = receta.cantidad_por_unidad * (receta.ingrediente.costo_efectivo or 0)
        costos[receta.variante_id] = costos.get(receta.variante_id, 0) + aporte
    return costos


def _recetas_por_variante(variante_ids: List[int], db: Session) -> Dict[int, List[models.RecetaItem]]:
    recetas = (
        db.query(models.RecetaItem).filter(models.RecetaItem.variante_id.in_(variante_ids)).all()
    )
    por_variante: Dict[int, List[models.RecetaItem]] = {}
    for receta in recetas:
        por_variante.setdefault(receta.variante_id, []).append(receta)
    return por_variante


def _consumo_del_pedido(items, recetas_por_variante) -> Dict[models.Ingrediente, float]:
    """Cuanto sale del inventario por cada insumo para producir el pedido."""
    consumo: Dict[models.Ingrediente, float] = {}
    for item in items:
        for receta in recetas_por_variante.get(item.variante_id, []):
            bruto = costeo.consumo_bruto(receta, item.cantidad)
            consumo[receta.ingrediente] = consumo.get(receta.ingrediente, 0) + bruto
    return consumo


def _faltantes(consumo: Dict[models.Ingrediente, float]) -> List[str]:
    return [
        f"{ing.nombre} (quedan {ing.stock_actual:g} {ing.unidad}, hacen falta {cantidad:.3g})"
        for ing, cantidad in consumo.items()
        if (ing.stock_actual or 0) < cantidad
    ]


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
    for item in pedido.items:
        if item.variante_id not in variantes:
            raise HTTPException(status_code=404, detail=f"Variante {item.variante_id} no existe")

    costos = _costo_por_variante(list(variantes.keys()), db)
    recetas = _recetas_por_variante(list(variantes.keys()), db)
    consumo = _consumo_del_pedido(pedido.items, recetas)

    # El inventario se mueve ACA, no al cobrar: la cocina empieza a gastar
    # insumos apenas le llega la comanda. Descontar al cobrar dejaba una
    # ventana donde el sistema creia tener lo que ya estaba en el sarten, y
    # hacia que un pedido anulado despues de prepararse no descontara nada.
    faltantes = _faltantes(consumo)
    if faltantes and not pedido.permitir_sin_stock:
        raise HTTPException(
            status_code=409,
            detail="No alcanza el inventario para: " + "; ".join(faltantes),
        )

    db_pedido = models.Pedido(numero=_siguiente_numero(db), nota=pedido.nota)
    db.add(db_pedido)
    db.flush()

    for item in pedido.items:
        variante = variantes[item.variante_id]
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

    for ingrediente, cantidad in consumo.items():
        ingrediente.stock_actual = (ingrediente.stock_actual or 0) - cantidad
        # Se deja constancia de lo que salio: si la receta cambia mientras el
        # pedido esta en cocina, al anularlo hay que devolver esto y no lo que
        # diria la receta nueva.
        db.add(
            models.PedidoConsumo(
                pedido_id=db_pedido.id, ingrediente_id=ingrediente.id, cantidad=cantidad
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

    if body.facturado and body.numero_factura:
        # El numero lo transcribe el dueno de su talonario. Repetirlo mete dos
        # facturas con el mismo numero en el Libro de Ventas, y eso es un
        # problema fiscal, no cosmetico.
        repetido = (
            db.query(models.Pedido)
            .filter(
                models.Pedido.numero_factura == body.numero_factura,
                models.Pedido.id != pedido_id,
            )
            .first()
        )
        if repetido:
            raise HTTPException(
                status_code=409,
                detail=f"La factura {body.numero_factura} ya se uso en el pedido #{repetido.numero}.",
            )

    pedido.estado = "pagado"
    pedido.metodo_pago = body.metodo_pago
    pedido.cerrado_en = ahora()
    # No todas las ventas se facturan - el dueno decide cual factura a mano
    # aqui mismo, al cobrar. Solo esa entra al Libro de Ventas y genera IVA.
    pedido.facturado = body.facturado
    pedido.numero_factura = body.numero_factura if body.facturado else None
    # Se congela la tasa del momento del cobro: el reporte en bolivares de la
    # semana pasada tiene que seguir mostrando los Bs que entraron entonces, no
    # los que darian los mismos dolares a la tasa de hoy. Igual con el IVA: si
    # sube la alicuota despues, un mes ya facturado no debe recalcularse solo.
    vigente = tasas.tasa_vigente(db)
    pedido.tasa_bcv = vigente.bcv if vigente else None
    pedido.tasa_iva = impuestos.tasa_iva(db) if body.facturado else None
    # El stock ya se descontó al crear la comanda. Aca solo se reconoce el
    # costo contra el ingreso, que es cuando corresponde registrarlo.
    contabilidad.registrar_venta(db, pedido)
    db.commit()
    db.refresh(pedido)

    resultado = schemas.Pedido.model_validate(pedido)
    await manager.broadcast("pedido_pagado", resultado.model_dump(mode="json"))
    return resultado


@router.post("/{pedido_id}/devolver", response_model=schemas.Pedido)
async def devolver_pedido(
    pedido_id: int, body: schemas.DevolucionRequest, db: Session = Depends(get_db)
):
    """El cliente trajo la comida de vuelta y se le devuelve la plata.

    Distinto de anular: anular es para un pedido que nunca se cobro. Aca ya
    hubo venta, asi que hay que deshacerla entera. Antes la unica salida era
    registrar la devolucion como un Gasto, y eso dejaba el ingreso contado, el
    IVA debiendose por una venta que no existio y la factura en el Libro de
    Ventas.
    """
    pedido = db.query(models.Pedido).filter(models.Pedido.id == pedido_id).first()
    if not pedido:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if pedido.estado != "pagado":
        raise HTTPException(
            status_code=409,
            detail="Solo se devuelve un pedido ya cobrado. Si todavia no se cobro, anulalo.",
        )
    if pedido.devuelto:
        raise HTTPException(status_code=409, detail="Este pedido ya fue devuelto")
    if pedido.facturado and not body.nota_credito:
        raise HTTPException(
            status_code=400,
            detail="Esta venta se facturo: hace falta el numero de la nota de credito para sacarla del Libro de Ventas.",
        )

    contabilidad.registrar_devolucion(db, pedido, body.recuperable)

    # La comida que se puede revender vuelve al inventario; la que se boto ya
    # quedo reconocida como merma en el asiento.
    if body.recuperable:
        for consumo in pedido.consumos:
            consumo.ingrediente.stock_actual = (consumo.ingrediente.stock_actual or 0) + consumo.cantidad

    pedido.devuelto = True
    pedido.fecha_devolucion = ahora()
    pedido.nota_credito = body.nota_credito
    pedido.motivo_devolucion = body.motivo
    db.commit()
    db.refresh(pedido)

    resultado = schemas.Pedido.model_validate(pedido)
    await manager.broadcast("pedido_actualizado", resultado.model_dump(mode="json"))
    return resultado


@router.post("/{pedido_id}/anular", response_model=schemas.Pedido)
async def anular_pedido(
    pedido_id: int, body: Optional[schemas.AnularRequest] = None, db: Session = Depends(get_db)
):
    pedido = db.query(models.Pedido).filter(models.Pedido.id == pedido_id).first()
    if not pedido:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    # Anular algo ya cobrado descuadraria la caja del dia en silencio.
    if pedido.estado == "pagado":
        raise HTTPException(
            status_code=409,
            detail="Este pedido ya fue cobrado. Si el cliente devolvio la comida, usa Devolver.",
        )
    if pedido.estado == "anulado":
        raise HTTPException(status_code=409, detail="Este pedido ya estaba anulado")

    # Lo que pasa con los insumos depende de si la cocina alcanzo a hacerlo:
    #  - todavia no lo tocaron -> la comida no existe, el stock vuelve;
    #  - ya lo prepararon      -> se boto comida de verdad, es una merma y hay
    #                             que reconocerla como perdida, no devolverla.
    if body is not None and body.comida_preparada is not None:
        preparada = body.comida_preparada
    else:
        preparada = pedido.estado == "listo" or any(i.preparado for i in pedido.items)

    # Lo que se devuelve (o se pierde) es lo que de VERDAD salio al crear la
    # comanda, no lo que diria la receta de hoy: si la receta cambio mientras
    # el pedido estaba en cocina, recalcularla hacia aparecer o desaparecer
    # inventario de la nada.
    consumo = {c.ingrediente: c.cantidad for c in pedido.consumos}

    if preparada:
        for ingrediente, cantidad in consumo.items():
            valor = round(cantidad * (ingrediente.costo_unitario or 0), 2)
            if valor <= 0:
                continue
            db_merma = models.Merma(
                ingrediente_id=ingrediente.id,
                cantidad=cantidad,
                motivo=f"Pedido #{pedido.numero} anulado despues de prepararse",
            )
            db.add(db_merma)
            db.flush()
            contabilidad.registrar_merma(db, ingrediente, valor, db_merma.id)
    else:
        for ingrediente, cantidad in consumo.items():
            ingrediente.stock_actual = (ingrediente.stock_actual or 0) + cantidad

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
