"""Memoria por proveedor: que es de lo nuestro cada renglon de su factura.

Dos operaciones, y ninguna crea facturas ni mueve stock:

  buscar   al leer una foto: para cada renglon, si ese proveedor ya lo trajo
           antes, a que mercancia corresponde y con que conversion.
  aprender despues de guardar: lo que decia el papel contra lo que la persona
           dejo en el formulario.

La IA lee el papel; esta memoria es la que sabe que "HARINA PAN BULTO" de ese
proveedor son 20 kg de nuestra Harina. Con el uso, cada vez queda menos por
asociar a mano.
"""

import difflib
import re
import unicodedata
from typing import List, Optional

from sqlalchemy.orm import Session

from . import impuestos, models, schemas
from .timeutils import ahora

# Cuanto se tiene que parecer un texto a uno recordado para proponerlo. La IA
# no lee dos veces igual el mismo papel ("HARINA PAN 1KG" / "HARINA P.A.N 1 KG"),
# pero "QUESO BLANCO" y "QUESO AMARILLO" no son la misma mercancia.
PARECIDO_MINIMO = 0.9

# Cantidad y precio tienen que moverse en la misma proporcion (con este margen
# por redondeo) para que el cambio cuente como conversion de unidad.
TOLERANCIA_CONVERSION = 0.02


def clave(texto: str) -> str:
    """El texto de un renglon reducido a lo que importa para compararlo."""
    t = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode().upper()
    # La marca de exento es del renglon de ESA factura, no del producto.
    t = re.sub(r"\(E\)|\bEXENTO\b", "", t)
    return re.sub(r"[^A-Z0-9]", "", t)


def _numeros(k: str) -> List[str]:
    return re.findall(r"\d+", k)


def _rif(rif: str) -> Optional[str]:
    return impuestos.normalizar_rif(rif) if impuestos.rif_valido(rif or "") else None


def buscar(db: Session, body: schemas.BuscarEquivalenciasRequest) -> List[schemas.SugerenciaRenglon]:
    rif = _rif(body.proveedor_rif)
    if rif is None:
        return []
    recordadas = [
        e for e in db.query(models.EquivalenciaProveedor).filter_by(proveedor_rif=rif).all()
        if e.ingrediente is not None and e.ingrediente.activo is not False
    ]
    if not recordadas:
        return []
    por_clave = {e.clave: e for e in recordadas}

    sugerencias = []
    for indice, renglon in enumerate(body.renglones):
        k = clave(renglon.descripcion)
        if not k:
            continue
        e, exacta = por_clave.get(k), True
        if e is None:
            exacta = False
            # Parecido, pero con los MISMOS numeros: "HARINA PAN 1KG" y
            # "HARINA PAN 2KG" se parecen en un 95% y son otra presentacion,
            # con otra conversion. Proponer una por la otra metia el doble.
            candidatas = [
                (difflib.SequenceMatcher(None, k, otra.clave).ratio(), otra)
                for otra in recordadas
                if _numeros(otra.clave) == _numeros(k)
            ]
            if not candidatas:
                continue
            parecido, e = max(candidatas, key=lambda par: par[0])
            if parecido < PARECIDO_MINIMO:
                continue
        sugerencias.append(
            schemas.SugerenciaRenglon(
                indice=indice,
                ingrediente_id=e.ingrediente_id,
                ingrediente_nombre=e.ingrediente.nombre,
                unidad=e.ingrediente.unidad,
                factor=e.factor,
                unidad_papel=e.unidad_papel,
                descripcion_recordada=e.descripcion,
                veces=e.veces,
                exacta=exacta,
            )
        )
    return sugerencias


def _factor(r: schemas.RenglonAprendido) -> Optional[float]:
    """La conversion, si el cambio entre papel y formulario ES una conversion.

    Se convirtio: 2 BULTO a $30 quedo en 40 kg a $1.50 -- la cantidad se
    multiplico por 20 y el precio se dividio por 20. Se corrigio una mala
    lectura: el papel decia 20 y la IA leyo 2, y solo cambia la cantidad. Lo
    segundo no es una equivalencia del proveedor, y recordarlo como "factor
    10" convertiria mal todas sus facturas siguientes.
    """
    if not (r.cantidad_papel and r.precio_papel and r.cantidad > 0 and r.costo_unitario > 0):
        return None
    por_cantidad = r.cantidad / r.cantidad_papel
    por_precio = r.precio_papel / r.costo_unitario
    if abs(por_cantidad - por_precio) <= TOLERANCIA_CONVERSION * max(por_cantidad, por_precio):
        return round(por_cantidad, 6)
    return None


def aprender(db: Session, body: schemas.AprenderEquivalenciasRequest) -> int:
    aprendidas = aprender_sin_confirmar(db, body)
    db.commit()
    return aprendidas


def aprender_sin_confirmar(db: Session, body: schemas.AprenderEquivalenciasRequest) -> int:
    """Lo mismo, sin commit: para aprender dentro de otra transaccion."""
    rif = _rif(body.proveedor_rif)
    if rif is None:
        return 0
    ids = {r.ingrediente_id for r in body.renglones}
    existentes = {i.id for i in db.query(models.Ingrediente.id).filter(models.Ingrediente.id.in_(ids))}

    recordadas = {
        e.clave: e for e in db.query(models.EquivalenciaProveedor).filter_by(proveedor_rif=rif).all()
    }
    aprendidas = 0
    for r in body.renglones:
        k = clave(r.descripcion)
        if not k or r.ingrediente_id not in existentes:
            continue
        factor = _factor(r)
        e = recordadas.get(k)
        if e is None:
            e = models.EquivalenciaProveedor(
                proveedor_rif=rif, clave=k, ingrediente_id=r.ingrediente_id,
                factor=factor or 1.0, veces=0,
            )
            db.add(e)
            recordadas[k] = e
        elif e.ingrediente_id != r.ingrediente_id:
            # Otra mercancia: lo de antes estaba mal. Se empieza de cero.
            e.ingrediente_id = r.ingrediente_id
            e.factor = factor or 1.0
            e.veces = 0
        elif factor is not None and abs(factor - (e.factor or 0)) > 1e-9:
            if (e.veces or 0) < 2:
                # Memoria nueva: se corrige sin mas.
                e.factor = factor
            elif e.factor_nuevo is not None and abs(e.factor_nuevo - factor) < 1e-9:
                e.veces_nuevo = (e.veces_nuevo or 0) + 1
                if e.veces_nuevo >= 2:
                    # Dos seguidas: el proveedor cambio la presentacion de verdad.
                    e.factor, e.veces, e.factor_nuevo, e.veces_nuevo = factor, 0, None, 0
                else:
                    continue
            else:
                # Una caja distinta (llego abierta, vino incompleta): se anota
                # como candidata y lo aprendido no cambia.
                e.factor_nuevo, e.veces_nuevo = factor, 1
                e.actualizado = ahora()
                continue
        elif factor is not None:
            e.factor_nuevo, e.veces_nuevo = None, 0
        e.descripcion = r.descripcion.strip()
        if body.proveedor_nombre.strip():
            e.proveedor_nombre = body.proveedor_nombre.strip()
        e.unidad_papel = (r.unidad or "").strip()
        e.veces += 1
        e.actualizado = ahora()
        aprendidas += 1
    return aprendidas
