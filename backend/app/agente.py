"""El asistente que hace cosas (IA, 23-oct).

"Regalé dos harinas PAN, descuéntalas", "móntale un pedido a Juanito por dos
empanadas de queso", "¿cuántos pastelitos vendí ayer?", "¿qué me falta por
llenar?", "¿cómo va la contabilidad?". Un chat que entiende eso y lo hace.

Como trabaja (Gemini con herramientas, "function calling"):
  - LEER lo hace solo: buscar en el menú o el inventario, sacar números de
    los reportes, ver qué falta configurar, mirar la contabilidad.
  - CAMBIAR algo (vender, descontar, cobrar, anular, gastar) NUNCA lo hace
    solo: arma la acción, el sistema la valida y le muestra a la persona una
    tarjeta "¿Hago esto?". Solo al tocar «Confirmar» se ejecuta.

POR LA PUERTA DE SIEMPRE. Cada acción se ejecuta llamando a la misma API que
usan las pantallas, con la sesión de quien está en el chat (`_Api`). Así
valen los mismos permisos (la cajera no anula si su rol no anula), las
mismas reglas (no vender sin stock, el nombre para fiar) y queda el mismo
rastro que si lo hubiera hecho a mano. El asistente no tiene una puerta
trasera a la base de datos.

Los ids los saca de las herramientas de búsqueda, nunca de la memoria: un id
que no existe vuelve como error y el modelo tiene que buscar.
"""

import datetime
import json
import logging
import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterator, List, Optional

from sqlalchemy.orm import Session

from . import asistente_ayuda, lectura_facturas, models, pedido_whatsapp, pregunta_negocio, reporte_dinamico as rd
from . import schemas, settings
from .acceso import permisos
from .timeutils import ahora, hoy

log = logging.getLogger("erp.agente")

MAX_VUELTAS = 8
VIDA_PROPUESTA_S = 15 * 60


# ── La API por dentro, con la sesión de quien pregunta ──────────────────────

class _Api:
    """Llama a la API del propio ERP como si fuera la pantalla: mismo
    middleware, mismos permisos, mismas reglas."""

    def __init__(self, token: str):
        from fastapi.testclient import TestClient

        from .main import app

        self._c = TestClient(app, raise_server_exceptions=False)
        self._h = {"Authorization": f"Bearer {token}"}

    def __call__(self, metodo: str, ruta: str, json_: Any = None, params: Optional[dict] = None):
        r = self._c.request(metodo, ruta, json=json_, params=params, headers=self._h)
        try:
            datos = r.json()
        except ValueError:
            datos = {"detail": r.text[:300]}
        return r.status_code, datos


def _error(status: int, datos: Any) -> str:
    detalle = datos.get("detail") if isinstance(datos, dict) else None
    if isinstance(detalle, list):  # validacion de FastAPI
        detalle = "; ".join(str(d.get("msg", d)) for d in detalle)
    if status == 403:
        return "Tu rol no tiene permiso para esto."
    return str(detalle or f"Error {status}")


@dataclass
class Contexto:
    db: Session
    api: _Api
    rol: str
    usuario: str
    nombre: str = ""
    modulos: tuple = ()
    eventos: List[dict] = field(default_factory=list)  # tablas para la pantalla
    # Lo que la IA necesita saber de lo que se acaba de hacer (el pedido_id
    # del pedido creado): va al historial, no a la pantalla.
    nota: str = ""

    def entra(self, *modulos: str) -> bool:
        return any(m in self.modulos for m in modulos)


# ── Las propuestas: lo que espera el «Confirmar» de la persona ───────────────

@dataclass
class Propuesta:
    id: str
    usuario: str
    herramienta: str
    args: dict
    titulo: str
    detalle: List[str]
    peligro: bool
    creada: float


_PROPUESTAS: Dict[str, Propuesta] = {}
_CANDADO = threading.Lock()


def _guardar(p: Propuesta) -> None:
    with _CANDADO:
        vencidas = [k for k, v in _PROPUESTAS.items() if time.time() - v.creada > VIDA_PROPUESTA_S]
        for k in vencidas:
            del _PROPUESTAS[k]
        _PROPUESTAS[p.id] = p


def _sacar(propuesta_id: str, usuario: str) -> Optional[Propuesta]:
    with _CANDADO:
        p = _PROPUESTAS.get(propuesta_id)
        if not p or p.usuario != usuario or time.time() - p.creada > VIDA_PROPUESTA_S:
            return None
        del _PROPUESTAS[propuesta_id]
        return p


def _usd(monto: float) -> str:
    return pregunta_negocio.formatear(monto, "dinero")


# ── Herramientas de lectura ─────────────────────────────────────────────────

def buscar_productos_menu(ctx: Contexto, texto: str = "") -> dict:
    opciones = pedido_whatsapp.menu(ctx.db)
    if texto.strip():
        elegidas = pedido_whatsapp._candidatas(texto, opciones, 8)
    else:
        elegidas = opciones[:80]
    return {"productos": [{"variante_id": o.variante_id, "nombre": o.nombre, "precio": o.precio} for o in elegidas]
            or "No encontré nada parecido en el menú."}


def buscar_mercancia(ctx: Contexto, texto: str = "") -> dict:
    if not ctx.entra("inventario", "compras", "recetas"):
        return {"error": "Tu rol no entra a Inventario."}
    todos = ctx.db.query(models.Ingrediente).filter(models.Ingrediente.activo.isnot(False)).all()
    if texto.strip():
        buscado = pedido_whatsapp._clave(texto)
        con_puntaje = sorted(((pedido_whatsapp._puntaje(texto, pedido_whatsapp._Opcion(i.id, i.nombre, 0, pedido_whatsapp._clave(i.nombre))), i)
                              for i in todos), key=lambda x: -x[0])
        todos = [i for p, i in con_puntaje if p >= 0.3 or buscado in pedido_whatsapp._clave(i.nombre)][:8]
    return {"mercancias": [{"ingrediente_id": i.id, "nombre": i.nombre, "unidad": i.unidad,
                            "hay": round(i.stock_actual or 0, 3), "tipo": i.tipo} for i in todos[:60]]
            or "No encontré esa mercancía en el inventario."}


def consultar_reporte(ctx: Contexto, fuente: str, desde: str, hasta: str, medidas: List[str],
                      filas: Optional[List[str]] = None, filtros: Optional[List[dict]] = None, limite: int = 10) -> dict:
    t = {"tipo": "consulta", "fuente": fuente, "desde": desde, "hasta": hasta, "medidas": medidas,
         "filas": filas or [], "filtros": filtros or [], "limite": limite}
    try:
        consulta, d, h, tope, filtrado = pregunta_negocio._consulta(ctx.db, t, ctx.modulos)
        r = rd.consultar(ctx.db, consulta, permisos.administra(ctx.rol), ctx.modulos)
    except (rd.ErrorDeConsulta, pregunta_negocio.NoSePuede) as e:
        return {"error": str(e)}
    columnas, filas_, total = pregunta_negocio._tabla(r, tope)
    nombre = rd.FUENTES[consulta.fuente].nombre + "".join(f" · solo {n}" for n in filtrado)
    periodo = pregunta_negocio._periodo(d, h)
    tabla = schemas.RespuestaNegocio(texto="", con_ia=True, titulo=f"{nombre} · {periodo}", columnas=columnas, filas=filas_,
                                     total=total, agrupado=len(r["campos_fila"]), mas=max(len(r["filas"]) - tope, 0))
    ctx.eventos.append({"tabla": tabla.model_dump()})
    return {"periodo": periodo, "columnas": columnas, "filas": filas_, "total": total}


def pendientes_por_configurar(ctx: Contexto) -> dict:
    """Lo que le falta al local para que los números digan la verdad."""
    db = ctx.db
    con_receta = {v for (v,) in db.query(models.RecetaItem.variante_id).distinct().all()}
    # Un combo no lleva receta propia: descuenta la de lo que trae.
    combos = {v for (v,) in db.query(models.ComboItem.combo_variante_id).distinct().all()}
    sin_receta = [o.nombre for o in pedido_whatsapp.menu(db) if o.variante_id not in con_receta and o.variante_id not in combos
                  and "delivery" not in o.nombre.lower()]
    sin_costo = [i.nombre for i in db.query(models.Ingrediente).filter(models.Ingrediente.activo.isnot(False)).all()
                 if not (i.costo_unitario or 0)]
    salida: Dict[str, Any] = {
        "productos_sin_receta": sin_receta[:20], "cuantos_sin_receta": len(sin_receta),
        "mercancias_sin_costo": sin_costo[:20],
        "mercancias": db.query(models.Ingrediente).count(),
        "tasa_de_hoy": db.get(models.TasaCambio, hoy()) is not None,
    }
    st, rec = ctx.api("GET", "/api/reportes/recorrido")
    if st == 200:
        salida["recorrido_del_dia"] = [f"{p['id']}: {p['frase']}" for p in rec.get("pasos", []) if p.get("pendiente")]
    st, av = ctx.api("GET", "/api/reportes/avisos")
    if st == 200:
        salida["avisos"] = [a["titulo"] for a in av]
    return salida


def estado_contabilidad(ctx: Contexto) -> dict:
    inicio = hoy().replace(day=1)
    st, salud = ctx.api("GET", "/api/contabilidad/salud")
    if st != 200:
        return {"error": _error(st, salud)}
    _, er = ctx.api("GET", "/api/contabilidad/estado-resultados", params={"desde": inicio.isoformat(), "hasta": hoy().isoformat()})
    _, bg = ctx.api("GET", "/api/contabilidad/balance-general")
    salida = {
        "libros_sanos": salud.get("sano"),
        "problemas": [p.get("mensaje") or p.get("titulo") or str(p) for p in salud.get("problemas", [])][:8],
    }
    if isinstance(er, dict) and "ingresos" in er:
        salida["resultado_del_mes"] = {k: er[k] for k in ("etiqueta", "ingresos", "costos", "utilidad_bruta", "gastos", "utilidad_neta")}
    if isinstance(bg, dict) and "total_activos" in bg:
        salida["balance"] = {k: bg[k] for k in ("total_activos", "total_pasivos", "total_patrimonio", "cuadra")}
    return salida


def pedidos_abiertos(ctx: Contexto) -> dict:
    """Los pedidos sin cobrar (de cuando sean) y los cobrados hoy. `del_dia`
    de la API trae solo los cobrados: lo abierto se pide aparte."""
    vistos: Dict[int, dict] = {}
    for params in ({"estado": "pendiente"}, {"estado": "listo"}, {"del_dia": True}):
        st, lista = ctx.api("GET", "/api/pedidos", params=params)
        if st != 200:
            return {"error": _error(st, lista)}
        for p in lista:
            vistos[p["id"]] = p
    pedidos = sorted(vistos.values(), key=lambda p: -p["id"])[:40]
    return {"pedidos": [{"pedido_id": p["id"], "numero": p["numero"], "cliente": p.get("cliente", ""),
                         "estado": "cobrado" if p["estado"] == "pagado" else "sin cobrar", "total": p["total"],
                         "hora": (p.get("creado_en") or "")[11:16],
                         "items": [f"{i.get('cantidad')} {i.get('nombre', '')}".strip() for i in p.get("items", [])][:6]}
                        for p in pedidos] or "No hay pedidos abiertos ni cobrados hoy."}


def buscar_en_manual(ctx: Contexto, tema: str) -> dict:
    """Las partes del manual que hablan de eso: para explicar cómo se hace."""
    palabras = [p for p in pedido_whatsapp._clave(tema).split() if len(p) > 3]
    secciones = asistente_ayuda.MANUAL.split("\n### ")
    puntuadas = sorted(((sum(pedido_whatsapp._clave(s).count(p) for p in palabras), s) for s in secciones), key=lambda x: -x[0])
    return {"manual": [s[:1800] for p, s in puntuadas[:2] if p > 0] or "El manual no habla de eso."}


# ── Herramientas que cambian algo: preparan, la persona confirma ─────────────

@dataclass
class Preparado:
    titulo: str
    detalle: List[str]
    peligro: bool = False


def _variantes(ctx: Contexto, items: List[dict]) -> List[tuple]:
    por_id = {o.variante_id: o for o in pedido_whatsapp.menu(ctx.db)}
    salida = []
    for it in items or []:
        o = por_id.get(int(it.get("variante_id") or 0))
        if o is None:
            raise ValueError(f"El variante_id {it.get('variante_id')} no existe en el menú: búscalo con buscar_productos_menu.")
        cantidad = max(1, int(round(float(it.get("cantidad") or 1))))
        salida.append((o, cantidad, bool(it.get("cortesia"))))
    if not salida:
        raise ValueError("El pedido no tiene productos.")
    return salida


def _nombre_cliente(cliente: str) -> str:
    """"juanito" -> "Juanito": como lo escribiria la cajera en la comanda."""
    cliente = " ".join((cliente or "").split())[:60]
    return cliente.title() if cliente.islower() else cliente


def preparar_crear_pedido(ctx: Contexto, items: List[dict], cliente: str = "", nota: str = "",
                          cobrar_con: str = "", referencia: str = "") -> Preparado:
    cliente = _nombre_cliente(cliente)
    renglones = _variantes(ctx, items)
    total = sum(o.precio * c for o, c, cortesia in renglones if not cortesia)
    detalle = [f"{c} × {o.nombre}" + (" (cortesía)" if cortesia else f" · {_usd(o.precio * c)}") for o, c, cortesia in renglones]
    if nota:
        detalle.append(f"Nota: {nota}")
    if cobrar_con:
        detalle.append(f"Se cobra con {cobrar_con}" + (f", ref. {referencia}" if referencia else ""))
    return Preparado(titulo=f"Pedido{' a nombre de ' + cliente if cliente else ''} · {_usd(total)}", detalle=detalle)


def ejecutar_crear_pedido(ctx: Contexto, items: List[dict], cliente: str = "", nota: str = "",
                          cobrar_con: str = "", referencia: str = "") -> str:
    cliente = _nombre_cliente(cliente)
    cuerpo = {"items": [{"variante_id": int(i["variante_id"]), "cantidad": int(round(float(i.get("cantidad") or 1))),
                         "cortesia": bool(i.get("cortesia"))} for i in items],
              "cliente": cliente, "nota": nota, "clave_cliente": secrets.token_hex(8)}
    st, p = ctx.api("POST", "/api/pedidos", cuerpo)
    if st != 200:
        raise ValueError(_error(st, p))
    ctx.nota = f"pedido_id={p['id']}, numero={p['numero']}"
    texto = f"Listo: pedido #{p['numero']}{' de ' + cliente if cliente else ''} por {_usd(p['total'])}, ya va a cocina."
    if cobrar_con:
        st, c = ctx.api("POST", f"/api/pedidos/{p['id']}/cobrar", {"metodo_pago": cobrar_con, "referencia": referencia or None})
        if st != 200:
            return texto + f" No lo pude cobrar: {_error(st, c)} Cóbralo desde Pedidos."
        texto = texto.replace("ya va a cocina", f"cobrado con {cobrar_con} y en cocina")
    return texto


def _ingrediente(ctx: Contexto, ingrediente_id: int) -> models.Ingrediente:
    i = ctx.db.get(models.Ingrediente, int(ingrediente_id or 0))
    if i is None:
        raise ValueError(f"El ingrediente_id {ingrediente_id} no existe: búscalo con buscar_mercancia.")
    return i


def preparar_sacar_de_inventario(ctx: Contexto, ingrediente_id: int, cantidad: float, motivo: str,
                                 tipo: str = "merma") -> Preparado:
    i = _ingrediente(ctx, ingrediente_id)
    if cantidad <= 0:
        raise ValueError("La cantidad tiene que ser mayor que cero.")
    que = "Consumo del personal" if tipo == "consumo_personal" else "Sale del inventario"
    return Preparado(titulo=f"{que}: {pregunta_negocio.formatear(cantidad, 'numero')} {i.unidad} de {i.nombre}",
                     detalle=[f"Motivo: {motivo or 'sin motivo'}", f"Hay {pregunta_negocio.formatear(i.stock_actual or 0, 'numero')} {i.unidad}; "
                              f"quedarían {pregunta_negocio.formatear((i.stock_actual or 0) - cantidad, 'numero')}."])


def ejecutar_sacar_de_inventario(ctx: Contexto, ingrediente_id: int, cantidad: float, motivo: str, tipo: str = "merma") -> str:
    ruta = "consumo-personal" if tipo == "consumo_personal" else "merma"
    st, r = ctx.api("POST", f"/api/inventario/ingredientes/{int(ingrediente_id)}/{ruta}", {"cantidad": cantidad, "motivo": motivo})
    if st != 200:
        raise ValueError(_error(st, r))
    return f"Listo: salieron {pregunta_negocio.formatear(cantidad, 'numero')} {r['unidad']} de {r['nombre']}. Quedan {pregunta_negocio.formatear(r['stock_actual'], 'numero')}."


def preparar_registrar_llegada(ctx: Contexto, ingrediente_id: int, cantidad: float, costo_total: float = 0,
                               metodo_pago: str = "Efectivo Bs") -> Preparado:
    i = _ingrediente(ctx, ingrediente_id)
    detalle = [f"Pagado con {metodo_pago}"] + ([f"Costó {_usd(costo_total)} en total"] if costo_total else ["Sin costo: queda el de siempre"])
    detalle.append("Sin factura (compra suelta). Con factura, mejor cárgala en Compras.")
    return Preparado(titulo=f"Llegó: {pregunta_negocio.formatear(cantidad, 'numero')} {i.unidad} de {i.nombre}", detalle=detalle)


def ejecutar_registrar_llegada(ctx: Contexto, ingrediente_id: int, cantidad: float, costo_total: float = 0,
                               metodo_pago: str = "Efectivo Bs") -> str:
    st, r = ctx.api("POST", f"/api/inventario/ingredientes/{int(ingrediente_id)}/comprar",
                    {"cantidad": cantidad, "costo_total": costo_total or None, "metodo_pago": metodo_pago})
    if st != 200:
        raise ValueError(_error(st, r))
    return "Listo: entró al inventario."


def _pedido(ctx: Contexto, pedido_id: int) -> models.Pedido:
    p = ctx.db.get(models.Pedido, int(pedido_id or 0))
    if p is None:
        raise ValueError(f"El pedido_id {pedido_id} no existe: búscalo con pedidos_abiertos.")
    return p


def _resumen_pedido(p: models.Pedido) -> List[str]:
    hora = p.creado_en.strftime("%H:%M") if p.creado_en else ""
    items = ", ".join(f"{i.cantidad} {i.nombre}" for i in p.items[:5])
    return [f"Tomado a las {hora}" + (f" · {items}" if items else "")]


def preparar_cobrar_pedido(ctx: Contexto, pedido_id: int, metodo_pago: str, referencia: str = "") -> Preparado:
    p = _pedido(ctx, pedido_id)
    if p.estado in ("pagado", "anulado"):
        raise ValueError(f"El pedido #{p.numero} ya está {'cobrado' if p.estado == 'pagado' else 'anulado'}.")
    return Preparado(titulo=f"Cobrar el pedido #{p.numero}{' de ' + p.cliente if p.cliente else ''} · {_usd(p.total)}",
                     detalle=_resumen_pedido(p) + [f"Con {metodo_pago}" + (f", ref. {referencia}" if referencia else "")])


def ejecutar_cobrar_pedido(ctx: Contexto, pedido_id: int, metodo_pago: str, referencia: str = "") -> str:
    st, r = ctx.api("POST", f"/api/pedidos/{int(pedido_id)}/cobrar", {"metodo_pago": metodo_pago, "referencia": referencia or None})
    if st != 200:
        raise ValueError(_error(st, r))
    return f"Listo: pedido #{r['numero']} cobrado con {metodo_pago}."


def preparar_anular_pedido(ctx: Contexto, pedido_id: int, motivo: str = "") -> Preparado:
    p = _pedido(ctx, pedido_id)
    if p.estado == "pagado":
        raise ValueError(f"El pedido #{p.numero} ya está cobrado: no se anula, se devuelve desde Ventas con «Devolver».")
    if p.estado == "anulado":
        raise ValueError(f"El pedido #{p.numero} ya estaba anulado.")
    return Preparado(titulo=f"Anular el pedido #{p.numero}{' de ' + p.cliente if p.cliente else ''} · {_usd(p.total)}",
                     detalle=_resumen_pedido(p) + ([f"Motivo: {motivo}"] if motivo else []), peligro=True)


def ejecutar_anular_pedido(ctx: Contexto, pedido_id: int, motivo: str = "") -> str:
    st, r = ctx.api("POST", f"/api/pedidos/{int(pedido_id)}/anular", {})
    if st != 200:
        raise ValueError(_error(st, r))
    return f"Listo: pedido #{r['numero']} anulado."


def preparar_registrar_gasto(ctx: Contexto, descripcion: str, monto: float, metodo_pago: str = "Efectivo",
                             categoria: str = "Operativo") -> Preparado:
    if monto <= 0:
        raise ValueError("El monto tiene que ser mayor que cero.")
    return Preparado(titulo=f"Gasto: {descripcion} · {_usd(monto)}", detalle=[f"Pagado con {metodo_pago}", f"Categoría: {categoria}"])


def ejecutar_registrar_gasto(ctx: Contexto, descripcion: str, monto: float, metodo_pago: str = "Efectivo",
                             categoria: str = "Operativo") -> str:
    st, r = ctx.api("POST", "/api/caja/gastos", {"descripcion": descripcion, "monto": monto, "metodo_pago": metodo_pago,
                                                 "categoria": categoria})
    if st != 200:
        raise ValueError(_error(st, r))
    return f"Listo: gasto de {_usd(monto)} anotado."


# ── El catálogo de herramientas, como lo ve Gemini ──────────────────────────

@dataclass
class Herramienta:
    descripcion: str
    parametros: dict
    paso: Callable[[dict], str]
    leer: Optional[Callable] = None
    preparar: Optional[Callable] = None
    ejecutar: Optional[Callable] = None


S, N, I, B = {"type": "STRING"}, {"type": "NUMBER"}, {"type": "INTEGER"}, {"type": "BOOLEAN"}


def _obj(props: dict, requeridos: List[str]) -> dict:
    return {"type": "OBJECT", "properties": props, "required": requeridos}


HERRAMIENTAS: Dict[str, Herramienta] = {
    "buscar_productos_menu": Herramienta(
        "Busca productos del MENÚ (lo que se vende) por nombre y da su variante_id y precio. Sin texto, el menú entero.",
        _obj({"texto": S}, []), lambda a: f"Buscando «{a.get('texto', '')}» en el menú…" if a.get("texto") else "Mirando el menú…",
        leer=buscar_productos_menu),
    "buscar_mercancia": Herramienta(
        "Busca MERCANCÍA del inventario (harina, queso, refrescos para revender...) y da su ingrediente_id, unidad y cuánto hay.",
        _obj({"texto": S}, []), lambda a: f"Buscando «{a.get('texto', '')}» en el inventario…", leer=buscar_mercancia),
    "consultar_reporte": Herramienta(
        "Saca números de los reportes del sistema (ventas, productos vendidos, cobros, compras, inventario...). "
        "Usa SOLO fuentes, campos y medidas del CATÁLOGO del sistema. Fechas AAAA-MM-DD.",
        _obj({"fuente": S, "desde": S, "hasta": S, "medidas": {"type": "ARRAY", "items": S},
              "filas": {"type": "ARRAY", "items": S},
              "filtros": {"type": "ARRAY", "items": _obj({"campo": S, "valores": {"type": "ARRAY", "items": S}}, ["campo", "valores"])},
              "limite": I}, ["fuente", "desde", "hasta", "medidas"]),
        lambda a: "Buscando en tus reportes…", leer=consultar_reporte),
    "pendientes_por_configurar": Herramienta(
        "Lo que le falta al negocio por cargar o hacer: productos sin receta, mercancía sin costo, tasa del día, "
        "pasos del día pendientes (caja, compras) y avisos.",
        _obj({}, []), lambda a: "Revisando qué falta…", leer=pendientes_por_configurar),
    "estado_contabilidad": Herramienta(
        "Cómo está la contabilidad: si los libros están sanos, el resultado del mes y el balance.",
        _obj({}, []), lambda a: "Mirando la contabilidad…", leer=estado_contabilidad),
    "pedidos_abiertos": Herramienta(
        "Los pedidos del día con su pedido_id, número, cliente, estado y total. Para cobrar o anular uno.",
        _obj({}, []), lambda a: "Buscando los pedidos de hoy…", leer=pedidos_abiertos),
    "buscar_en_manual": Herramienta(
        "Busca en el manual del sistema cómo se hace algo, para explicarlo.",
        _obj({"tema": S}, ["tema"]), lambda a: "Buscando en el manual…", leer=buscar_en_manual),
    # ── las que cambian algo: el sistema pide confirmación ──
    "crear_pedido": Herramienta(
        "CAMBIA: crea un pedido (comanda) que va a cocina. items con variante_id de buscar_productos_menu; "
        "cortesia=true si se regala. cobrar_con opcional (Efectivo Bs, Efectivo $, Punto de venta, Pago movil, "
        "Transferencia, Zelle, Fiado); los que no son efectivo necesitan referencia.",
        _obj({"items": {"type": "ARRAY", "items": _obj({"variante_id": I, "cantidad": N, "cortesia": B}, ["variante_id", "cantidad"])},
              "cliente": S, "nota": S, "cobrar_con": S, "referencia": S}, ["items"]),
        lambda a: "Armando el pedido…", preparar=preparar_crear_pedido, ejecutar=ejecutar_crear_pedido),
    "sacar_de_inventario": Herramienta(
        "CAMBIA: saca mercancía del inventario sin venta (se regaló, se dañó, se botó): tipo=merma; o si se la "
        "comió el personal: tipo=consumo_personal. ingrediente_id de buscar_mercancia.",
        _obj({"ingrediente_id": I, "cantidad": N, "motivo": S, "tipo": {"type": "STRING", "enum": ["merma", "consumo_personal"]}},
             ["ingrediente_id", "cantidad", "motivo"]),
        lambda a: "Preparando la salida del inventario…", preparar=preparar_sacar_de_inventario, ejecutar=ejecutar_sacar_de_inventario),
    "registrar_llegada_mercancia": Herramienta(
        "CAMBIA: entra mercancía al inventario sin factura (compra suelta). costo_total en dólares si se sabe.",
        _obj({"ingrediente_id": I, "cantidad": N, "costo_total": N, "metodo_pago": S}, ["ingrediente_id", "cantidad"]),
        lambda a: "Preparando la entrada…", preparar=preparar_registrar_llegada, ejecutar=ejecutar_registrar_llegada),
    "cobrar_pedido": Herramienta(
        "CAMBIA: cobra un pedido ya tomado. pedido_id de pedidos_abiertos.",
        _obj({"pedido_id": I, "metodo_pago": S, "referencia": S}, ["pedido_id", "metodo_pago"]),
        lambda a: "Preparando el cobro…", preparar=preparar_cobrar_pedido, ejecutar=ejecutar_cobrar_pedido),
    "anular_pedido": Herramienta(
        "CAMBIA: anula un pedido que NO se ha cobrado. pedido_id de pedidos_abiertos.",
        _obj({"pedido_id": I, "motivo": S}, ["pedido_id"]),
        lambda a: "Preparando la anulación…", preparar=preparar_anular_pedido, ejecutar=ejecutar_anular_pedido),
    "registrar_gasto": Herramienta(
        "CAMBIA: anota un gasto pagado con plata del negocio (luz, gas, un servicio). Monto en dólares.",
        _obj({"descripcion": S, "monto": N, "metodo_pago": S, "categoria": S}, ["descripcion", "monto"]),
        lambda a: "Preparando el gasto…", preparar=preparar_registrar_gasto, ejecutar=ejecutar_registrar_gasto),
}


INSTRUCCIONES = """Eres el asistente del ERP de un negocio de comida en Venezuela. Hablas con
{quien}. Hoy es {hoy_texto} ({hoy}).

Puedes consultar y también HACER cosas en el sistema con tus herramientas.

Reglas:
- Los datos (ids, precios, cuánto hay, números de ventas) salen SIEMPRE de las
  herramientas. Nunca inventes un id: primero busca (buscar_productos_menu para lo
  que se vende, buscar_mercancia para el inventario, pedidos_abiertos para un pedido).
  "El pedido" de la conversación es el que dice su pedido_id en el historial; si
  no lo sabes, búscalo en pedidos_abiertos por cliente. Si no aparece, dilo:
  nunca uses un pedido_id que no viste.
- Las herramientas marcadas CAMBIA no se ejecutan solas: el sistema le muestra a la
  persona una tarjeta para que confirme. No digas que ya está hecho.
- Si algo es ambiguo (dos productos parecidos, no sabes la cantidad), pregunta en
  una frase antes de proponer.
- "Regalé X" de una mercancía es sacar_de_inventario con tipo=merma y motivo
  "Regalo"; de algo del menú, un pedido con cortesia=true.
- Para números usa consultar_reporte con el CATÁLOGO de abajo (mismas reglas de
  fechas: "ayer", "esta semana" = del lunes a hoy, "este mes" = del 1 a hoy).
  Si preguntan por un producto o una categoría, FILTRA por ese campo con el
  nombre como lo dijo la persona ("pastelito"): la tabla que se le muestra
  tiene que ser de eso, no de todo.
- Si piden algo que no puedes hacer con tus herramientas, dilo y di en qué
  pantalla se hace.
- Responde en español, de tú, cálido y breve (2 a 4 frases), con **negrita** en lo
  importante. Si es el primer mensaje, saluda por el nombre en pocas palabras.

{quien_detalle}

CATÁLOGO de reportes (para consultar_reporte):
{catalogo}"""


def _declaraciones() -> List[dict]:
    return [{"name": n, "description": h.descripcion, "parameters": h.parametros} for n, h in HERRAMIENTAS.items()]


def _turno(contenidos: List[dict], instrucciones: str) -> List[dict]:
    """Una vuelta con Gemini con herramientas: las partes de la respuesta."""
    cuerpo = {
        "contents": contenidos,
        "systemInstruction": {"parts": [{"text": instrucciones}]},
        "tools": [{"functionDeclarations": _declaraciones()}],
        "generationConfig": {"temperature": 0},
    }
    ultimo = "la IA no contestó"
    for modelo in asistente_ayuda._modelos(rapido=False):
        try:
            r = lectura_facturas._llamar(lectura_facturas.GEMINI_URL.format(modelo=modelo), cuerpo)
        except Exception as e:
            ultimo = str(e)
            continue
        if r.status_code == 200:
            return (r.datos.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
        ultimo = f"Gemini {modelo} respondió {r.status_code}"
        log.warning("%s al agente: %s", ultimo, r.text[:300])
        if r.status_code not in lectura_facturas.ESTADOS_PASAJEROS:
            break
    raise RuntimeError(ultimo)


def _instrucciones(ctx: Contexto) -> str:
    d = hoy()
    fuentes = [f for f in rd.catalogo(permisos.administra(ctx.rol), ctx.modulos) if f["medidas"]]
    modulos = [permisos.MODULOS[m]["nombre"] for m in ctx.modulos if m in permisos.MODULOS]
    return INSTRUCCIONES.format(
        quien=ctx.nombre or "alguien del negocio", hoy=d.isoformat(),
        hoy_texto=f"{pregunta_negocio.DIAS[d.weekday()]} {pregunta_negocio._fecha(d)} de {d.year}",
        quien_detalle=f"Su rol: {permisos.nombre_de(ctx.rol)}. Entra a: {', '.join(modulos) or 'solo la portada'}.",
        catalogo=pregunta_negocio._catalogo_texto(fuentes) or "(su rol no entra a ningún reporte)",
    )


def conversar(ctx: Contexto, mensaje: str, historial: List[schemas.TurnoAyuda]) -> Iterator[dict]:
    """La conversación contada mientras pasa: {"paso"}, {"tabla"}, {"texto"},
    {"propuesta"} (si quiere cambiar algo) y {"fin"}."""
    if not asistente_ayuda.activo():
        yield {"texto": "La IA no está encendida en este local."}
        yield {"fin": True}
        return
    contenidos = [{"role": "model" if t.rol == "asistente" else "user", "parts": [{"text": t.texto[:2000]}]}
                  for t in historial[-10:] if t.texto.strip()]
    contenidos.append({"role": "user", "parts": [{"text": mensaje.strip()[:2000]}]})
    instrucciones = _instrucciones(ctx)
    yield {"paso": "Pensando…"}
    for _ in range(MAX_VUELTAS):
        try:
            partes = _turno(contenidos, instrucciones)
        except Exception as e:
            log.warning("El agente no pudo seguir: %s", e)
            yield {"texto": "No pude responder ahora. Prueba otra vez en un momento."}
            yield {"fin": True}
            return
        llamadas = [p["functionCall"] for p in partes if p.get("functionCall")]
        texto = "".join(p.get("text", "") for p in partes if p.get("text") and not p.get("thought")).strip()
        if not llamadas:
            yield {"texto": texto or "Listo."}
            yield {"fin": True}
            return
        contenidos.append({"role": "model", "parts": partes})
        respuestas = []
        for fc in llamadas:
            nombre, args = fc.get("name", ""), fc.get("args") or {}
            h = HERRAMIENTAS.get(nombre)
            if h is None:
                respuestas.append({"functionResponse": {"name": nombre, "response": {"error": "No existe esa herramienta."}}})
                continue
            yield {"paso": h.paso(args)}
            log.info("agente rol=%s herramienta=%s args=%s", ctx.rol, nombre, json.dumps(args, ensure_ascii=False)[:300])
            if h.leer:
                try:
                    resultado = h.leer(ctx, **args)
                except TypeError as e:
                    resultado = {"error": f"Parámetros inválidos: {e}"}
                for ev in ctx.eventos:
                    yield ev
                ctx.eventos.clear()
                respuestas.append({"functionResponse": {"name": nombre, "response": resultado}})
                continue
            # Cambia algo: se valida y se le pregunta a la persona.
            try:
                prep = h.preparar(ctx, **args)
            except (ValueError, TypeError) as e:
                respuestas.append({"functionResponse": {"name": nombre, "response": {"error": str(e)}}})
                continue
            p = Propuesta(id=secrets.token_urlsafe(12), usuario=ctx.usuario, herramienta=nombre, args=args,
                          titulo=prep.titulo, detalle=prep.detalle, peligro=prep.peligro, creada=time.time())
            _guardar(p)
            if texto:
                yield {"texto": texto}
            yield {"propuesta": {"id": p.id, "titulo": p.titulo, "detalle": p.detalle, "peligro": p.peligro}}
            yield {"fin": True}
            return
        contenidos.append({"role": "user", "parts": respuestas})
    yield {"texto": "Me enredé con eso. ¿Me lo dices de otra forma?"}
    yield {"fin": True}


def confirmar(ctx: Contexto, propuesta_id: str) -> schemas.ResultadoAccion:
    p = _sacar(propuesta_id, ctx.usuario)
    if p is None:
        return schemas.ResultadoAccion(ok=False, texto="Esa propuesta ya venció o no es tuya. Pídemelo de nuevo.")
    try:
        texto = HERRAMIENTAS[p.herramienta].ejecutar(ctx, **p.args)
    except (ValueError, TypeError) as e:
        return schemas.ResultadoAccion(ok=False, texto=f"No se pudo: {e}")
    log.info("agente confirmado usuario=%s %s %s", ctx.usuario, p.herramienta, ctx.nota)
    return schemas.ResultadoAccion(ok=True, texto=texto, nota=ctx.nota)


def cancelar(usuario: str, propuesta_id: str) -> None:
    _sacar(propuesta_id, usuario)
