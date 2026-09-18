"""Directorio de proveedores.

Vive dentro de Compras (mismo modulo, misma pantalla con pestañas) porque es
donde se usa: elegir un proveedor completa nombre y RIF en la factura, en vez
de tipearlos de nuevo cada vez con el riesgo de que un error de tecleo separe
"Carnes SA" de "Carnes S.A." en dos proveedores distintos para siempre.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import impuestos, models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/proveedores", tags=["proveedores"])


@router.get("", response_model=List[schemas.Proveedor])
def listar(activos: Optional[bool] = None, db: Session = Depends(get_db)):
    query = db.query(models.Proveedor)
    if activos is not None:
        query = query.filter(models.Proveedor.activo.is_(activos))
    return query.order_by(models.Proveedor.nombre).all()


def _validar_rif_si_viene(rif: Optional[str]) -> Optional[str]:
    if not rif:
        return None
    if not impuestos.rif_valido(rif):
        raise HTTPException(
            status_code=400,
            detail="El RIF debe ser letra (J/G/V/E/P/C) + 8 o 9 dígitos, o dejarlo en blanco.",
        )
    return impuestos.normalizar_rif(rif)


@router.post("", response_model=schemas.Proveedor)
def crear(datos: schemas.ProveedorCreate, db: Session = Depends(get_db)):
    if not datos.nombre.strip():
        raise HTTPException(status_code=400, detail="El nombre es obligatorio")
    proveedor = models.Proveedor(
        nombre=datos.nombre.strip(),
        rif=_validar_rif_si_viene(datos.rif),
        telefono=datos.telefono.strip(),
        direccion=datos.direccion.strip(),
        contacto=datos.contacto.strip(),
        nota=datos.nota.strip(),
    )
    db.add(proveedor)
    db.commit()
    db.refresh(proveedor)
    return proveedor


@router.put("/{proveedor_id}", response_model=schemas.Proveedor)
def editar(proveedor_id: int, datos: schemas.ProveedorCreate, db: Session = Depends(get_db)):
    proveedor = db.query(models.Proveedor).filter(models.Proveedor.id == proveedor_id).first()
    if not proveedor:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    if not datos.nombre.strip():
        raise HTTPException(status_code=400, detail="El nombre es obligatorio")
    proveedor.nombre = datos.nombre.strip()
    proveedor.rif = _validar_rif_si_viene(datos.rif)
    proveedor.telefono = datos.telefono.strip()
    proveedor.direccion = datos.direccion.strip()
    proveedor.contacto = datos.contacto.strip()
    proveedor.nota = datos.nota.strip()
    db.commit()
    db.refresh(proveedor)
    return proveedor


@router.post("/{proveedor_id}/archivar", response_model=schemas.Proveedor)
def archivar(proveedor_id: int, activo: bool = False, db: Session = Depends(get_db)):
    """No se borra: sus facturas ya cargadas siguen diciendo su nombre y su
    RIF de todos modos (no es una llave foranea), asi que archivar solo lo
    saca de la lista para elegir en una factura nueva."""
    proveedor = db.query(models.Proveedor).filter(models.Proveedor.id == proveedor_id).first()
    if not proveedor:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    proveedor.activo = activo
    db.commit()
    db.refresh(proveedor)
    return proveedor
