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
    if factura.iva < 0:
        raise HTTPException(status_code=400, detail="El IVA no puede ser negativo")

    if factura.items:
        # Con renglones: la base la calcula el sistema sumando lo que de
        # verdad se compro, no lo que alguien tipeo aparte - evita que un
        # numero de cabecera quede desincronizado de sus propios renglones.
        ingredientes = {
            i.id: i
            for i in db.query(models.Ingrediente).filter(
                models.Ingrediente.id.in_([it.ingrediente_id for it in factura.items])
            )
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
    # Sin esto el asiento contable de la factura queda huerfano en los libros.
    db.query(models.AsientoContable).filter(
        models.AsientoContable.origen == "factura_compra",
        models.AsientoContable.referencia_id == factura_id,
    ).delete()
    db.delete(db_factura)
    db.commit()
    return {"ok": True}
