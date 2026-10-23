"""Pregúntale a tu negocio (IA, 22-oct).

"¿Cuánto vendí el sábado?", "¿qué producto me dejó más este mes?", "¿cuánto
le compré a Carnes SA?". Tres pasos, y la IA no calcula ningún número:

  1. `traducir`: la IA convierte la pregunta en una consulta del catálogo de
     la reportería (reporte_dinamico.py): fuente, fechas, por qué agrupar,
     qué medir y qué filtrar. Solo puede elegir de lo que ya existe y está
     probado; no escribe SQL.
  2. `reporte_dinamico.consultar` calcula, con las mismas reglas que Reportes
     y Ventas (devoluciones fuera, cortesías no son venta...) y con los
     permisos de quien pregunta: la cajera no ve Contabilidad ni el margen.
  3. `_redactar`: la IA responde en una o dos frases usando SOLO esos
     números. Debajo se muestra la tabla que sacó el sistema, para que
     cualquiera la pueda comprobar.

Si la consulta no se puede (un campo que no existe, un producto que no
aparece), se le devuelve el error a la IA una vez para que la corrija; si
tampoco, se le dice a la persona qué sí se puede preguntar.
"""

import datetime
import difflib
import json
import logging
import unicodedata
from typing import Dict, Iterator, List, Optional, Sequence, Tuple

from sqlalchemy.orm import Session

from . import asistente_ayuda, reporte_dinamico as rd, schemas
from .acceso import permisos
from .lectura_facturas import _sin_bloque
from .timeutils import MESES_ES, hoy, inicio_del_dia

log = logging.getLogger("erp.negocio")

FILAS_EN_PANTALLA = 15
TOPE_POR_DEFECTO = 10
DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]


class NoSePuede(Exception):
    """La pregunta no se puede responder con el catálogo; el mensaje dice por qué."""


# ── Los números como los muestra el sistema ─────────────────────────────────

def _miles(valor: float, decimales: int) -> str:
    return f"{valor:,.{decimales}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def formatear(valor: Optional[float], formato: str) -> str:
    if valor is None:
        return "—"
    if formato == "dinero":
        return ("-" if valor < 0 else "") + "$" + _miles(abs(valor), 2)
    if formato == "bs":
        return "Bs " + _miles(valor, 2)
    if formato == "entero":
        return _miles(valor, 0)
    if formato == "pct":
        return _miles(valor, 1) + " %"
    return _miles(valor, 2).rstrip("0").rstrip(",")


def _sin_tildes(texto: str) -> str:
    return unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode().lower().strip()


def _singular(palabra: str) -> str:
    if len(palabra) > 4 and palabra.endswith("es") and palabra[-3] not in "aeiou":
        return palabra[:-2]  # "panes" -> "pan"
    if len(palabra) > 3 and palabra.endswith("s"):
        return palabra[:-1]  # "empanadas" -> "empanada"
    return palabra


def _coincide(buscado: str, etiqueta: str) -> bool:
    """"empanadas de carne" encuentra «Empanada · Carne»: cada palabra que
    importa, en singular, tiene que estar en la etiqueta."""
    palabras = [_singular(w) for w in buscado.replace("·", " ").split() if len(w) > 2 and w not in ("del", "las", "los", "con")]
    return bool(palabras) and all(w in etiqueta for w in palabras)


def _fecha(d: datetime.date) -> str:
    return f"{d.day} de {MESES_ES[d.month - 1].lower()}"


# ── 1. La pregunta, como consulta del catálogo ──────────────────────────────

INSTRUCCIONES = """Traduces preguntas del dueño de un negocio de comida en Venezuela a UNA
consulta del catálogo de reportes de su sistema. No respondes la pregunta: solo
eliges la consulta que la responde. El sistema la calcula.

Hoy es {hoy_texto} ({hoy}).
Fechas:
- "hoy" = {hoy}; "ayer" = el día anterior.
- "el sábado" (o cualquier día) = el último que ya pasó o es hoy.
- "esta semana" = del lunes de esta semana a hoy. "la semana pasada" = lunes a domingo anteriores.
- "este mes" = del día 1 a hoy. "el mes pasado" = el mes calendario anterior.
- Sin fecha en la pregunta: los últimos 30 días.
- Nunca una fecha después de hoy.

Reglas:
- `fuente`, `filas`, `medidas` y `filtros[].campo` SOLO con los id del catálogo, y
  los campos y medidas de ESA fuente.
- `filas`: por qué agrupar (0, 1 o 2 campos). "¿Qué producto vendió más?" agrupa
  por producto; "¿cuánto vendí?" no agrupa.
- `filtros[].valores`: el nombre como lo dijo la persona ("empanada", "Carnes SA").
  El sistema lo busca.
- `limite`: cuántas filas importan ("los 3 que más" = 3). Si no dice, {tope}.
- Si la pregunta no se puede con este catálogo (no hay esos datos, o su rol no
  entra a esa fuente), `tipo` = "no_se_puede" y en `motivo` di en una frase qué sí
  puede preguntar.
- Si la persona sigue una conversación ("¿y el domingo?"), usa lo anterior.

Quien pregunta: {rol}.

CATÁLOGO (lo único que existe):
{catalogo}"""


def _catalogo_texto(fuentes: List[dict]) -> str:
    bloques = []
    for f in fuentes:
        campos = ", ".join(f"{c['id']} ({c['nombre']})" for c in f["campos"])
        medidas = ", ".join(f"{m['id']} ({m['nombre']})" for m in f["medidas"])
        bloques.append(f"- fuente `{f['id']}` — {f['nombre']}: {f['descripcion']}\n  campos: {campos}\n  medidas: {medidas}")
    return "\n".join(bloques)


def _esquema(fuentes: List[dict]) -> dict:
    campos = sorted({c["id"] for f in fuentes for c in f["campos"]})
    medidas = sorted({m["id"] for f in fuentes for m in f["medidas"]})
    return {
        "type": "OBJECT",
        "properties": {
            "tipo": {"type": "STRING", "enum": ["consulta", "no_se_puede"]},
            "motivo": {"type": "STRING"},
            "fuente": {"type": "STRING", "enum": [f["id"] for f in fuentes]},
            "desde": {"type": "STRING", "description": "AAAA-MM-DD"},
            "hasta": {"type": "STRING", "description": "AAAA-MM-DD, inclusive"},
            "filas": {"type": "ARRAY", "items": {"type": "STRING", "enum": campos}},
            "medidas": {"type": "ARRAY", "items": {"type": "STRING", "enum": medidas}},
            "filtros": {"type": "ARRAY", "items": {
                "type": "OBJECT",
                "properties": {"campo": {"type": "STRING", "enum": campos},
                               "valores": {"type": "ARRAY", "items": {"type": "STRING"}}},
                "required": ["campo", "valores"],
            }},
            "limite": {"type": "INTEGER"},
        },
        "required": ["tipo", "motivo", "fuente", "desde", "hasta", "filas", "medidas", "filtros", "limite"],
    }


def _contenidos(historial: Sequence[schemas.TurnoAyuda], pregunta: str) -> List[dict]:
    salida = [
        {"role": "model" if t.rol == "asistente" else "user", "parts": [{"text": t.texto[:1500]}]}
        for t in list(historial)[-asistente_ayuda.TURNOS_DE_MEMORIA:] if t.texto.strip()
    ]
    salida.append({"role": "user", "parts": [{"text": pregunta}]})
    return salida


def traducir(contenidos: List[dict], fuentes: List[dict], rol: str, rapido: bool = True) -> dict:
    d = hoy()
    instrucciones = INSTRUCCIONES.format(
        hoy=d.isoformat(), hoy_texto=f"{DIAS[d.weekday()]} {_fecha(d)} de {d.year}",
        tope=TOPE_POR_DEFECTO, rol=permisos.nombre_de(rol), catalogo=_catalogo_texto(fuentes),
    )
    # El liviano primero: elegir una consulta del catalogo es guiado, y tarda
    # la mitad. Si se equivoca, el reintento va con el bueno (ver `_preparar`).
    texto = asistente_ayuda.gemini(contenidos, instrucciones, esquema=_esquema(fuentes), rapido=rapido)
    if not texto:
        raise RuntimeError("la IA no contestó")
    return json.loads(_sin_bloque(texto))


# ── 2. La consulta, validada y calculada ─────────────────────────────────────

def _resolver_filtro(db: Session, fuente: str, campo: str, pedidos: List[str],
                     inicio: datetime.datetime, fin: datetime.datetime,
                     modulos: Sequence[str]) -> Tuple[List[str], List[str]]:
    """Lo que dijo la persona ("empanada") contra los valores que hay de verdad:
    (valores para filtrar, sus nombres para decir que se filtro)."""
    posibles = rd.valores_posibles(db, fuente, campo, inicio, fin, modulos)
    etiqueta_de = {p["valor"]: p["etiqueta"] for p in posibles}
    elegidos: List[str] = []
    for pedido in pedidos:
        buscado = _sin_tildes(pedido)
        if not buscado:
            continue
        iguales = [p["valor"] for p in posibles if _sin_tildes(p["etiqueta"]) == buscado]
        contiene = [p["valor"] for p in posibles
                    if buscado in _sin_tildes(p["etiqueta"]) or _coincide(buscado, _sin_tildes(p["etiqueta"]))]
        encontrados = iguales or contiene
        if not encontrados:
            parecidos = difflib.get_close_matches(buscado, [_sin_tildes(p["etiqueta"]) for p in posibles], n=3, cutoff=0.6)
            nombres = [p["etiqueta"] for p in posibles if _sin_tildes(p["etiqueta"]) in parecidos]
            raise NoSePuede(
                f"No encontré «{pedido}» en ese período."
                + (f" ¿Quisiste decir {', '.join('«' + n + '»' for n in nombres)}?" if nombres else "")
            )
        elegidos += [v for v in encontrados if v not in elegidos]
    return elegidos, [etiqueta_de[v] for v in elegidos]


def _consulta(db: Session, t: dict, modulos: Sequence[str]) -> Tuple[rd.Consulta, datetime.date, datetime.date, int, List[str]]:
    if t.get("tipo") != "consulta":
        raise NoSePuede(t.get("motivo") or "Eso no lo puedo sacar de tus reportes.")
    try:
        desde = datetime.date.fromisoformat(t.get("desde") or "")
        hasta = datetime.date.fromisoformat(t.get("hasta") or "")
    except ValueError:
        raise rd.ErrorDeConsulta("Las fechas tienen que ser AAAA-MM-DD.")
    hasta = min(hasta, hoy())
    if desde > hasta:
        raise rd.ErrorDeConsulta("`desde` no puede ser después de `hasta`.")
    inicio = inicio_del_dia(desde)
    fin = inicio_del_dia(hasta + datetime.timedelta(days=1))
    fuente = t.get("fuente") or ""
    filtros: Dict[str, List[str]] = {}
    nombres: List[str] = []
    for f in t.get("filtros") or []:
        if f.get("valores"):
            filtros[f["campo"]], etiquetas = _resolver_filtro(db, fuente, f["campo"], f["valores"], inicio, fin, modulos)
            nombres.append(", ".join(etiquetas[:3]) + ("…" if len(etiquetas) > 3 else ""))
    limite = max(1, min(int(t.get("limite") or TOPE_POR_DEFECTO), FILAS_EN_PANTALLA))
    consulta = rd.Consulta(fuente=fuente, inicio=inicio, fin=fin, filas=list(t.get("filas") or [])[:2],
                           medidas=list(t.get("medidas") or []), filtros=filtros)
    return consulta, desde, hasta, limite, nombres


def _periodo(desde: datetime.date, hasta: datetime.date) -> str:
    if desde == hasta:
        return f"{DIAS[desde.weekday()]} {_fecha(desde)}"
    return f"del {_fecha(desde)} al {_fecha(hasta)}"


def _tabla(r: dict, limite: int) -> Tuple[List[str], List[List[str]], List[str]]:
    medidas = r["medidas"]
    columnas = [c["nombre"] for c in r["campos_fila"]] + [m["nombre"] for m in medidas]
    filas = [
        f["etiquetas"] + [formatear(f["total"].get(m["id"]), m["formato"]) for m in medidas]
        for f in r["filas"][:limite]
    ]
    total = []
    if r["campos_fila"] and len(r["filas"]) > 1:
        total = ["Total"] + [""] * (len(r["campos_fila"]) - 1) + [
            formatear(r["totales"]["total"].get(m["id"]), m["formato"]) if m["sumable"] else "" for m in medidas
        ]
    if not r["campos_fila"]:
        filas = [[formatear(r["totales"]["total"].get(m["id"]), m["formato"]) for m in medidas]]
    return columnas, filas, total


# ── 3. La respuesta ─────────────────────────────────────────────────────────

REDACTAR = """Respondes al dueño de un negocio de comida con los números que sacó su sistema.

Reglas:
- Usa SOLO los números de la tabla, escritos igual. No calcules números nuevos
  (ni sumas, ni promedios, ni porcentajes, ni "casi la mitad" o "una quinta
  parte"); comparar cuál es mayor sí.
- Dos o tres frases, de tú. Empieza por la respuesta, en **negrita** el número
  que importa. Tono cálido de socio que conoce el negocio{nombre}: si el dato es
  bueno, celébralo en pocas palabras; después, una observación útil que se vea en
  la tabla (qué destaca, qué conviene mirar). Sin saludo.
- Si la tabla está vacía, dilo: en ese período no hay movimientos de eso.
- Di el período como está abajo.

Pregunta: {pregunta}
Lo que se calculó: {que} ({fuente}), {periodo}.
Tabla:
{tabla}"""


def _redactar(pregunta: str, fuente: str, periodo: str,
              columnas: List[str], filas: List[List[str]], total: List[str]) -> Optional[str]:
    lineas = [" | ".join(columnas)] + [" | ".join(f) for f in filas] + ([" | ".join(total)] if total else [])
    return asistente_ayuda.gemini([{"role": "user", "parts": [{"text": _texto_redactar(
        pregunta, fuente, periodo, columnas, filas, total)}]}], "Eres el asistente de números de un ERP. Respondes corto y exacto.",
        rapido=True)


def _texto_redactar(pregunta: str, fuente: str, periodo: str, columnas: List[str], filas: List[List[str]],
                    total: List[str], nombre: str = "") -> str:
    lineas = [" | ".join(columnas)] + [" | ".join(f) for f in filas] + ([" | ".join(total)] if total else [])
    return REDACTAR.format(pregunta=pregunta, que=", ".join(columnas), fuente=fuente, periodo=periodo,
                           tabla="\n".join(lineas) if filas else "(vacía)",
                           nombre=f" (se llama {nombre}; usa su nombre como mucho una vez)" if nombre else "")


def puede_preguntar(rol: str) -> bool:
    return bool(rd.catalogo(permisos.administra(rol), permisos.modulos_de(rol)))


def _preparar(db: Session, pregunta: str, historial: Sequence[schemas.TurnoAyuda], rol: str) -> Iterator[dict]:
    """Los pasos hasta tener la tabla, contados mientras pasan. Termina con
    {"listo": {...}} o con {"mensaje": texto, "con_ia": bool}."""
    if not asistente_ayuda.activo():
        yield {"mensaje": "La IA no está encendida en este local.", "con_ia": False}
        return
    ve_sensibles = permisos.administra(rol)
    modulos = permisos.modulos_de(rol)
    fuentes = [f for f in rd.catalogo(ve_sensibles, modulos) if f["medidas"]]
    if not fuentes:
        yield {"mensaje": "Tu rol no entra a ningún reporte: esto lo ve el dueño.", "con_ia": False}
        return
    yield {"paso": "Entendiendo tu pregunta…"}
    contenidos = _contenidos(historial, pregunta)
    try:
        for intento in range(2):
            t = traducir(contenidos, fuentes, rol, rapido=intento == 0)
            try:
                consulta, desde, hasta, limite, filtrado = _consulta(db, t, modulos)
                yield {"paso": f"Buscando en {rd.FUENTES[consulta.fuente].nombre.lower()}, {_periodo(desde, hasta)}…"}
                resultado = rd.consultar(db, consulta, ve_sensibles, modulos)
                break
            except rd.ErrorDeConsulta as e:
                if intento:
                    raise NoSePuede(f"No pude armar esa consulta: {e}")
                # Una vez, con el modelo bueno: la IA ve el error y corrige.
                yield {"paso": "Afinando la búsqueda…"}
                contenidos = contenidos + [
                    {"role": "model", "parts": [{"text": json.dumps(t, ensure_ascii=False)}]},
                    {"role": "user", "parts": [{"text": f"El sistema rechazó esa consulta: {e} Corrígela."}]},
                ]
    except NoSePuede as e:
        yield {"mensaje": str(e), "con_ia": True}
        return
    except Exception as e:  # la IA no contesto o contesto algo que no es JSON
        log.warning("Preguntale a tu negocio fallo: %s", e)
        yield {"mensaje": "No pude responder ahora. Prueba otra vez en un momento.", "con_ia": False}
        return

    nombre_fuente = rd.FUENTES[consulta.fuente].nombre + "".join(f" · solo {n}" for n in filtrado)
    periodo = _periodo(desde, hasta)
    columnas, filas, total = _tabla(resultado, limite)
    log.info("negocio rol=%s consulta=%s", rol, json.dumps(t, ensure_ascii=False)[:400])
    yield {"listo": {
        "fuente": nombre_fuente, "periodo": periodo,
        "tabla": schemas.RespuestaNegocio(
            texto="", con_ia=True, titulo=f"{nombre_fuente} · {periodo}", columnas=columnas, filas=filas, total=total,
            agrupado=len(resultado["campos_fila"]), mas=max(len(resultado["filas"]) - limite, 0)),
    }}


def responder_en_vivo(db: Session, pregunta: str, historial: Sequence[schemas.TurnoAyuda], rol: str,
                      nombre: str = "") -> Iterator[dict]:
    """Mis números, contado mientras pasa: los pasos, la tabla del sistema en
    cuanto esta, y la respuesta escribiendose."""
    pregunta = pregunta.strip()[:asistente_ayuda.LARGO_MAXIMO]
    listo = None
    for e in _preparar(db, pregunta, historial, rol):
        if "paso" in e:
            yield e
        elif "mensaje" in e:
            yield {"texto": e["mensaje"]}
            yield {"fin": True, "con_ia": e["con_ia"]}
            return
        else:
            listo = e["listo"]
    tabla: schemas.RespuestaNegocio = listo["tabla"]
    yield {"tabla": tabla.model_dump()}
    escrito = False
    try:
        for trozo in asistente_ayuda.gemini_en_vivo(
            [{"role": "user", "parts": [{"text": _texto_redactar(pregunta, listo["fuente"], listo["periodo"], tabla.columnas,
                                                                  tabla.filas, tabla.total, nombre)}]}],
            "Eres el asistente de números de un ERP. Respondes corto y exacto.", rapido=True,
        ):
            escrito = True
            yield {"texto": trozo}
    except Exception as e:
        log.warning("La redaccion en vivo se corto: %s", e)
    if not escrito:
        yield {"texto": f"{listo['fuente']}, {listo['periodo']}: mira la tabla."}
    yield {"fin": True, "con_ia": escrito}


def responder(db: Session, pregunta: str, historial: Sequence[schemas.TurnoAyuda], rol: str) -> schemas.RespuestaNegocio:
    """Lo mismo, de una vez (la usan las pruebas y quien no lea en vivo)."""
    pregunta = pregunta.strip()[:asistente_ayuda.LARGO_MAXIMO]
    listo = None
    for e in _preparar(db, pregunta, historial, rol):
        if "mensaje" in e:
            return schemas.RespuestaNegocio(texto=e["mensaje"], con_ia=e["con_ia"])
        if "listo" in e:
            listo = e["listo"]
    tabla: schemas.RespuestaNegocio = listo["tabla"]
    texto = _redactar(pregunta, listo["fuente"], listo["periodo"], tabla.columnas, tabla.filas, tabla.total)
    return tabla.model_copy(update={
        "texto": texto or f"{listo['fuente']}, {listo['periodo']}: mira la tabla.",
        "con_ia": texto is not None,
    })
