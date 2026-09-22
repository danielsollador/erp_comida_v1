import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, selectinload

from .. import combos, contabilidad, costeo, impuestos, kardex, models, schemas, tasas
from .. import autorizaciones
from ..database import get_db
from ..timeutils import ahora, hoy, inicio_del_dia
from ..ws_manager import manager
from .. import consolidacion
from .. import seed
from . import operadores

router = APIRouter(prefix="/api/pedidos", tags=["pedidos"])

# Cuanto tiempo se queda una comanda en el tablero de cocina.
#
# Sin limite, un pedido que nadie marco como preparado se queda ahi PARA
# SIEMPRE: un mes de ventas dejaba 981 comandas en la pantalla de cocina, que
# ya no es un tablero sino un archivo. Doce horas porque tiene que cubrir el
# turno completo y cruzar la medianoche -cortar por "hoy" haria desaparecer a
# las 00:00 una comanda de las 23:50 que todavia se esta cocinando- y a la vez
# soltar lo que quedo sin marcar del dia anterior, que ya no es trabajo
# pendiente sino olvido. Lo que se cocino de verdad sale del tablero al
# marcarlo, no al vencerse.
HORAS_EN_COCINA = 12

# Cuanto se queda una comanda ya cobrada y ya cocinada en el mostrador.
#
# Cuando la cocina termina y la venta ya esta cobrada, la comanda desaparecia
# de la pantalla al instante: la comida quedaba en la barra y la cajera no
# tenia donde mirar de quien era. Leider (21-sep): "cada comanda que ya fue
# cobrada y ademas ya fue cocinada tiene que prevalecer por lo menos 60
# minutos... para que el cajero pueda seguirla viendo y ver a quien darle el
# producto".
MINUTOS_PARA_ENTREGAR = 60

# Cuanto vale el candado que pone el punto de venta al abrir una comanda para
# editarla.
#
# Vence solo, y no es un detalle: mientras el candado esta puesto la cocina no
# puede tocar esa comanda. Si la cajera abre la edicion y se va a atender a
# alguien --o se le apaga la tablet-- sin vencimiento la comanda le queda
# trancada a la cocina hasta que alguien reinicie algo. Cinco minutos es mas de
# lo que toma agregar un refresco y menos de lo que la cocina puede esperar con
# la comida en el sarten. Quien sigue editando cuando vence no pierde nada: al
# guardar se vuelve a tomar el candado si nadie mas lo agarro.
MINUTOS_EDITANDO = 5


@router.get("", response_model=List[schemas.Pedido])
def listar_pedidos(
    estado: Optional[str] = None,
    en_cocina: Optional[bool] = None,
    por_entregar: Optional[bool] = None,
    del_dia: Optional[bool] = None,
    db: Session = Depends(get_db),
):
    """`en_cocina=true` es lo que pregunta la pantalla de cocina: que falta por
    preparar, sin importar si ya se cobro.

    No es lo mismo que `estado='pendiente'`. Cobrar pone `estado='pagado'`
    aunque la comida no se haya tocado -pagar antes de que salga el pedido es
    el flujo normal de un mostrador-, y con `estado='pendiente'` ese pedido
    desaparecia de cocina sin que nadie lo hubiera preparado. Lo que de verdad
    dice si falta cocinar es el detalle: si algun item no esta `preparado`, la
    cocina todavia tiene trabajo con ese pedido, este pagado o no.

    `por_entregar=true` es el otro lado: lo que ya se cobro Y ya se cocino,
    durante `MINUTOS_PARA_ENTREGAR`. Son las que estan en la barra esperando
    que el cliente las venga a buscar, y por eso las sigue viendo la caja.

    `del_dia=true` son las ventas de hoy, para consultarlas desde el
    mostrador sin salir a otro modulo.
    """
    # Sin esto, pintar 40 comandas dispara 120 consultas sueltas (renglones,
    # pagos y ediciones de cada una, una por una). `selectinload` las trae en
    # una consulta por relacion, y aguanta el `distinct()` de mas abajo.
    query = db.query(models.Pedido).options(
        selectinload(models.Pedido.items),
        selectinload(models.Pedido.pagos),
        selectinload(models.Pedido.ediciones),
    )
    if estado:
        query = query.filter(models.Pedido.estado == estado)
    if del_dia:
        query = query.filter(
            models.Pedido.estado == "pagado",
            models.Pedido.cerrado_en >= inicio_del_dia(hoy()),
        )
    if por_entregar:
        # Ya cobrada, nada pendiente en cocina, y todavia reciente. El reloj es
        # `listo_en`; para las que nunca pasaron por cocina --una botella-- no
        # existe, y entonces vale la hora del cobro.
        falta_cocinar = (
            db.query(models.PedidoItem.id)
            .filter(
                models.PedidoItem.pedido_id == models.Pedido.id,
                models.PedidoItem.preparado.is_(False),
            )
            .exists()
        )
        desde = ahora() - datetime.timedelta(minutes=MINUTOS_PARA_ENTREGAR)
        query = query.filter(
            models.Pedido.estado == "pagado",
            models.Pedido.devuelto.is_(False),
            ~falta_cocinar,
            func.coalesce(models.Pedido.listo_en, models.Pedido.cerrado_en) >= desde,
        )
    if en_cocina:
        query = (
            query.filter(models.Pedido.estado != "anulado")
            # Una venta devuelta se quedaba en el tablero para siempre: sigue
            # en estado "pagado" -- la plata entro y salio de verdad -- y sus
            # renglones nunca se marcaron, asi que cumplia las dos condiciones.
            # Pero el cliente trajo la comida DE VUELTA: no hay nada que
            # cocinar, y el cocinero no tiene por que verla.
            .filter(models.Pedido.devuelto.is_(False))
            .filter(models.Pedido.creado_en >= ahora() - datetime.timedelta(hours=HORAS_EN_COCINA))
            .join(models.PedidoItem)
            .filter(models.PedidoItem.preparado.is_(False))
            .distinct()
        )
    return query.order_by(models.Pedido.id.desc()).all()


def _buscar(db: Session, pedido_id: int) -> models.Pedido:
    pedido = db.query(models.Pedido).filter(models.Pedido.id == pedido_id).first()
    if not pedido:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    return pedido


def edicion_viva(pedido: models.Pedido) -> bool:
    """Si el punto de venta tiene esta comanda abierta AHORA MISMO."""
    if not pedido.editando_desde:
        return False
    return pedido.editando_desde >= ahora() - datetime.timedelta(minutes=MINUTOS_EDITANDO)


def la_tiene_cocina(pedido: models.Pedido) -> bool:
    """Si la comanda esta EN EL SARTEN ahora mismo.

    Las dos condiciones son necesarias, y la segunda es la que evita un error
    caro: `cocinando_desde` no se limpia solo, asi que sin mirar los renglones
    una comanda que la cocina despacho hace tres horas seguiria "en
    preparacion" para siempre, y la caja no podria corregir NUNCA una venta ya
    cobrada -- que es justo el caso para el que se hizo la edicion.

    Cuando ya no queda nada por preparar, la cocina termino y suelta la
    comanda. Editarla desde ahi sigue siendo posible, pero lo que se quite es
    comida hecha y se trata como merma, no como inventario que vuelve.
    """
    if not pedido.cocinando_desde:
        return False
    return any(not i.preparado for i in pedido.items)


def _nombre_de_variante(variante: models.Variante) -> str:
    """Como se llama el renglon en la comanda y en el ticket."""
    nombre = variante.producto.nombre
    if variante.nombre and variante.nombre.lower() != "regular":
        nombre = f"{nombre} - {variante.nombre}"
    return nombre


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


def _nace_preparado(
    variante: models.Variante,
    receta: Optional[List[models.RecetaItem]],
    categoria_envios_id: Optional[int],
) -> bool:
    """Si este renglon NO pasa por la cocina y nace ya "preparado".

    La regla anterior era "sin receta = nada que cocinar". Servia para el
    delivery y la gaseosa, pero en un local que arranca sin recetas cargadas
    --que es como arranca todo local-- volvia TODA comanda algo que no se
    cocina: el pastelito nacia preparado, la cocina nunca lo veia y el
    mostrador tampoco (ver `crear_pedido`). Invisible es peor que un toque de
    mas en cocina.

    Ahora nace preparado solo lo que de verdad no se cocina:
      - un envio (la categoria de envios, se llame como se llame);
      - un producto cuya receta es toda mercancia de reventa: la botella de
        agua que se compra y se vende tal cual.
    Sin receta, o con receta que lleva materia prima, va a cocina.
    """
    # La receta manda sobre la categoria: algo que lleva materia prima se
    # cocina este donde este (una torta que se entrega a domicilio igual pasa
    # por el horno). La categoria de envios solo decide para lo que NO tiene
    # receta, que es el caso del delivery.
    if receta:
        return all(r.ingrediente.tipo == "reventa" for r in receta)
    return categoria_envios_id is not None and variante.producto.categoria_id == categoria_envios_id


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


def _vender_sin_inventario(db: Session) -> bool:
    """Si el local esta arrancando y el control de inventario esta apagado.

    Bypasea el bloqueo entero, no solo lo avisa: con el interruptor prendido
    ninguna venta se traba por stock, sin importar lo que digan las recetas.
    """
    fila = db.query(models.Configuracion).first()
    return bool(fila and fila.vender_sin_inventario)


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
    envios = seed.categoria_envios(db)
    categoria_envios_id = envios.id if envios else None

    # El inventario se mueve ACA, no al cobrar: la cocina empieza a gastar
    # insumos apenas le llega la comanda. Descontar al cobrar dejaba una
    # ventana donde el sistema creia tener lo que ya estaba en el sarten, y
    # hacia que un pedido anulado despues de prepararse no descontara nada.
    faltantes = _faltantes(consumo)
    if faltantes and not pedido.permitir_sin_stock and not _vender_sin_inventario(db):
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
        cliente=(pedido.cliente or "").strip(),
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
                    preparado=bool(item.preparado),
                )
            )
            continue
        variante = variantes[item.variante_id]
        nombre = _nombre_de_variante(variante)
        db.add(
            models.PedidoItem(
                pedido_id=db_pedido.id,
                variante_id=variante.id,
                nombre=nombre,
                precio_unitario=variante.precio,
                costo_unitario=round(costos.get(variante.id, 0), 4),
                cantidad=item.cantidad,
                nota=item.nota,
                preparado=_nace_preparado(variante, recetas.get(variante.id), categoria_envios_id),
            )
        )

    # Si ningun renglon necesita cocina, la comanda nace "lista": es la misma
    # regla de marcar-listo, aplicada al nacer. Sin esto quedaba en
    # "pendiente" con todo preparado, y NINGUNA pantalla la pedia asi: ni la
    # cocina (nada por preparar), ni el mostrador (solo pide "listo" o lo
    # que falta cocinar). El POST devolvia 200 y la comanda no aparecia en
    # ningun lado -- Leider (21-sep): "le doy a enviar y no se guarda ni en
    # pedidos ni llega a cocina".
    db.flush()
    if db_pedido.items and all(i.preparado for i in db_pedido.items):
        db_pedido.estado = "listo"
        db_pedido.listo_en = ahora()

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


def _cocina_puede_tocar(pedido: models.Pedido) -> None:
    """La cocina no toca una comanda que el punto de venta esta editando.

    Es el lado de cocina del candado: si la cajera le esta quitando un renglon
    al pedido, marcar ese renglon preparado no significa nada -- el cocinero
    estaria trabajando sobre una comanda que en dos segundos va a ser otra.
    Mejor que espere treinta segundos a que haga comida que nadie pidio.
    """
    if edicion_viva(pedido):
        quien = pedido.editando_por or "El punto de venta"
        raise HTTPException(
            status_code=409,
            detail=f"{quien} está editando la comanda #{pedido.numero}. "
            "Espera a que termine: los renglones pueden cambiar.",
        )


@router.post("/{pedido_id}/cocinando", response_model=schemas.Pedido)
async def marcar_cocinando(pedido_id: int, request: Request, db: Session = Depends(get_db)):
    """La cocina agarra (o suelta) la comanda. Es un interruptor.

    Sirve para dos cosas a la vez, y las dos importan: el resto de la cocina ve
    que esa comanda ya tiene dueño, y el punto de venta deja de poder editarla.
    Lo segundo es el motivo de que exista. Hasta ahora la caja podia cambiarle
    los renglones a un pedido que ya estaba en el sarten, y el cocinero se
    enteraba cuando salia un plato que ya no era el que pedian.

    Se puede soltar porque un toque por error no puede dejar la comanda
    bloqueada para la caja sin forma de deshacerlo.
    """
    pedido = _buscar(db, pedido_id)
    if pedido.estado == "anulado":
        raise HTTPException(status_code=409, detail="Esta comanda está anulada")
    _cocina_puede_tocar(pedido)

    if pedido.cocinando_desde:
        pedido.cocinando_desde = None
        pedido.cocinando_por_id = None
    else:
        quien = operadores.del_turno(db, request)
        pedido.cocinando_desde = ahora()
        pedido.cocinando_por_id = quien.id if quien else None
    db.commit()
    db.refresh(pedido)

    resultado = schemas.Pedido.model_validate(pedido)
    await manager.broadcast("pedido_actualizado", resultado.model_dump(mode="json"))
    return resultado


@router.post("/items/{item_id}/preparado", response_model=schemas.Pedido)
async def marcar_item_preparado(item_id: int, request: Request, db: Session = Depends(get_db)):
    item = db.query(models.PedidoItem).filter(models.PedidoItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item no encontrado")
    pedido = db.query(models.Pedido).filter(models.Pedido.id == item.pedido_id).first()
    _cocina_puede_tocar(pedido)

    item.preparado = not item.preparado
    # Marcar un renglon ES empezar a cocinar. Sin esto el candado dependia de
    # que alguien se acordara de apretar un boton aparte, y el boton que la
    # cocina de verdad aprieta es este.
    if item.preparado and not pedido.cocinando_desde:
        quien = operadores.del_turno(db, request)
        pedido.cocinando_desde = ahora()
        pedido.cocinando_por_id = quien.id if quien else None
    db.commit()

    if pedido.items and all(i.preparado for i in pedido.items):
        # La hora en que la comida quedo hecha, que es desde cuando el
        # mostrador la muestra como "para entregar".
        if not pedido.listo_en:
            pedido.listo_en = ahora()
        if pedido.estado == "pendiente":
            pedido.estado = "listo"
        db.commit()
        db.refresh(pedido)

    resultado = schemas.Pedido.model_validate(pedido)
    await manager.broadcast("pedido_actualizado", resultado.model_dump(mode="json"))
    return resultado


@router.post("/{pedido_id}/marcar-listo", response_model=schemas.Pedido)
async def marcar_pedido_listo(pedido_id: int, request: Request, db: Session = Depends(get_db)):
    pedido = _buscar(db, pedido_id)
    _cocina_puede_tocar(pedido)
    for item in pedido.items:
        item.preparado = True
    if not pedido.cocinando_desde:
        quien = operadores.del_turno(db, request)
        pedido.cocinando_desde = ahora()
        pedido.cocinando_por_id = quien.id if quien else None
    # Si ya se cobro, `estado` vale "pagado" y ASI SE QUEDA: es la señal que
    # usan caja, contabilidad, reportes e impuestos para saber que es venta
    # reconocida (17 sitios distintos). Pisarlo con "listo" aca lo hacia
    # desaparecer de todos esos calculos en silencio, aunque la venta siguiera
    # siendo real. Marcar los items como preparados es lo unico que hace falta
    # para que salga de la cola de cocina.
    if pedido.estado not in ("pagado", "anulado"):
        pedido.estado = "listo"
    if pedido.items and not pedido.listo_en:
        pedido.listo_en = ahora()
    db.commit()
    db.refresh(pedido)

    resultado = schemas.Pedido.model_validate(pedido)
    await manager.broadcast("pedido_actualizado", resultado.model_dump(mode="json"))
    return resultado


# -- Editar una comanda ya tomada --------------------------------------------
#
# Se pidio mal, el cliente cambio de idea, la cajera tecleo dos refrescos en
# vez de uno. Hasta ahora la unica salida era anular y volver a empezar, que
# manda una comanda nueva a cocina, le cambia el numero al cliente y -si ya
# estaba cobrado- ni siquiera se podia. Editar es lo que la gente de verdad
# hace, y el sistema tiene que saberlo en vez de enterarse por un descuadre.


def _clave_de_fila(fila: models.PedidoItem) -> tuple:
    """Que hace a dos renglones "el mismo" para efectos de editar.

    Del menu, la variante. De la venta libre, el nombre y el precio: es lo
    unico que la identifica, porque no existe en ningun catalogo.
    """
    if fila.variante_id is not None:
        return ("menu", fila.variante_id)
    return ("libre", (fila.nombre or "").strip().lower(), round(fila.precio_unitario or 0, 2))


def _clave_pedida(item: schemas.PedidoItemCreate) -> tuple:
    if item.variante_id is not None:
        return ("menu", item.variante_id)
    return ("libre", (item.nombre_libre or "").strip().lower(), round(item.precio_libre or 0, 2))


def _revisar_que_se_puede_editar(pedido: models.Pedido, quien_id: Optional[int]) -> None:
    """Todo lo que impide tocar esta comanda, con el motivo escrito."""
    if pedido.estado == "anulado":
        raise HTTPException(status_code=409, detail="Un pedido anulado ya no se edita")
    if pedido.devuelto:
        raise HTTPException(
            status_code=409,
            detail="Esta venta se devolvió entera. Si el cliente quiere otra cosa, es un pedido nuevo.",
        )
    if la_tiene_cocina(pedido):
        quien = pedido.cocinando_por or "La cocina"
        desde = pedido.cocinando_desde.strftime("%H:%M") if pedido.cocinando_desde else ""
        detalle = f"{quien} ya está preparando la comanda #{pedido.numero}"
        if desde:
            detalle += f" (desde las {desde})"
        raise HTTPException(
            status_code=409,
            detail=detalle + ". Habla con cocina: lo que está en el sartén ya no se cambia desde aquí.",
        )
    if edicion_viva(pedido) and pedido.editando_por_id not in (None, quien_id):
        raise HTTPException(
            status_code=409,
            detail=f"{pedido.editando_por or 'Otra caja'} está editando la comanda "
            f"#{pedido.numero} en este momento.",
        )
    # Una venta cobrada AYER ya entro al cierre de caja de ayer. Moverle el
    # monto hoy deja la gaveta de ayer diciendo una cosa y los libros otra, y
    # ese descuadre no aparece hasta que alguien cuenta billetes.
    if pedido.estado == "pagado" and pedido.cerrado_en and pedido.cerrado_en < inicio_del_dia(hoy()):
        raise HTTPException(
            status_code=409,
            detail="Esta venta es de otro día y ya entró al cierre de caja. "
            "Para corregirla usa Devolver y vuelve a cobrarla.",
        )


@router.post("/{pedido_id}/edicion", response_model=schemas.Pedido)
async def abrir_edicion(pedido_id: int, request: Request, db: Session = Depends(get_db)):
    """El punto de venta agarra la comanda para cambiarla.

    Avisa a la cocina ANTES de que el cajero empiece a tocar renglones, no
    despues: esa es toda la gracia. Mientras el candado esta puesto, la
    pantalla de cocina muestra la comanda bloqueada y no la deja marcar.
    """
    pedido = _buscar(db, pedido_id)
    quien = operadores.del_turno(db, request)
    _revisar_que_se_puede_editar(pedido, quien.id if quien else None)

    pedido.editando_desde = ahora()
    pedido.editando_por_id = quien.id if quien else None
    db.commit()
    db.refresh(pedido)

    resultado = schemas.Pedido.model_validate(pedido)
    await manager.broadcast("pedido_actualizado", resultado.model_dump(mode="json"))
    return resultado


@router.delete("/{pedido_id}/edicion", response_model=schemas.Pedido)
async def soltar_edicion(pedido_id: int, db: Session = Depends(get_db)):
    """Se cerro el cuadro de edicion sin guardar: la cocina puede seguir."""
    pedido = _buscar(db, pedido_id)
    pedido.editando_desde = None
    pedido.editando_por_id = None
    db.commit()
    db.refresh(pedido)

    resultado = schemas.Pedido.model_validate(pedido)
    await manager.broadcast("pedido_actualizado", resultado.model_dump(mode="json"))
    return resultado


def _autorizar_diferencia(
    db: Session, request: Request, body: schemas.EditarPedidoRequest,
    pedido: models.Pedido, diferencia: float,
) -> str:
    """La firma que hace falta cuando la edicion mueve plata ya cobrada.

    El caso que esto cubre no es un error de tecleo: es que a una venta ya
    pagada se le quite un renglon, la diferencia salga de la gaveta y el cierre
    del dia siga cuadrando porque el sistema tambien bajo lo que esperaba. Sin
    una firma, eso no deja rastro de ninguna clase.

    Firma con PIN quien tiene un rol que autoriza, o aprueba desde su
    aplicacion si no esta en el local (ver `autorizaciones.py`). Si quien
    esta editando ya autoriza, no se le pide nada. Lo que da el control es
    que el nombre queda escrito en la edicion y se ve en ventas.
    """
    propia = autorizaciones.firma_propia(request)
    if propia:
        return propia
    if not body.autorizacion:
        raise HTTPException(
            status_code=403,
            detail=f"Esta edición cambia ${abs(diferencia):.2f} de una venta ya cobrada. "
            + autorizaciones.SIN_FIRMA,
        )
    return autorizaciones.firmar(
        db, request, body.autorizacion, accion="editar_venta", pedido_id=pedido.id
    )


def _pagos_de_la_diferencia(
    body: schemas.EditarPedidoRequest, diferencia: float
) -> List[schemas.PagoInput]:
    """Por donde entro (o salio) la plata de la diferencia.

    Los montos vienen en positivo siempre: el signo lo pone la diferencia, no el
    cajero. Pedirle que escriba -3.00 para una devolucion es pedirle que se
    equivoque.
    """
    pagos = body.pagos or []
    falta = round(abs(diferencia), 2)
    verbo = "se cobró" if diferencia > 0 else "se devolvió"
    if not pagos:
        raise HTTPException(
            status_code=400,
            detail=f"Falta decir cómo {verbo} la diferencia de ${falta:.2f}.",
        )
    for pago in pagos:
        if pago.metodo not in contabilidad.CUENTA_POR_METODO_PAGO:
            raise HTTPException(
                status_code=400, detail=f"Forma de pago desconocida: '{pago.metodo}'."
            )
        # Fiar la diferencia abriria una cuenta por cobrar dentro de una venta
        # que ya figura cobrada, y el saldo del cliente quedaria contado por dos
        # lados. Si el cliente va a quedar debiendo, es otra venta.
        if pago.metodo == "Fiado":
            raise HTTPException(
                status_code=400,
                detail="La diferencia de una edición no se puede fiar: cóbrala o devuélvela.",
            )
        if pago.monto <= 0:
            raise HTTPException(status_code=400, detail="Cada pago debe ser mayor a cero")
        if pago.metodo in contabilidad.METODOS_CON_REFERENCIA and not (pago.referencia or "").strip():
            raise HTTPException(
                status_code=400,
                detail=f"Falta el número de referencia del pago por {pago.metodo}.",
            )
    suma = round(sum(p.monto for p in pagos), 2)
    if abs(suma - falta) > 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"Los pagos suman ${suma:.2f} y la diferencia es de ${falta:.2f}.",
        )
    return pagos


@router.put("/{pedido_id}", response_model=schemas.Pedido)
async def editar_pedido(
    pedido_id: int,
    body: schemas.EditarPedidoRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Cambia los renglones de una comanda ya tomada.

    Llega la lista COMPLETA de como tiene que quedar el pedido, no un delta: el
    POS ya lo tiene en pantalla, y mandar el estado final evita que dos
    ediciones seguidas sumen cambios sobre bases distintas.

    Lo que se mueve junto, y por eso vive todo en la misma transaccion:
      inventario   lo que se agrega sale del stock y lo que se quita vuelve,
                   contra lo que de VERDAD salio (PedidoConsumo), no contra lo
                   que diria la receta de hoy;
      plata        solo si el pedido ya estaba cobrado. Una diferencia exige
                   clave y decir por que gaveta entro o salio;
      contabilidad un asiento de ajuste por la diferencia, nunca reescribiendo
                   el asiento de la venta;
      rastro       una fila en PedidoEdicion y la marca "editado", que es lo que
                   despues se ve en cocina y en ventas.
    """
    pedido = _buscar(db, pedido_id)
    quien = operadores.del_turno(db, request)
    _revisar_que_se_puede_editar(pedido, quien.id if quien else None)

    if not body.items:
        raise HTTPException(
            status_code=400, detail="Un pedido no puede quedar vacío. Si ya no va, anúlalo."
        )

    # -- los renglones que se piden, con las mismas reglas que al crear
    for item in body.items:
        if item.cantidad <= 0:
            raise HTTPException(status_code=400, detail="Cada renglón necesita una cantidad")
        if item.variante_id is None:
            if not (item.nombre_libre or "").strip():
                raise HTTPException(
                    status_code=400,
                    detail="Una venta libre necesita un nombre para que quede en el ticket",
                )
            if not item.precio_libre or item.precio_libre <= 0:
                raise HTTPException(status_code=400, detail="Una venta libre necesita su precio")

    del_menu = [i for i in body.items if i.variante_id is not None]
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
    # Las recetas cubren lo nuevo Y lo viejo: sin las de un renglon que se
    # quita no hay con que saber cuanto inventario devolver.
    recetas = _recetas_por_variante(
        list(set(variantes) | {f.variante_id for f in pedido.items if f.variante_id}), db
    )

    # -- como queda cada renglon: lo pedido contra lo que ya estaba
    pedidas: Dict[tuple, int] = {}
    ejemplo: Dict[tuple, schemas.PedidoItemCreate] = {}
    for item in body.items:
        clave = _clave_pedida(item)
        pedidas[clave] = pedidas.get(clave, 0) + item.cantidad
        ejemplo.setdefault(clave, item)

    actuales: Dict[tuple, List[models.PedidoItem]] = {}
    for fila in pedido.items:
        actuales.setdefault(_clave_de_fila(fila), []).append(fila)

    def _precio_y_costo(clave: tuple) -> tuple:
        """El precio de un renglon que YA ESTABA no se recalcula.

        Si el menu subio de precio mientras la comanda estaba abierta, agregarle
        un refresco no puede cambiarle al cliente lo que ya le habiamos dicho
        que costaban sus empanadas. Lo que entra nuevo si va al precio de hoy.
        """
        if clave in actuales:
            fila = actuales[clave][0]
            return fila.precio_unitario, (fila.costo_unitario or 0)
        item = ejemplo[clave]
        if item.variante_id is not None:
            return variantes[item.variante_id].precio, round(costos.get(item.variante_id, 0), 4)
        return round(item.precio_libre, 2), 0.0

    nuevo_subtotal = 0.0
    nuevo_costo = 0.0
    for clave, cantidad in pedidas.items():
        precio, costo = _precio_y_costo(clave)
        nuevo_subtotal += precio * cantidad
        nuevo_costo += costo * cantidad
    nuevo_subtotal = round(nuevo_subtotal, 2)
    nuevo_costo = round(nuevo_costo, 2)

    total_antes = pedido.total
    costo_antes = round(sum((i.costo_unitario or 0) * i.cantidad for i in pedido.items), 2)
    nuevo_total = round(max(nuevo_subtotal - (pedido.descuento or 0), 0), 2)
    diferencia = round(nuevo_total - total_antes, 2)

    # -- la plata, si ya estaba cobrado
    autorizado_por = ""
    pagos: List[schemas.PagoInput] = []
    if pedido.estado == "pagado" and abs(diferencia) > 0.01:
        if pedido.facturado:
            raise HTTPException(
                status_code=409,
                detail=f"Esta venta se facturó (N° {pedido.numero_factura}). Cambiarle el monto "
                "exige una nota de crédito: usa Devolver y vuelve a cobrarla.",
            )
        # Una venta fiada no es plata en la gaveta: es una deuda del cliente,
        # con sus abonos y su saldo. Cambiarle el monto por un lado y meter el
        # vuelto en efectivo por el otro dejaria al cliente debiendo lo de
        # antes mientras la venta dice otra cosa, y el saldo que se le cobre
        # despues seria el equivocado.
        if pedido.fiado_saldo > 0:
            raise HTTPException(
                status_code=409,
                detail=f"Esta venta quedó fiada y todavía se deben ${pedido.fiado_saldo:.2f}. "
                "Cóbrala o devuélvela: editarle el monto dejaría la deuda del cliente "
                "diciendo otra cosa.",
            )
        autorizado_por = _autorizar_diferencia(db, request, body, pedido, diferencia)
        pagos = _pagos_de_la_diferencia(body, diferencia)

    # -- el inventario, renglon por renglon
    #
    # No sirve restar el consumo nuevo del viejo en bruto: quitar una empanada
    # YA HECHA y agregar dos crudas da un neto que parece inocente, y esconde
    # que se boto comida de verdad. Son tres flujos distintos y cada uno va a
    # un sitio distinto:
    #   aumento   lo que hay que sacar del deposito ahora
    #   retorno   lo que se quito y todavia no se habia tocado: vuelve al stock
    #   perdida   lo que se quito y YA ESTABA HECHO: eso no vuelve, se perdio
    aumento: Dict[models.Ingrediente, float] = {}
    retorno: Dict[models.Ingrediente, float] = {}
    perdida: Dict[models.Ingrediente, float] = {}
    costo_perdido = 0.0
    for clave in set(actuales) | set(pedidas):
        antes = sum(f.cantidad for f in actuales.get(clave, []))
        despues = pedidas.get(clave, 0)
        if antes == despues:
            continue
        if clave in actuales:
            variante_id = actuales[clave][0].variante_id
            ya_hecho = actuales[clave][0].preparado
        else:
            variante_id, ya_hecho = ejemplo[clave].variante_id, False
        # La venta libre no tiene receta: no mueve inventario, ni al entrar ni
        # al salir. Su costo tampoco se conoce, y eso es honesto.
        if variante_id is None or not recetas.get(variante_id):
            continue
        if despues > antes:
            destino, cantidad = aumento, despues - antes
        else:
            destino, cantidad = (perdida if ya_hecho else retorno), antes - despues
            if ya_hecho:
                costo_perdido += (actuales[clave][0].costo_unitario or 0) * cantidad
        for receta in recetas[variante_id]:
            bruto = costeo.consumo_bruto(receta, cantidad)
            destino[receta.ingrediente] = destino.get(receta.ingrediente, 0) + bruto
    costo_perdido = round(costo_perdido, 2)

    neto = {}
    for ingrediente in set(aumento) | set(retorno):
        cambio = round(aumento.get(ingrediente, 0) - retorno.get(ingrediente, 0), 4)
        if cambio:
            neto[ingrediente] = cambio

    faltantes = _faltantes({i: c for i, c in neto.items() if c > 0})
    if faltantes and not body.permitir_sin_stock and not _vender_sin_inventario(db):
        raise HTTPException(
            status_code=409, detail="No alcanza el inventario para: " + "; ".join(faltantes)
        )

    # -- que cambio, en palabras, antes de tocar nada
    cambios = []
    for clave in list(actuales) + [c for c in pedidas if c not in actuales]:
        antes = sum(f.cantidad for f in actuales.get(clave, []))
        despues = pedidas.get(clave, 0)
        if antes == despues:
            continue
        if clave in actuales:
            nombre = actuales[clave][0].nombre
        else:
            item = ejemplo[clave]
            nombre = (
                _nombre_de_variante(variantes[item.variante_id])
                if item.variante_id is not None
                else item.nombre_libre.strip()
            )
        if despues == 0:
            cambios.append(f"quitado {nombre} (x{antes})")
        elif antes == 0:
            cambios.append(f"+{despues} {nombre}")
        else:
            cambios.append(f"{nombre}: {antes} -> {despues}")

    if not cambios and (body.nota is None or body.nota == pedido.nota):
        raise HTTPException(status_code=400, detail="No hay ningún cambio que guardar")

    # -- se aplica
    for clave, cantidad in pedidas.items():
        filas = actuales.get(clave)
        if filas:
            fila = filas[0]
            # Si la misma cosa estaba en dos renglones, se consolida en uno.
            for sobrante in filas[1:]:
                db.delete(sobrante)
            antes = sum(f.cantidad for f in filas)
            # Hay comida nueva que hacer: vuelve a la cola de cocina aunque el
            # renglon ya estuviera marcado.
            if cantidad > antes:
                fila.preparado = False
            fila.cantidad = cantidad
        else:
            item = ejemplo[clave]
            precio, costo = _precio_y_costo(clave)
            if item.variante_id is not None:
                nombre = _nombre_de_variante(variantes[item.variante_id])
                # Misma regla que al crear: sin receta no hay nada que cocinar.
                nace_preparado = not recetas.get(item.variante_id)
            else:
                nombre = item.nombre_libre.strip()
                # Igual que al crear: una venta libre no tiene receta que
                # consultar, asi que por defecto la marca cocina a mano (puede
                # ser un encargo de verdad). Quien sabe que no hay nada que
                # cocinar -- un delivery personalizado -- lo dice.
                nace_preparado = bool(item.preparado)
            db.add(
                models.PedidoItem(
                    pedido_id=pedido.id,
                    variante_id=item.variante_id,
                    nombre=nombre,
                    precio_unitario=precio,
                    costo_unitario=costo,
                    cantidad=cantidad,
                    nota=item.nota,
                    preparado=nace_preparado,
                )
            )
    for clave, filas in actuales.items():
        if clave not in pedidas:
            for fila in filas:
                db.delete(fila)

    for ingrediente, cambio in neto.items():
        kardex.anotar(
            db, ingrediente, -cambio,
            kardex.VENTA if cambio > 0 else kardex.REVERSO,
            origen="pedido_editado", referencia_id=pedido.id,
            nota=f"Comanda #{pedido.numero} editada",
            operador_id=quien.id if quien else None,
        )

    # La comida que ya estaba hecha y se quito no pasa por el kardex: esos
    # insumos salieron del deposito cuando se tomo la comanda y no volvieron.
    # Lo que hace falta es reconocer la perdida, igual que al anular un pedido
    # que la cocina alcanzo a preparar.
    for ingrediente, cantidad in perdida.items():
        db_merma = models.Merma(
            ingrediente_id=ingrediente.id,
            cantidad=round(cantidad, 4),
            motivo=f"Pedido #{pedido.numero} editado: comida ya preparada",
            operador_id=quien.id if quien else None,
        )
        db.add(db_merma)
        db.flush()
        # Una venta ya cobrada tiene su costo reconocido en 5010, asi que la
        # perdida se saca de ahi dentro del asiento de ajuste. Una que todavia
        # no se cobro nunca lo reconocio: ahi la merma sale del inventario, que
        # es exactamente lo que hace `registrar_merma`.
        if pedido.estado != "pagado":
            contabilidad.registrar_merma(
                db, ingrediente, round(cantidad * (ingrediente.costo_unitario or 0), 2), db_merma.id
            )

    # Lo que este pedido tiene consumido AHORA: lo que ya habia, mas lo que
    # entro, menos lo que volvio y lo que se boto. Se arrastra el registro
    # viejo en vez de recalcularlo desde las recetas de hoy, porque si una
    # receta cambio mientras la comanda estaba abierta, recalcular haria
    # aparecer o desaparecer insumos que nadie movio.
    consumo_viejo = {c.ingrediente: c.cantidad for c in pedido.consumos}
    for consumo in list(pedido.consumos):
        db.delete(consumo)
    db.flush()
    for ingrediente in set(consumo_viejo) | set(aumento) | set(retorno) | set(perdida):
        queda = round(
            consumo_viejo.get(ingrediente, 0)
            + aumento.get(ingrediente, 0)
            - retorno.get(ingrediente, 0)
            - perdida.get(ingrediente, 0),
            4,
        )
        if queda > 0:
            db.add(
                models.PedidoConsumo(
                    pedido_id=pedido.id, ingrediente_id=ingrediente.id, cantidad=queda
                )
            )

    if body.nota is not None:
        pedido.nota = body.nota

    if pedido.estado == "pagado":
        signo = 1 if diferencia > 0 else -1
        for pago in pagos:
            db.add(
                models.PagoPedido(
                    pedido_id=pedido.id,
                    metodo=pago.metodo,
                    monto=round(signo * pago.monto, 2),
                    referencia=(pago.referencia or "").strip(),
                )
            )
        db.flush()
        db.refresh(pedido)
        metodos = {p.metodo for p in pedido.pagos}
        pedido.metodo_pago = list(metodos)[0] if len(metodos) == 1 else "Mixto"
        contabilidad.registrar_ajuste_edicion(
            db, pedido, diferencia, round(nuevo_costo - costo_antes, 2),
            [(p.metodo, p.monto) for p in pagos], costo_perdido=costo_perdido,
        )

    db.add(
        models.PedidoEdicion(
            pedido_id=pedido.id,
            detalle="; ".join(cambios) or "cambio de nota",
            total_antes=total_antes,
            total_despues=nuevo_total,
            diferencia=diferencia,
            metodo_pago=", ".join(sorted({p.metodo for p in pagos})),
            motivo=body.motivo,
            operador_id=quien.id if quien else None,
            autorizado_por=autorizado_por,
        )
    )
    pedido.editado = True
    pedido.editado_en = ahora()
    pedido.editando_desde = None
    pedido.editando_por_id = None
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
                detail=f"La factura {body.numero_factura} ya se usó en el pedido #{repetido.numero}.",
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
    # El nombre puede venir de dos sitios: se escribio al tomar la comanda, o
    # se escribe ahora al cobrar. Lo del cobro pisa --ahi es donde se corrige
    # un nombre mal escuchado-- pero vacio NO pisa: el POS manda el campo
    # siempre, y un cobro normal de una comanda que si tenia nombre le borraba
    # el suyo. Con fiado eso era perder a quien cobrarle.
    if (body.cliente or "").strip():
        pedido.cliente = body.cliente.strip()

    # Un pago puede venir partido: $5 en efectivo y el resto por pago movil es
    # cosa de todos los dias. Sin esto habia que elegir un metodo y mentir, y
    # el cierre de caja mostraba un faltante que no existia.
    a_cobrar = pedido.a_cobrar
    pagos = body.pagos or [
        schemas.PagoInput(metodo=body.metodo_pago, monto=a_cobrar, referencia=body.referencia)
    ]
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
        # Sin esto, un reclamo de pago movil o Zelle es la palabra del cliente
        # contra la del negocio: no hay con que ubicar el comprobante.
        if pago.metodo in contabilidad.METODOS_CON_REFERENCIA and not (pago.referencia or "").strip():
            raise HTTPException(
                status_code=400,
                detail=f"Falta el número de referencia del pago por {pago.metodo}.",
            )
    if abs(round(sum(p.monto for p in pagos), 2) - round(a_cobrar, 2)) > 0.01:
        detalle = f"Los pagos suman ${sum(p.monto for p in pagos):.2f} y hay que cobrar ${a_cobrar:.2f}"
        if pedido.propina:
            detalle += f" (${pedido.total:.2f} de comida + ${pedido.propina:.2f} de propina)"
        raise HTTPException(status_code=400, detail=detalle + ".")

    # Contra el nombre YA resuelto, no contra el del cuerpo: si se escribio al
    # tomar la comanda, fiar no tiene por que volver a pedirlo.
    if any(p.metodo == "Fiado" for p in pagos) and not (pedido.cliente or "").strip():
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
                referencia=(pago.referencia or "").strip(),
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


@router.post("/{pedido_id}/facturar", response_model=schemas.Pedido)
async def facturar_pedido(
    pedido_id: int, body: schemas.FacturarRequest, db: Session = Depends(get_db)
):
    """Facturar despues, no al cobrar: el dueno revisa el historico de ventas
    al final de la semana y decide ahi que factura de su talonario le pone a
    cada venta. Antes la unica ventana era al momento de cobrar.
    """
    pedido = db.query(models.Pedido).filter(models.Pedido.id == pedido_id).first()
    if not pedido:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if pedido.estado != "pagado":
        raise HTTPException(status_code=409, detail="Solo se factura un pedido ya cobrado")
    if pedido.devuelto:
        raise HTTPException(
            status_code=409, detail="Este pedido fue devuelto: ya no hay nada que facturar"
        )
    if pedido.facturado:
        raise HTTPException(status_code=409, detail="Este pedido ya esta facturado")

    # Facturar tarde mete la venta en el Libro de Ventas del mes en que se
    # VENDIO, no del mes en que se agarro el talonario. Si ese mes ya se le
    # declaro al SENIAT, el libro reimpreso diria una cifra distinta de la que
    # se presento; y si el ano ya se cerro, el asiento caeria despues del
    # cierre. En los dos casos lo correcto es una factura nueva con fecha de
    # hoy, no retocar un periodo firmado.
    motivo = contabilidad.periodo_bloqueado(db, pedido.cerrado_en or ahora())
    if motivo:
        raise HTTPException(
            status_code=409,
            detail=(
                f"No se puede facturar esta venta: {motivo}. "
                "Facturarla ahora cambiaria un periodo que ya se presento."
            ),
        )

    numero = (body.numero_factura or "").strip()
    if not numero:
        raise HTTPException(status_code=400, detail="Hace falta el numero de factura")
    # Mismo control que al cobrar: dos facturas con el mismo numero es un
    # problema fiscal, no cosmetico.
    repetido = (
        db.query(models.Pedido)
        .filter(models.Pedido.numero_factura == numero, models.Pedido.id != pedido_id)
        .first()
    )
    if repetido:
        raise HTTPException(
            status_code=409,
            detail=f"La factura {numero} ya se uso en el pedido #{repetido.numero}.",
        )

    pedido.facturado = True
    pedido.numero_factura = numero
    # La alicuota se congela AHORA, que es cuando de verdad se decide
    # facturar -no la de cuando se vendio, que en este caso no se guardo
    # porque en ese momento no iba a haber factura.
    pedido.tasa_iva = impuestos.tasa_iva(db)
    contabilidad.registrar_facturacion_tardia(db, pedido)
    # La venta ya estaba en el mart sin factura: ese dia se recalcula.
    consolidacion.invalidar_dia(db, pedido.cerrado_en)
    db.commit()
    db.refresh(pedido)

    resultado = schemas.Pedido.model_validate(pedido)
    await manager.broadcast("pedido_actualizado", resultado.model_dump(mode="json"))
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
            detail="Solo se devuelve un pedido ya cobrado. Si todavía no se cobró, anúlalo.",
        )
    if pedido.devuelto:
        raise HTTPException(status_code=409, detail="Este pedido ya fue devuelto")
    if pedido.facturado and not body.nota_credito:
        raise HTTPException(
            status_code=400,
            detail="Esta venta se facturó: hace falta el número de la nota de crédito para sacarla del Libro de Ventas.",
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
    # Deja de ser venta del dia en que se cobro: ese dia se recalcula.
    consolidacion.invalidar_dia(db, pedido.cerrado_en)
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
                referencia=p.referencia or "",
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
    # Los anulados se cuentan por el dia en que se tomo la comanda: una de
    # ayer anulada hoy cambia los numeros de ayer que el mart ya guardo.
    consolidacion.invalidar_dia(db, pedido.creado_en)
    # Anular algo ya cobrado descuadraria la caja del dia en silencio.
    if pedido.estado == "pagado":
        raise HTTPException(
            status_code=409,
            detail="Este pedido ya fue cobrado. Si el cliente devolvió la comida, usa Devolver.",
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
    # Se guarda la decision de VERDAD, no lo que adivina el front mirando si
    # algun item quedo "preparado": quien anula puede haber corregido esa
    # adivinanza, y Ventas necesita el dato real para mostrar dos tipos de
    # anulacion distintos, no repetir la misma adivinanza en otro lado.
    pedido.anulado_es_perdida = preparada
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
        raise HTTPException(status_code=400, detail="Lista de variantes inválida")
    if not ids:
        return []
    return combos.sugerir(db, ids)
