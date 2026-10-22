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
    cache_escrito = 0
    previo = []  # texto que vino junto a una llamada a herramienta
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
        r.tokens_entrada += u.input_tokens or 0
        cache_escrito += getattr(u, "cache_creation_input_tokens", 0) or 0
        cache_leido += getattr(u, "cache_read_input_tokens", 0) or 0
        r.tokens_salida += u.output_tokens or 0

        if resp.stop_reason == "refusal":
            r.texto = "Esa pregunta no la puedo responder. Prueba a decirla de otra forma."
            break

        llamadas = [b for b in resp.content if b.type == "tool_use"]
        historial.append({"role": "assistant", "content": resp.content})
        if resp.stop_reason != "tool_use" or not llamadas:
            final = "".join(b.text for b in resp.content if b.type == "text").strip()
            # Si escribió parte de la respuesta antes de llamar a una
            # herramienta ("Arriba te dejé las causas..."), esa parte también
            # va: sin ella el final no se entiende.
            r.texto = "\n\n".join(t for t in previo + [final] if t)
            if not r.texto:
                raise ErrorDelAsistente("El asistente no pudo responder. Intenta reformular.")
            break

        dicho = "".join(b.text for b in resp.content if b.type == "text").strip()
        if dicho:
            previo.append(dicho)
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
    # Escribir el caché cuesta 1,25 veces la entrada; leerlo, la tarifa de caché.
    r.costo_extra = (cache_leido * pc + cache_escrito * pe * 1.25) / 1_000_000
    r.precios = (pe, ps)
    r.ms = int((time.monotonic() - inicio) * 1000)
    return r


def estructurado(
    sistema_fijo: str,
    sistema_variable: str,
    texto: str,
    schema: dict,
    esfuerzo: str = "low",
    modelo: Optional[str] = None,
) -> tuple:
    """Una sola llamada que devuelve JSON con la forma de `schema` (validada
    por Anthropic). Es lo que usan los reportes hablados y los cambios de
    precio: el modelo NO calcula ni toca datos, solo traduce la frase a una
    estructura que el ERP valida después.

    Devuelve (dict | None si se negó, Resultado con el costo y el tiempo).
    """
    if not settings.ANTHROPIC_API_KEY:
        raise ErrorDelAsistente("El asistente no tiene clave de Claude configurada (ANTHROPIC_API_KEY).")
    modelo = modelo or settings.ASISTENTE_MODELO_CLAUDE
    r = Resultado(texto="", modelo=modelo, vueltas=1)
    inicio = time.monotonic()
    try:
        resp = _cli().beta.messages.create(
            model=modelo,
            max_tokens=8000,
            system=[{"type": "text", "text": sistema_fijo, "cache_control": {"type": "ephemeral"}}]
            + ([{"type": "text", "text": sistema_variable}] if sistema_variable else []),
            messages=[{"role": "user", "content": texto}],
            output_config={"effort": esfuerzo, "format": {"type": "json_schema", "schema": schema}},
            betas=["server-side-fallback-2026-07-01"],
            extra_body={"fallbacks": "default"},
        )
    except anthropic.AuthenticationError:
        raise ErrorDelAsistente("La clave de Claude no es válida. Revisa ANTHROPIC_API_KEY.")
    except (anthropic.RateLimitError, anthropic.InternalServerError):
        raise ErrorDelAsistente("Claude está saturado en este momento. Intenta en un minuto.")
    except anthropic.APIConnectionError:
        raise ErrorDelAsistente("No hubo respuesta de Claude. Revisa la conexión e intenta de nuevo.")
    except anthropic.APIStatusError as e:
        raise ErrorDelAsistente(f"Claude respondió {e.status_code}: {str(e.message)[:200]}")
    u = resp.usage
    r.tokens_entrada = u.input_tokens or 0
    r.tokens_salida = u.output_tokens or 0
    pe, ps, pc = PRECIOS.get(modelo, (2.00, 10.00, 0.20))
    r.precios = (pe, ps)
    r.costo_extra = (
        (getattr(u, "cache_read_input_tokens", 0) or 0) * pc
        + (getattr(u, "cache_creation_input_tokens", 0) or 0) * pe * 1.25
    ) / 1_000_000
    r.ms = int((time.monotonic() - inicio) * 1000)
    if resp.stop_reason == "refusal":
        return None, r
    import json

    texto_json = next((b.text for b in resp.content if b.type == "text"), "")
    try:
        return json.loads(texto_json), r
    except ValueError:
        # Cortado por max_tokens: el JSON quedó a medias.
        raise ErrorDelAsistente("La respuesta salió incompleta. Intenta con una frase más corta.")


def _a_texto(salida) -> str:
    import json

    return json.dumps(salida, ensure_ascii=False, default=str)
