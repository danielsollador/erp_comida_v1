"""Cargar una factura de compra desde una foto.

Nada de este archivo guarda facturas. El flujo es:

  1. `POST /lectura`: sube la foto, se guarda como soporte, y el lector
     devuelve un borrador que el frontend usa para PRELLENAR el formulario de
     siempre.
  2. `POST /revision`: mientras alguien revisa, dice si la factura ya parece
     cargada y que precios se salen de lo normal. Solo consulta.
  3. La persona le da Guardar: `POST /facturas`, el mismo de toda la vida,
     sin cambios. Stock, costo promedio, IVA y asientos salen de ahi.
  4. `POST /facturas/{id}/soporte`: la foto se engancha a la factura que salio.

Vive aparte de `compras.py` a proposito: el guardado de una factura no tiene
por que enterarse de que existe una camara.
"""

import re
import statistics
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import impuestos, lectura_facturas, models, reposicion, schemas
from ..database import get_db

router = APIRouter(prefix="/api/compras", tags=["compras"])

# Lo que acepta el lector. El frontend achica la foto antes de subirla (queda
# en unos cientos de KB); el tope es para una foto que llegue sin achicar.
TIPOS_DE_IMAGEN = ("image/jpeg", "image/png", "image/webp")
TAMANO_MAXIMO = 8 * 1024 * 1024

# Cuanto se puede alejar un precio de lo que se venia pagando antes de
# avisar. Por debajo de esto es el vaiven normal de un proveedor (y de la
# inflacion de unas semanas); por encima, vale la pena mirar el papel.
PRECIO_FUERA_DE_LO_NORMAL_PCT = 25.0
# Con cuantas compras anteriores se arma la referencia. La mediana, no el
# promedio: una sola compra rara (una oferta, un error viejo) no la mueve.
MUESTRAS_DE_REFERENCIA = 5


@router.get("/lectura", response_model=schemas.EstadoLector)
def estado_lector():
    nombre = lectura_facturas.lector_activo()
    return schemas.EstadoLector(activo=nombre is not None, lector=nombre or "")


@router.post("/lectura", response_model=schemas.LecturaFactura)
def leer_factura(archivo: UploadFile = File(...), db: Session = Depends(get_db)):
    # Sincrona a proposito: FastAPI la corre en un hilo aparte, y asi ni la
    # base ni el lector (que puede tardar segundos) frenan al resto del ERP.
    nombre = lectura_facturas.lector_activo()
    if nombre is None:
        raise HTTPException(
            status_code=503, detail="La lectura de facturas desde foto no está activada."
        )
    tipo = (archivo.content_type or "").lower()
    if tipo not in TIPOS_DE_IMAGEN:
        raise HTTPException(
            status_code=415, detail="La foto tiene que ser JPG, PNG o WEBP."
        )
    imagen = archivo.file.read(TAMANO_MAXIMO + 1)
    if not imagen:
        raise HTTPException(status_code=400, detail="La foto llegó vacía.")
    if len(imagen) > TAMANO_MAXIMO:
        raise HTTPException(status_code=413, detail="La foto pesa demasiado (máximo 8 MB).")

    soporte = models.SoporteFactura(
        tipo_mime=tipo, tamano=len(imagen), contenido=imagen, lector=nombre
    )
    borrador: Optional[schemas.BorradorFactura] = None
    try:
        lectura = lectura_facturas.leer(imagen, tipo)
        borrador = lectura.borrador
        soporte.lectura = borrador.model_dump_json()
        soporte.tokens_entrada = lectura.tokens_entrada
        soporte.tokens_salida = lectura.tokens_salida
    except lectura_facturas.ErrorDeLectura as e:
        # La foto se queda igual: se puede cargar a mano y adjuntarla.
        soporte.error = str(e)

    db.add(soporte)
    db.commit()
    db.refresh(soporte)
    return schemas.LecturaFactura(
        soporte_id=soporte.id, lector=nombre, borrador=borrador, error=soporte.error or ""
    )


def _numero_normalizado(numero: str) -> str:
    """"0004512", "4512" y "N° 4512" son la misma factura en papeles distintos.

    Se queda con letras y digitos y le quita los ceros de relleno: el
    proveedor imprime el numero con ceros y quien lo teclea casi nunca.
    """
    texto = (numero or "").strip().upper()
    # "N° 4512", "Nro. 4512": el prefijo es del papel, no del numero.
    texto = re.sub(r"^(NRO|NUMERO|NÚMERO|NUM|NO|N)[\s.°º:#-]+", "", texto)
    limpio = re.sub(r"[^0-9A-Z]", "", texto)
    return limpio.lstrip("0") or limpio


def _duplicadas(db: Session, body: schemas.RevisionFacturaRequest) -> List[schemas.FacturaParecida]:
    numero = _numero_normalizado(body.numero_factura)
    if not numero:
        return []
    consulta = db.query(models.FacturaCompra)
    if impuestos.rif_valido(body.proveedor_rif or ""):
        # Las facturas se guardan con el RIF ya normalizado.
        consulta = consulta.filter(
            models.FacturaCompra.proveedor_rif == impuestos.normalizar_rif(body.proveedor_rif)
        )
    elif body.proveedor_nombre.strip():
        # Sin RIF todavia (se esta tecleando) el nombre es lo que hay.
        nombre = body.proveedor_nombre.strip().lower()
        consulta = consulta.filter(func.lower(models.FacturaCompra.proveedor_nombre) == nombre)
    else:
        return []
    return [
        schemas.FacturaParecida(
            id=f.id, numero_factura=f.numero_factura, proveedor_nombre=f.proveedor_nombre,
            fecha=f.fecha, total=f.total,
        )
        for f in consulta.order_by(models.FacturaCompra.id.desc()).all()
        if _numero_normalizado(f.numero_factura) == numero
    ]


def _aviso_de_precio(
    db: Session, renglon: schemas.RenglonARevisar, ingrediente: models.Ingrediente
) -> Optional[schemas.AvisoPrecio]:
    costo = renglon.costo_unitario
    if costo <= 0:
        return None
    anteriores = [
        c["costo_unitario"]
        for c in reposicion.historial_de_costos(db, ingrediente.id, limite=MUESTRAS_DE_REFERENCIA)
        if c["costo_unitario"] and c["costo_unitario"] > 0
    ]
    if anteriores:
        referencia, base = statistics.median(anteriores), "compras"
    elif ingrediente.costo_unitario and ingrediente.costo_unitario > 0:
        referencia, base = ingrediente.costo_unitario, "promedio"
    else:
        return None  # nunca se compro ni tiene costo: no hay contra que comparar

    variacion = round((costo / referencia - 1) * 100, 1)
    nivel, mensaje = "normal", ""
    sospechoso = reposicion.salto_sospechoso(costo, referencia)
    if sospechoso:
        nivel, mensaje = "unidad", sospechoso["mensaje"]
    elif referencia / costo - 1 >= reposicion.SALTO_SOSPECHOSO_PCT / 100:
        # El mismo error al reves: la factura dice el precio de 1 kg y la
        # cantidad se tecleo en bultos, o el precio es por unidad de un
        # paquete que nosotros llevamos entero.
        nivel = "unidad"
        mensaje = (
            f"Ese precio es {referencia / costo:.0f} veces menor que lo que se venía "
            f"pagando. Revisa que precio y cantidad estén en {ingrediente.unidad}."
        )
    elif abs(variacion) >= PRECIO_FUERA_DE_LO_NORMAL_PCT:
        nivel = "alto" if variacion > 0 else "bajo"
        mensaje = (
            f"{'Subió' if variacion > 0 else 'Bajó'} {abs(variacion):.0f}% contra "
            + ("lo que se venía pagando." if base == "compras" else "su costo promedio.")
        )
    return schemas.AvisoPrecio(
        indice=renglon.indice, ingrediente_id=ingrediente.id, costo_unitario=costo,
        referencia=round(referencia, 4), base=base, muestras=len(anteriores),
        variacion_pct=variacion, nivel=nivel, mensaje=mensaje,
    )


@router.post("/revision", response_model=schemas.RevisionFactura)
def revisar_factura(body: schemas.RevisionFacturaRequest, db: Session = Depends(get_db)):
    """Lo que conviene mirar antes de darle Guardar. No bloquea nada: avisa.

    Sirve igual para una factura leida de una foto que para una tecleada.
    """
    ids = {r.ingrediente_id for r in body.items if r.ingrediente_id}
    ingredientes = {
        i.id: i for i in db.query(models.Ingrediente).filter(models.Ingrediente.id.in_(ids))
    } if ids else {}
    precios = []
    for renglon in body.items:
        ingrediente = ingredientes.get(renglon.ingrediente_id)
        if ingrediente is None:
            continue
        aviso = _aviso_de_precio(db, renglon, ingrediente)
        if aviso is not None:
            precios.append(aviso)
    return schemas.RevisionFactura(duplicadas=_duplicadas(db, body), precios=precios)
    if fecha > hoy():
        return "La fecha de la factura no puede ser futura."
    declarada = (
        db.query(models.DeclaracionIva)
        .filter(models.DeclaracionIva.anio == fecha.year, models.DeclaracionIva.mes == fecha.month)
        .first()
    )
    if declarada:
        return (
            f"El IVA de {declarada.periodo} ya fue declarado: una factura con esa fecha "
            "cambiaría ese Libro de Compras. Consulta con quien lleva la contabilidad."
        )
    return ""


@router.post("/facturas/{factura_id}/soporte")
def adjuntar_soporte(
    factura_id: int, body: schemas.AdjuntarSoporteRequest, db: Session = Depends(get_db)
):
    factura = db.query(models.FacturaCompra).filter_by(id=factura_id).first()
    if factura is None:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    soporte = db.query(models.SoporteFactura).filter_by(id=body.soporte_id).first()
    if soporte is None:
        raise HTTPException(status_code=404, detail="Esa foto no existe")
    if soporte.factura_id == factura_id:
        return {"ok": True}  # reintento del mismo enganche
    if soporte.factura_id is not None:
        raise HTTPException(status_code=409, detail="Esa foto ya respalda otra factura")
    if factura.soporte is not None:
        raise HTTPException(status_code=409, detail="Esta factura ya tiene su foto")
    soporte.factura_id = factura_id
    db.commit()
    return {"ok": True}


@router.get("/facturas/{factura_id}/soporte")
def ver_soporte(factura_id: int, db: Session = Depends(get_db)):
    soporte = db.query(models.SoporteFactura).filter_by(factura_id=factura_id).first()
    if soporte is None:
        raise HTTPException(status_code=404, detail="Esta factura no tiene foto")
    return Response(
        content=soporte.contenido,
        media_type=soporte.tipo_mime,
        headers={"Cache-Control": "private, max-age=3600"},
    )
