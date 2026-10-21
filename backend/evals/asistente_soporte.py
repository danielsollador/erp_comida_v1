"""Prueba del asistente de soporte: ¿responde bien leyendo SOLO el manual?

Prueba el chat de ayuda del ERP (`app/asistente_ayuda.py`) con sus mismas
instrucciones, como si preguntara el dueño.

Cada pregunta de `preguntas_soporte.json` es real (o como las que llegan) y
trae los puntos que una buena respuesta tiene que decir. Algunas son de cosas
que el sistema NO hace: ahí lo correcto es decirlo y pasarle el caso al
equipo, no inventar una pantalla.

    cd backend
    python -m evals.asistente_soporte            # todas
    python -m evals.asistente_soporte vuelto     # solo esa

Responde y evalúa Gemini (la clave del .env). Cuando esté la de Claude, se
agrega como otro proveedor y se comparan con las mismas preguntas.
"""

import json
import pathlib
import sys
import time

from app import lectura_facturas, settings
from app.asistente_ayuda import MANUAL, sistema

AQUI = pathlib.Path(__file__).parent
PREGUNTAS = json.loads((AQUI / "preguntas_soporte.json").read_text(encoding="utf-8"))

JUEZ = """Evalúa la respuesta de un asistente de soporte de un ERP.

Pregunta del usuario: {pregunta}

Puntos que la respuesta TIENE que cubrir (en sustancia, no con las mismas palabras):
{puntos}

Respuesta del asistente:
{respuesta}

Para cada punto di si la respuesta lo cubre. Y di si la respuesta INVENTA algo:
un botón, una pantalla, una función o un dato que el MANUAL de abajo no
respalda, o algo que lo contradiga. Lo que esté en el manual, aunque no esté en
los puntos, NO es inventar.

MANUAL:
{manual}"""

ESQUEMA_JUEZ = {
    "type": "OBJECT",
    "properties": {
        "puntos": {"type": "ARRAY", "items": {
            "type": "OBJECT",
            "properties": {"punto": {"type": "STRING"}, "cubre": {"type": "BOOLEAN"}},
            "required": ["punto", "cubre"],
        }},
        "inventa": {"type": "BOOLEAN"},
        "que_invento": {"type": "STRING"},
    },
    "required": ["puntos", "inventa", "que_invento"],
}


def _gemini(texto: str, instrucciones: str = "", esquema=None) -> str:
    modelo = settings.GEMINI_MODELO_RESPALDO or settings.GEMINI_MODELO
    cuerpo = {
        "contents": [{"role": "user", "parts": [{"text": texto}]}],
        "generationConfig": {"temperature": 0, "thinkingConfig": {"includeThoughts": True}},
    }
    if instrucciones:
        cuerpo["systemInstruction"] = {"parts": [{"text": instrucciones}]}
    if esquema:
        cuerpo["generationConfig"]["response_mime_type"] = "application/json"
        cuerpo["generationConfig"]["response_schema"] = esquema
    for espera in (0, 3, 8):
        time.sleep(espera)
        r = lectura_facturas._llamar(lectura_facturas.GEMINI_URL.format(modelo=modelo), cuerpo)
        if r.status_code == 200:
            partes = (r.datos.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
            return "".join(p.get("text", "") for p in partes if not p.get("thought"))
        if r.status_code not in lectura_facturas.ESTADOS_PASAJEROS:
            raise RuntimeError(f"Gemini {r.status_code}: {r.text[:200]}")
    raise RuntimeError("Gemini saturado")


def correr(solo=None):
    # El mismo SISTEMA del chat del ERP: lo que se mide es lo que se despliega.
    instrucciones = sistema("dueno")
    resultados = []
    for p in PREGUNTAS:
        if solo and p["id"] not in solo:
            continue
        inicio = time.monotonic()
        respuesta = _gemini(p["pregunta"], instrucciones)
        segundos = time.monotonic() - inicio
        juicio = json.loads(lectura_facturas._sin_bloque(_gemini(JUEZ.format(
            pregunta=p["pregunta"], respuesta=respuesta,
            puntos="\n".join(f"- {x}" for x in p["debe_decir"]), manual=MANUAL,
        ), esquema=ESQUEMA_JUEZ)))
        cubiertos = sum(1 for x in juicio["puntos"] if x["cubre"])
        bien = cubiertos == len(p["debe_decir"]) and not juicio["inventa"]
        resultados.append({**p, "respuesta": respuesta, "juicio": juicio, "bien": bien,
                           "cubiertos": cubiertos, "segundos": round(segundos, 1)})
        marca = "OK " if bien else "MAL"
        print(f"{marca} {p['id']:<26} {cubiertos}/{len(p['debe_decir'])}"
              + (f"  INVENTA: {juicio['que_invento'][:90]}" if juicio["inventa"] else ""), flush=True)
    bien = sum(r["bien"] for r in resultados)
    print(f"\n{bien}/{len(resultados)} bien")
    salida = AQUI / "resultados_soporte.json"
    salida.write_text(json.dumps(resultados, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Detalle en {salida}")
    return resultados


if __name__ == "__main__":
    correr(set(sys.argv[1:]) or None)
