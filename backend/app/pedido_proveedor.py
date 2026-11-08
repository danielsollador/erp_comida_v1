"""El pedido al proveedor, listo para WhatsApp (21-oct).

«Qué comprar» ya dice QUÉ falta y cuánto. Lo que quedaba a mano era pasarlo
a un mensaje por proveedor: acordarse de a quién se le compra cada cosa, y
convertir "40 kg de harina" a "2 bultos", que es como lo vende él.

Las dos cosas ya las sabe el sistema:
  - a quién: el proveedor de la última factura que trajo esa mercancía.
  - cómo lo vende: la equivalencia que se aprendió de sus facturas
    (equivalencias.py: "HARINA PAN BULTO" son 20 kg). Se redondea hacia
    arriba al bulto entero: no se piden 1,6 bultos.

Plantilla fija, sin IA: es un mensaje corto que la persona lee y puede
cambiar antes de enviarlo. No envía nada solo.
"""

import math
import re
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from . import impuestos, locales, models, schemas

SIN_PROVEEDOR = "Sin proveedor conocido"


def _num(cantidad: float) -> str:
    return f"{cantidad:,.2f}".rstrip("0").rstrip(".").replace(",", "X").replace(".", ",").replace("X", ".")


def _plural(unidad: str, cantidad: float) -> str:
    unidad = unidad.strip().lower()
    if cantidad == 1 or not unidad:
        return unidad
    if unidad in ("und", "un", "u", "unid", "unidad"):
        return "unidades"
    if unidad in ("kg", "g", "lt", "l", "ml", "gr", "kgs"):
        return unidad
    return unidad + ("s" if unidad[-1] in "aeiou" else "es")


def whatsapp(telefono: str) -> str:
    """El número como lo pide wa.me: con el 58 y sin el cero. "" si no sirve."""
    digitos = re.sub(r"\D", "", telefono or "")
    if digitos.startswith("00"):
        digitos = digitos[2:]
    if digitos.startswith("0") and len(digitos) == 11:  # 0414 123 4567
        digitos = "58" + digitos[1:]
    elif len(digitos) == 10 and digitos.startswith("4"):  # 414 123 4567
        digitos = "58" + digitos
    return digitos if len(digitos) >= 11 else ""


def _ultima_compra(db: Session) -> Dict[int, Tuple[models.FacturaCompraItem, models.FacturaCompra]]:
    ultima: Dict[int, tuple] = {}
    filas = (
        db.query(models.FacturaCompraItem, models.FacturaCompra)
        .join(models.FacturaCompra, models.FacturaCompra.id == models.FacturaCompraItem.factura_id)
        .order_by(models.FacturaCompra.fecha)
        .all()
    )
    for item, factura in filas:
        ultima[item.ingrediente_id] = (item, factura)
    return ultima


def _presentacion(db: Session, rif: str, ingrediente_id: int) -> Optional[models.EquivalenciaProveedor]:
    if not rif:
        return None
    candidatas = (
        db.query(models.EquivalenciaProveedor)
        .filter_by(proveedor_rif=rif, ingrediente_id=ingrediente_id)
        .all()
    )
    candidatas = [e for e in candidatas if (e.factor or 1) > 1]
    return max(candidatas, key=lambda e: (e.veces or 0, e.actualizado), default=None)


def armar(db: Session, sugerencias: List[schemas.SugerenciaCompra]) -> List[schemas.PedidoProveedor]:
    ultima = _ultima_compra(db)
    fichas = {
        impuestos.normalizar_rif(p.rif): p
        for p in db.query(models.Proveedor).filter(models.Proveedor.activo.isnot(False)).all() if p.rif
    }
    grupos: Dict[str, schemas.PedidoProveedor] = {}
    for s in sugerencias:
        compra = ultima.get(s.ingrediente_id)
        factura = compra[1] if compra else None
        rif = impuestos.normalizar_rif(factura.proveedor_rif or "") if factura else ""
        nombre = factura.proveedor_nombre if factura else SIN_PROVEEDOR
        clave = rif or nombre.strip().lower()
        if clave not in grupos:
            ficha = fichas.get(rif)
            grupos[clave] = schemas.PedidoProveedor(
                proveedor=(ficha.nombre if ficha else nombre),
                rif=rif,
                contacto=(ficha.contacto or "") if ficha else "",
                whatsapp=whatsapp(ficha.telefono) if ficha else "",
                conocido=factura is not None,
                lineas=[],
            )
        linea = schemas.LineaPedidoProveedor(
            ingrediente_id=s.ingrediente_id,
            nombre=s.ingrediente_nombre,
            cantidad=s.cantidad_sugerida,
            unidad=s.unidad,
            precio=round(compra[0].costo_unitario, 4) if compra else None,
        )
        equivalencia = _presentacion(db, rif, s.ingrediente_id)
        if equivalencia:
            bultos = math.ceil(s.cantidad_sugerida / equivalencia.factor - 1e-9)
            linea.presentacion = _plural(equivalencia.unidad_papel or "bulto", bultos)
            linea.cantidad_presentacion = bultos
            linea.factor = equivalencia.factor
            linea.cantidad = round(bultos * equivalencia.factor, 3)
        grupos[clave].lineas.append(linea)

    pedidos = sorted(grupos.values(), key=lambda p: (not p.conocido, -len(p.lineas), p.proveedor))
    local = locales.actual()["nombre"]
    for p in pedidos:
        p.estimado = round(sum((l.precio or 0) * l.cantidad for l in p.lineas), 2)
        p.mensaje = mensaje(p, local)
    return pedidos


def mensaje(p: schemas.PedidoProveedor, local: str) -> str:
    renglones = []
    for l in p.lineas:
        if l.presentacion:
            renglones.append(
                f"- {l.nombre}: {l.cantidad_presentacion} {l.presentacion} ({_num(l.cantidad)} {l.unidad})"
            )
        else:
            renglones.append(f"- {l.nombre}: {_num(l.cantidad)} {_plural(l.unidad, l.cantidad)}")
    saludo = f"Buenos días{', ' + p.contacto.split()[0] if p.contacto.strip() else ''}."
    return (
        f"{saludo} Para {local} necesitamos:\n"
        + "\n".join(renglones)
        + "\n\n¿Nos confirma precio y cuándo lo puede traer? Gracias."
    )
