from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
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
    db_ingrediente.stock_actual += body.cantidad
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
