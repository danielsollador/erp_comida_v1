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

import base64
import datetime
import json
import logging
from dataclasses import dataclass
from typing import Optional

import httpx
from pydantic import ValidationError

from . import schemas, settings

log = logging.getLogger("erp.lectura")


class ErrorDeLectura(Exception):
    """El archivo no se pudo leer. El mensaje es para quien carga la factura."""


@dataclass
class Lectura:
    borrador: schemas.BorradorFactura
    tokens_entrada: int = 0
    tokens_salida: int = 0


def lector_activo() -> Optional[str]:
    """El nombre del lector configurado, o None si la funcion esta apagada.

    Gemini sin clave cuenta como apagado: mejor que el boton no aparezca a que
    aparezca y falle en cada foto.
    """
    nombre = settings.LECTOR_FACTURAS
    if nombre not in _LECTORES:
        return None
    if nombre == "gemini" and not settings.GEMINI_API_KEY:
        return None
    return nombre


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


# ---------------------------------------------------------------- Gemini

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent"
# Una factura de una o dos paginas tarda unos segundos; con la red del local
# puede tardar mas. Pasado esto, mejor que la persona la cargue a mano.
GEMINI_TIMEOUT_S = 90

INSTRUCCIONES = """Transcribe esta factura de COMPRA de un restaurante en Venezuela.
Copia lo que dice el papel; no calcules, no completes ni inventes nada.

- proveedor_nombre y proveedor_rif: los del EMISOR, quien vende. No los del
  cliente (el restaurante), que tambien suelen aparecer en la factura.
- numero_factura: el numero de FACTURA, no el "numero de control".
- fecha: la de emision, como AAAA-MM-DD. En Venezuela se escribe DD/MM/AAAA.
- moneda: "Bs" si los montos de los renglones estan en bolivares, "$" si
  estan en dolares, "" si no se puede saber.
- renglones: uno por cada linea de producto, en el orden del papel.
  descripcion y unidad tal cual (UND, KG, BULTO, CAJA...). precio_unitario
  SIN IVA. exento: true si el renglon esta marcado como exento ("(E)",
  "E", "Exento"), false si se ve que grava IVA, null si no se distingue.
- recargo (flete, recargo) y descuento: montos POSITIVOS sobre el total de
  la factura; 0 si no hay.
- subtotal: la suma de TODOS los renglones antes de IVA, exentos incluidos
  (en la factura suele decir "SUB-TOTAL"). No es la "base imponible", que
  es solo la parte gravada. iva y total: los IMPRESOS.
- Numeros con punto decimal y sin separador de miles: en Venezuela
  "1.234,56" significa 1234.56.
- Si un dato no se lee con seguridad, dejalo en null ("" si es texto) y
  explicalo en advertencias, en espanol y breve. Un campo vacio se corrige
  en un segundo; uno inventado se cuela en la contabilidad."""

# Lo mismo que schemas.BorradorFactura, en el formato que pide Gemini. Lo que
# vuelve se valida igual contra BorradorFactura: el esquema guia, no confia.
_TEXTO = {"type": "STRING"}
_NUMERO_O_NULL = {"type": "NUMBER", "nullable": True}
ESQUEMA = {
    "type": "OBJECT",
    "properties": {
        "proveedor_nombre": _TEXTO,
        "proveedor_rif": _TEXTO,
        "numero_factura": _TEXTO,
        "fecha": {"type": "STRING", "nullable": True, "description": "AAAA-MM-DD"},
        # Gemini no acepta un valor vacio en `enum`: "no se sabe" es null.
        "moneda": {"type": "STRING", "enum": ["$", "Bs"], "nullable": True},
        "renglones": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "descripcion": _TEXTO,
                    "cantidad": _NUMERO_O_NULL,
                    "unidad": _TEXTO,
                    "precio_unitario": _NUMERO_O_NULL,
                    "subtotal": _NUMERO_O_NULL,
                    "exento": {"type": "BOOLEAN", "nullable": True},
                },
                "required": ["descripcion", "cantidad", "unidad", "precio_unitario", "subtotal", "exento"],
            },
        },
        "recargo": {"type": "NUMBER"},
        "descuento": {"type": "NUMBER"},
        "subtotal": _NUMERO_O_NULL,
        "iva": _NUMERO_O_NULL,
        "total": _NUMERO_O_NULL,
        "advertencias": {"type": "ARRAY", "items": _TEXTO},
    },
    "required": [
        "proveedor_nombre", "proveedor_rif", "numero_factura", "fecha", "moneda",
        "renglones", "recargo", "descuento", "subtotal", "iva", "total", "advertencias",
    ],
}

# Lo que se le dice a quien carga, segun lo que contesto Google.
_MENSAJE_POR_ESTADO = {
    400: "Gemini no aceptó el archivo. Prueba con otra foto o carga la factura a mano.",
    401: "La clave de Gemini no es válida. Revisa GEMINI_API_KEY.",
    403: "La clave de Gemini no tiene permiso. Revisa GEMINI_API_KEY y la facturación.",
    404: "El modelo de Gemini configurado no existe. Revisa ERP_GEMINI_MODELO.",
    429: "Se alcanzó el límite de uso de Gemini (o se acabó el saldo). Intenta en un rato.",
}


def _sin_bloque(texto: str) -> str:
    """El JSON sin las comillas de bloque de markdown, si las trajo."""
    t = texto.strip()
    if t.startswith("```"):
        t = t[3:]
        if t[:4].lower() == "json":
            t = t[4:]
        t = t.rsplit("```", 1)[0]
    return t.strip()


def _leer_con_gemini(archivo: bytes, tipo_mime: str) -> Lectura:
    cuerpo = {
        "contents": [{
            "role": "user",
            "parts": [
                {"inline_data": {"mime_type": tipo_mime, "data": base64.b64encode(archivo).decode()}},
                {"text": INSTRUCCIONES},
            ],
        }],
        "generationConfig": {
            "response_mime_type": "application/json",
            "response_schema": ESQUEMA,
            # Transcribir no es crear: la misma foto tiene que dar lo mismo.
            "temperature": 0,
        },
    }
    try:
        r = httpx.post(
            GEMINI_URL.format(modelo=settings.GEMINI_MODELO),
            json=cuerpo,
            headers={"x-goog-api-key": settings.GEMINI_API_KEY},
            timeout=GEMINI_TIMEOUT_S,
        )
    except httpx.TimeoutException:
        raise ErrorDeLectura("Gemini tardó demasiado en leer la factura. Intenta otra vez o cárgala a mano.")
    except httpx.HTTPError:
        raise ErrorDeLectura("No se pudo conectar con Gemini. Revisa la conexión del servidor.")

    if r.status_code != 200:
        # El cuerpo del error va al log (sirve para diagnosticar) pero no a
        # la pantalla: puede traer detalles de la cuenta.
        log.warning("Gemini respondio %s: %s", r.status_code, r.text[:500])
        mensaje = _MENSAJE_POR_ESTADO.get(r.status_code)
        if mensaje is None:
            mensaje = "Gemini no está disponible ahora. Intenta en un rato o carga la factura a mano."
        raise ErrorDeLectura(mensaje)

    datos = r.json()
    if datos.get("promptFeedback", {}).get("blockReason"):
        raise ErrorDeLectura("Gemini se negó a leer este archivo. Carga la factura a mano.")
    candidatos = datos.get("candidates") or []
    partes = (candidatos[0].get("content") or {}).get("parts", []) if candidatos else []
    # Los modelos que razonan devuelven partes de pensamiento: solo cuenta la
    # respuesta.
    texto = "".join(p.get("text", "") for p in partes if not p.get("thought"))
    if not texto.strip():
        motivo = candidatos[0].get("finishReason", "") if candidatos else ""
        log.warning("Gemini devolvio una respuesta vacia (finishReason=%s)", motivo)
        raise ErrorDeLectura("Gemini no devolvió nada legible. Prueba con una foto más nítida.")
    try:
        leido = json.loads(_sin_bloque(texto))
        # El borrador usa "" para "no se sabe"; el esquema de Gemini, null.
        leido["moneda"] = leido.get("moneda") or ""
        borrador = schemas.BorradorFactura(**leido)
    except (json.JSONDecodeError, ValidationError, TypeError) as e:
        log.warning("Gemini devolvio algo que no es un borrador: %s / %s", e, texto[:300])
        raise ErrorDeLectura("Gemini devolvió una lectura incompleta. Prueba otra vez o carga la factura a mano.")

    uso = datos.get("usageMetadata") or {}
    return Lectura(
        borrador=borrador,
        tokens_entrada=int(uso.get("promptTokenCount") or 0),
        # Lo que razona tambien se cobra como salida.
        tokens_salida=int(uso.get("candidatesTokenCount") or 0) + int(uso.get("thoughtsTokenCount") or 0),
    )


_LECTORES = {
    "prueba": _leer_de_prueba,
    "gemini": _leer_con_gemini,
}
