"""Cargar el inventario hablando o con fotos (IA, 20-oct).

El dueño arranca de cero y tiene la mercancia y las recetas en la cabeza o en
un cuaderno. Teclear ficha por ficha, preparacion por preparacion y receta
por receta es lo que hace que la carga se quede a medias. Aqui la persona
escribe (o dicta con el microfono del teclado) o manda fotos del cuaderno, y
la IA devuelve una PROPUESTA: que mercancia hay, que preparaciones con que
rinde, y que lleva cada producto del menu.

Las tres piezas, separadas a proposito (como en lectura_facturas.py):
  1. `leer`: quien lee (de prueba o Gemini) devuelve un PropuestaCarga por
     NOMBRES. No sabe nada de la base.
  2. `revisar`: cruza la propuesta con lo que ya existe --la mercancia que ya
     esta, el producto del menu al que se refiere, la unidad de cada ficha--
     y marca lo dudoso. No guarda nada.
  3. `guardar`: lo que la persona aprobo, en UNA transaccion: o entra todo o
     no entra nada. Con las mismas reglas que las pantallas de siempre (sin
     duplicados, que va en una preparacion y que en una receta).

El stock NO se carga por aqui: se cuenta con el conteo fisico o entra con
la compra. Asi esta carga no toca la contabilidad.
"""

import base64
import datetime
import difflib
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import httpx
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.orm import Session

from . import lectura_facturas, models, schemas, settings
from .texto import clave_de_nombre, nombre_limpio

log = logging.getLogger("erp.asistente")


class ErrorDeLectura(Exception):
    """No se pudo leer. El mensaje es para quien esta cargando."""


@dataclass
class Lectura:
    propuesta: schemas.PropuestaCarga
    modelo: str = ""
    tokens_entrada: int = 0
    tokens_salida: int = 0


def lector_activo() -> Optional[str]:
    """El mismo interruptor que la lectura de facturas: si esa esta apagada,
    esta tambien. Gemini sin clave cuenta como apagado."""
    return lectura_facturas.lector_activo()


# ── 1. Leer ──────────────────────────────────────────────────────────────────


def leer(db: Session, texto: str, archivos: List[Tuple[bytes, str]]) -> Lectura:
    nombre = lector_activo()
    if nombre is None:
        raise ErrorDeLectura("La carga con IA no está activada.")
    if not (texto or "").strip() and not archivos:
        raise ErrorDeLectura("Escribe lo que tienes o agrega una foto.")
    if nombre == "prueba":
        return Lectura(propuesta=_propuesta_de_prueba(), modelo="prueba")
    return _leer_con_gemini(db, texto, archivos)


def _propuesta_de_prueba() -> schemas.PropuestaCarga:
    """Siempre la misma, sin llamar a nadie: para probar la pantalla.

    Ejercita lo que importa: una preparacion cuya receta se dice por tanda
    (1 kg de pollo da 0,8 kg de guiso), cantidades en gramos para fichas en
    kg, un producto que hay que buscar en el menu, y una duda."""
    L = schemas.LineaPropuesta
    return schemas.PropuestaCarga(
        mercancias=[
            schemas.MercanciaPropuesta(nombre="Pollo", tipo="insumo", unidad="kg", costo_unitario=4.5),
            schemas.MercanciaPropuesta(nombre="Cebolla", tipo="insumo", unidad="kg", costo_unitario=1.2, exento=True),
            schemas.MercanciaPropuesta(nombre="Disco de masa", tipo="insumo", unidad="unidad", costo_unitario=0.12),
            schemas.MercanciaPropuesta(nombre="Vaso 12 oz", tipo="consumible", unidad="unidad", costo_unitario=0.05),
            schemas.MercanciaPropuesta(nombre="Servilleta", tipo="desechable", unidad="unidad"),
        ],
        preparaciones=[
            schemas.PreparacionPropuesta(
                nombre="Guiso de pollo", unidad="kg", rinde=0.8,
                lineas=[L(mercancia="Pollo", cantidad=1, unidad="kg"), L(mercancia="Cebolla", cantidad=200, unidad="g")],
            ),
        ],
        recetas=[
            schemas.RecetaPropuesta(
                producto="Pastelito de pollo",
                lineas=[L(mercancia="Disco de masa", cantidad=1, unidad="unidad"),
                        L(mercancia="Guiso de pollo", cantidad=50, unidad="g")],
            ),
        ],
        dudas=["¿El guiso lleva aceite? Si es el de freír, no va en la receta: se reparte aparte."],
    )


INSTRUCCIONES = """Eres el asistente de inventario de un negocio de comida en Venezuela.
El dueño te cuenta (en texto o en fotos de su cuaderno) que mercancia usa, que
prepara en la cocina y que lleva cada producto que vende. Arma con eso una
propuesta para cargar en el sistema. Hoy es {hoy}.

Que es cada cosa:
- mercancias: lo que se COMPRA. tipo "insumo" (materia prima de recetas:
  carne, harina, queso), "reventa" (se vende tal cual: un refresco en lata),
  "consumible" (empaque que va con el producto: vaso, pitillo, caja) o
  "desechable" (servilletas, bolsas, limpieza: no va en recetas). unidad:
  "kg", "lt" o "unidad" (lo que se cuenta de uno en uno). costo_unitario en
  dolares por esa unidad SOLO si te lo dijeron; si no, null.
- preparaciones: lo que se HACE en la cocina con mercancia (un guiso, una
  salsa, una masa). lineas = lo que lleva UNA TANDA tal como la describieron,
  y rinde = cuanto sale de esa tanda en la unidad de la preparacion. Si no
  dijeron cuanto rinde, pon la suma de lo que lleva y dilo en dudas.
- recetas: que lleva UNA unidad de cada producto que se vende. producto: el
  nombre como lo dijeron (si dicen variante, "Pastelito - Carne").

Reglas:
- Cada renglon dice mercancia (el nombre EXACTO de una mercancia o
  preparacion de esta propuesta o de las que ya existen), cantidad y unidad
  tal como la dijeron ("kg", "g", "lt", "ml" o "unidad").
- Si algo ya existe en la lista de abajo, usa ESE nombre y no lo vuelvas a
  poner en mercancias.
- No inventes cantidades, costos ni productos. Lo que no este claro va en
  dudas, en español, una pregunta corta por cosa.
- El aceite de freir no va en ninguna receta: el sistema lo reparte aparte.
  Si lo nombran, ponlo como mercancia y aclaralo en dudas.

Mercancia que ya existe (nombre, unidad, tipo):
{existentes}

Productos del menu:
{menu}
{texto}"""

_T = {"type": "STRING"}
_LINEA = {
    "type": "OBJECT",
    "properties": {"mercancia": _T, "cantidad": {"type": "NUMBER"}, "unidad": {"type": "STRING", "enum": ["kg", "g", "lt", "ml", "unidad"]}},
    "required": ["mercancia", "cantidad", "unidad"],
}
ESQUEMA = {
    "type": "OBJECT",
    "properties": {
        "mercancias": {"type": "ARRAY", "items": {
            "type": "OBJECT",
            "properties": {
                "nombre": _T,
                "tipo": {"type": "STRING", "enum": ["insumo", "reventa", "consumible", "desechable"]},
                "unidad": {"type": "STRING", "enum": ["kg", "lt", "unidad"]},
                "costo_unitario": {"type": "NUMBER", "nullable": True},
                "exento": {"type": "BOOLEAN"},
            },
            "required": ["nombre", "tipo", "unidad", "costo_unitario", "exento"],
        }},
        "preparaciones": {"type": "ARRAY", "items": {
            "type": "OBJECT",
            "properties": {
                "nombre": _T,
                "unidad": {"type": "STRING", "enum": ["kg", "lt", "unidad"]},
                "rinde": {"type": "NUMBER"},
                "lineas": {"type": "ARRAY", "items": _LINEA},
            },
            "required": ["nombre", "unidad", "rinde", "lineas"],
        }},
        "recetas": {"type": "ARRAY", "items": {
            "type": "OBJECT",
            "properties": {"producto": _T, "lineas": {"type": "ARRAY", "items": _LINEA}},
            "required": ["producto", "lineas"],
        }},
        "dudas": {"type": "ARRAY", "items": _T},
    },
    "required": ["mercancias", "preparaciones", "recetas", "dudas"],
}


def _contexto(db: Session) -> Tuple[str, str]:
    existentes = [
        f"- {i.nombre} ({i.unidad}, {i.tipo})"
        for i in db.query(models.Ingrediente).filter(models.Ingrediente.activo.is_(True)).order_by(models.Ingrediente.nombre)
    ]
    menu = [f"- {v.nombre}" for v in variantes_del_menu(db)]
    return "\n".join(existentes) or "(todavia no hay ninguna)", "\n".join(menu) or "(el menu esta vacio)"


def _leer_con_gemini(db: Session, texto: str, archivos: List[Tuple[bytes, str]]) -> Lectura:
    existentes, menu = _contexto(db)
    partes = [{"inline_data": {"mime_type": tipo, "data": base64.b64encode(dato).decode()}} for dato, tipo in archivos]
    partes.append({"text": INSTRUCCIONES.format(
        hoy=datetime.date.today().isoformat(), existentes=existentes, menu=menu,
        texto=f"\nLo que escribio el dueño:\n{texto.strip()}" if (texto or "").strip() else "",
    )})
    cuerpo = {
        "contents": [{"role": "user", "parts": partes}],
        "generationConfig": {
            "response_mime_type": "application/json",
            "response_schema": ESQUEMA,
            "temperature": 0,
            "thinkingConfig": {"includeThoughts": True},
        },
    }
    # El modelo preciso: aqui hay que entender recetas, no transcribir.
    modelo = settings.GEMINI_MODELO_RESPALDO or settings.GEMINI_MODELO
    respuesta = None
    for espera in (0,) + lectura_facturas.ESPERAS_REINTENTO_S:
        if espera:
            time.sleep(espera)
        try:
            respuesta = lectura_facturas._llamar(lectura_facturas.GEMINI_URL.format(modelo=modelo), cuerpo)
        except httpx.TimeoutException:
            raise ErrorDeLectura("La IA tardó demasiado. Intenta con menos cosas a la vez.")
        except httpx.HTTPError as e:
            log.warning("Gemini %s: fallo la conexion (%s)", modelo, e)
            continue
        if respuesta.status_code not in lectura_facturas.ESTADOS_PASAJEROS:
            break
    if respuesta is None or respuesta.status_code != 200:
        if respuesta is not None:
            log.warning("Gemini %s respondio %s: %s", modelo, respuesta.status_code, respuesta.text[:500])
        mensaje = lectura_facturas._MENSAJE_POR_ESTADO.get(respuesta.status_code if respuesta else 0)
        raise ErrorDeLectura(mensaje or "La IA no está disponible ahora. Intenta en unos minutos.")
    datos = respuesta.datos
    candidatos = datos.get("candidates") or []
    partes_r = (candidatos[0].get("content") or {}).get("parts", []) if candidatos else []
    salida = "".join(p.get("text", "") for p in partes_r if not p.get("thought"))
    try:
        propuesta = schemas.PropuestaCarga(**json.loads(lectura_facturas._sin_bloque(salida)))
    except (json.JSONDecodeError, ValidationError, TypeError) as e:
        log.warning("La IA devolvio algo que no es una propuesta: %s / %s", e, salida[:300])
        raise ErrorDeLectura("La IA no devolvió una propuesta clara. Prueba otra vez, con menos cosas a la vez.")
    uso = datos.get("usageMetadata") or {}
    return Lectura(
        propuesta=propuesta, modelo=modelo,
        tokens_entrada=int(uso.get("promptTokenCount") or 0),
        tokens_salida=int(uso.get("candidatesTokenCount") or 0) + int(uso.get("thoughtsTokenCount") or 0),
    )


# ── 2. Revisar ───────────────────────────────────────────────────────────────

# Lo que se dijo en una unidad y la ficha lleva en otra: cuanto vale uno.
_FACTOR = {("g", "kg"): 0.001, ("kg", "g"): 1000, ("ml", "lt"): 0.001, ("lt", "ml"): 1000}
# Parecido minimo para sugerir "¿es esta?" (difflib, 0 a 1).
PARECIDO_MINIMO = 0.75


def convertir(cantidad: float, de: str, a: str) -> Optional[float]:
    if de == a:
        return cantidad
    factor = _FACTOR.get((de, a))
    return None if factor is None else cantidad * factor


def _parecidas(nombre: str, opciones: List[str], cuantas: int = 3) -> List[str]:
    clave = clave_de_nombre(nombre)
    puntuadas = sorted(
        ((difflib.SequenceMatcher(None, clave, clave_de_nombre(o)).ratio(), o) for o in opciones),
        reverse=True,
    )
    return [o for r, o in puntuadas[:cuantas] if r >= PARECIDO_MINIMO]


def variantes_del_menu(db: Session) -> List[schemas.VarianteDelMenu]:
    """Cada variante activa con el nombre con que la diria el dueño: el
    producto solo si tiene una, "Producto · Variante" si tiene varias."""
    con_receta = {v for (v,) in db.query(models.RecetaItem.variante_id).distinct()}
    salida = []
    productos = db.query(models.Producto).filter(models.Producto.activo.isnot(False)).order_by(models.Producto.nombre)
    for p in productos:
        activas = [v for v in p.variantes if v.activo is not False]
        for v in activas:
            nombre = p.nombre if len(activas) == 1 else f"{p.nombre} · {v.nombre}"
            salida.append(schemas.VarianteDelMenu(id=v.id, nombre=nombre, tiene_receta=v.id in con_receta))
    return salida


@dataclass
class _Conocida:
    nombre: str
    unidad: str
    tipo: str


@dataclass
class _Catalogo:
    """Todo lo que un renglon puede nombrar: lo que ya existe y lo nuevo de
    esta carga, por clave de nombre."""

    por_clave: Dict[str, _Conocida] = field(default_factory=dict)

    def agregar(self, nombre: str, unidad: str, tipo: str) -> None:
        self.por_clave.setdefault(clave_de_nombre(nombre), _Conocida(nombre_limpio(nombre), unidad, tipo))

    def buscar(self, nombre: str) -> Optional[_Conocida]:
        return self.por_clave.get(clave_de_nombre(nombre))

    def nombres(self) -> List[str]:
        return sorted(c.nombre for c in self.por_clave.values())


def _catalogo(db: Session, propuesta: schemas.PropuestaCarga) -> _Catalogo:
    cat = _Catalogo()
    for i in db.query(models.Ingrediente).filter(models.Ingrediente.activo.is_(True)):
        cat.agregar(i.nombre, i.unidad, i.tipo)
    for m in propuesta.mercancias:
        cat.agregar(m.nombre, m.unidad, m.tipo)
    for p in propuesta.preparaciones:
        cat.agregar(p.nombre, p.unidad, "preparacion")
    return cat


# Que puede ir donde: lo mismo que validan preparaciones.py e inventario.py.
_EN_PREPARACION = {"insumo", "consumible", "preparacion"}
_EN_RECETA = {"insumo", "reventa", "consumible", "preparacion"}


def _revisar_linea(cat: _Catalogo, linea: schemas.LineaPropuesta, permitidos: set, donde: str) -> schemas.LineaRevisada:
    r = schemas.LineaRevisada(**linea.model_dump())
    c = cat.buscar(linea.mercancia)
    if c is None:
        sugeridas = _parecidas(linea.mercancia, cat.nombres(), 1)
        r.problema = (
            f"No está en la lista: ¿es «{sugeridas[0]}»?" if sugeridas
            else "No está en la lista: agrégala como mercancía o elige otra."
        )
        return r
    r.se_usa, r.unidad_ficha = c.nombre, c.unidad
    if c.tipo not in permitidos:
        r.problema = (
            "Un desechable no va en recetas: va directo a gasto." if c.tipo == "desechable"
            else f"Una mercancía de reventa no va dentro de una {donde}."
        )
        return r
    convertida = convertir(linea.cantidad, linea.unidad, c.unidad)
    if convertida is None:
        r.problema = f"Dice {linea.unidad} y {c.nombre} se lleva en {c.unidad}: corrige la cantidad."
        return r
    r.cantidad_ficha = round(convertida, 6)
    return r


def _buscar_variante(nombre: str, variantes: List[schemas.VarianteDelMenu]) -> Optional[schemas.VarianteDelMenu]:
    clave = clave_de_nombre(nombre.replace("-", " · "))
    for v in variantes:
        if clave_de_nombre(v.nombre) == clave:
            return v
    parecidas = _parecidas(nombre, [v.nombre for v in variantes], 1)
    return next((v for v in variantes if parecidas and v.nombre == parecidas[0]), None)


def revisar(db: Session, propuesta: schemas.PropuestaCarga, lector: str = "") -> schemas.PropuestaRevisada:
    from .routers.inventario import _gemela

    cat = _catalogo(db, propuesta)
    existentes = [i.nombre for i in db.query(models.Ingrediente).filter(models.Ingrediente.activo.is_(True))]
    variantes = variantes_del_menu(db)
    por_id = {v.id: v for v in variantes}

    mercancias = []
    for m in propuesta.mercancias:
        r = schemas.MercanciaRevisada(**m.model_dump())
        r.nombre = nombre_limpio(m.nombre)
        gemela = _gemela(db, r.nombre)
        if gemela:
            r.ya_existe = f"{gemela.nombre} ({gemela.unidad})"
        else:
            r.parecidas = _parecidas(r.nombre, existentes)
        mercancias.append(r)

    preparaciones = []
    for p in propuesta.preparaciones:
        gemela = _gemela(db, p.nombre)
        preparaciones.append(schemas.PreparacionRevisada(
            nombre=nombre_limpio(p.nombre), unidad=p.unidad, rinde=p.rinde,
            lineas=[_revisar_linea(cat, l, _EN_PREPARACION, "preparación") for l in p.lineas],
            ya_existe=f"{gemela.nombre} ({gemela.unidad})" if gemela else None,
        ))

    recetas = []
    for rc in propuesta.recetas:
        v = por_id.get(rc.variante_id) if rc.variante_id else _buscar_variante(rc.producto, variantes)
        recetas.append(schemas.RecetaRevisada(
            producto=rc.producto,
            variante_id=v.id if v else None,
            variante_nombre=v.nombre if v else "",
            tiene_receta=bool(v and v.tiene_receta),
            lineas=[_revisar_linea(cat, l, _EN_RECETA, "receta") for l in rc.lineas],
        ))

    return schemas.PropuestaRevisada(
        mercancias=mercancias, preparaciones=preparaciones, recetas=recetas,
        dudas=propuesta.dudas, variantes=variantes, mercancias_conocidas=cat.nombres(), lector=lector,
    )


# ── 3. Guardar ───────────────────────────────────────────────────────────────


def _ficha(db: Session, nombre: str) -> Optional[models.Ingrediente]:
    from .routers.inventario import _gemela

    return _gemela(db, nombre)


def _lineas_a_ids(db: Session, lineas: List[schemas.LineaPropuesta], donde: str) -> Dict[int, float]:
    """{id de la ficha: cantidad en SU unidad}, sumando lo repetido. Falla
    con un mensaje para la persona si un renglon no se puede guardar."""
    ids: Dict[int, float] = {}
    for l in lineas:
        ing = _ficha(db, l.mercancia)
        if ing is None:
            raise HTTPException(status_code=400, detail=f"{donde}: «{l.mercancia}» no está entre la mercancía.")
        cantidad = convertir(l.cantidad, l.unidad, ing.unidad)
        if cantidad is None:
            raise HTTPException(
                status_code=400,
                detail=f"{donde}: «{ing.nombre}» se lleva en {ing.unidad} y el renglón dice {l.unidad}.",
            )
        ids[ing.id] = ids.get(ing.id, 0) + cantidad
    return ids


def guardar(db: Session, carga: schemas.PropuestaCarga) -> schemas.ResultadoCarga:
    """Todo o nada: si algo no se puede guardar, no queda nada a medias."""
    from .routers import inventario as inv
    from .routers import preparaciones as prep

    hecho = schemas.ResultadoCarga()
    try:
        # Mercancia nueva. Lo que ya existe se usa, no se duplica.
        for m in carga.mercancias:
            nombre = nombre_limpio(m.nombre)
            if not nombre:
                continue
            gemela = _ficha(db, nombre)
            if gemela:
                hecho.omitidas.append(f"{nombre}: ya existía como «{gemela.nombre}», se usó esa.")
                continue
            db.add(models.Ingrediente(
                nombre=nombre, unidad=m.unidad, tipo=m.tipo, costo_unitario=m.costo_unitario or 0,
                exento=m.exento, stock_actual=0, activo=True, rendimiento_pct=100.0,
            ))
            db.flush()
            hecho.mercancias.append(nombre)

        # Preparaciones: una puede llevar otra (la salsa dentro del guiso), asi
        # que se crean en el orden en que sus renglones ya existen.
        pendientes = list(carga.preparaciones)
        while pendientes:
            avanzo = False
            for p in list(pendientes):
                if any(_ficha(db, l.mercancia) is None for l in p.lineas):
                    continue
                pendientes.remove(p)
                avanzo = True
                nombre = nombre_limpio(p.nombre)
                if _ficha(db, nombre):
                    hecho.omitidas.append(f"{nombre}: esa preparación ya existe; su receta no se cambió.")
                    continue
                por_tanda = _lineas_a_ids(db, p.lineas, nombre)
                lineas = [schemas.LineaPreparacionInput(ingrediente_id=i, cantidad=round(c / p.rinde, 6)) for i, c in por_tanda.items()]
                prep._validar_lineas(db, None, lineas)
                nueva = models.Ingrediente(
                    nombre=nombre, unidad=p.unidad, tipo="preparacion", rinde=1.0, modo_produccion="descontar",
                    rendimiento_pct=100.0, stock_actual=0, costo_unitario=0, activo=True,
                )
                db.add(nueva)
                db.flush()
                prep._guardar_lineas(nueva, lineas)
                db.flush()
                nueva.costo_unitario = round(nueva.costo_estandar, 4)
                hecho.preparaciones.append(nombre)
            if not avanzo:
                faltan = ", ".join(nombre_limpio(p.nombre) for p in pendientes)
                raise HTTPException(status_code=400, detail=f"No se pudo armar {faltan}: lleva algo que no está entre la mercancía.")

        # Recetas del menu.
        for r in carga.recetas:
            if not r.variante_id:
                hecho.omitidas.append(f"{r.producto}: no se eligió a qué producto del menú va.")
                continue
            variante = db.get(models.Variante, r.variante_id)
            if variante is None:
                raise HTTPException(status_code=400, detail=f"{r.producto}: ese producto del menú ya no existe.")
            if db.query(models.ComboItem).filter(models.ComboItem.combo_variante_id == variante.id).count():
                hecho.omitidas.append(f"{r.producto}: es un combo, su receta sale de los productos que lleva.")
                continue
            items = _lineas_a_ids(db, r.lineas, r.producto)
            inv._guardar_receta(db, variante.id, [(i, round(c, 6)) for i, c in items.items()])
            inv._rearmar_combos_con(db, variante.id)
            hecho.recetas.append(r.producto)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return hecho
