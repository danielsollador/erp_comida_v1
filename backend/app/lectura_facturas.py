"""Leer una factura de compra desde una foto o un PDF.

El lector es UNA pieza pequena y reemplazable: recibe la foto o el PDF de la
factura y devuelve un `BorradorFactura`. Un PDF puede traer varias paginas;
el lector las lee todas (la API de Claude acepta PDF directamente). Todo lo
demas -guardar el archivo, prellenar el formulario, los controles de cuadre,
duplicado y precio, y el guardado- es codigo normal del ERP que no sabe quien
leyo. Asi se puede desarrollar y probar con el lector de
prueba sin gastar nada, y cambiar de lector sin tocar el resto.

Quien lee lo decide `settings.LECTOR_FACTURAS`. Apagado por defecto.

Lo que el lector devuelve es una PROPUESTA. No crea facturas, no mueve stock,
no toca la contabilidad: eso sigue siendo `POST /api/compras/facturas`, y solo
cuando una persona reviso el formulario y le dio Guardar.
"""

import datetime
from dataclasses import dataclass
from typing import Optional

from . import schemas, settings


class ErrorDeLectura(Exception):
    """La imagen no se pudo leer. El mensaje es para quien carga la factura."""


@dataclass
class Lectura:
    borrador: schemas.BorradorFactura
    tokens_entrada: int = 0
    tokens_salida: int = 0


def lector_activo() -> Optional[str]:
    """El nombre del lector configurado, o None si la funcion esta apagada."""
    nombre = settings.LECTOR_FACTURAS
    return nombre if nombre in _LECTORES else None


def leer(imagen: bytes, tipo_mime: str) -> Lectura:
    nombre = lector_activo()
    if nombre is None:
        raise ErrorDeLectura("La lectura de facturas desde foto no está activada.")
    return _LECTORES[nombre](imagen, tipo_mime)


def _leer_de_prueba(imagen: bytes, tipo_mime: str) -> Lectura:
    """Siempre la misma factura, inventada, sin mirar la imagen.

    Esta hecha para que ejercite lo que importa del formulario: un renglon
    exento marcado en el papel, unidades del proveedor que no son las nuestras
    ("UND" de harina que nosotros llevamos en kg), y totales impresos que
    cuadran si se asocia bien cada renglon.
    """
    return Lectura(
        borrador=schemas.BorradorFactura(
            proveedor_nombre="Distribuidora La Montaña, C.A.",
            proveedor_rif="J-40123456-7",
            numero_factura="0004512",
            fecha=datetime.date(2026, 9, 28),
            moneda="$",
            renglones=[
                schemas.RenglonLeido(
                    descripcion="HARINA PAN 1KG (E)", cantidad=20, unidad="UND",
                    precio_unitario=1.10, subtotal=22.00, exento=True,
                ),
                schemas.RenglonLeido(
                    descripcion="QUESO BLANCO DURO", cantidad=5, unidad="KG",
                    precio_unitario=6.50, subtotal=32.50, exento=False,
                ),
                schemas.RenglonLeido(
                    descripcion="ACEITE VEGETAL 1LT", cantidad=12, unidad="UND",
                    precio_unitario=2.80, subtotal=33.60, exento=False,
                ),
            ],
            subtotal=88.10,
            iva=10.58,  # 16% de los 66.10 gravados
            total=98.68,
            advertencias=["Factura de prueba: no se leyó la imagen."],
        )
    )


_LECTORES = {
    "prueba": _leer_de_prueba,
}
