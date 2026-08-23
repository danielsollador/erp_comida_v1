from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/menu", tags=["menu"])


def _categoria_query(db: Session):
    return db.query(models.Categoria).options(
        joinedload(models.Categoria.productos).joinedload(models.Producto.variantes)
    )


@router.get("/categorias", response_model=List[schemas.Categoria])
def listar_categorias(db: Session = Depends(get_db)):
    return _categoria_query(db).order_by(models.Categoria.orden, models.Categoria.nombre).all()


@router.post("/categorias", response_model=schemas.Categoria)
def crear_categoria(categoria: schemas.CategoriaCreate, db: Session = Depends(get_db)):
    db_categoria = models.Categoria(**categoria.model_dump())
    db.add(db_categoria)
    db.commit()
    db.refresh(db_categoria)
    return db_categoria


@router.put("/categorias/{categoria_id}", response_model=schemas.Categoria)
def actualizar_categoria(categoria_id: int, categoria: schemas.CategoriaCreate, db: Session = Depends(get_db)):
    db_categoria = db.query(models.Categoria).filter(models.Categoria.id == categoria_id).first()
    if not db_categoria:
        raise HTTPException(status_code=404, detail="Categoria no encontrada")
    for key, value in categoria.model_dump().items():
        setattr(db_categoria, key, value)
    db.commit()
    db.refresh(db_categoria)
    return db_categoria


@router.delete("/categorias/{categoria_id}")
def eliminar_categoria(categoria_id: int, db: Session = Depends(get_db)):
    db_categoria = db.query(models.Categoria).filter(models.Categoria.id == categoria_id).first()
    if not db_categoria:
        raise HTTPException(status_code=404, detail="Categoria no encontrada")
    db.delete(db_categoria)
    db.commit()
    return {"ok": True}


@router.post("/productos", response_model=schemas.Producto)
def crear_producto(producto: schemas.ProductoCreate, db: Session = Depends(get_db)):
    db_producto = models.Producto(
        nombre=producto.nombre, categoria_id=producto.categoria_id, activo=producto.activo
    )
    db.add(db_producto)
    db.flush()
    for variante in producto.variantes:
        db.add(models.Variante(producto_id=db_producto.id, **variante.model_dump()))
    db.commit()
    db.refresh(db_producto)
    return db_producto


@router.put("/productos/{producto_id}", response_model=schemas.Producto)
def actualizar_producto(producto_id: int, producto: schemas.ProductoBase, db: Session = Depends(get_db)):
    db_producto = db.query(models.Producto).filter(models.Producto.id == producto_id).first()
    if not db_producto:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    for key, value in producto.model_dump().items():
        setattr(db_producto, key, value)
    db.commit()
    db.refresh(db_producto)
    return db_producto


@router.delete("/productos/{producto_id}")
def eliminar_producto(producto_id: int, db: Session = Depends(get_db)):
    db_producto = db.query(models.Producto).filter(models.Producto.id == producto_id).first()
    if not db_producto:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    db_producto.activo = False
    db.commit()
    return {"ok": True}


@router.post("/productos/{producto_id}/variantes", response_model=schemas.Variante)
def crear_variante(producto_id: int, variante: schemas.VarianteCreate, db: Session = Depends(get_db)):
    producto = db.query(models.Producto).filter(models.Producto.id == producto_id).first()
    if not producto:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    db_variante = models.Variante(producto_id=producto_id, **variante.model_dump())
    db.add(db_variante)
    db.commit()
    db.refresh(db_variante)
    return db_variante


@router.put("/variantes/{variante_id}", response_model=schemas.Variante)
def actualizar_variante(variante_id: int, variante: schemas.VarianteCreate, db: Session = Depends(get_db)):
    db_variante = db.query(models.Variante).filter(models.Variante.id == variante_id).first()
    if not db_variante:
        raise HTTPException(status_code=404, detail="Variante no encontrada")
    for key, value in variante.model_dump().items():
        setattr(db_variante, key, value)
    db.commit()
    db.refresh(db_variante)
    return db_variante


@router.delete("/variantes/{variante_id}")
def eliminar_variante(variante_id: int, db: Session = Depends(get_db)):
    db_variante = db.query(models.Variante).filter(models.Variante.id == variante_id).first()
    if not db_variante:
        raise HTTPException(status_code=404, detail="Variante no encontrada")
    db_variante.activo = False
    db.commit()
    return {"ok": True}
