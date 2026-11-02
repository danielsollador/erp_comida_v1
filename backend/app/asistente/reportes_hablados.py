"""Reportes hablados: una frase -> la definición de Reportes › A medida.

El LLM NO consulta ni calcula nada. Recibe el catálogo de A medida (el mismo
que ve este usuario: sus fuentes, sin las medidas sensibles si no es dueño)
y los valores con que se puede filtrar, y devuelve una definición. Aquí se
valida campo por campo contra ese catálogo; la pantalla la pone en las
pastillas de siempre y el motor de Daniel (`reporte_dinamico.consultar`) hace
el resto. Si el modelo inventa un campo, no pasa de aquí.

Probado en el spike (22-oct-2026): 12 de 12 frases bien traducidas con
Sonnet 5.5; la que no tenía respuesta ("clientes nuevos") dijo por qué.
"""
import datetime
import json
from typing import List, Optional, Sequence

from sqlalchemy.orm import Session

from .. import reporte_dinamico as rd
from ..timeutils import hoy
from . import claude
from .gemini import ErrorDelAsistente

DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]

# Los campos de texto cuyos valores se le dan al modelo para que filtre con el
# valor EXACTO (el producto va por id: "v:6", no por nombre). Los demás campos
# de texto (persona, cliente...) no se filtran desde una frase.
FILTRABLES = {
    "productos": ("producto", "categoria"),
    "ventas": ("forma_pago", "persona", "caja"),
    "cobros": ("forma_pago", "persona"),
    "compras": ("proveedor", "producto", "categoria"),
    "inventario": ("producto", "categoria", "motivo"),
}
MAX_VALORES = 150

SISTEMA = """Traduces lo que pide el dueño de un negocio de comida en Venezuela a la definición de un reporte de "Reportes a medida".

Reglas:
- Usa SOLO ids que estén en el CATÁLOGO: una fuente, sus campos (para "filas" y "columna") y sus medidas.
- "filas": 0 a 2 campos por los que se agrupa. "columna": un campo para comparar lado a lado, o null.
- En filtros usa SOLO el "valor" exacto de la lista VALORES (para día de la semana: 0=lunes … 6=domingo).
- Elige el período (desde/hasta, inclusive). "Esta semana" = lunes a hoy; "este mes" = día 1 a hoy; "el mes pasado" = el mes calendario anterior completo; "últimos N días" incluye hoy. Sin fecha en la frase: el mes en curso.
- "entendi": una frase corta, en palabras del negocio, de lo que vas a mostrar (con las fechas). Es lo que lee el dueño para saber si entendiste.
- Si el catálogo no tiene con qué responder, explica en "no_se_puede" qué falta y qué sí se puede ver; lo demás va mínimo.

CATÁLOGO:
{catalogo}

VALORES:
{valores}"""

ESQUEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["fuente", "desde", "hasta", "filas", "columna", "medidas", "filtros", "entendi", "no_se_puede"],
    "properties": {
        "fuente": {"type": "string"},
        "desde": {"type": "string", "format": "date"},
        "hasta": {"type": "string", "format": "date"},
        "filas": {"type": "array", "items": {"type": "string"}},
        "columna": {"type": ["string", "null"]},
        "medidas": {"type": "array", "items": {"type": "string"}},
        "filtros": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["campo", "valores"],
                "properties": {"campo": {"type": "string"}, "valores": {"type": "array", "items": {"type": "string"}}},
            },
        },
        "entendi": {"type": "string"},
        "no_se_puede": {"type": ["string", "null"]},
    },
}


def _valores(db: Session, cat: List[dict], modulos: Optional[Sequence[str]]) -> dict:
    fin = datetime.datetime.combine(hoy() + datetime.timedelta(days=1), datetime.time())
    inicio = fin - datetime.timedelta(days=90)
    salida = {}
    for f in cat:
        ids = {c["id"] for c in f["campos"]}
        for campo in FILTRABLES.get(f["id"], ()):
            if campo not in ids:
                continue
            try:
                vals = rd.valores_posibles(db, f["id"], campo, inicio, fin, modulos)
            except rd.ErrorDeConsulta:
                continue
            vals = [v for v in vals if v["etiqueta"] != rd.SIN_DATO][:MAX_VALORES]
            if vals:
                salida[f"{f['id']}.{campo}"] = [{"valor": v["valor"], "nombre": v["etiqueta"]} for v in vals]
    return salida


def _validar(d: dict, cat: List[dict]) -> Optional[str]:
    """None si la definición se puede usar; si no, qué está mal."""
    f = next((x for x in cat if x["id"] == d["fuente"]), None)
    if f is None:
        return f"la fuente «{d['fuente']}» no existe"
    campos = {c["id"] for c in f["campos"]}
    medidas = {m["id"] for m in f["medidas"]}
    if not d["medidas"]:
        return "falta al menos una medida"
    for m in d["medidas"]:
        if m not in medidas:
            return f"la medida «{m}» no es de {f['nombre']}"
    usados = list(d["filas"]) + ([d["columna"]] if d["columna"] else [])
    if len(d["filas"]) > 2 or len(set(usados)) != len(usados):
        return "los campos de filas y columna no pueden repetirse (máximo 2 filas)"
    for c in usados + [x["campo"] for x in d["filtros"]]:
        if c not in campos:
            return f"el campo «{c}» no es de {f['nombre']}"
    try:
        desde = datetime.date.fromisoformat(d["desde"])
        hasta = datetime.date.fromisoformat(d["hasta"])
    except ValueError:
        return "las fechas no son válidas"
    if hasta < desde:
        return "la fecha final es anterior a la inicial"
    return None


def traducir(db: Session, frase: str, ve_sensibles: bool, modulos: Optional[Sequence[str]]) -> dict:
    cat = rd.catalogo(ve_sensibles, modulos)
    if not cat:
        raise ErrorDelAsistente("Tu rol no tiene acceso a ningún reporte.")
    # Lo fijo (catálogo + valores) se cachea; cambia solo cuando cambia el menú.
    fijo = SISTEMA.format(
        catalogo=json.dumps(cat, ensure_ascii=False),
        valores=json.dumps(_valores(db, cat, modulos), ensure_ascii=False),
    )
    h = hoy()
    variable = f"Hoy es {DIAS[h.weekday()]} {h.isoformat()}."
    texto = frase
    for intento in range(2):
        d, r = claude.estructurado(fijo, variable, texto, ESQUEMA)
        if d is None:
            raise ErrorDelAsistente("Esa petición no la puedo traducir. Prueba a decirla de otra forma.")
        if d.get("no_se_puede"):
            return {"no_se_puede": d["no_se_puede"], "entendi": d.get("entendi", ""), "costo_usd": r.costo_usd, "ms": r.ms}
        problema = _validar(d, cat)
        if problema is None:
            filtros = {}
            for x in d["filtros"]:
                if x["valores"]:
                    filtros.setdefault(x["campo"], []).extend(x["valores"])
            return {
                "definicion": {
                    "fuente": d["fuente"], "filas": d["filas"], "columna": d["columna"],
                    "medidas": d["medidas"][:2], "filtros": filtros,
                },
                "desde": d["desde"],
                "hasta": d["hasta"],
                "entendi": d["entendi"],
                "no_se_puede": None,
                "costo_usd": r.costo_usd,
                "ms": r.ms,
            }
        # Una segunda vuelta diciéndole qué estuvo mal; si tampoco, se avisa.
        texto = f"{frase}\n\n(Tu respuesta anterior no sirve: {problema}. Corrígela usando solo el catálogo.)"
    raise ErrorDelAsistente("No logré armar ese reporte. Prueba a decirlo con otras palabras o ármalo con las pastillas.")
