from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import models, reposicion, schemas
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
    """Saca la categoria del menu sin destruir el historico.

    Antes borraba en duro y el cascade se llevaba productos y variantes, pero
    las ventas ya cobradas apuntan a esas variantes: quedaban huerfanas y el
    dueno no tenia forma de recuperar lo borrado. Se desactiva, igual que
    producto y variante.
    """
    db_categoria = db.query(models.Categoria).filter(models.Categoria.id == categoria_id).first()
    if not db_categoria:
        raise HTTPException(status_code=404, detail="Categoria no encontrada")
    db_categoria.activo = False
    for producto in db_categoria.productos:
        producto.activo = False
    db.commit()
    return {"ok": True}


@router.post("/categorias/{categoria_id}/reactivar", response_model=schemas.Categoria)
def reactivar_categoria(categoria_id: int, db: Session = Depends(get_db)):
    """Deshace el retiro del menu. Sin esto, quitar una categoria por error no
    tendria vuelta atras."""
    db_categoria = db.query(models.Categoria).filter(models.Categoria.id == categoria_id).first()
    if not db_categoria:
        raise HTTPException(status_code=404, detail="Categoria no encontrada")
    db_categoria.activo = True
    for producto in db_categoria.productos:
        producto.activo = True
    db.commit()
    db.refresh(db_categoria)
    return db_categoria


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

    precio_anterior = db_variante.precio
    for key, value in variante.model_dump().items():
        setattr(db_variante, key, value)

    # Queda el rastro del cambio: antes el precio se sobrescribia sin dejar
    # forma de saber cuando se movio ni desde cuanto.
    if round(precio_anterior, 4) != round(db_variante.precio, 4):
        db.add(
            models.CambioPrecio(
                variante_id=variante_id,
                precio_anterior=precio_anterior,
                precio_nuevo=db_variante.precio,
            )
        )

    db.commit()
    db.refresh(db_variante)
    return db_variante


@router.get("/variantes/{variante_id}/precios", response_model=List[schemas.CambioPrecio])
def historial_precios(variante_id: int, db: Session = Depends(get_db)):
    return (
        db.query(models.CambioPrecio)
        .filter(models.CambioPrecio.variante_id == variante_id)
        .order_by(models.CambioPrecio.id.desc())
        .limit(20)
        .all()
    )


@router.get("/costos", response_model=List[schemas.CostoVariante])
def costos_por_variante(db: Session = Depends(get_db)):
    """Cuanto cuesta producir cada variante y que margen deja a su precio actual.

    El menu necesita este dato para no dejar fijar un precio por debajo del
    costo a ciegas: el sistema ya sabe cuanto cuesta el producto, solo que
    hasta ahora no lo miraba al momento de ponerle precio.
    """
    # Dos costos por producto, porque son dos preguntas distintas:
    #   - `costos`: promedio ponderado, lo que costo lo que ya esta vendido.
    #   - `reponer`: ultimo precio pagado, lo que cuesta producirlo mañana.
    # Fijar precios mirando solo el primero es como un negocio se descapitaliza
    # sin enterarse: la caja cuadra, el reporte dice que ganaste, y cuando vas
    # a comprar no te alcanza para la misma cantidad.
    ultimos = reposicion.costos_reposicion(db)
    costos = {}
    reponer = {}
    for receta in db.query(models.RecetaItem).all():
        ingrediente = receta.ingrediente
        aporte = receta.cantidad_por_unidad * (ingrediente.costo_efectivo or 0)
        costos[receta.variante_id] = costos.get(receta.variante_id, 0) + aporte

        ultimo = ultimos.get(receta.ingrediente_id)
        efectivo_hoy = (
            reposicion.costo_efectivo_de(ultimo["costo"], ingrediente.rendimiento_pct)
            if ultimo
            else (ingrediente.costo_efectivo or 0)  # sin compras: el promedio es lo que hay
        )
        reponer[receta.variante_id] = reponer.get(receta.variante_id, 0) + (
            receta.cantidad_por_unidad * efectivo_hoy
        )

    filas = []
    for v in db.query(models.Variante).all():
        costo = costos.get(v.id)
        costo_hoy = reponer.get(v.id)
        margen = (
            round((v.precio - costo) / v.precio * 100, 1)
            if costo is not None and v.precio > 0
            else None
        )
        filas.append(
            schemas.CostoVariante(
                variante_id=v.id,
                costo=round(costo, 4) if costo is not None else None,
                margen_pct=margen,
                sin_receta=costo is None,
                costo_reposicion=round(costo_hoy, 4) if costo_hoy is not None else None,
                margen_reposicion_pct=(
                    round((v.precio - costo_hoy) / v.precio * 100, 1)
                    if costo_hoy is not None and v.precio > 0
                    else None
                ),
                # El precio que conserva el margen que el dueno ya tenia, no un
                # margen inventado por el sistema.
                precio_sugerido=(
                    reposicion.precio_para_margen(costo_hoy, margen)
                    if costo_hoy is not None and margen is not None and margen < 100
                    else None
                ),
            )
        )
    return filas


@router.delete("/variantes/{variante_id}")
def eliminar_variante(variante_id: int, db: Session = Depends(get_db)):
    db_variante = db.query(models.Variante).filter(models.Variante.id == variante_id).first()
    if not db_variante:
        raise HTTPException(status_code=404, detail="Variante no encontrada")
    db_variante.activo = False
    db.commit()
    return {"ok": True}
