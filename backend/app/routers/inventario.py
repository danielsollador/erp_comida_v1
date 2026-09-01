from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import contabilidad, models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/inventario", tags=["inventario"])


@router.get("/ingredientes", response_model=List[schemas.Ingrediente])
def listar_ingredientes(db: Session = Depends(get_db)):
    return db.query(models.Ingrediente).order_by(models.Ingrediente.nombre).all()


@router.post("/ingredientes", response_model=schemas.Ingrediente)
def crear_ingrediente(ingrediente: schemas.IngredienteCreate, db: Session = Depends(get_db)):
    db_ingrediente = models.Ingrediente(**ingrediente.model_dump())
    db.add(db_ingrediente)
    db.commit()
    db.refresh(db_ingrediente)
    return db_ingrediente


@router.put("/ingredientes/{ingrediente_id}", response_model=schemas.Ingrediente)
def actualizar_ingrediente(
    ingrediente_id: int, ingrediente: schemas.IngredienteCreate, db: Session = Depends(get_db)
):
    db_ingrediente = db.query(models.Ingrediente).filter(models.Ingrediente.id == ingrediente_id).first()
    if not db_ingrediente:
        raise HTTPException(status_code=404, detail="Ingrediente no encontrado")
    for key, value in ingrediente.model_dump().items():
        setattr(db_ingrediente, key, value)
    db.commit()
    db.refresh(db_ingrediente)
    return db_ingrediente


@router.post("/ingredientes/{ingrediente_id}/comprar", response_model=schemas.Ingrediente)
def registrar_compra(
    ingrediente_id: int, body: schemas.ComprarIngredienteRequest, db: Session = Depends(get_db)
):
    db_ingrediente = db.query(models.Ingrediente).filter(models.Ingrediente.id == ingrediente_id).first()
    if not db_ingrediente:
        raise HTTPException(status_code=404, detail="Ingrediente no encontrado")
    if body.cantidad <= 0:
        raise HTTPException(status_code=400, detail="La cantidad debe ser mayor a cero")

    # Valor de la compra para el asiento contable: lo que se pago, o si no se
    # informo, se estima con el costo unitario que ya tenia el insumo.
    valor = (
        body.costo_total
        if body.costo_total is not None and body.costo_total > 0
        else body.cantidad * (db_ingrediente.costo_unitario or 0)
    )

    db_ingrediente.stock_actual += body.cantidad
    # Si informa cuanto pago, el costo unitario se mantiene solo al dia.
    if body.costo_total is not None and body.costo_total > 0:
        db_ingrediente.costo_unitario = round(body.costo_total / body.cantidad, 4)
    db.flush()
    contabilidad.registrar_compra_insumo(db, db_ingrediente, round(valor, 2), db_ingrediente.id)
    db.commit()
    db.refresh(db_ingrediente)
    return db_ingrediente


@router.post("/ingredientes/{ingrediente_id}/merma", response_model=schemas.Ingrediente)
def registrar_merma(
    ingrediente_id: int, body: schemas.MermaRequest, db: Session = Depends(get_db)
):
    """Lo que se daño, quemó o botó. Sin esto el stock del sistema nunca cuadra."""
    db_ingrediente = db.query(models.Ingrediente).filter(models.Ingrediente.id == ingrediente_id).first()
    if not db_ingrediente:
        raise HTTPException(status_code=404, detail="Ingrediente no encontrado")
    if body.cantidad <= 0:
        raise HTTPException(status_code=400, detail="La cantidad debe ser mayor a cero")

    db_ingrediente.stock_actual -= body.cantidad
    db_merma = models.Merma(
        ingrediente_id=ingrediente_id, cantidad=body.cantidad, motivo=body.motivo
    )
    db.add(db_merma)
    db.flush()
    contabilidad.registrar_merma(
        db, db_ingrediente, round(body.cantidad * (db_ingrediente.costo_unitario or 0), 2), db_merma.id
    )
    db.commit()
    db.refresh(db_ingrediente)
    return db_ingrediente


@router.post("/ingredientes/{ingrediente_id}/ajustar", response_model=schemas.Ingrediente)
def ajustar_stock(
    ingrediente_id: int, body: schemas.AjusteStockRequest, db: Session = Depends(get_db)
):
    """Conteo fisico: lo que dice la balanza manda sobre lo que dice el sistema."""
    db_ingrediente = db.query(models.Ingrediente).filter(models.Ingrediente.id == ingrediente_id).first()
    if not db_ingrediente:
        raise HTTPException(status_code=404, detail="Ingrediente no encontrado")

    faltante = db_ingrediente.stock_actual - body.stock_real
    if faltante > 0:
        db_merma = models.Merma(
            ingrediente_id=ingrediente_id, cantidad=faltante, motivo=body.motivo
        )
        db.add(db_merma)
        db.flush()
        contabilidad.registrar_merma(
            db, db_ingrediente, round(faltante * (db_ingrediente.costo_unitario or 0), 2), db_merma.id
        )
    db_ingrediente.stock_actual = body.stock_real
    db.commit()
    db.refresh(db_ingrediente)
    return db_ingrediente


@router.get("/recetas/{variante_id}", response_model=List[schemas.RecetaItem])
def ver_receta(variante_id: int, db: Session = Depends(get_db)):
    items = (
        db.query(models.RecetaItem).filter(models.RecetaItem.variante_id == variante_id).all()
    )
    return [
        schemas.RecetaItem(
            id=i.id,
            ingrediente_id=i.ingrediente_id,
            ingrediente_nombre=i.ingrediente.nombre,
            unidad=i.ingrediente.unidad,
            cantidad_por_unidad=i.cantidad_por_unidad,
        )
        for i in items
    ]


@router.put("/recetas/{variante_id}", response_model=List[schemas.RecetaItem])
def actualizar_receta(
    variante_id: int, items: List[schemas.RecetaItemInput], db: Session = Depends(get_db)
):
    variante = db.query(models.Variante).filter(models.Variante.id == variante_id).first()
    if not variante:
        raise HTTPException(status_code=404, detail="Variante no encontrada")

    db.query(models.RecetaItem).filter(models.RecetaItem.variante_id == variante_id).delete()
    for item in items:
        db.add(
            models.RecetaItem(
                variante_id=variante_id,
                ingrediente_id=item.ingrediente_id,
                cantidad_por_unidad=item.cantidad_por_unidad,
            )
        )
    db.commit()
    return ver_receta(variante_id, db)


@router.get("/sugerencias", response_model=List[schemas.SugerenciaCompra])
def sugerencias_compra(db: Session = Depends(get_db)):
    sugerencias = []
    for ing in db.query(models.Ingrediente).all():
        if ing.stock_actual <= ing.stock_minimo:
            objetivo = max(ing.stock_objetivo, ing.stock_minimo)
            cantidad = round(max(objetivo - ing.stock_actual, 0), 2)
            if cantidad <= 0:
                continue
            razon = (
                f"Quedan {ing.stock_actual:g} {ing.unidad}, por debajo del minimo de "
                f"{ing.stock_minimo:g} {ing.unidad}. Se recomienda comprar para volver a "
                f"{objetivo:g} {ing.unidad}."
            )
            sugerencias.append(
                schemas.SugerenciaCompra(
                    ingrediente_id=ing.id,
                    ingrediente_nombre=ing.nombre,
                    unidad=ing.unidad,
                    stock_actual=ing.stock_actual,
                    stock_minimo=ing.stock_minimo,
                    cantidad_sugerida=cantidad,
                    razon=razon,
                )
            )
    return sugerencias
