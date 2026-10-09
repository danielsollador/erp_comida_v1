"""Alertas de precio: que llego mas caro en una factura, y que le hace al menu.

Complementa lo que ya habia, sin repetirlo:
  - "Registrar compra" en Inventario ya avisaba del impacto de una compra
    suelta, pero la factura -la via principal- no decia nada.
  - Reportes ya mira la canasta completa ("tu mercancia subio X% en 30 dias").
Esto mira factura por factura, renglon por renglon, y lo deja guardado para
quien no estaba cuando se cargo.
"""

import datetime
import json
import statistics
from typing import List, Optional, Tuple

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import models, reposicion

# Por debajo de esto una subida es ruido de proveedor: es el mismo criterio
# que ya usa Inventario para avisar al registrar una compra suelta.
SUBIDA_QUE_IMPORTA_PCT = reposicion.SALTO_QUE_IMPORTA_PCT
# Cuantas compras anteriores se miran cuando el proveedor es nuevo.
MUESTRAS = 5
# Hasta donde se busca a otro proveedor que lo haya vendido mas barato.
DIAS_ALTERNATIVA = 90


def _anteriores(db: Session, factura: models.FacturaCompra, ingrediente_id: int):
    """Los renglones de ese insumo en facturas ANTERIORES a esta, nuevos primero."""
    return (
        db.query(models.FacturaCompraItem, models.FacturaCompra)
        .join(models.FacturaCompra, models.FacturaCompra.id == models.FacturaCompraItem.factura_id)
        .filter(
            models.FacturaCompraItem.ingrediente_id == ingrediente_id,
            models.FacturaCompra.id != factura.id,
            models.FacturaCompra.fecha <= factura.fecha,
            models.FacturaCompraItem.costo_unitario > 0,
        )
        .order_by(models.FacturaCompra.fecha.desc(), models.FacturaCompra.id.desc())
        .all()
    )


def _referencia(
    db: Session, factura: models.FacturaCompra, ingrediente_id: int, anteriores
) -> Optional[Tuple[float, str]]:
    """Contra que se compara: el mismo proveedor, o si es nuevo, las ultimas compras."""
    rif = factura.proveedor_rif
    del_mismo = [item.costo_unitario for item, f in anteriores if rif and f.proveedor_rif == rif]
    if del_mismo:
        return del_mismo[0], "proveedor"
    # Proveedor nuevo: la mediana de lo ultimo que se pago, por factura o
    # compra suelta. La compra suelta tambien cuenta: es plata que se pago.
    sueltas = (
        db.query(models.CompraSuelta)
        .filter(
            models.CompraSuelta.ingrediente_id == ingrediente_id,
            models.CompraSuelta.fecha <= factura.fecha,
            models.CompraSuelta.costo_unitario > 0,
        )
        .all()
    )
    compras = sorted(
        [(f.fecha, item.costo_unitario) for item, f in anteriores]
        + [(s.fecha, s.costo_unitario) for s in sueltas],
        key=lambda c: c[0],
        reverse=True,
    )[:MUESTRAS]
    if not compras:
        return None
    return statistics.median(c for _, c in compras), "compras"


def _alternativa(factura: models.FacturaCompra, costo: float, anteriores):
    """Otro proveedor que lo vendio mas barato hace poco, el mas barato de ellos."""
    desde = factura.fecha - datetime.timedelta(days=DIAS_ALTERNATIVA)
    otros = [
        (item.costo_unitario, f)
        for item, f in anteriores
        if f.proveedor_rif != factura.proveedor_rif and f.fecha >= desde and item.costo_unitario < costo
    ]
    return min(otros, key=lambda o: o[0]) if otros else None


def _tipo(costo: float, referencia: float) -> Optional[str]:
    if reposicion.salto_sospechoso(costo, referencia):
        return "unidad"
    # El mismo error al reves (precio del kg con la cantidad en bultos). No es
    # una subida, pero entra al deposito con el costo equivocado igual.
    if referencia / costo - 1 >= reposicion.SALTO_SOSPECHOSO_PCT / 100:
        return "unidad"
    if (costo / referencia - 1) * 100 >= SUBIDA_QUE_IMPORTA_PCT:
        return "subida"
    return None


def generar(db: Session, factura: models.FacturaCompra) -> List[models.AlertaPrecio]:
    """Las alertas de una factura ya guardada. Se puede llamar dos veces: la
    segunda devuelve las mismas, no las duplica."""
    ya = db.query(models.AlertaPrecio).filter_by(factura_id=factura.id).all()
    if ya:
        return ya

    nuevas = []
    # Un insumo que viene dos veces en la misma factura se mira una vez, al
    # precio mas alto: es el que duele.
    por_insumo = {}
    for item in factura.items:
        if item.costo_unitario > 0 and item.costo_unitario >= por_insumo.get(item.ingrediente_id, 0):
            por_insumo[item.ingrediente_id] = item.costo_unitario

    for ingrediente_id, costo in por_insumo.items():
        anteriores = _anteriores(db, factura, ingrediente_id)
        ref = _referencia(db, factura, ingrediente_id, anteriores)
        if ref is None:
            continue
        referencia, base = ref
        tipo = _tipo(costo, referencia)
        if tipo is None:
            continue

        productos = []
        if tipo == "subida":
            # Solo lo que queda en problema: un plato que sigue con buen
            # margen no es noticia.
            productos = [
                {
                    "nombre": p["nombre"],
                    "precio": p["precio"],
                    "margen_antes_pct": p["margen_antes_pct"],
                    "margen_despues_pct": p["margen_despues_pct"],
                    "a_perdida": p["a_perdida"],
                }
                for p in reposicion.impacto_en_productos(db, ingrediente_id, costo, referencia)
                if p["a_perdida"] or p["margen_flaco"]
            ]
        alternativa = _alternativa(factura, costo, anteriores) if tipo == "subida" else None

        alerta = models.AlertaPrecio(
            fecha=factura.fecha,
            factura_id=factura.id,
            ingrediente_id=ingrediente_id,
            proveedor_nombre=factura.proveedor_nombre,
            proveedor_rif=factura.proveedor_rif or "",
            costo_anterior=round(referencia, 4),
            costo_nuevo=round(costo, 4),
            variacion_pct=round((costo / referencia - 1) * 100, 1),
            base=base,
            tipo=tipo,
            productos=json.dumps(productos, ensure_ascii=False),
            alternativa_proveedor=alternativa[1].proveedor_nombre if alternativa else "",
            alternativa_costo=round(alternativa[0], 4) if alternativa else None,
            alternativa_fecha=alternativa[1].fecha if alternativa else None,
        )
        db.add(alerta)
        nuevas.append(alerta)
    try:
        db.commit()
    except IntegrityError:
        # Otro pedido genero las de esta factura al mismo tiempo: valen esas.
        db.rollback()
        return db.query(models.AlertaPrecio).filter_by(factura_id=factura.id).all()
    return nuevas
