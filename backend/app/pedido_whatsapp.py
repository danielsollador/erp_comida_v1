"""Pedidos por WhatsApp como borrador (22-oct).

El cliente escribe "buenas, me mandas 3 empanadas de queso, 2 de carne y un
jugo de naranja grande, a nombre de Luis". La cajera lo pega y le queda la
comanda armada para revisar: cada renglón con su producto del menú, la
cantidad y lo que no se entendió aparte.

La persona decide: esto NO crea el pedido. Devuelve un borrador y el punto de
venta lo carga en la comanda actual, donde se revisa y se manda a cocina como
cualquier otro.

Dos lectores, con el mismo resultado:
  - con IA (Gemini): entiende cómo escribe la gente ("una de queso y otra
    igual", "2 tequeños grandes y uno pequeño").
  - sin IA: un lector de reglas, renglón por renglón ("2 empanadas de
    queso"). Es el que queda si la IA no está encendida o no contesta.
En los dos, el producto lo elige el sistema contra el menú de verdad: un id
que la IA invente no pasa.
"""

import difflib
import json
import logging
import re
import unicodedata
from dataclasses import dataclass
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from . import asistente_ayuda, models, schemas
from .lectura_facturas import _sin_bloque

log = logging.getLogger("erp.whatsapp")

LARGO_MAXIMO = 3000
PARECIDO_MINIMO = 0.55
NUMEROS = {
    "un": 1, "una": 1, "uno": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5, "seis": 6,
    "siete": 7, "ocho": 8, "nueve": 9, "diez": 10, "once": 11, "doce": 12, "media docena": 6, "docena": 12,
}
# Lo que no es producto: saludos, despedidas, formas de pago.
RUIDO = re.compile(
    r"^(hola|buen[oa]s?( dias| tardes| noches)?|gracias|porfa|por favor|ok|listo|saludos|bendiciones)\b", re.I
)


@dataclass
class _Opcion:
    variante_id: int
    nombre: str
    precio: float
    clave: str
    producto: str = ""


def _sin_tildes(texto: str) -> str:
    t = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", t)).strip()


def _singular(palabra: str) -> str:
    if len(palabra) > 4 and palabra.endswith("es") and palabra[-3] not in "aeiou":
        return palabra[:-2]
    if len(palabra) > 3 and palabra.endswith("s"):
        return palabra[:-1]
    return palabra


def _clave(texto: str) -> str:
    vacias = {"de", "del", "la", "el", "con", "y", "a", "los", "las", "un", "una"}
    return " ".join(_singular(w) for w in _sin_tildes(texto).split() if w not in vacias)


def menu(db: Session) -> List[_Opcion]:
    opciones = []
    filas = (
        db.query(models.Variante, models.Producto)
        .join(models.Producto, models.Producto.id == models.Variante.producto_id)
        .filter(models.Variante.activo.isnot(False), models.Producto.activo.isnot(False))
        .all()
    )
    for v, p in filas:
        una_sola = len([x for x in p.variantes if x.activo is not False]) == 1
        nombre = p.nombre if una_sola and v.nombre.lower() in ("regular", "unica", "única", "normal") else f"{p.nombre} · {v.nombre}"
        opciones.append(_Opcion(variante_id=v.id, nombre=nombre, precio=v.precio, clave=_clave(f"{p.nombre} {v.nombre}"),
                                producto=p.nombre))
    return opciones


def _puntaje(texto: str, opcion: _Opcion) -> float:
    """Cuánto se parece lo que escribió el cliente al nombre del menú: las
    palabras del cliente que están en el producto pesan más que la forma."""
    pedidas = set(_clave(texto).split())
    tiene = set(opcion.clave.split())
    if not pedidas:
        return 0.0
    comunes = len(pedidas & tiene) / len(pedidas | tiene)
    forma = difflib.SequenceMatcher(None, _clave(texto), opcion.clave).ratio()
    return 0.6 * comunes + 0.4 * forma


def _candidatas(texto: str, opciones: List[_Opcion], n: int = 3) -> List[_Opcion]:
    return [o for p, o in sorted(((_puntaje(texto, o), o) for o in opciones), key=lambda x: -x[0])[:n] if p > 0.2]


# ── Sin IA: renglón por renglón ─────────────────────────────────────────────

_A_NOMBRE = re.compile(r"(?:a nombre de|nombre:?|soy)\s+([a-záéíóúñ][\wáéíóúñ ]{1,40})", re.I)
# Lo que dice el cliente antes de pedir: se quita para llegar a la cantidad.
_ANTES = re.compile(
    r"^(?:(?:hola|buen[oa]s?(?: dias| tardes| noches)?|saludos|amig[oa])[\s!,.]*)*"
    r"(?:(?:me (?:mandas?|envias?|regalas?|traes?|vendes?|das?)|quiero|quisiera|necesito|para pedir|pedido:?|por fa(?:vor)?)\s+)*",
    re.I,
)
_PALABRA_NUMERO = "|".join(sorted((re.escape(k) for k in NUMEROS), key=len, reverse=True))
_CANTIDAD = re.compile(rf"^(?:(\d+)\s*x?|({_PALABRA_NUMERO}))\s+(.+)$", re.I)
_ES_NOTA = ("direccion", "llevar", "delivery", "pago", "transferencia", "efectivo", "zelle", "sin ", "aparte",
            "hora", "retiro", "paso a buscar", "punto de referencia")


def _renglones(texto: str) -> List[str]:
    """Las cosas que pide, una por renglon. Un renglon de direccion o de pago
    va entero a la nota: "calle 4, casa 12" no son dos productos."""
    salida = []
    for linea in texto.splitlines():
        linea = linea.strip(" .-*•")
        if not linea:
            continue
        if any(w in _sin_tildes(linea) for w in _ES_NOTA) or _A_NOMBRE.search(linea):
            salida.append(linea)
            continue
        partes = re.split(r"[;,](?!\d)|\s+y\s+(?=(?:\d|un|una|dos|tres|cuatro|cinco|seis|media)\b)", linea, flags=re.I)
        salida += [p.strip(" .-*•") for p in partes if p and p.strip(" .-*•")]
    return salida


def leer_con_reglas(texto: str) -> dict:
    cliente = ""
    m = _A_NOMBRE.search(texto)
    if m:
        cliente = m.group(1).strip().splitlines()[0].strip()
        cliente = re.split(r"\s+(?:por|para|y|que|gracias)\b", cliente, flags=re.I)[0].strip().title()
    lineas = []
    notas = []
    for r in _renglones(texto):
        if _A_NOMBRE.search(r):
            continue
        if any(w in _sin_tildes(r) for w in _ES_NOTA):
            notas.append(r)
            continue
        pedido = _ANTES.sub("", r).strip()
        if not pedido or RUIDO.match(_sin_tildes(pedido)):
            continue
        cantidad = 1
        resto = pedido
        m = _CANTIDAD.match(pedido)
        if m:
            cantidad = int(m.group(1)) if m.group(1) else NUMEROS[m.group(2).lower()]
            resto = m.group(3)
        lineas.append({"texto": pedido, "cantidad": cantidad, "busca": resto, "variante_id": 0})
    return {"cliente": cliente, "nota": "; ".join(notas), "lineas": lineas}


# ── Con IA ──────────────────────────────────────────────────────────────────

INSTRUCCIONES = """Lees mensajes de WhatsApp de clientes de un negocio de comida en Venezuela
y sacas el pedido. No respondes al cliente.

- `lineas`: cada cosa que pide, con su cantidad y el `variante_id` del MENÚ de
  abajo que corresponde. Si no estás seguro de cuál es, `variante_id` = 0 y en
  `busca` pon lo que pidió con sus palabras. Nunca inventes un id.
- "una de queso y otra igual" son 2. "media docena" son 6.
- `cliente`: el nombre si lo dice; si no, vacío.
- `nota`: lo que no es producto pero la cajera debe saber (dirección, hora,
  "sin cebolla", cómo va a pagar). Corto.
- Los saludos y las despedidas no son pedido.

MENÚ (variante_id: nombre — precio):
{menu}"""

ESQUEMA = {
    "type": "OBJECT",
    "properties": {
        "cliente": {"type": "STRING"},
        "nota": {"type": "STRING"},
        "lineas": {"type": "ARRAY", "items": {
            "type": "OBJECT",
            "properties": {
                "texto": {"type": "STRING", "description": "lo que escribió el cliente para esa cosa"},
                "cantidad": {"type": "NUMBER"},
                "variante_id": {"type": "INTEGER"},
                "busca": {"type": "STRING"},
            },
            "required": ["texto", "cantidad", "variante_id"],
        }},
    },
    "required": ["cliente", "nota", "lineas"],
}


def leer_con_ia(texto: str, opciones: List[_Opcion]) -> Optional[dict]:
    lista = "\n".join(f"{o.variante_id}: {o.nombre} — ${o.precio:.2f}" for o in opciones)
    respuesta = asistente_ayuda.gemini([{"role": "user", "parts": [{"text": texto}]}],
                                       INSTRUCCIONES.format(menu=lista), esquema=ESQUEMA)
    if not respuesta:
        return None
    try:
        return json.loads(_sin_bloque(respuesta))
    except ValueError:
        log.warning("La lectura del WhatsApp no vino en JSON")
        return None


# ── El borrador ─────────────────────────────────────────────────────────────

def borrador(db: Session, texto: str) -> schemas.BorradorWhatsApp:
    texto = (texto or "").strip()[:LARGO_MAXIMO]
    opciones = menu(db)
    por_id: Dict[int, _Opcion] = {o.variante_id: o for o in opciones}
    leido = leer_con_ia(texto, opciones) if asistente_ayuda.activo() else None
    con_ia = leido is not None
    if leido is None:
        leido = leer_con_reglas(texto)

    lineas: List[schemas.LineaBorrador] = []
    anterior: Optional[_Opcion] = None
    for l in leido.get("lineas") or []:
        try:
            cantidad = max(1, int(round(float(l.get("cantidad") or 1))))
        except (TypeError, ValueError):
            cantidad = 1
        dicho = (l.get("texto") or l.get("busca") or "").strip()
        elegida = por_id.get(int(l.get("variante_id") or 0))
        candidatas = _candidatas(l.get("busca") or dicho, opciones)
        if elegida is None and candidatas and _puntaje(l.get("busca") or dicho, candidatas[0]) >= PARECIDO_MINIMO:
            elegida = candidatas[0]
        if elegida is None and anterior is not None:
            # "3 empanadas de queso, 2 de carne": el segundo es otra empanada.
            con_el_anterior = f"{anterior.producto} {l.get('busca') or dicho}"
            otras = _candidatas(con_el_anterior, opciones)
            if otras and _puntaje(con_el_anterior, otras[0]) >= PARECIDO_MINIMO:
                elegida, candidatas = otras[0], otras
        anterior = elegida or anterior
        lineas.append(schemas.LineaBorrador(
            texto=dicho, cantidad=cantidad,
            variante_id=elegida.variante_id if elegida else None,
            nombre=elegida.nombre if elegida else "",
            precio=elegida.precio if elegida else None,
            opciones=[schemas.OpcionMenu(variante_id=o.variante_id, nombre=o.nombre, precio=o.precio)
                      for o in ([elegida] if elegida else []) + [c for c in candidatas if c is not elegida]][:4],
        ))
    total = round(sum((l.precio or 0) * l.cantidad for l in lineas if l.variante_id), 2)
    return schemas.BorradorWhatsApp(
        cliente=(leido.get("cliente") or "").strip()[:60],
        nota=(leido.get("nota") or "").strip()[:300],
        lineas=lineas,
        total=total,
        con_ia=con_ia,
    )
