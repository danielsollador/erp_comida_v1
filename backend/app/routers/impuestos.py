from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import impuestos, models, schemas
from ..database import get_db
from ..timeutils import rango_periodo

router = APIRouter(prefix="/api/impuestos", tags=["impuestos"])


@router.get("/config", response_model=schemas.ConfiguracionFiscal)
def obtener_config(db: Session = Depends(get_db)):
    return schemas.ConfiguracionFiscal(tasa_iva=impuestos.tasa_iva(db))


@router.put("/config", response_model=schemas.ConfiguracionFiscal)
def actualizar_config(body: schemas.ConfiguracionFiscal, db: Session = Depends(get_db)):
    if body.tasa_iva < 0:
        raise HTTPException(status_code=400, detail="La tasa de IVA no puede ser negativa")
    return schemas.ConfiguracionFiscal(tasa_iva=impuestos.fijar_tasa_iva(db, body.tasa_iva))


@router.get("/libro-ventas", response_model=schemas.LibroVentas)
def libro_ventas(periodo: str = "mes", db: Session = Depends(get_db)):
    if periodo not in ("dia", "semana", "mes"):
        periodo = "mes"
    inicio, fin, etiqueta = rango_periodo(periodo)

    pedidos_facturados = (
        db.query(models.Pedido)
        .filter(
            models.Pedido.estado == "pagado",
            models.Pedido.facturado.is_(True),
            models.Pedido.cerrado_en >= inicio,
            models.Pedido.cerrado_en < fin,
        )
        .order_by(models.Pedido.cerrado_en)
        .all()
    )
    no_facturados = (
        db.query(models.Pedido)
        .filter(
            models.Pedido.estado == "pagado",
            models.Pedido.facturado.is_(False),
            models.Pedido.cerrado_en >= inicio,
            models.Pedido.cerrado_en < fin,
        )
        .all()
    )

    filas = []
    for p in pedidos_facturados:
        base, iva = impuestos.desglosar(p.total, p.tasa_iva or impuestos.IVA_DEFAULT)
        filas.append(
            schemas.FilaLibroVentas(
                pedido_id=p.id,
                fecha=p.cerrado_en,
                numero_factura=p.numero_factura or f"P-{p.numero}",
                cliente="Consumidor final",
                base_imponible=base,
                iva=iva,
                total=round(p.total, 2),
            )
        )

    return schemas.LibroVentas(
        periodo=periodo,
        etiqueta=etiqueta,
        tasa_iva=impuestos.tasa_iva(db),
        filas=filas,
        total_base=round(sum(f.base_imponible for f in filas), 2),
        total_iva=round(sum(f.iva for f in filas), 2),
        total_general=round(sum(f.total for f in filas), 2),
        ventas_no_facturadas=len(no_facturados),
        monto_no_facturado=round(sum(p.total for p in no_facturados), 2),
    )


@router.get("/libro-compras", response_model=schemas.LibroCompras)
def libro_compras(periodo: str = "mes", db: Session = Depends(get_db)):
    if periodo not in ("dia", "semana", "mes"):
        periodo = "mes"
    inicio, fin, etiqueta = rango_periodo(periodo)

    facturas = (
        db.query(models.FacturaCompra)
        .filter(models.FacturaCompra.fecha >= inicio, models.FacturaCompra.fecha < fin)
        .order_by(models.FacturaCompra.fecha)
        .all()
    )

    filas = [
        schemas.FilaLibroCompras(
            factura_id=f.id,
            fecha=f.fecha,
            numero_factura=f.numero_factura,
            proveedor_nombre=f.proveedor_nombre,
            proveedor_rif=f.proveedor_rif,
            base_imponible=f.base_imponible,
            iva=f.iva,
            total=f.total,
        )
        for f in facturas
    ]

    return schemas.LibroCompras(
        periodo=periodo,
        etiqueta=etiqueta,
        filas=filas,
        total_base=round(sum(f.base_imponible for f in filas), 2),
        total_iva=round(sum(f.iva for f in filas), 2),
        total_general=round(sum(f.total for f in filas), 2),
    )


@router.get("/resumen", response_model=schemas.ResumenIva)
def resumen_iva(periodo: str = "mes", db: Session = Depends(get_db)):
    ventas = libro_ventas(periodo, db)
    compras = libro_compras(periodo, db)
    return schemas.ResumenIva(
        periodo=periodo,
        etiqueta=ventas.etiqueta,
        iva_debito=ventas.total_iva,
        iva_credito=compras.total_iva,
        iva_a_pagar=round(ventas.total_iva - compras.total_iva, 2),
    )
