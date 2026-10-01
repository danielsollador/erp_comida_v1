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
import re
import time
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
    modelo: str = ""  # el que de verdad leyo (puede ser el de respaldo)


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

# Google contesta 503 "mucha demanda" a rachas, sobre todo en los modelos mas
# nuevos: con las 21 facturas reales de la primera prueba fallo la mitad. Es
# pasajero, asi que se reintenta antes de rendirse, y si el modelo sigue
# saturado se prueba con el de respaldo. Las esperas son cortas: alguien esta
# delante de la pantalla esperando.
ESTADOS_PASAJEROS = (500, 502, 503, 504)
ESPERAS_REINTENTO_S = (2, 5)

# Lo que hay que decirle a Gemini sobre ESTAS facturas lo aprendio una
# prueba con 21 facturas reales escaneadas (2026-10-01): leia mal el ano,
# tomaba el RIF del sello de recibido, convertia codigos de barra en
# renglones y se perdia con los escaneos girados. Cada regla de abajo viene
# de un error visto, no de una suposicion.
INSTRUCCIONES = """Transcribe esta factura de COMPRA de un negocio en Venezuela.
Copia lo que dice el papel; no calcules, no completes ni inventes nada.
Hoy es {hoy}: la factura es de hoy o de pocas semanas atras.

- El escaneo puede estar girado 90 o 180 grados, o al reves: leelo en su
  orientacion correcta antes de transcribir.
- proveedor_nombre y proveedor_rif: los del EMISOR, quien vende (suele estar
  en el encabezado, junto al logo). NO los del cliente: ni los de "Cliente",
  "Senores", "Razon social" o "Nombre", ni los del SELLO de recibido (un sello
  con firma y fecha escrita a mano, casi siempre abajo), que son de quien
  compra. Si el emisor no muestra su RIF, deja proveedor_rif vacio.
- numero_factura: el de FACTURA o NOTA DE ENTREGA, no el "numero de control"
  ni el de pedido, guia o ticket.
- fecha: la de emision, como AAAA-MM-DD. En Venezuela se escribe DD/MM/AAAA
  o DD-MM-AAAA. Lee el ano con cuidado: si no se distingue, no lo deduzcas de
  otro dato, dejalo vacio y dilo en advertencias.
- moneda: "Bs" si los montos de los renglones estan en bolivares, "$" si
  estan en dolares, "" si no se puede saber.
- renglones: uno por cada PRODUCTO, en el orden del papel. Un codigo de
  barras o de articulo impreso debajo o al lado del producto es parte de ese
  renglon, no un renglon aparte. descripcion y unidad tal cual (UND, KG,
  BULTO, CAJA...). precio_unitario SIN IVA. exento: true si el renglon esta marcado como exento ("(E)",
  "E", "Exento"), false si se ve que grava IVA, null si no se distingue.
- recargo (flete, recargo) y descuento: montos POSITIVOS sobre el total de
  la factura; 0 si no hay.
- subtotal: la suma de TODOS los renglones antes de IVA, exentos incluidos
  (en la factura suele decir "SUB-TOTAL"). No es la "base imponible", que
  es solo la parte gravada. iva y total: los IMPRESOS.
- Numeros con punto decimal y sin separador de miles: en Venezuela
  "1.234,56" significa 1234.56. Si la factura trae montos en Bs y en $,
  transcribe la moneda de los renglones y sus totales en esa misma moneda.
- Un monto cortado por el borde del papel (por ejemplo "X 1.334,7" o
  "11.035,"): transcribe la parte que SI se ve (1334.7, 11035) y dilo en
  advertencias. Faltan centimos, no el renglon: el cuadre contra el subtotal
  los delata. Deja null solo si no se ve ningun digito.
- Las marcas a mano (chulitos, tachas, numeros escritos encima) son de
  quien recibio la mercancia: no cambian lo impreso.
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


def _es_codigo_suelto(renglon: dict) -> bool:
    """Un codigo de barras que se colo como renglon: solo digitos y sin
    precio ni subtotal (la cantidad no cuenta: a veces le ponen 1). Pasaba
    aunque las instrucciones digan que no."""
    descripcion = re.sub(r"\s", "", str(renglon.get("descripcion") or ""))
    return descripcion.isdigit() and not renglon.get("precio_unitario") and not renglon.get("subtotal")


def _sin_bloque(texto: str) -> str:
    """El JSON sin las comillas de bloque de markdown, si las trajo."""
    t = texto.strip()
    if t.startswith("```"):
        t = t[3:]
        if t[:4].lower() == "json":
            t = t[4:]
        t = t.rsplit("```", 1)[0]
    return t.strip()


class _Pasajero(Exception):
    """Google esta saturado o fallo por su lado: vale la pena otro intento."""


def _modelos_a_probar() -> list:
    principal = settings.GEMINI_MODELO
    respaldo = settings.GEMINI_MODELO_RESPALDO
    return [principal] + ([respaldo] if respaldo and respaldo != principal else [])


def _leer_con_gemini(archivo: bytes, tipo_mime: str) -> Lectura:
    modelos = _modelos_a_probar()
    for i, modelo in enumerate(modelos):
        for espera in (0,) + ESPERAS_REINTENTO_S:
            if espera:
                time.sleep(espera)
            try:
                return _pedir_a_gemini(archivo, tipo_mime, modelo)
            except _Pasajero:
                continue
        if i + 1 < len(modelos):
            log.warning("Gemini %s sigue saturado: se prueba con %s", modelo, modelos[i + 1])
    raise ErrorDeLectura(
        "Gemini está saturado en este momento. Intenta en unos minutos o carga la factura a mano."
    )


def _pedir_a_gemini(archivo: bytes, tipo_mime: str, modelo: str) -> Lectura:
    cuerpo = {
        "contents": [{
            "role": "user",
            "parts": [
                {"inline_data": {"mime_type": tipo_mime, "data": base64.b64encode(archivo).decode()}},
                {"text": INSTRUCCIONES.format(hoy=datetime.date.today().isoformat())},
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
            GEMINI_URL.format(modelo=modelo),
            json=cuerpo,
            headers={"x-goog-api-key": settings.GEMINI_API_KEY},
            timeout=GEMINI_TIMEOUT_S,
        )
    except httpx.TimeoutException:
        # No se reintenta: ya se espero GEMINI_TIMEOUT_S, otra vuelta igual
        # dejaria a la persona minutos frente a la pantalla.
        raise ErrorDeLectura("Gemini tardó demasiado en leer la factura. Intenta otra vez o cárgala a mano.")
    except httpx.HTTPError:
        raise ErrorDeLectura("No se pudo conectar con Gemini. Revisa la conexión del servidor.")

    if r.status_code != 200:
        # El cuerpo del error va al log (sirve para diagnosticar) pero no a
        # la pantalla: puede traer detalles de la cuenta.
        log.warning("Gemini %s respondio %s: %s", modelo, r.status_code, r.text[:500])
        if r.status_code in ESTADOS_PASAJEROS:
            raise _Pasajero()
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
        if isinstance(leido.get("renglones"), list):
            leido["renglones"] = [
                r for r in leido["renglones"] if not (isinstance(r, dict) and _es_codigo_suelto(r))
            ]
        borrador = schemas.BorradorFactura(**leido)
    except (json.JSONDecodeError, ValidationError, TypeError, AttributeError) as e:
        log.warning("Gemini devolvio algo que no es un borrador: %s / %s", e, texto[:300])
        raise ErrorDeLectura("Gemini devolvió una lectura incompleta. Prueba otra vez o carga la factura a mano.")

    uso = datos.get("usageMetadata") or {}
    return Lectura(
        borrador=borrador,
        tokens_entrada=int(uso.get("promptTokenCount") or 0),
        # Lo que razona tambien se cobra como salida.
        tokens_salida=int(uso.get("candidatesTokenCount") or 0) + int(uso.get("thoughtsTokenCount") or 0),
        modelo=modelo,
    )


_LECTORES = {
    "prueba": _leer_de_prueba,
    "gemini": _leer_con_gemini,
}
