"""El bucle de conversación con Gemini: pregunta -> herramientas -> respuesta.

Mismo cliente que `lectura_facturas.py` (REST con httpx y la misma clave), pero
aquí el modelo no lee una foto sino que pide datos: en cada vuelta puede
devolver texto (terminó) o una o varias `functionCall` que se ejecutan aquí y
se le devuelven como `functionResponse`.

Dos reglas que no son opcionales:

- Las partes del modelo se reenvían TAL CUAL. Gemini 3 firma su razonamiento
  (`thoughtSignature`) y si en la vuelta siguiente esa firma no viene, responde
  400. Por eso el historial guarda el `content` que llegó, sin reconstruirlo.
- Hay un tope de vueltas. Un modelo que pide herramientas en bucle no puede
  dejar al dueño esperando ni gastar sin límite.
"""
import json
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

import httpx

from .. import settings

URL = "https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent"
MAX_VUELTAS = 6
TIMEOUT_S = 45

# Precio por millón de tokens (USD, entrada/salida), para medir el costo de
# cada pregunta en el spike. Tomado de ai.google.dev/pricing el 22-oct-2026;
# el de Flash-Lite 3.5 es el de 3.1 (no publicado aparte). Si Google cambia la
# tarifa solo se desvía la estimación.
PRECIOS = {
    "gemini-3.5-flash-lite": (0.25, 1.50),
    "gemini-3.8-flash": (0.75, 3.75),
}


class ErrorDelAsistente(Exception):
    """Algo que el dueño debe leer tal cual (sin traza)."""


@dataclass
class Resultado:
    texto: str
    herramientas: list = field(default_factory=list)  # [{nombre, args, ms}]
    tokens_entrada: int = 0
    tokens_salida: int = 0
    vueltas: int = 0
    modelo: str = ""
    ms: int = 0

    @property
    def costo_usd(self) -> float:
        pe, ps = PRECIOS.get(self.modelo, (0.75, 3.75))
        return round((self.tokens_entrada * pe + self.tokens_salida * ps) / 1_000_000, 6)


def conversar(
    sistema: str,
    historial: list,
    declaraciones: list,
    ejecutar: Callable[[str, dict], dict],
    modelo: Optional[str] = None,
) -> Resultado:
    """Corre la conversación hasta que el modelo conteste en texto.

    `historial` es la lista de `contents` de Gemini (role user/model). Se
    modifica en sitio: al volver trae las vueltas de herramientas, por si la
    pantalla quiere mandarlas de nuevo en la pregunta siguiente.
    """
    if not settings.GEMINI_API_KEY:
        raise ErrorDelAsistente("El asistente no tiene clave de Gemini configurada (GEMINI_API_KEY).")
    modelo = modelo or settings.ASISTENTE_MODELO
    r = Resultado(texto="", modelo=modelo)
    inicio = time.monotonic()
    cuerpo = {
        "systemInstruction": {"parts": [{"text": sistema}]},
        "contents": historial,
        "tools": [{"functionDeclarations": declaraciones}] if declaraciones else [],
        "generationConfig": {"temperature": 0.2, "thinkingConfig": {"thinkingLevel": settings.ASISTENTE_PENSAR}},
    }
    for vuelta in range(1, MAX_VUELTAS + 1):
        r.vueltas = vuelta
        datos = _llamar(modelo, cuerpo)
        uso = datos.get("usageMetadata") or {}
        r.tokens_entrada += uso.get("promptTokenCount", 0)
        r.tokens_salida += uso.get("candidatesTokenCount", 0) + uso.get("thoughtsTokenCount", 0)
        candidatos = datos.get("candidates") or []
        contenido = (candidatos[0].get("content") if candidatos else None) or {}
        partes = contenido.get("parts") or []
        llamadas = [p["functionCall"] for p in partes if "functionCall" in p]
        if not llamadas:
            r.texto = "".join(p.get("text", "") for p in partes if not p.get("thought")).strip()
            if not r.texto:
                motivo = candidatos[0].get("finishReason") if candidatos else "sin respuesta"
                raise ErrorDelAsistente(f"El asistente no pudo responder ({motivo}). Intenta reformular.")
            historial.append({"role": "model", "parts": partes})
            break
        historial.append({"role": "model", "parts": partes})
        respuestas = []
        for ll in llamadas:
            t = time.monotonic()
            try:
                salida = ejecutar(ll["name"], ll.get("args") or {})
            except Exception as e:  # la herramienta falló: el modelo lo sabe y lo dice
                salida = {"error": str(e)[:300]}
            r.herramientas.append({"nombre": ll["name"], "args": ll.get("args") or {}, "ms": int((time.monotonic() - t) * 1000)})
            resp = {"name": ll["name"], "response": _a_json(salida)}
            if ll.get("id"):
                resp["id"] = ll["id"]
            respuestas.append({"functionResponse": resp})
        historial.append({"role": "user", "parts": respuestas})
    else:
        r.texto = "Me enredé buscando los datos. ¿Puedes preguntarlo de otra forma, más concreta?"
    r.ms = int((time.monotonic() - inicio) * 1000)
    return r


def _a_json(salida) -> dict:
    """functionResponse exige un objeto JSON; fechas y Decimal pasan a texto."""
    if not isinstance(salida, dict):
        salida = {"resultado": salida}
    return json.loads(json.dumps(salida, default=str))


def _llamar(modelo: str, cuerpo: dict) -> dict:
    try:
        resp = httpx.post(
            URL.format(modelo=modelo),
            json=cuerpo,
            headers={"x-goog-api-key": settings.GEMINI_API_KEY},
            timeout=httpx.Timeout(15.0, read=TIMEOUT_S),
        )
    except httpx.HTTPError:
        raise ErrorDelAsistente("No hubo respuesta de Google. Revisa la conexión e intenta de nuevo.")
    if resp.status_code == 429 or resp.status_code >= 500:
        raise ErrorDelAsistente("Google está saturado en este momento. Intenta en un minuto.")
    if resp.status_code != 200:
        raise ErrorDelAsistente(f"Gemini respondió {resp.status_code}: {resp.text[:200]}")
    return resp.json()
