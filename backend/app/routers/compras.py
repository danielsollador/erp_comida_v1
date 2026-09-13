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
    if pago.forma_pago not in ("Efectivo", "Banco"):
        raise HTTPException(status_code=400, detail="La forma de pago debe ser Efectivo o Banco")

    contabilidad.registrar_pago_factura(db, db_factura, pago.forma_pago)
    db_factura.pagada = True
    db_factura.fecha_pago = ahora()
    db.commit()
    db.refresh(db_factura)
    return _a_schema(db_factura)


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
