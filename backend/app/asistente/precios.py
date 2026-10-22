"""Cambios de precio por instrucción: "sube 10% las arepas menos la reina".

El LLM ELIGE QUÉ variantes y QUÉ operación (subir %, sumar $, fijar un
precio), nunca escribe un precio calculado por él: la cuenta y el redondeo
se hacen aquí, con el precio que está en la base en este momento. Lo único
que guarda el ERP es lo que el dueño vio en la lista y aprobó (`aplicar`),
y solo si el precio no cambió entre medio.
"""
from decimal import ROUND_HALF_UP, Decimal
from typing import List, Optional

from sqlalchemy.orm import Session, joinedload

from .. import models
from . import claude
from .gemini import ErrorDelAsistente

SISTEMA = """Conviertes la instrucción del dueño de un negocio de comida en Venezuela en cambios de precio sobre su menú.

Reglas:
- Cada regla dice A QUÉ variantes (por id, del MENÚ de abajo) y QUÉ hacer: "porcentaje" (valor 10 = subir 10%; -5 = bajar 5%), "sumar" (dólares a sumar o, en negativo, a restar) o "fijar" (el precio nuevo en dólares).
- Tú NO calculas precios: solo eliges variantes y operación. El sistema hace la cuenta.
- "redondeo": múltiplo en dólares al que se redondea el resultado (0.05, 0.1, 0.25, 0.5, 1) solo si la instrucción lo pide o dice "redondea"; si no, null.
- Una categoría o un producto incluye TODAS sus variantes. "Menos X" / "excepto X" saca esas variantes.
- Si la instrucción es ambigua (no sabes a qué producto se refiere, o falta el monto), no adivines: deja reglas vacías y explica en "duda" qué hay que aclarar.
- Los precios están en dólares. Si la instrucción habla en bolívares, explícalo en "duda".
- "entendi": una frase corta de lo que vas a cambiar, en palabras del negocio.

MENÚ (id de variante · categoría · producto · variante · precio actual en $):
{menu}"""

ESQUEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["reglas", "entendi", "duda"],
    "properties": {
        "reglas": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["variantes", "operacion", "valor", "redondeo"],
                "properties": {
                    "variantes": {"type": "array", "items": {"type": "integer"}},
                    "operacion": {"type": "string", "enum": ["porcentaje", "sumar", "fijar"]},
                    "valor": {"type": "number"},
                    "redondeo": {"type": ["number", "null"]},
                },
            },
        },
        "entendi": {"type": "string"},
        "duda": {"type": ["string", "null"]},
    },
}


def _variantes(db: Session) -> List[models.Variante]:
    return (
        db.query(models.Variante)
        .join(models.Producto)
        .join(models.Categoria)
        .options(joinedload(models.Variante.producto).joinedload(models.Producto.categoria))
        .filter(models.Variante.activo.is_(True), models.Producto.activo.is_(True), models.Categoria.activo.is_(True))
        .order_by(models.Categoria.orden, models.Producto.orden, models.Variante.id)
        .all()
    )


def nombre_de(v: models.Variante) -> str:
    p = v.producto.nombre
    return p if (v.nombre or "").lower() in ("", "regular") else f"{p} · {v.nombre}"


def _redondear(x: float, paso: Optional[float]) -> float:
    """Al múltiplo pedido y a centavos, con el medio centavo hacia arriba
    (1,425 -> 1,43): `round` de Python lo mandaba a 1,42 por cómo guarda el
    float, y un precio no se redondea a la baja sin que nadie lo pida."""
    d = Decimal(str(x))
    if paso and paso > 0:
        p = Decimal(str(paso))
        d = (d / p).quantize(Decimal("1"), rounding=ROUND_HALF_UP) * p
    return float(d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def calcular(variantes: List[models.Variante], reglas: list) -> List[dict]:
    """Aplica las reglas en orden sobre los precios ACTUALES. Si dos reglas
    tocan la misma variante, la segunda parte del resultado de la primera
    ("sube todo 10% y deja el café en 1$")."""
    por_id = {v.id: v for v in variantes}
    nuevo = {}
    for r in reglas:
        for vid in r["variantes"]:
            v = por_id.get(vid)
            if v is None:
                continue
            base = nuevo.get(vid, v.precio)
            if r["operacion"] == "porcentaje":
                p = base * (1 + r["valor"] / 100)
            elif r["operacion"] == "sumar":
                p = base + r["valor"]
            else:
                p = r["valor"]
            nuevo[vid] = _redondear(p, r.get("redondeo"))
    cambios = []
    for vid, p in nuevo.items():
        v = por_id[vid]
        if p <= 0 or round(p, 2) == round(v.precio, 2):
            continue
        cambios.append({
            "variante_id": vid,
            "nombre": nombre_de(v),
            "categoria": v.producto.categoria.nombre,
            "precio_anterior": round(v.precio, 2),
            "precio_nuevo": p,
        })
    return cambios


def proponer(db: Session, instruccion: str) -> dict:
    vs = _variantes(db)
    if not vs:
        raise ErrorDelAsistente("El menú no tiene productos activos.")
    menu = "\n".join(
        f"{v.id} · {v.producto.categoria.nombre} · {v.producto.nombre} · {v.nombre} · {v.precio:.2f}" for v in vs
    )
    d, r = claude.estructurado(SISTEMA.format(menu=menu), "", instruccion, ESQUEMA)
    if d is None:
        raise ErrorDelAsistente("Esa instrucción no la puedo procesar. Prueba a decirla de otra forma.")
    validas = {v.id for v in vs}
    reglas = [
        {**x, "variantes": [i for i in x["variantes"] if i in validas]}
        for x in d["reglas"]
        if x["operacion"] in ("porcentaje", "sumar", "fijar")
    ]
    # Un "fijar" de 0 o negativo, o un porcentaje que deja el precio en nada,
    # se descarta en `calcular` (p <= 0): no hay forma de regalar el menú por error.
    cambios = calcular(vs, reglas)
    return {"cambios": cambios, "entendi": d["entendi"], "duda": d["duda"], "costo_usd": r.costo_usd, "ms": r.ms}


def aplicar(db: Session, cambios: list) -> dict:
    """Guarda lo aprobado, todo o nada. Si algún precio cambió desde que se
    armó la lista (otra persona lo tocó), no se guarda nada: se pide rehacer."""
    ids = [c["variante_id"] for c in cambios]
    vs = {v.id: v for v in db.query(models.Variante).filter(models.Variante.id.in_(ids)).all()}
    for c in cambios:
        v = vs.get(c["variante_id"])
        if v is None:
            raise ErrorDelAsistente("Un producto de la lista ya no existe. Vuelve a pedir el cambio.")
        if round(v.precio, 2) != round(c["precio_anterior"], 2):
            raise ErrorDelAsistente(f"El precio de {nombre_de(v)} cambió mientras tanto. Vuelve a pedir el cambio.")
        if c["precio_nuevo"] <= 0:
            raise ErrorDelAsistente("Un precio nuevo no puede ser cero o negativo.")
    for c in cambios:
        v = vs[c["variante_id"]]
        nuevo = round(float(c["precio_nuevo"]), 2)
        db.add(models.CambioPrecio(variante_id=v.id, precio_anterior=v.precio, precio_nuevo=nuevo))
        v.precio = nuevo
    db.commit()
    return {"aplicados": len(cambios)}

