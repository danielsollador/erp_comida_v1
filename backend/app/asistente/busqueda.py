"""Buscar documentos hablando: "la factura de Makro de la semana pasada de unos 40".

El LLM traduce la frase a filtros (tipo, a quién o qué, fechas, monto
aproximado, número) llamando a `buscar_documentos`. La búsqueda la hace AQUÍ
el ERP, en la base, y ordena por parecido: el modelo nunca ve la base entera
ni inventa un documento; solo puede mostrar lo que esta función devolvió, y
cada resultado lleva su enlace para abrirlo en su pantalla.

El parecido es a propósito tolerante: "makro" encuentra "Makro
Comercializadora C.A.", "unos 40" acepta de 30 a 50, y la fecha suma pero no
excluye si el dueño se equivocó de semana (el filtro duro es el rango que el
modelo pide; si no encuentra, el modelo puede ampliar y volver a buscar).
"""
import datetime
import re
import unicodedata
from typing import List, Optional

from sqlalchemy.orm import Session, joinedload

from .. import models
from ..acceso import permisos
from ..timeutils import hoy

MAX_RESULTADOS = 8
MAX_FILAS = 2000  # por tipo y rango: un local chico no llega; uno grande, no se recorre de más

TIPOS = {
    "compra": ("compras", "Factura de compra"),
    "venta": ("ventas", "Venta"),
    "gasto": ("caja", "Gasto"),
}


def _norm(t: str) -> str:
    t = unicodedata.normalize("NFKD", (t or "").lower())
    return "".join(c for c in t if not unicodedata.combining(c))


def _palabras(t: str) -> List[str]:
    # "de", "la", "c.a." no ayudan a encontrar nada.
    return [w for w in re.findall(r"[a-z0-9]+", _norm(t)) if len(w) > 2 or w.isdigit()]


def _coincidencia(buscadas: List[str], pajar: str) -> float:
    """Qué parte de las palabras buscadas aparece (por comienzo de palabra)."""
    if not buscadas:
        return 0.0
    propias = _palabras(pajar)
    halladas = sum(1 for b in buscadas if any(p.startswith(b) or b.startswith(p) and len(p) > 3 for p in propias))
    return halladas / len(buscadas)


def _rango(desde: Optional[str], hasta: Optional[str]):
    h = datetime.date.fromisoformat(hasta) if hasta else hoy()
    d = datetime.date.fromisoformat(desde) if desde else h - datetime.timedelta(days=90)
    if d > h:
        d, h = h, d
    return datetime.datetime.combine(d, datetime.time()), datetime.datetime.combine(h + datetime.timedelta(days=1), datetime.time())


def _puntaje(texto: float, hay_texto: bool, monto: Optional[float], total: float, numero_ok: bool,
             hay_numero: bool = False) -> Optional[float]:
    """None = descartado. Sin texto ni monto, todo vale lo mismo (va por fecha)."""
    if hay_numero and not numero_ok:
        # Si dijo un número, el que no lo tiene no es.
        return None
    p = 0.0
    if numero_ok:
        p += 5
    if hay_texto:
        if texto == 0 and not numero_ok:
            return None
        p += 3 * texto
    if monto:
        dif = abs(total - monto) / monto
        if dif > 0.35 and not numero_ok:
            return None
        p += 2 * (1 - min(dif, 0.35) / 0.35)
    return p


def _enlace(base: str, cuando: datetime.date, ident: int) -> str:
    # El período del documento va en la URL: la lista lo muestra aunque esté
    # fuera del período que la pantalla abre por defecto.
    return f"{base}?d={cuando.isoformat()}&h={cuando.isoformat()}&abrir={ident}"


def _compras(db, inicio, fin, palabras, monto, numero) -> list:
    q = (
        db.query(models.FacturaCompra)
        .options(joinedload(models.FacturaCompra.items).joinedload(models.FacturaCompraItem.ingrediente))
        .filter(models.FacturaCompra.fecha >= inicio, models.FacturaCompra.fecha < fin)
        .order_by(models.FacturaCompra.fecha.desc())
        .limit(MAX_FILAS)
    )
    salida = []
    for f in q:
        lleva = " ".join(i.ingrediente.nombre for i in f.items if i.ingrediente)
        pajar = f"{f.proveedor_nombre} {f.numero_factura} {f.descripcion or ''} {f.categoria or ''} {lleva}"
        num_ok = bool(numero) and _norm(numero) in _norm(f"{f.numero_factura} {f.numero_control or ''}")
        p = _puntaje(_coincidencia(palabras, pajar), bool(palabras), monto, f.total, num_ok, bool(numero))
        if p is None:
            continue
        cuando = f.fecha_emision or f.fecha.date()
        salida.append((p, f.fecha, {
            "tipo": "compra",
            "id": f.id,
            "titulo": f"Factura {f.numero_factura} · {f.proveedor_nombre}",
            "detalle": (lleva[:90] + "…") if len(lleva) > 90 else lleva,
            "fecha": cuando.isoformat(),
            "monto_usd": round(f.total, 2),
            "estado": "pagada" if f.pagada else "por pagar",
            "enlace": _enlace("/compras", f.fecha.date(), f.id),
        }))
    return salida


def _ventas(db, inicio, fin, palabras, monto, numero) -> list:
    q = (
        db.query(models.Pedido)
        .options(joinedload(models.Pedido.items))
        .filter(models.Pedido.creado_en >= inicio, models.Pedido.creado_en < fin, models.Pedido.estado != "pendiente")
        .order_by(models.Pedido.creado_en.desc())
        .limit(MAX_FILAS)
    )
    salida = []
    for v in q:
        lleva = ", ".join(f"{i.cantidad} {i.nombre}" for i in v.items)
        pajar = f"{v.cliente or ''} {v.razon_social_cliente or ''} {v.rif_cliente or ''} {v.nota or ''} {lleva} {v.metodo_pago or ''}"
        num_ok = bool(numero) and _norm(numero).lstrip("#") in (str(v.numero), _norm(v.numero_factura or ""))
        p = _puntaje(_coincidencia(palabras, pajar), bool(palabras), monto, v.total, num_ok, bool(numero))
        if p is None:
            continue
        estado = "anulada" if v.estado == "anulado" else "devuelta" if v.devuelto else "cobrada" if v.estado == "pagado" else v.estado
        quien = v.cliente or v.razon_social_cliente
        salida.append((p, v.creado_en, {
            "tipo": "venta",
            "id": v.id,
            "titulo": f"Venta #{v.numero}" + (f" · {quien}" if quien else ""),
            "detalle": (lleva[:90] + "…") if len(lleva) > 90 else lleva,
            "fecha": v.creado_en.date().isoformat(),
            "monto_usd": round(v.total, 2),
            "estado": estado,
            "enlace": _enlace("/ventas", v.creado_en.date(), v.id),
        }))
    return salida


def _gastos(db, inicio, fin, palabras, monto, numero) -> list:
    q = (
        db.query(models.Gasto)
        .filter(models.Gasto.fecha >= inicio, models.Gasto.fecha < fin)
        .order_by(models.Gasto.fecha.desc())
        .limit(MAX_FILAS)
    )
    salida = []
    for g in q:
        p = _puntaje(_coincidencia(palabras, f"{g.descripcion} {g.categoria or ''}"), bool(palabras), monto, g.monto, False, bool(numero))
        if p is None:
            continue
        salida.append((p, g.fecha, {
            "tipo": "gasto",
            "id": g.id,
            "titulo": f"Gasto · {g.descripcion}",
            "detalle": f"{g.categoria or ''} · pagado con {g.metodo_pago or 'efectivo'}".strip(" ·"),
            "fecha": g.fecha.date().isoformat(),
            "monto_usd": round(g.monto, 2),
            "estado": "",
            "enlace": f"/caja/movimientos?d={g.fecha.date().isoformat()}&h={g.fecha.date().isoformat()}",
        }))
    return salida


BUSCADORES = {"compra": _compras, "venta": _ventas, "gasto": _gastos}


def buscar(db: Session, rol: str, tipo: str = "cualquiera", texto: str = "", desde: Optional[str] = None,
           hasta: Optional[str] = None, monto_aproximado: Optional[float] = None, numero: Optional[str] = None) -> dict:
    tipos = list(TIPOS) if tipo in ("", "cualquiera", None) else [tipo]
    permitidos = [t for t in tipos if t in TIPOS and permisos.puede_modulo(rol, TIPOS[t][0])]
    if not permitidos:
        return {"error": "Este usuario no tiene acceso a ese tipo de documento."}
    try:
        inicio, fin = _rango(desde, hasta)
    except ValueError:
        return {"error": "Las fechas no son válidas (AAAA-MM-DD)."}
    palabras = _palabras(texto or "")
    monto = float(monto_aproximado) if monto_aproximado else None
    hallados = []
    for t in permitidos:
        hallados += BUSCADORES[t](db, inicio, fin, palabras, monto, numero)
    # Primero lo que más se parece; a igual parecido, lo más reciente.
    hallados.sort(key=lambda x: (-x[0], -x[1].timestamp()))
    docs = [d for _, _, d in hallados[:MAX_RESULTADOS]]
    return {
        "buscado": {"tipos": permitidos, "desde": inicio.date().isoformat(), "hasta": (fin - datetime.timedelta(days=1)).date().isoformat(),
                    "texto": texto, "monto_aproximado": monto, "numero": numero},
        "encontrados": len(hallados),
        "documentos": docs,
    }


DECLARACION = {
    "name": "buscar_documentos",
    "description": (
        "Busca facturas de compra, ventas o gastos a partir de lo que el usuario recuerde: a quién (proveedor, "
        "cliente), qué llevaba (\"harina\", \"empanadas\"), cuándo, cuánto más o menos, o el número. Úsala cuando "
        "pida encontrar, ver o abrir un documento. Pon solo lo que el usuario dijo; las fechas como rango (si dice "
        "\"la semana pasada\", de lunes a domingo de esa semana; si no dice nada, deja las fechas vacías = últimos 90 "
        "días). Si no aparece nada, amplía el rango o quita el monto y vuelve a buscar UNA vez. Los resultados se le "
        "muestran al usuario con un botón para abrirlos: en tu respuesta di cuál parece ser y por qué, sin repetir "
        "la lista entera, y sin explicar cómo calculaste las fechas."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "tipo": {"type": "string", "enum": ["compra", "venta", "gasto", "cualquiera"]},
            "texto": {"type": "string", "description": "Nombres o cosas que recuerda: proveedor, cliente, producto, descripción."},
            "desde": {"type": "string", "description": "AAAA-MM-DD, inclusive."},
            "hasta": {"type": "string", "description": "AAAA-MM-DD, inclusive."},
            "monto_aproximado": {"type": "number", "description": "En dólares, si dijo un monto (\"unos 40\")."},
            "numero": {"type": "string", "description": "Número de factura o de venta, si lo dijo."},
        },
        "required": ["tipo"],
    },
}
