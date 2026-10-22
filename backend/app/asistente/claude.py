"""El bucle del asistente con Claude (Anthropic): pregunta -> herramientas -> respuesta.

Misma forma que `gemini.py` (`conversar` recibe lo mismo y devuelve un
`Resultado`), así que el router no sabe con quién habla. Diferencias que
importan:

- Las partes del modelo (texto, `thinking`, `tool_use`) se devuelven TAL CUAL
  en la vuelta siguiente: Sonnet 5.5 piensa entre herramientas y esos bloques
  van atados a la conversación.
- El sistema va en dos bloques: el fijo (reglas + herramientas) se cachea; lo
  que cambia en cada pregunta (fecha, hora, pantalla) va después del corte,
  para no invalidar el caché.
- `fallbacks: "default"`: si un clasificador de seguridad rechaza la pregunta,
  Anthropic la reintenta en otro modelo dentro de la misma llamada.
"""
import time
from typing import Callable, List, Optional

import anthropic

from .. import settings
from .gemini import ErrorDelAsistente, Resultado

MAX_VUELTAS = 6

# USD por millón de tokens (entrada, salida, lectura de caché), lista de
# Anthropic al 22-oct-2026.
PRECIOS = {
    "claude-sonnet-5-5": (2.00, 10.00, 0.20),
    "claude-haiku-5-5": (0.10, 0.50, 0.01),
}

_cliente: Optional[anthropic.Anthropic] = None


def _cli() -> anthropic.Anthropic:
    global _cliente
    if _cliente is None:
        # La URL va explícita: un ANTHROPIC_BASE_URL heredado del entorno
        # (lo pone Claude Code en la laptop) mandaría las preguntas a otro lado.
        _cliente = anthropic.Anthropic(
            api_key=settings.ANTHROPIC_API_KEY,
            base_url=settings.ANTHROPIC_URL,
            timeout=anthropic.Timeout(45.0, connect=10.0),
            max_retries=1,
        )
    return _cliente


def _herramienta(d: dict) -> dict:
    """De la declaración estilo Gemini ({name, description, parameters}) a la de Claude."""
    return {
        "name": d["name"],
        "description": d["description"],
        "input_schema": d.get("parameters") or {"type": "object", "properties": {}},
    }


def conversar(
    sistema_fijo: str,
    sistema_variable: str,
    mensajes: List[dict],
    declaraciones: list,
    ejecutar: Callable[[str, dict], dict],
    modelo: Optional[str] = None,
) -> Resultado:
    """`mensajes`: [{"rol": "yo"|"asistente", "texto": ...}] en orden."""
    if not settings.ANTHROPIC_API_KEY:
        raise ErrorDelAsistente("El asistente no tiene clave de Claude configurada (ANTHROPIC_API_KEY).")
    modelo = modelo or settings.ASISTENTE_MODELO_CLAUDE
    r = Resultado(texto="", modelo=modelo)
    inicio = time.monotonic()
    historial = [{"role": "user" if m["rol"] == "yo" else "assistant", "content": m["texto"]} for m in mensajes]
    herramientas = [_herramienta(d) for d in declaraciones]
    sistema = [
        {"type": "text", "text": sistema_fijo, "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": sistema_variable},
    ]
    cache_leido = 0
    for vuelta in range(1, MAX_VUELTAS + 1):
        r.vueltas = vuelta
        try:
            resp = _cli().beta.messages.create(
                model=modelo,
                max_tokens=4000,
                system=sistema,
                tools=herramientas,
                messages=historial,
                output_config={"effort": settings.ASISTENTE_ESFUERZO},
                betas=["server-side-fallback-2026-07-01"],
                extra_body={"fallbacks": "default"},
            )
        except anthropic.AuthenticationError:
            raise ErrorDelAsistente("La clave de Claude no es válida. Revisa ANTHROPIC_API_KEY.")
        except anthropic.RateLimitError:
            raise ErrorDelAsistente("Claude está saturado en este momento. Intenta en un minuto.")
        except anthropic.APIConnectionError:
            raise ErrorDelAsistente("No hubo respuesta de Claude. Revisa la conexión e intenta de nuevo.")
        except anthropic.APIStatusError as e:
            if e.status_code >= 500:
                raise ErrorDelAsistente("Claude está saturado en este momento. Intenta en un minuto.")
            raise ErrorDelAsistente(f"Claude respondió {e.status_code}: {str(e.message)[:200]}")

        u = resp.usage
        r.tokens_entrada += (u.input_tokens or 0) + (getattr(u, "cache_creation_input_tokens", 0) or 0)
        cache_leido += getattr(u, "cache_read_input_tokens", 0) or 0
        r.tokens_salida += u.output_tokens or 0

        if resp.stop_reason == "refusal":
            r.texto = "Esa pregunta no la puedo responder. Prueba a decirla de otra forma."
            break

        llamadas = [b for b in resp.content if b.type == "tool_use"]
        historial.append({"role": "assistant", "content": resp.content})
        if resp.stop_reason != "tool_use" or not llamadas:
            r.texto = "".join(b.text for b in resp.content if b.type == "text").strip()
            if not r.texto:
                raise ErrorDelAsistente("El asistente no pudo responder. Intenta reformular.")
            break

        resultados = []
        for b in llamadas:
            t = time.monotonic()
            try:
                salida = ejecutar(b.name, dict(b.input or {}))
                error = isinstance(salida, dict) and "error" in salida and len(salida) == 1
            except Exception as e:  # la herramienta falló: el modelo lo sabe y lo dice
                salida, error = {"error": str(e)[:300]}, True
            r.herramientas.append({"nombre": b.name, "args": dict(b.input or {}), "ms": int((time.monotonic() - t) * 1000)})
            resultados.append({
                "type": "tool_result",
                "tool_use_id": b.id,
                "content": _a_texto(salida),
                **({"is_error": True} if error else {}),
            })
        # Todos los resultados en UN mensaje: partirlos le enseña a no pedir en paralelo.
        historial.append({"role": "user", "content": resultados})
    else:
        r.texto = "Me enredé buscando los datos. ¿Puedes preguntarlo de otra forma, más concreta?"

    pe, ps, pc = PRECIOS.get(modelo, (2.00, 10.00, 0.20))
    r.costo_extra = cache_leido * pc / 1_000_000
    r.precios = (pe, ps)
    r.ms = int((time.monotonic() - inicio) * 1000)
    return r


def _a_texto(salida) -> str:
    import json

    return json.dumps(salida, ensure_ascii=False, default=str)
