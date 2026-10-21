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
clave de Claude, entra como otro proveedor en `_gemini` y se comparan con la
misma prueba.
"""

import logging
import pathlib
import time
from typing import List, Optional, Sequence

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
- Corto: los pasos justos, numerados si son varios. Sin saludos largos.
- Español, de tú.
- Si lo que pregunta está en un módulo al que su rol no entra, explícale
  igual qué es, pero dile que eso lo hace quien tenga ese permiso (el dueño)
  y no le des los pasos como si pudiera.
- No tienes acceso a los datos del negocio (ventas, montos, pedidos): si te
  los pide, dile dónde verlos en el sistema.

Quien pregunta:
{quien}

MANUAL:
{manual}"""


def _quien(rol: str, pantalla: str) -> str:
    modulos = [permisos.MODULOS[m]["nombre"] for m in permisos.modulos_de(rol) if m in permisos.MODULOS]
    lineas = [f"- Rol: {permisos.nombre_de(rol)}.",
              f"- Entra a: {', '.join(modulos) if modulos else 'solo la portada'}."]
    if pantalla:
        lineas.append(f"- Está ahora en la pantalla `{pantalla}` (la dirección, como sale en el manual).")
    return "\n".join(lineas)


def sistema(rol: str = "dueno", pantalla: str = "") -> str:
    return SISTEMA.format(quien=_quien(rol, pantalla), manual=MANUAL)


def activo() -> bool:
    return lectura_facturas.lector_activo() == "gemini"


def responder(pregunta: str, historial: Sequence[schemas.TurnoAyuda], rol: str, pantalla: str = "") -> schemas.RespuestaAyuda:
    pregunta = pregunta.strip()[:LARGO_MAXIMO]
    if not activo():
        return schemas.RespuestaAyuda(
            texto="La ayuda con IA no está encendida en este local. Escríbele al equipo de soporte.",
            con_ia=False,
        )
    contenidos = [
        {"role": "model" if t.rol == "asistente" else "user", "parts": [{"text": t.texto[:LARGO_MAXIMO]}]}
        for t in list(historial)[-TURNOS_DE_MEMORIA:] if t.texto.strip()
    ]
    contenidos.append({"role": "user", "parts": [{"text": pregunta}]})
    inicio = time.monotonic()
    texto = _gemini(contenidos, sistema(rol, pantalla))
    log.info("ayuda rol=%s pantalla=%s %.1fs pregunta=%r", rol, pantalla, time.monotonic() - inicio, pregunta[:200])
    if not texto:
        return schemas.RespuestaAyuda(
            texto="No pude responder ahora (la IA no contestó). Prueba otra vez en un momento.",
            con_ia=False,
        )
    return schemas.RespuestaAyuda(texto=texto, con_ia=True)


def _gemini(contenidos: List[dict], instrucciones: str) -> Optional[str]:
    # El modelo de la prueba: con el liviano se equivocaba más en los "no lo
    # tiene el sistema". Si está saturado, el liviano antes que nada.
    modelos = [m for m in (settings.GEMINI_MODELO_RESPALDO, settings.GEMINI_MODELO) if m]
    cuerpo = {
        "contents": contenidos,
        "systemInstruction": {"parts": [{"text": instrucciones}]},
        "generationConfig": {"temperature": 0, "thinkingConfig": {"includeThoughts": True}},
    }
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
