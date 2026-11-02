"""Soporte con el manual propio (spike de IA, idea 6).

"¿Por qué no me cuadra la caja?" no se contesta con un número sino con cómo
funciona Vertigo. El manual (`manual.md`) y el glosario de la pantalla
(`glosario.json`, generado con `npm run glosario:json`) se le dan al
asistente como HERRAMIENTAS, no en el prompt: el modelo pide la sección que
necesita.

Primero iban enteros en el prompt (con caché). Medido el 22-oct-2026: con el
caché caliente salía US$0,011 por pregunta, pero el caché dura 5 minutos y en
un local las preguntas llegan espaciadas; en frío cada pregunta, aunque fuera
"¿cuánto vendí hoy?", pagaba ~25.000 tokens (US$0,11). Leyendo solo la
sección, la pregunta de soporte paga ~2.000 tokens y la de datos, nada.
"""
import json
import os
import re
import unicodedata
from functools import lru_cache

AQUI = os.path.dirname(__file__)


@lru_cache(maxsize=1)
def secciones() -> dict:
    """{título de la sección ##: su texto}. Vacío si no está el manual."""
    try:
        with open(os.path.join(AQUI, "manual.md"), encoding="utf-8") as f:
            texto = f.read()
    except OSError:
        return {}
    partes = re.split(r"^## ", texto, flags=re.M)[1:]
    return {p.split("\n", 1)[0].strip(): "## " + p.strip() for p in partes}


@lru_cache(maxsize=1)
def _glosario() -> dict:
    try:
        with open(os.path.join(AQUI, "glosario.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _palabras(t: str) -> set:
    t = unicodedata.normalize("NFKD", t.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return {w for w in re.findall(r"[a-z0-9]+", t) if len(w) > 2}


def leer_manual(seccion: str) -> dict:
    s = secciones()
    if seccion not in s:
        return {"error": f"No hay una sección «{seccion}». Las que hay: {', '.join(s)}"}
    return {"seccion": seccion, "texto": s[seccion]}


def que_significa(termino: str) -> dict:
    """Las definiciones del glosario que más se parecen al término (por palabras)."""
    buscadas = _palabras(termino)
    puntaje = []
    for clave, e in _glosario().items():
        en_clave = _palabras(clave.replace(".", " ").replace("_", " "))
        en_texto = _palabras(e.get("que", ""))
        p = 3 * len(buscadas & en_clave) + len(buscadas & en_texto)
        if p:
            puntaje.append((p, clave, e))
    puntaje.sort(key=lambda x: -x[0])
    return {"definiciones": [{"clave": c, **e} for _, c, e in puntaje[:6]]}


def declaraciones() -> list:
    s = secciones()
    if not s:
        return []
    # Cada problema es una línea entera en negrita ("**La cocina no suena.**").
    problemas = re.findall(r"^\*\*(.+?)\*\*\s*$", s.get("Problemas comunes", ""), flags=re.M)
    return [
        {
            "name": "leer_manual",
            "description": (
                "Lee una sección del manual de Vertigo Pro: para qué sirve cada pantalla, dónde está cada botón, "
                "cómo se hacen las tareas y por qué el sistema hace lo que hace. Úsalo para preguntas de uso, de "
                "soporte y de \"por qué\". La sección «Problemas comunes» responde: " + "; ".join(problemas)
            ),
            "parameters": {
                "type": "object",
                "properties": {"seccion": {"type": "string", "enum": list(s)}},
                "required": ["seccion"],
            },
        },
        {
            "name": "que_significa",
            "description": "Qué significa una columna o cifra de las pantallas (Ticket promedio, Debes tener, Rendimiento, Costo de reposición...): qué es, de dónde sale y cómo se calcula.",
            "parameters": {
                "type": "object",
                "properties": {"termino": {"type": "string"}},
                "required": ["termino"],
            },
        },
    ]


HERRAMIENTAS = {"leer_manual": leer_manual, "que_significa": que_significa}

REGLAS = """
Preguntas de uso y soporte ("¿por qué…?", "¿qué significa…?", "no me deja…", "¿dónde está…?"):
- Lee la sección del manual que corresponda (leer_manual) o busca el término (que_significa) ANTES de responder. No respondas de memoria cómo funciona una pantalla.
- Responde en palabras del negocio, sin copiar el manual entero. Al final, en una línea, di de dónde sale ("Según el manual: Cierre de caja").
- Si la respuesta depende de sus datos (cuánto le falta, qué producto no tiene receta), usa además las consultas.
- Si el manual no lo cubre, dilo claro ("Eso no lo tengo en el manual") y sugiere escribirle al equipo de Vertigo.
- Si la pregunta es cómo HACER algo, además de explicarlo ofrece la guía en pantalla (armar_guia).

Dos funciones nuevas que el manual todavía no cuenta:
- Menú › botón «Cambiar precios»: se escribe lo que se quiere ("sube 10% las empanadas menos la de queso", "pon el café en 1,50"), se ve el antes y el después de cada precio y se toca Aplicar. Queda Deshacer unos segundos.
- Reportes › A medida › casilla «Pídelo con tus palabras»: se escribe el reporte ("empanadas por día esta semana") y se arma solo en las pastillas, que se pueden ajustar.
Si alguien quiere un reporte o cambiar precios, explícale que lo puede hacer ahí y ofrécele la guía."""
