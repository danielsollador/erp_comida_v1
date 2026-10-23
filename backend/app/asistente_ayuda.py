"""El chat de ayuda (IA, nivel 1, 21-oct).

Quien usa el sistema pregunta "¿cómo hago...?" o "¿qué significa...?" desde
cualquier pantalla, y el asistente responde leyendo SOLO el manual
(`manual-savora.md`). Si el manual no lo dice, lo dice y ofrece pasarle el
caso al equipo: no inventa pantallas ni botones.

Sabe dos cosas de quien pregunta, que el navegador no puede falsear porque
salen de la sesión:
  - su rol y los módulos a los que entra: no le explica a la cocina cómo
    cerrar la caja como si pudiera; le dice a quién pedírselo.
  - la pantalla donde está: "¿qué es esto?" se entiende sin que lo diga.

SOLO EXPLICA. No lee datos del negocio ni toca nada: preguntar por las
ventas de ayer es el nivel siguiente (ver docs/pendientes.md).

Responde Gemini por ahora; la prueba (`evals/asistente_soporte.py`) usa este
mismo `SISTEMA`, así que lo que se mide es lo que se despliega. Cuando esté la
clave de Claude, entra como otro proveedor en `gemini` y se comparan con la
misma prueba.
"""

import json
import logging
import pathlib
import time
from typing import Iterator, List, Optional, Sequence

import httpx

from . import lectura_facturas, schemas, settings
from .acceso import permisos

log = logging.getLogger("erp.ayuda")

MANUAL = (pathlib.Path(__file__).parent / "manual-savora.md").read_text(encoding="utf-8")

# Lo que se manda de la conversación: lo justo para entender "¿y eso dónde
# está?" sin pagar el chat entero en cada pregunta.
TURNOS_DE_MEMORIA = 6
LARGO_MAXIMO = 1500

SISTEMA = """Eres el asistente de ayuda de un ERP para negocios de comida en Venezuela.
Te escribe alguien del negocio (dueño, cajero o cocina), casi siempre desde el
teléfono y con prisa.

Reglas:
- Responde SOLO con lo que dice el manual de abajo. Si el manual no lo dice,
  di claramente que el sistema no lo tiene o que no estás seguro, y ofrece
  pasarle el caso al equipo de soporte. No inventes pantallas ni botones.
- Usa los nombres de los botones tal como están en el manual, entre «».
- Corto: los pasos justos, numerados si son varios.
- Español, de tú, cálido y cercano: como un compañero que conoce el sistema y
  tiene ganas de ayudar. Si es el primer mensaje, salúdalo por su nombre en
  pocas palabras; después no repitas el saludo. Si algo le salió mal, una
  frase de ánimo y a la solución.
- Si lo que pregunta está en un módulo al que su rol no entra, explícale
  igual qué es, pero dile que eso lo hace quien tenga ese permiso (el dueño)
  y no le des los pasos como si pudiera.
- No tienes acceso a los datos del negocio (ventas, montos, pedidos): si te
  los pide, dile dónde verlos en el sistema.

Quien pregunta:
{quien}

MANUAL:
{manual}"""


def _quien(rol: str, pantalla: str, nombre: str = "") -> str:
    modulos = [permisos.MODULOS[m]["nombre"] for m in permisos.modulos_de(rol) if m in permisos.MODULOS]
    lineas = ([f"- Se llama {nombre}."] if nombre else []) + [f"- Rol: {permisos.nombre_de(rol)}.",
              f"- Entra a: {', '.join(modulos) if modulos else 'solo la portada'}."]
    if pantalla:
        lineas.append(f"- Está ahora en la pantalla `{pantalla}` (la dirección, como sale en el manual).")
    return "\n".join(lineas)


def sistema(rol: str = "dueno", pantalla: str = "", nombre: str = "") -> str:
    return SISTEMA.format(quien=_quien(rol, pantalla, nombre), manual=MANUAL)


def activo() -> bool:
    return lectura_facturas.lector_activo() == "gemini"


def _contenidos(pregunta: str, historial: Sequence[schemas.TurnoAyuda]) -> List[dict]:
    contenidos = [
        {"role": "model" if t.rol == "asistente" else "user", "parts": [{"text": t.texto[:LARGO_MAXIMO]}]}
        for t in list(historial)[-TURNOS_DE_MEMORIA:] if t.texto.strip()
    ]
    contenidos.append({"role": "user", "parts": [{"text": pregunta.strip()[:LARGO_MAXIMO]}]})
    return contenidos


NO_ENCENDIDA = "La ayuda con IA no está encendida en este local. Escríbele al equipo de soporte."
NO_CONTESTO = "No pude responder ahora (la IA no contestó). Prueba otra vez en un momento."


def responder_en_vivo(pregunta: str, historial: Sequence[schemas.TurnoAyuda], rol: str,
                      pantalla: str = "", nombre: str = "") -> Iterator[dict]:
    """La respuesta a medida que se escribe: {"paso"}, {"texto"} trozo a trozo
    y {"fin"}. Es lo que hace que el chat se sienta vivo: la primera palabra
    llega en un par de segundos en vez de esperar la respuesta entera."""
    if not activo():
        yield {"texto": NO_ENCENDIDA}
        yield {"fin": True, "con_ia": False}
        return
    yield {"paso": "Buscando en el manual…"}
    inicio = time.monotonic()
    escrito = False
    try:
        for trozo in gemini_en_vivo(_contenidos(pregunta, historial), sistema(rol, pantalla, nombre)):
            escrito = True
            yield {"texto": trozo}
    except Exception as e:  # se cayo a mitad: lo escrito queda, y si no hubo nada, un intento entero
        log.warning("La ayuda en vivo se corto: %s", e)
        if not escrito:
            texto = gemini(_contenidos(pregunta, historial), sistema(rol, pantalla, nombre))
            if texto:
                escrito = True
                yield {"texto": texto}
    log.info("ayuda en vivo rol=%s pantalla=%s %.1fs pregunta=%r", rol, pantalla, time.monotonic() - inicio, pregunta[:200])
    if not escrito:
        yield {"texto": NO_CONTESTO}
    yield {"fin": True, "con_ia": escrito}


def responder(pregunta: str, historial: Sequence[schemas.TurnoAyuda], rol: str, pantalla: str = "",
              nombre: str = "") -> schemas.RespuestaAyuda:
    if not activo():
        return schemas.RespuestaAyuda(texto=NO_ENCENDIDA, con_ia=False)
    contenidos = _contenidos(pregunta, historial)
    inicio = time.monotonic()
    texto = gemini(contenidos, sistema(rol, pantalla, nombre))
    log.info("ayuda rol=%s pantalla=%s %.1fs pregunta=%r", rol, pantalla, time.monotonic() - inicio, pregunta[:200])
    if not texto:
        return schemas.RespuestaAyuda(texto=NO_CONTESTO, con_ia=False)
    return schemas.RespuestaAyuda(texto=texto, con_ia=True)


def _modelos(rapido: bool) -> List[str]:
    # El de la prueba primero: con el liviano se equivocaba más en los "no lo
    # tiene el sistema". `rapido` al revés: para lo que es corto y guiado
    # (elegir una consulta, redactar con una tabla), el liviano tarda la mitad.
    orden = (settings.GEMINI_MODELO, settings.GEMINI_MODELO_RESPALDO) if rapido else \
        (settings.GEMINI_MODELO_RESPALDO, settings.GEMINI_MODELO)
    return list(dict.fromkeys(m for m in orden if m))


def gemini(contenidos: List[dict], instrucciones: str, esquema: Optional[dict] = None,
           rapido: bool = False) -> Optional[str]:
    """Una vuelta con Gemini: el texto de la respuesta, o None si no contestó.
    Con `esquema`, la respuesta es ese JSON (lo usa pregunta_negocio.py)."""
    modelos = _modelos(rapido)
    cuerpo = {
        "contents": contenidos,
        "systemInstruction": {"parts": [{"text": instrucciones}]},
        "generationConfig": {"temperature": 0, "thinkingConfig": {"includeThoughts": True}},
    }
    if esquema:
        cuerpo["generationConfig"]["response_mime_type"] = "application/json"
        cuerpo["generationConfig"]["response_schema"] = esquema
    for modelo in modelos:
        try:
            r = lectura_facturas._llamar(lectura_facturas.GEMINI_URL.format(modelo=modelo), cuerpo)
        except Exception as e:
            log.warning("La ayuda no pudo llamar a Gemini %s: %s", modelo, e)
            continue
        if r.status_code == 200:
            partes = (r.datos.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
            texto = "".join(p.get("text", "") for p in partes if not p.get("thought")).strip()
            if texto:
                return texto
        log.warning("Gemini %s respondio %s a la ayuda", modelo, r.status_code)
        if r.status_code not in lectura_facturas.ESTADOS_PASAJEROS:
            break
    return None


def gemini_en_vivo(contenidos: List[dict], instrucciones: str, rapido: bool = False) -> Iterator[str]:
    """Lo mismo que `gemini`, pero devuelve el texto a medida que llega (sin
    los pensamientos). Si el primer modelo no contesta, prueba el otro antes
    de escribir nada; una vez que empezo a escribir, un corte es un error."""
    cuerpo = {
        "contents": contenidos,
        "systemInstruction": {"parts": [{"text": instrucciones}]},
        "generationConfig": {"temperature": 0, "thinkingConfig": {"includeThoughts": True}},
    }
    ultimo = None
    for modelo in _modelos(rapido):
        url = lectura_facturas.GEMINI_URL.format(modelo=modelo).replace(":generateContent", ":streamGenerateContent") + "?alt=sse"
        with httpx.stream("POST", url, json=cuerpo, headers={"x-goog-api-key": settings.GEMINI_API_KEY},
                          timeout=httpx.Timeout(30.0, read=lectura_facturas.GEMINI_SILENCIO_S)) as r:
            if r.status_code != 200:
                r.read()
                ultimo = f"Gemini {modelo} respondio {r.status_code}"
                log.warning(ultimo)
                if r.status_code in lectura_facturas.ESTADOS_PASAJEROS:
                    continue
                break
            for linea in r.iter_lines():
                if not linea.startswith("data:"):
                    continue
                evento = json.loads(linea[5:])
                for c in evento.get("candidates") or []:
                    for p in (c.get("content") or {}).get("parts", []):
                        if p.get("text") and not p.get("thought"):
                            yield p["text"]
            return
    raise RuntimeError(ultimo or "Gemini no contesto")
