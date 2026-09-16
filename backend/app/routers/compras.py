import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import contabilidad, costeo, models, schemas
from ..database import get_db
from ..timeutils import ahora, hoy, inicio_del_dia

router = APIRouter(prefix="/api/compras", tags=["compras"])


def _a_schema(factura: models.FacturaCompra) -> schemas.FacturaCompra:
    return schemas.FacturaCompra(
        id=factura.id,
        numero_factura=factura.numero_factura,
        proveedor_nombre=factura.proveedor_nombre,
        proveedor_rif=factura.proveedor_rif,
        fecha=factura.fecha,
        categoria=factura.categoria,
        forma_pago=factura.forma_pago,
        descripcion=factura.descripcion,
        base_imponible=factura.base_imponible,
        iva=factura.iva,
        total=factura.total,
        pagada=factura.pagada,
        fecha_vencimiento=factura.fecha_vencimiento,
        fecha_pago=factura.fecha_pago,
        items=[
            schemas.LineaFactura(
                id=i.id,
                ingrediente_id=i.ingrediente_id,
                ingrediente_nombre=i.ingrediente.nombre,
                unidad=i.ingrediente.unidad,
                cantidad=i.cantidad,
                costo_unitario=i.costo_unitario,
                subtotal=i.subtotal,
            )
            for i in factura.items
        ],
    )


@router.get("/facturas", response_model=List[schemas.FacturaCompra])
def listar_facturas(dias: int = 60, db: Session = Depends(get_db)):
    desde = inicio_del_dia(hoy()) - datetime.timedelta(days=dias)
    facturas = (
        db.query(models.FacturaCompra)
        .options(joinedload(models.FacturaCompra.items).joinedload(models.FacturaCompraItem.ingrediente))
        .filter(models.FacturaCompra.fecha >= desde)
        .order_by(models.FacturaCompra.id.desc())
        .all()
    )
    return [_a_schema(f) for f in facturas]


@router.post("/facturas", response_model=schemas.FacturaCompra)
def crear_factura(factura: schemas.FacturaCompraCreate, db: Session = Depends(get_db)):
    # Los renglones mueven stock igual que una compra suelta, asi que entran
    # por el mismo candado: sin el, dos facturas cargadas a la vez se pisaban
    # el promedio ponderado del mismo insumo.
    with costeo.bloqueo_inventario():
        return _crear_factura(factura, db)


def _crear_factura(factura: schemas.FacturaCompraCreate, db: Session) -> schemas.FacturaCompra:
    if factura.iva < 0:
        raise HTTPException(status_code=400, detail="El IVA no puede ser negativo")

    if factura.items:
        # Con renglones: la base la calcula el sistema sumando lo que de
        # verdad se compro, no lo que alguien tipeo aparte - evita que un
        # numero de cabecera quede desincronizado de sus propios renglones.
        db.expire_all()  # otro hilo pudo haber movido el stock de estos insumos
        ingredientes = {
            i.id: i
            for i in db.query(models.Ingrediente)
            .filter(models.Ingrediente.id.in_([it.ingrediente_id for it in factura.items]))
            .with_for_update()
        }
        for item in factura.items:
            if item.ingrediente_id not in ingredientes:
                raise HTTPException(status_code=404, detail=f"Ingrediente {item.ingrediente_id} no existe")
            if item.cantidad <= 0:
                raise HTTPException(status_code=400, detail="La cantidad de cada renglon debe ser mayor a cero")
        base_imponible = round(sum(it.cantidad * it.costo_unitario for it in factura.items), 2)
    else:
        if not factura.base_imponible or factura.base_imponible <= 0:
            raise HTTPException(status_code=400, detail="La base imponible debe ser mayor a cero")
        base_imponible = factura.base_imponible

    es_credito = factura.forma_pago == "Credito"
    db_factura = models.FacturaCompra(
        numero_factura=factura.numero_factura,
        proveedor_nombre=factura.proveedor_nombre,
        proveedor_rif=factura.proveedor_rif,
        fecha=factura.fecha or ahora(),
        categoria=factura.categoria,
        forma_pago=factura.forma_pago,
        descripcion=factura.descripcion,
        base_imponible=base_imponible,
        iva=factura.iva,
        # Efectivo/Banco: la plata ya salio al cargarla. Credito: queda
        # pendiente hasta que se registre el pago aparte.
        pagada=not es_credito,
        fecha_vencimiento=factura.fecha_vencimiento if es_credito else None,
        fecha_pago=None if es_credito else (factura.fecha or ahora()),
    )
    db.add(db_factura)
    db.flush()

    for item in factura.items:
        ingrediente = ingredientes[item.ingrediente_id]
        db.add(
            models.FacturaCompraItem(
                factura_id=db_factura.id,
                ingrediente_id=item.ingrediente_id,
                cantidad=item.cantidad,
                costo_unitario=item.costo_unitario,
            )
        )
        # El costo del insumo se promedia con lo que ya habia - mismo motor
        # que "Registrar compra" en Inventario (ver costeo.py), para que las
        # dos vias de cargar una compra lleguen siempre al mismo numero.
        costeo.registrar_entrada(ingrediente, item.cantidad, item.costo_unitario)

    db.flush()
    contabilidad.registrar_factura_compra(db, db_factura)

    # Una compra de activos crea el bien para que empiece a depreciarse. Antes
    # entraba a 1050 y se quedaba ahi a valor de compra para siempre.
    if db_factura.categoria == "Activos":
        db.add(
            models.ActivoFijo(
                nombre=db_factura.descripcion or f"Activo (fact. {db_factura.numero_factura})",
                valor=db_factura.base_imponible,
                fecha_compra=db_factura.fecha,
                vida_util_meses=factura.vida_util_meses or 60,
                factura_id=db_factura.id,
            )
        )

    db.commit()
    db.refresh(db_factura)
    return _a_schema(db_factura)


@router.post("/facturas/{factura_id}/pagar", response_model=schemas.FacturaCompra)
def pagar_factura(factura_id: int, pago: schemas.PagoFacturaRequest, db: Session = Depends(get_db)):
    db_factura = (
        db.query(models.FacturaCompra)
        .options(joinedload(models.FacturaCompra.items).joinedload(models.FacturaCompraItem.ingrediente))
        .filter(models.FacturaCompra.id == factura_id)
        .first()
    )
    if not db_factura:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    if db_factura.forma_pago != "Credito":
        raise HTTPException(status_code=400, detail="Esta factura no quedo a credito")
    if db_factura.pagada:
        raise HTTPException(status_code=409, detail="Esta factura ya esta pagada")
    if not contabilidad.metodo_de_pago_valido(pago.forma_pago):
        raise HTTPException(
            status_code=400,
            detail="La factura se paga desde una gaveta (Efectivo Bs, Efectivo $) o del Banco",
        )

    contabilidad.registrar_pago_factura(db, db_factura, pago.forma_pago)
    db_factura.pagada = True
    db_factura.fecha_pago = ahora()
    db.commit()
    db.refresh(db_factura)
    return _a_schema(db_factura)


@router.get("/facturas/{factura_id}/notas-credito", response_model=List[schemas.NotaCreditoCompra])
def listar_notas_credito(factura_id: int, db: Session = Depends(get_db)):
    factura = _factura_o_404(db, factura_id)
    return [_nota_a_schema(n) for n in factura.notas_credito]


@router.post("/facturas/{factura_id}/notas-credito", response_model=schemas.NotaCreditoCompra)
def crear_nota_credito(
    factura_id: int, body: schemas.NotaCreditoCompraCreate, db: Session = Depends(get_db)
):
    """Nota de credito del proveedor: el espejo de la devolucion de venta.

    Antes no existia. Si el proveedor facturaba 10 kg y mandaba 8, la factura
    no se podia borrar (con razon: deshacer un promedio ponderado ya mezclado
    es peligroso) y la unica salida que ofrecia el mensaje de error era un
    ajuste de inventario, que registra la diferencia como MERMA. Eso dejaba
    tres cosas mal a la vez: una perdida que no ocurrio, credito fiscal de mas
    en el Libro de Compras, y una deuda inflada con el proveedor.

    Son dos casos con asientos distintos:
      - devolucion: la mercancia vuelve. Sale stock y sale valor; el costo por
        unidad no se mueve, porque lo que se devuelve costaba lo mismo.
      - descuento: te quedas la mercancia y rebajan el precio. El stock no se
        toca y el costo por unidad BAJA, que es lo que de verdad paso.
    """
    with costeo.bloqueo_inventario():
        factura = _factura_o_404(db, factura_id)

        if body.tipo not in ("devolucion", "descuento"):
            raise HTTPException(
                status_code=400, detail="El tipo debe ser 'devolucion' o 'descuento'"
            )

        fecha = body.fecha or ahora()
        _bloquear_si_periodo_declarado(db, fecha, factura)

        if body.tipo == "devolucion":
            base, lineas = _lineas_de_devolucion(db, factura, body)
        else:
            base, lineas = _base_de_descuento(body), []

        if base <= 0:
            raise HTTPException(status_code=400, detail="La nota de credito debe ser mayor a cero")

        disponible = round(factura.base_neta, 2)
        if base > disponible + 0.01:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"La nota es por ${base:.2f} pero de esa factura solo quedan "
                    f"${disponible:.2f} sin acreditar."
                ),
            )

        # Si no lo dicen, el IVA se prorratea al mismo porcentaje de la factura:
        # acreditar base sin acreditar su IVA dejaria credito fiscal de mas.
        if body.iva is not None:
            iva = round(body.iva, 2)
        elif factura.base_imponible:
            iva = round(factura.iva * (base / factura.base_imponible), 2)
        else:
            iva = 0.0

        nota = models.NotaCreditoCompra(
            factura_id=factura.id,
            numero=body.numero,
            tipo=body.tipo,
            fecha=fecha,
            base_imponible=round(base, 2),
            iva=iva,
            motivo=body.motivo,
        )
        db.add(nota)
        db.flush()

        for ingrediente, cantidad, costo in lineas:
            db.add(
                models.NotaCreditoCompraItem(
                    nota_id=nota.id,
                    ingrediente_id=ingrediente.id,
                    cantidad=cantidad,
                    costo_unitario=costo,
                )
            )
            # La mercancia se va: sale del stock al costo al que entro. El
            # promedio ponderado no se toca, porque lo devuelto costaba
            # exactamente lo que el resto de esa factura.
            ingrediente.stock_actual = round((ingrediente.stock_actual or 0) - cantidad, 4)

        if body.tipo == "descuento":
            _abaratar_insumos(db, factura, base)

        cuenta = contabilidad.CUENTA_POR_CATEGORIA_COMPRA.get(factura.categoria, "6010")
        contabilidad.registrar_nota_credito_compra(db, nota, cuenta)
        db.commit()
        db.refresh(nota)
        return _nota_a_schema(nota)


def _factura_o_404(db: Session, factura_id: int) -> models.FacturaCompra:
    factura = (
        db.query(models.FacturaCompra)
        .options(joinedload(models.FacturaCompra.items))
        .filter(models.FacturaCompra.id == factura_id)
        .first()
    )
    if not factura:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    return factura


def _bloquear_si_periodo_declarado(
    db: Session, fecha: datetime.datetime, factura: models.FacturaCompra
):
    """Una nota de credito cambia el Libro de Compras del mes de la factura.

    Si ese mes ya se le presento al SENIAT, reescribirlo en silencio seria
    peor que el problema: hace falta una declaracion sustitutiva. Mismo
    criterio que ya se aplica a las devoluciones de venta.
    """
    declarada = (
        db.query(models.DeclaracionIva)
        .filter(
            models.DeclaracionIva.anio == factura.fecha.year,
            models.DeclaracionIva.mes == factura.fecha.month,
        )
        .first()
    )
    if declarada:
        raise HTTPException(
            status_code=409,
            detail=(
                f"El IVA de {declarada.periodo} ya fue declarado y esta nota cambiaria "
                "ese Libro de Compras. Anula esa declaracion primero (Impuestos) y "
                "vuelve a declarar el periodo con la nota ya cargada."
            ),
        )


def _lineas_de_devolucion(db: Session, factura: models.FacturaCompra, body):
    """Valida los renglones devueltos contra los de la factura."""
    if not body.items:
        raise HTTPException(
            status_code=400,
            detail="Una devolucion necesita decir que insumos vuelven y cuanto de cada uno",
        )

    por_ingrediente = {i.ingrediente_id: i for i in factura.items}
    ya_devuelto = {}
    for nota in factura.notas_credito:
        for item in nota.items:
            ya_devuelto[item.ingrediente_id] = (
                ya_devuelto.get(item.ingrediente_id, 0) + item.cantidad
            )

    base = 0.0
    lineas = []
    for pedido_item in body.items:
        linea = por_ingrediente.get(pedido_item.ingrediente_id)
        if linea is None:
            raise HTTPException(
                status_code=400,
                detail=f"El insumo {pedido_item.ingrediente_id} no esta en esa factura",
            )
        if pedido_item.cantidad <= 0:
            raise HTTPException(status_code=400, detail="La cantidad debe ser mayor a cero")

        restante = linea.cantidad - ya_devuelto.get(pedido_item.ingrediente_id, 0)
        if pedido_item.cantidad > restante + 0.0001:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"De {linea.ingrediente.nombre} la factura trae {linea.cantidad} "
                    f"{linea.ingrediente.unidad} y quedan {round(restante, 4)} por devolver."
                ),
            )
        ingrediente = (
            db.query(models.Ingrediente)
            .filter(models.Ingrediente.id == pedido_item.ingrediente_id)
            .with_for_update()
            .first()
        )
        base += pedido_item.cantidad * linea.costo_unitario
        lineas.append((ingrediente, pedido_item.cantidad, linea.costo_unitario))

    return round(base, 2), lineas


def _base_de_descuento(body) -> float:
    if body.base_imponible is None or body.base_imponible <= 0:
        raise HTTPException(
            status_code=400, detail="Un descuento necesita el monto acreditado (base imponible)"
        )
    return round(body.base_imponible, 2)


def _abaratar_insumos(db: Session, factura: models.FacturaCompra, rebaja: float):
    """Un descuento hace que lo comprado haya costado menos.

    Se reparte la rebaja entre los renglones de la factura en proporcion a lo
    que pesa cada uno, y se le baja el costo promedio al insumo por la parte
    que todavia esta en el deposito. Sin esto el costo quedaba inflado para
    siempre y el margen del menu mentia hacia abajo.
    """
    if not factura.items or factura.base_imponible <= 0:
        return
    for linea in factura.items:
        peso = (linea.cantidad * linea.costo_unitario) / factura.base_imponible
        rebaja_linea = rebaja * peso
        ingrediente = (
            db.query(models.Ingrediente)
            .filter(models.Ingrediente.id == linea.ingrediente_id)
            .with_for_update()
            .first()
        )
        if ingrediente is None or (ingrediente.stock_actual or 0) <= 0:
            continue
        # Solo se abarata lo que queda en existencia: lo ya vendido se costeo
        # con el precio de entonces y su margen historico esta congelado.
        en_deposito = min(linea.cantidad, ingrediente.stock_actual)
        if en_deposito <= 0:
            continue
        baja_unitaria = (rebaja_linea * (en_deposito / linea.cantidad)) / ingrediente.stock_actual
        ingrediente.costo_unitario = round(
            max((ingrediente.costo_unitario or 0) - baja_unitaria, 0), 4
        )


def _nota_a_schema(n: models.NotaCreditoCompra) -> schemas.NotaCreditoCompra:
    return schemas.NotaCreditoCompra(
        id=n.id,
        factura_id=n.factura_id,
        numero=n.numero,
        tipo=n.tipo,
        fecha=n.fecha,
        base_imponible=n.base_imponible,
        iva=n.iva,
        total=n.total,
        motivo=n.motivo or "",
        items=[
            schemas.NotaCreditoItem(
                id=i.id,
                ingrediente_id=i.ingrediente_id,
                ingrediente_nombre=i.ingrediente.nombre,
                unidad=i.ingrediente.unidad,
                cantidad=i.cantidad,
                costo_unitario=i.costo_unitario,
                subtotal=round(i.cantidad * i.costo_unitario, 2),
            )
            for i in n.items
        ],
    )


@router.delete("/facturas/{factura_id}")
def eliminar_factura(factura_id: int, db: Session = Depends(get_db)):
    db_factura = (
        db.query(models.FacturaCompra)
        .options(joinedload(models.FacturaCompra.items))
        .filter(models.FacturaCompra.id == factura_id)
        .first()
    )
    if not db_factura:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    if db_factura.items:
        # Revertir esta factura significaria deshacer un promedio ponderado
        # que ya se mezclo con compras posteriores - no es reversible sin
        # arriesgar dejar el costo del insumo mal. Mas seguro bloquearlo,
        # igual que ya hacemos con un pedido cobrado.
        raise HTTPException(
            status_code=409,
            detail="Esta factura ya actualizo el stock de insumos y no se puede borrar. "
            "Si fue un error, registra un ajuste de inventario para corregir el stock.",
        )
    if db_factura.forma_pago == "Credito" and db_factura.pagada:
        # Ya hay un asiento de pago real (plata que de verdad salio de caja o
        # banco) referenciando esta factura - borrarla lo dejaria huerfano.
        raise HTTPException(
            status_code=409,
            detail="Esta factura ya fue pagada y tiene un asiento de pago asociado, no se puede borrar.",
        )
    # Un año cerrado no se toca: borrar una factura de 2025 cambiaria el
    # resultado que ya se llevo a Utilidades retenidas.
    try:
        contabilidad.asegurar_ejercicio_abierto(db, db_factura.fecha, "esa factura")
    except contabilidad.ErrorEjercicioCerrado as e:
        raise HTTPException(status_code=409, detail=str(e))
    # La factura de un activo creo el bien. Borrarla sin borrar el bien lo
    # dejaba vivo y depreciandose contra nada -- y con las claves foraneas
    # activas ni siquiera eso: la base rechazaba el borrado con un 500.
    for activo in db.query(models.ActivoFijo).filter_by(factura_id=factura_id).all():
        if contabilidad.depreciacion_acumulada(db, activo) > 0:
            raise HTTPException(
                status_code=409,
                detail=f"El equipo «{activo.nombre}» que nacio de esta factura ya lleva "
                f"depreciacion asentada: dalo de baja desde Contabilidad en vez de borrar la factura.",
            )
        db.delete(activo)
    # Sin esto el asiento contable de la factura queda huerfano en los libros.
    # Uno por uno con db.delete(): un DELETE masivo sobre el query NO dispara el
    # cascade del ORM y dejaria vivos los movimientos, que el balance de
    # comprobacion sigue sumando aunque su asiento ya no exista.
    for asiento in (
        db.query(models.AsientoContable)
        .filter(
            models.AsientoContable.origen == "factura_compra",
            models.AsientoContable.referencia_id == factura_id,
        )
        .all()
    ):
        db.delete(asiento)
    db.delete(db_factura)
    db.commit()
    return {"ok": True}
