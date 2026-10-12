"""Directorio de proveedores.

Vive dentro de Compras (mismo modulo, misma pantalla con pestañas) porque es
donde se usa: elegir un proveedor completa nombre y RIF en la factura, en vez
de tipearlos de nuevo cada vez con el riesgo de que un error de tecleo separe
"Carnes SA" de "Carnes S.A." en dos proveedores distintos para siempre.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
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


def _sin_duplicar(db: Session, nombre: str, rif: Optional[str], excluir: Optional[int] = None):
    """Que no entre dos veces el mismo proveedor.

    El directorio existe justamente para que "Carnes SA" y "Carnes S.A." no
    terminen siendo dos, pero nada impedia crear el mismo dos veces desde la
    propia pantalla -- y entonces el directorio deja de ser el arreglo y pasa
    a ser otra fuente del problema.

    El nombre se compara sin distinguir mayusculas ni espacios de sobra; el
    RIF es la identidad legal y ahi no hay margen: dos proveedores con el
    mismo RIF son el mismo proveedor, aunque se escriban distinto. El indice
    unico de `rif` en la base es la red por debajo (ver `migrations`); esto
    es para poder decirlo con palabras en vez de un error de base de datos.
    """
    igual = db.query(models.Proveedor).filter(
        func.lower(func.trim(models.Proveedor.nombre)) == nombre.strip().lower())
    if excluir is not None:
        igual = igual.filter(models.Proveedor.id != excluir)
    existente = igual.first()
    if existente:
        raise HTTPException(
            status_code=409,
            detail=f"Ya existe un proveedor llamado «{existente.nombre}»."
                   + ("" if existente.activo else " Está archivado: puedes reactivarlo."))

    if rif:
        por_rif = db.query(models.Proveedor).filter(models.Proveedor.rif == rif)
        if excluir is not None:
            por_rif = por_rif.filter(models.Proveedor.id != excluir)
        otro = por_rif.first()
        if otro:
            raise HTTPException(
                status_code=409,
                detail=f"Ese RIF ya es de «{otro.nombre}».")


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
    rif = _validar_rif_si_viene(datos.rif)
    _sin_duplicar(db, datos.nombre, rif)
    proveedor = models.Proveedor(
        nombre=datos.nombre.strip(),
        rif=rif,
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
    rif = _validar_rif_si_viene(datos.rif)
    _sin_duplicar(db, datos.nombre, rif, excluir=proveedor_id)
    proveedor.nombre = datos.nombre.strip()
    proveedor.rif = rif
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


def _facturas_del(db: Session, proveedor: models.Proveedor):
    """Las facturas de un proveedor. La factura no lleva llave foranea al
    directorio (ver test_rif.py): se enlazan por el RIF normalizado y, si la
    ficha no tiene RIF, por el nombre tal cual."""
    query = db.query(models.FacturaCompra)
    if proveedor.rif:
        query = query.filter(models.FacturaCompra.proveedor_rif == impuestos.normalizar_rif(proveedor.rif))
    else:
        query = query.filter(func.lower(models.FacturaCompra.proveedor_nombre) == proveedor.nombre.strip().lower())
    return query.order_by(models.FacturaCompra.fecha.desc(), models.FacturaCompra.id.desc()).all()


@router.get("/{proveedor_id}/resumen", response_model=schemas.ProveedorResumen)
def resumen(proveedor_id: int, db: Session = Depends(get_db)):
    """La ficha: cuanto se le compro, cuanto se le debe y sus ultimas facturas."""
    proveedor = db.query(models.Proveedor).filter(models.Proveedor.id == proveedor_id).first()
    if not proveedor:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    facturas = _facturas_del(db, proveedor)
    a_credito = [f for f in facturas if f.forma_pago == "Credito" and not f.pagada]
    hoy = models.ahora()
    alertas = db.query(models.AlertaPrecio).filter(models.AlertaPrecio.visto.is_(False))
    if proveedor.rif:
        alertas = alertas.filter(models.AlertaPrecio.proveedor_rif == impuestos.normalizar_rif(proveedor.rif))
    else:
        alertas = alertas.filter(func.lower(models.AlertaPrecio.proveedor_nombre) == proveedor.nombre.strip().lower())
    return schemas.ProveedorResumen(
        facturas=len(facturas),
        comprado=round(sum(f.base_imponible for f in facturas), 2),
        deuda=round(sum(f.saldo for f in a_credito), 2),
        vencidas=sum(1 for f in a_credito if f.fecha_vencimiento and f.fecha_vencimiento < hoy),
        alertas_pendientes=alertas.count(),
        ultima_compra=facturas[0].fecha if facturas else None,
        ultimas=[
            schemas.ProveedorFacturaResumen(
                id=f.id, fecha=f.fecha, numero_factura=f.numero_factura, total=f.total,
                forma_pago=f.forma_pago, pagada=bool(f.pagada), saldo=f.saldo,
            )
            for f in facturas[:10]
        ],
    )
