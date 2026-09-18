import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from .. import combos, contabilidad, costeo, impuestos, kardex, models, schemas, tasas
from ..database import get_db
from ..timeutils import ahora, hoy, inicio_del_dia
from ..ws_manager import manager
from . import operadores

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
async def crear_pedido(
    pedido: schemas.PedidoCreate, request: Request, db: Session = Depends(get_db)
):
    if not pedido.items:
        raise HTTPException(status_code=400, detail="El pedido necesita al menos un item")

    # Reintento de una comanda que quizas ya entro. La wifi del local se cae y
    # la cajera no sabe si el pedido llego: le da otra vez. Con la misma clave
    # se le devuelve el que ya existe, en vez de mandar dos comandas iguales a
    # cocina y descontar el inventario dos veces.
    if pedido.clave_cliente:
        ya = (
            db.query(models.Pedido)
            .filter(models.Pedido.clave_cliente == pedido.clave_cliente)
            .first()
        )
        if ya is not None:
            return schemas.Pedido.model_validate(ya)

    # Venta libre: renglones que no estan en el menu. No mueven inventario
    # (no tienen receta) y su costo queda en cero, que es honesto: el sistema
    # no sabe cuanto costo producir algo que no tiene cargado.
    del_menu = [i for i in pedido.items if i.variante_id is not None]
    libres = [i for i in pedido.items if i.variante_id is None]
    for item in libres:
        if not (item.nombre_libre or "").strip():
            raise HTTPException(
                status_code=400,
                detail="Una venta libre necesita un nombre para que quede en el ticket",
            )
        if not item.precio_libre or item.precio_libre <= 0:
            raise HTTPException(
                status_code=400, detail="Una venta libre necesita su precio"
            )

    variantes = {
        v.id: v
        for v in db.query(models.Variante).filter(
            models.Variante.id.in_([i.variante_id for i in del_menu])
        )
    }
    for item in del_menu:
        if item.variante_id not in variantes:
            raise HTTPException(status_code=404, detail=f"Variante {item.variante_id} no existe")

    costos = _costo_por_variante(list(variantes.keys()), db)
    recetas = _recetas_por_variante(list(variantes.keys()), db)
    consumo = _consumo_del_pedido(del_menu, recetas)

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

    # Quien tomo la comanda: la sesion con la que se entro. Al cobrar se vuelve
    # a anotar quien cobro, que puede ser otra persona.
    quien_toma = operadores.del_turno(db, request)
    db_pedido = models.Pedido(
        numero=_siguiente_numero(db),
        nota=pedido.nota,
        operador_id=quien_toma.id if quien_toma else None,
        clave_cliente=pedido.clave_cliente,
    )
    db.add(db_pedido)
    db.flush()

    for item in pedido.items:
        if item.variante_id is None:
            db.add(
                models.PedidoItem(
                    pedido_id=db_pedido.id,
                    variante_id=None,
                    nombre=item.nombre_libre.strip(),
                    precio_unitario=round(item.precio_libre, 2),
                    costo_unitario=0,
                    cantidad=item.cantidad,
                    nota=item.nota,
                )
            )
            continue
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
        kardex.anotar(
            db, ingrediente, -cantidad, kardex.VENTA,
            origen="pedido", referencia_id=db_pedido.id,
            nota=f"Comanda #{db_pedido.numero}",
            operador_id=quien_toma.id if quien_toma else None,
        )
        # Se deja constancia de lo que salio: si la receta cambia mientras el
        # pedido esta en cocina, al anularlo hay que devolver esto y no lo que
        # diria la receta nueva.
        db.add(
            models.PedidoConsumo(
                pedido_id=db_pedido.id, ingrediente_id=ingrediente.id, cantidad=cantidad
            )
        )

    try:
        db.commit()
    except IntegrityError:
        # Dos reintentos que llegaron juntos: el indice UNIQUE de
        # `clave_cliente` dejo pasar uno. El que perdio devuelve el pedido del
        # que gano, que es exactamente lo que el cajero queria ver.
        db.rollback()
        ya = (
            db.query(models.Pedido)
            .filter(models.Pedido.clave_cliente == pedido.clave_cliente)
            .first()
        )
        if ya is None:
            raise
        return schemas.Pedido.model_validate(ya)

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
async def cobrar_pedido(
    pedido_id: int, body: schemas.CobrarRequest, request: Request, db: Session = Depends(get_db)
):
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

    # El descuento y la propina se fijan ANTES de armar los pagos: los dos
    # cambian cuanta plata entra a la gaveta.
    if body.descuento < 0:
        raise HTTPException(status_code=400, detail="El descuento no puede ser negativo")
    if body.descuento > pedido.subtotal + 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"El descuento (${body.descuento:.2f}) es mayor que el pedido "
            f"(${pedido.subtotal:.2f}).",
        )
    if body.propina < 0:
        raise HTTPException(status_code=400, detail="La propina no puede ser negativa")
    pedido.descuento = round(body.descuento, 2)
    pedido.motivo_descuento = body.motivo_descuento
    pedido.propina = round(body.propina, 2)
    pedido.cliente = body.cliente

    # Un pago puede venir partido: $5 en efectivo y el resto por pago movil es
    # cosa de todos los dias. Sin esto habia que elegir un metodo y mentir, y
    # el cierre de caja mostraba un faltante que no existia.
    a_cobrar = pedido.a_cobrar
    pagos = body.pagos or [schemas.PagoInput(metodo=body.metodo_pago, monto=a_cobrar)]
    for pago in pagos:
        if pago.metodo not in contabilidad.CUENTA_POR_METODO_PAGO:
            raise HTTPException(
                status_code=400,
                detail=f"Forma de pago desconocida: '{pago.metodo}'. "
                f"Validas: {', '.join(sorted(contabilidad.CUENTA_POR_METODO_PAGO))}.",
            )
        if pago.monto <= 0:
            raise HTTPException(status_code=400, detail="Cada pago debe ser mayor a cero")
        if pago.recibido is not None and pago.recibido + 0.01 < pago.monto:
            raise HTTPException(
                status_code=400,
                detail=f"Recibiste ${pago.recibido:.2f} por un pago de ${pago.monto:.2f}.",
            )
        if pago.vuelto_metodo and pago.vuelto_metodo not in contabilidad.CUENTA_POR_METODO_PAGO:
            raise HTTPException(
                status_code=400, detail=f"Forma de vuelto desconocida: '{pago.vuelto_metodo}'"
            )
    if abs(round(sum(p.monto for p in pagos), 2) - round(a_cobrar, 2)) > 0.01:
        detalle = f"Los pagos suman ${sum(p.monto for p in pagos):.2f} y hay que cobrar ${a_cobrar:.2f}"
        if pedido.propina:
            detalle += f" (${pedido.total:.2f} de comida + ${pedido.propina:.2f} de propina)"
        raise HTTPException(status_code=400, detail=detalle + ".")

    if any(p.metodo == "Fiado" for p in pagos) and not body.cliente.strip():
        raise HTTPException(
            status_code=400,
            detail="Para fiar hace falta el nombre del cliente: si no, no hay a quien cobrarle.",
        )

    # Quien cobro y desde que caja. Sin esto, con dos tablets no habia forma de
    # saber cuanto entro por cada gaveta ni quien atendio.
    operador = operadores.del_turno(db, request, body.operador_id)
    punto = operadores.resolver_punto(db, body.punto_venta_id)
    pedido.operador_id = operador.id if operador else None
    pedido.punto_venta_id = punto.id if punto else None

    pedido.estado = "pagado"
    # El campo resumen sigue existiendo para mostrar de un vistazo como se pago.
    pedido.metodo_pago = pagos[0].metodo if len(pagos) == 1 else "Mixto"
    for pago in pagos:
        vuelto = round(max((pago.recibido or pago.monto) - pago.monto, 0), 2)
        db.add(
            models.PagoPedido(
                pedido_id=pedido.id,
                metodo=pago.metodo,
                monto=round(pago.monto, 2),
                recibido=round(pago.recibido, 2) if pago.recibido is not None else None,
                vuelto_metodo=(pago.vuelto_metodo or pago.metodo) if vuelto > 0 else None,
                vuelto_monto=vuelto,
            )
        )
    db.flush()
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
            kardex.anotar(
                db, consumo.ingrediente, consumo.cantidad, kardex.REVERSO,
                origen="devolucion", referencia_id=pedido.id,
                nota=f"Devolucion del pedido #{pedido.numero}: la comida se pudo revender",
            )

    pedido.devuelto = True
    pedido.fecha_devolucion = ahora()
    pedido.nota_credito = body.nota_credito
    pedido.motivo_devolucion = body.motivo
    db.commit()
    db.refresh(pedido)

    resultado = schemas.Pedido.model_validate(pedido)
    await manager.broadcast("pedido_actualizado", resultado.model_dump(mode="json"))
    return resultado


@router.get("/olvidados", response_model=List[schemas.Pedido])
def pedidos_olvidados(horas: int = 24, db: Session = Depends(get_db)):
    """Comandas abiertas hace demasiado. Su inventario ya salio."""
    limite = ahora() - datetime.timedelta(hours=horas)
    return (
        db.query(models.Pedido)
        .filter(
            models.Pedido.estado.in_(("pendiente", "listo")),
            models.Pedido.creado_en < limite,
        )
        .order_by(models.Pedido.creado_en)
        .all()
    )


@router.get("/{pedido_id}/ticket", response_model=schemas.Ticket)
def ticket(pedido_id: int, db: Session = Depends(get_db)):
    """Los datos del comprobante que el cliente se lleva.

    No habia impresion de ninguna clase en todo el sistema: el cliente no podia
    llevarse nada, la cocina no tenia respaldo en papel si se caia la tablet, y
    una factura impresa -que en Venezuela puede exigirse- no tenia por donde
    salir. El backend entrega los datos ya calculados y la pantalla los imprime
    con el dialogo del navegador, que es lo que funciona con cualquier
    impresora termica sin drivers ni servicios extra.
    """
    pedido = (
        db.query(models.Pedido)
        .options(joinedload(models.Pedido.items))
        .filter(models.Pedido.id == pedido_id)
        .first()
    )
    if not pedido:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")

    vigente = tasas.tasa_vigente(db)
    tasa = pedido.tasa_bcv or (vigente.bcv if vigente else None)
    base = iva = None
    if pedido.facturado:
        base, iva = impuestos.desglosar(
            pedido.total, pedido.tasa_iva or impuestos.IVA_DEFAULT
        )

    return schemas.Ticket(
        pedido_id=pedido.id,
        numero=pedido.numero,
        fecha=pedido.cerrado_en or pedido.creado_en,
        estado=pedido.estado,
        items=[
            schemas.TicketLinea(
                nombre=i.nombre,
                cantidad=i.cantidad,
                precio_unitario=round(i.precio_unitario, 2),
                subtotal=round(i.precio_unitario * i.cantidad, 2),
            )
            for i in pedido.items
        ],
        subtotal=pedido.subtotal,
        descuento=round(pedido.descuento or 0, 2),
        propina=round(pedido.propina or 0, 2),
        total=pedido.total,
        a_cobrar=pedido.a_cobrar,
        # Lo que el cliente de verdad paga esta en bolivares: mostrar solo
        # dolares en el ticket obliga a sacar la cuenta a mano en el mostrador.
        tasa_bcv=tasa,
        total_bs=round(pedido.a_cobrar * tasa, 2) if tasa else None,
        facturado=bool(pedido.facturado),
        numero_factura=pedido.numero_factura,
        base_imponible=base,
        iva=iva,
        pagos=[
            schemas.Pago(
                metodo=p.metodo,
                monto=p.monto,
                recibido=p.recibido,
                vuelto_metodo=p.vuelto_metodo,
                vuelto_monto=p.vuelto_monto or 0,
            )
            for p in pedido.pagos
        ],
        cliente=pedido.cliente or "",
        operador=pedido.operador,
        punto_venta=pedido.punto_venta,
    )


@router.post("/{pedido_id}/anular", response_model=schemas.Pedido)
async def anular_pedido(
    pedido_id: int,
    request: Request,
    body: Optional[schemas.AnularRequest] = None,
    db: Session = Depends(get_db),
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

    # Quien anulo. Es la operacion que un dueno ausente mas necesita poder
    # revisar: anular es la via por la que se va comida sin cobrar.
    quien = operadores.del_turno(db, request, body.operador_id if body else None)
    pedido.anulado_por_id = quien.id if quien else None

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
            kardex.anotar(
                db, ingrediente, cantidad, kardex.REVERSO,
                origen="pedido_anulado", referencia_id=pedido.id,
                nota=f"Pedido #{pedido.numero} anulado antes de prepararse",
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
