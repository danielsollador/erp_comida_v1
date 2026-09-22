from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models, schemas, tasas
from ..database import get_db

router = APIRouter(prefix="/api/config", tags=["config"])


def _fila(db: Session) -> models.Configuracion:
    """La unica fila de parametros del local. Se crea la primera vez que se
    pide: no hace falta sembrarla al arrancar, y asi nunca hay dos filas
    peleando por ser "la" configuracion."""
    fila = db.query(models.Configuracion).first()
    if fila is None:
        fila = models.Configuracion(vender_sin_inventario=False)
        db.add(fila)
        db.commit()
        db.refresh(fila)
    return fila


@router.get("", response_model=schemas.Configuracion)
def obtener_config(db: Session = Depends(get_db)):
    """Tasa vigente y parametros del local.

    La tasa se sirve desde la tabla de tasas y no desde esta fila: dos
    lugares guardando "la tasa" terminan siempre discrepando.
    """
    vigente = tasas.tasa_vigente(db)
    fila = _fila(db)
    return schemas.Configuracion(
        tasa_bcv=vigente.bcv if vigente else 0,
        vender_sin_inventario=bool(fila.vender_sin_inventario),
    )


@router.put("", response_model=schemas.Configuracion)
def actualizar_config(body: schemas.Configuracion, db: Session = Depends(get_db)):
    """Cargar la tasa a mano desde Caja. Equivale a fijarla en el modulo de
    tasa.

    SOLO LA TASA. `vender_sin_inventario` vive en su propio endpoint
    (`PUT /config/inventario`) a proposito: si este PUT tambien la aceptara,
    cada vez que Caja mandara la tasa sin ese campo lo apagaria de vuelta al
    valor por defecto sin que nadie lo haya tocado.
    """
    if body.tasa_bcv > 0:
        tasas.fijar_manual(db, body.tasa_bcv)
    fila = _fila(db)
    vigente = tasas.tasa_vigente(db)
    return schemas.Configuracion(
        tasa_bcv=vigente.bcv if vigente else 0,
        vender_sin_inventario=bool(fila.vender_sin_inventario),
    )


@router.put("/inventario", response_model=schemas.Configuracion)
def actualizar_venta_sin_inventario(
    body: schemas.VenderSinInventarioRequest, db: Session = Depends(get_db)
):
    """Prender o apagar la venta sin control de inventario.

    PARA QUE SIRVE. Un local que arranca hoy no tiene insumos ni recetas
    cargadas todavia; mientras tanto CUALQUIER venta se traba con "no alcanza
    el inventario" en cuanto alguien le mete una receta a un producto. Esto
    es la valvula de escape: mientras esta prendido, ninguna venta se bloquea
    por falta de stock, sin importar que digan las recetas.

    Se apaga el dia que el inventario de verdad este cargado.
    """
    fila = _fila(db)
    fila.vender_sin_inventario = body.vender_sin_inventario
    db.commit()
    vigente = tasas.tasa_vigente(db)
    return schemas.Configuracion(
        tasa_bcv=vigente.bcv if vigente else 0,
        vender_sin_inventario=bool(fila.vender_sin_inventario),
    )
