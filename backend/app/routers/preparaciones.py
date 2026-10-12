"""Preparaciones, produccion y los numeros que salen de ellas.

Ver docs/plan-compras-inventario-produccion.md (fases 2 a 4). En corto:

  - Una PREPARACION (el guiso de pollo) es una mercancia mas, de tipo
    "preparacion", con su receta POR UNO: lo que lleva 1 kg (o 1 lt, o 1
    unidad). El pastelito dice "50 g de guiso" y no "5 g de cebolla"; al
    venderlo, el sistema baja por la receta hasta la materia prima
    (costeo.explotar).
  - La PRODUCCION es opcional: solo las preparaciones en modo "producir"
    registran tandas, con su rendimiento real.
  - COSTO TEORICO vs REAL: lo que debio gastarse segun recetas contra lo que
    dice el conteo. Es el control que no depende de que la cocina anote.
  - COSTOS INDIRECTOS: el aceite de freir se carga a la freidora y se reparte
    por pieza frita.
"""

import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import contabilidad, costeo, kardex, models, schemas
from ..database import get_db
from ..texto import nombre_limpio
from ..timeutils import ahora, hoy, inicio_del_dia
from . import operadores
from .inventario import _gemela, _ingrediente_para_actualizar, anotar_merma

router = APIRouter(prefix="/api/inventario", tags=["preparaciones"])

# Lo que puede ir dentro de una preparacion: materia prima, empaques que la
# acompañan y otras preparaciones (la salsa dentro del guiso). No la reventa
# (se vende tal cual), ni los desechables (no llevan stock), ni el aceite de
# freir (se reparte aparte, ver costo indirecto).
TIPOS_EN_PREPARACION = {"insumo", "consumible", "preparacion"}

# Lo que puede ir en la receta de un producto del menu.
TIPOS_EN_RECETA = {"insumo", "reventa", "consumible", "preparacion"}


def _rango(desde: Optional[datetime.date], hasta: Optional[datetime.date], dias: int = 30):
    hasta = hasta or hoy()
    desde = desde or (hasta - datetime.timedelta(days=dias))
    return inicio_del_dia(desde), inicio_del_dia(hasta + datetime.timedelta(days=1))


# ── Preparaciones ───────────────────────────────────────────────────────────


def _contiene(ingrediente: models.Ingrediente, buscado_id: int, visitados=frozenset()) -> bool:
    """Si `ingrediente` lleva (directa o indirectamente) a `buscado_id`."""
    if ingrediente.id == buscado_id:
        return True
    if ingrediente.tipo != "preparacion" or ingrediente.id in visitados:
        return False
    dentro = visitados | {ingrediente.id}
    return any(_contiene(linea.ingrediente, buscado_id, dentro) for linea in ingrediente.lineas_preparacion)


def _a_schema(db: Session, prep: models.Ingrediente) -> schemas.Preparacion:
    lineas = [
        schemas.LineaPreparacion(
            ingrediente_id=linea.ingrediente_id,
            nombre=linea.ingrediente.nombre,
            unidad=linea.ingrediente.unidad,
            tipo=linea.ingrediente.tipo,
            cantidad=linea.cantidad,
            costo=round(linea.cantidad * models._costo_de(linea.ingrediente, frozenset({prep.id})), 4),
        )
        for linea in prep.lineas_preparacion
    ]
    costo_tanda = round(sum(linea.costo for linea in lineas), 4)
    # Rendimiento real: lo que salio sobre lo esperado, en las ultimas 10.
    tandas = (
        db.query(models.Produccion)
        .filter(models.Produccion.preparacion_id == prep.id, models.Produccion.cantidad_esperada > 0)
        .order_by(models.Produccion.id.desc())
        .limit(10)
        .all()
    )
    salio = sum(t.cantidad for t in tandas)
    esperado = sum(t.cantidad_esperada for t in tandas)
    return schemas.Preparacion(
        id=prep.id,
        nombre=prep.nombre,
        unidad=prep.unidad,
        rinde=prep.rinde_real or 1,
        modo_produccion=prep.modo_produccion or "descontar",
        vida_util_horas=prep.vida_util_horas,
        stock_actual=round(prep.stock_actual or 0, 4),
        lineas=lineas,
        costo_tanda=costo_tanda,
        costo_unitario=round(costo_tanda / (prep.rinde_real or 1), 4),
        rendimiento_real=round(salio / esperado, 4) if esperado else None,
        tandas=len(tandas),
    )


def _validar_lineas(db: Session, prep_id: Optional[int], lineas: List[schemas.LineaPreparacionInput]):
    if not lineas:
        raise HTTPException(status_code=400, detail="La preparación necesita al menos un ingrediente.")
    ids = [linea.ingrediente_id for linea in lineas]
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=400, detail="Un ingrediente aparece dos veces: súmalo en una sola línea.")
    for linea in lineas:
        ing = db.get(models.Ingrediente, linea.ingrediente_id)
        if ing is None or not ing.activo:
            raise HTTPException(status_code=400, detail=f"La mercancía {linea.ingrediente_id} no existe o está archivada.")
        if ing.tipo not in TIPOS_EN_PREPARACION or ing.es_indirecto:
            raise HTTPException(
                status_code=400,
                detail=f"«{ing.nombre}» no puede ir dentro de una preparación: solo materia prima, empaques u otras preparaciones.",
            )
        if prep_id is not None and _contiene(ing, prep_id):
            raise HTTPException(status_code=400, detail=f"«{ing.nombre}» ya lleva esta preparación: se contendría a sí misma.")


def _guardar_lineas(prep: models.Ingrediente, lineas: List[schemas.LineaPreparacionInput]):
    prep.lineas_preparacion.clear()
    for linea in lineas:
        prep.lineas_preparacion.append(
            models.LineaPreparacion(ingrediente_id=linea.ingrediente_id, cantidad=linea.cantidad)
        )


@router.get("/preparaciones", response_model=List[schemas.Preparacion])
def listar_preparaciones(db: Session = Depends(get_db)):
    preps = (
        db.query(models.Ingrediente)
        .filter(models.Ingrediente.tipo == "preparacion", models.Ingrediente.activo.isnot(False))
        .order_by(models.Ingrediente.nombre)
        .all()
    )
    return [_a_schema(db, p) for p in preps]


@router.post("/preparaciones", response_model=schemas.Preparacion)
def crear_preparacion(body: schemas.PreparacionInput, db: Session = Depends(get_db)):
    nombre = nombre_limpio(body.nombre)
    if not nombre:
        raise HTTPException(status_code=400, detail="La preparación necesita un nombre.")
    gemela = _gemela(db, nombre)
    if gemela:
        raise HTTPException(status_code=409, detail=f"Ya existe «{gemela.nombre}». Ponle un nombre distinto.")
    _validar_lineas(db, None, body.lineas)
    prep = models.Ingrediente(
        nombre=nombre,
        unidad=body.unidad,
        tipo="preparacion",
        # La receta es por uno: lo que rinde es, por definicion, 1.
        rinde=1.0,
        modo_produccion=body.modo_produccion,
        vida_util_horas=body.vida_util_horas,
        # La merma de cocinar vive en `rinde`; un rendimiento aparte la
        # contaria dos veces (ver costeo.consumo_bruto).
        rendimiento_pct=100.0,
        stock_actual=0,
        costo_unitario=0,
        activo=True,
    )
    db.add(prep)
    db.flush()
    _guardar_lineas(prep, body.lineas)
    db.flush()
    prep.costo_unitario = round(prep.costo_estandar, 4)
    db.commit()
    db.refresh(prep)
    return _a_schema(db, prep)


@router.put("/preparaciones/{prep_id}", response_model=schemas.Preparacion)
def actualizar_preparacion(prep_id: int, body: schemas.PreparacionInput, db: Session = Depends(get_db)):
    """Cambiar la receta. La cocina afina estos numeros con el tiempo: el
    sistema escala con lo ultimo que se guardo."""
    prep = db.get(models.Ingrediente, prep_id)
    if prep is None or prep.tipo != "preparacion":
        raise HTTPException(status_code=404, detail="Preparación no encontrada")
    nombre = nombre_limpio(body.nombre)
    gemela = _gemela(db, nombre, salvo_id=prep_id)
    if gemela:
        raise HTTPException(status_code=409, detail=f"Ya existe «{gemela.nombre}». Ponle un nombre distinto.")
    if prep.modo_produccion == "producir" and body.modo_produccion == "descontar" and (prep.stock_actual or 0) > 0.0001:
        raise HTTPException(
            status_code=409,
            detail=f"Hay {prep.stock_actual:g} {prep.unidad} producidos: úsalos o anótalos como merma antes de dejar de producirla.",
        )
    _validar_lineas(db, prep_id, body.lineas)
    prep.nombre = nombre
    prep.unidad = body.unidad
    prep.rinde = 1.0
    prep.modo_produccion = body.modo_produccion
    prep.vida_util_horas = body.vida_util_horas
    prep.rendimiento_pct = 100.0
    _guardar_lineas(prep, body.lineas)
    db.flush()
    if prep.modo_produccion != "producir" or (prep.stock_actual or 0) <= 0:
        prep.costo_unitario = round(prep.costo_estandar, 4)
    db.commit()
    db.refresh(prep)
    return _a_schema(db, prep)


# ── Produccion ──────────────────────────────────────────────────────────────


def _produccion_a_schema(p: models.Produccion) -> schemas.ProduccionOut:
    return schemas.ProduccionOut(
        id=p.id,
        fecha=p.fecha,
        preparacion_id=p.preparacion_id,
        preparacion=p.preparacion.nombre,
        unidad=p.preparacion.unidad,
        cantidad=p.cantidad,
        cantidad_esperada=p.cantidad_esperada,
        rendimiento_real=p.rendimiento_real,
        costo_total=p.costo_total,
    )


@router.post("/produccion", response_model=schemas.ProduccionOut)
def registrar_produccion(body: schemas.ProduccionInput, request: Request, db: Session = Depends(get_db)):
    """Una tanda: sale lo que se uso, entra lo que salio.

    Lo que se uso, si no se dice, es la receta escalada a lo que salio (como
    si hubiera rendido exacto). Si se dice ("use 3 kg de pollo"), se compara
    lo que salio con lo que la receta esperaba de eso: ese es el rendimiento
    real que despues sugiere corregir el estandar.

    El valor no cambia, se transforma: lo que sale del crudo entra en la
    preparacion al mismo costo total. Las dos viven en el inventario (1040):
    no hay asiento. Si el crudo no alcanza se avisa primero (casi siempre es
    un numero mal escrito); confirmando (`forzar`) se registra igual y queda
    en negativo: el conteo lo corrige, la cocina no se traba.
    """
    quien = operadores.del_turno(db, request)
    operador_id = quien.id if quien else None
    with costeo.bloqueo_inventario():
        prep = _ingrediente_para_actualizar(db, body.preparacion_id)
        if prep.tipo != "preparacion":
            raise HTTPException(status_code=400, detail="Solo se producen preparaciones.")
        if prep.modo_produccion != "producir":
            raise HTTPException(
                status_code=400,
                detail=f"«{prep.nombre}» se descuenta del crudo al vender. Para anotar tandas, cámbiala a «se produce».",
            )
        receta = {linea.ingrediente_id: linea for linea in prep.lineas_preparacion}
        if not receta:
            raise HTTPException(status_code=400, detail="Esta preparación no tiene receta todavía.")
        rinde = prep.rinde_real or 1

        if body.usado:
            usado = {u.ingrediente_id: u.cantidad for u in body.usado}
        else:
            usado = {iid: linea.cantidad * body.cantidad / rinde for iid, linea in receta.items()}

        # Lo que se esperaba sacar con lo usado: por el ingrediente que mas
        # pesa en el costo de la receta (en el guiso, el pollo). Promediar
        # todos mezclaria el pollo con la sal.
        principal = max(
            receta.values(),
            key=lambda linea: linea.cantidad * models._costo_de(linea.ingrediente, frozenset({prep.id})),
        )
        escala = usado.get(principal.ingrediente_id, 0) / principal.cantidad if principal.cantidad else 0
        esperado = round(escala * rinde, 4)

        nota = f"Producción de {prep.nombre}: {body.cantidad:g} {prep.unidad}"
        # Todos primero y despues se mueven: buscar uno a uno refresca la
        # sesion y perderia lo que ya se le saco al anterior.
        usados = []
        for iid, cantidad in usado.items():
            if cantidad > 0:
                usados.append((_ingrediente_para_actualizar(db, iid), cantidad))
        prep = db.get(models.Ingrediente, prep.id)
        consumo = {}
        for ing, cantidad in usados:
            # Lo usado puede ser otra preparacion que se descuenta del crudo:
            # entonces sale su materia prima.
            for hoja, q in costeo.explotar(ing, cantidad).items():
                consumo[hoja] = consumo.get(hoja, 0) + q
        faltan = [
            f"{hoja.nombre} (hay {max(hoja.stock_actual or 0, 0):g} {hoja.unidad}, la tanda usa {q:g})"
            for hoja, q in consumo.items()
            if q > (hoja.stock_actual or 0) + 1e-6
        ]
        if faltan and not body.forzar:
            raise HTTPException(status_code=409, detail="No alcanza: " + "; ".join(faltan) + ".")
        costo_total = 0.0
        for hoja, q in consumo.items():
            costo = hoja.costo_unitario or 0
            kardex.anotar(
                db, hoja, -q, kardex.PRODUCCION, costo_unitario=costo,
                origen="produccion", referencia_id=prep.id, nota=nota, operador_id=operador_id,
            )
            costo_total += q * costo

        costo_total = round(costo_total, 4)
        produccion = models.Produccion(
            preparacion_id=prep.id,
            cantidad=body.cantidad,
            cantidad_esperada=esperado,
            escala=round(escala, 6),
            principal_id=principal.ingrediente_id,
            usado_principal=round(usado.get(principal.ingrediente_id, 0), 6),
            costo_total=costo_total,
            operador_id=operador_id,
            nota=body.nota,
        )
        db.add(produccion)
        db.flush()
        costeo.registrar_entrada(
            prep, body.cantidad, costo_total / body.cantidad, db,
            origen="produccion", referencia_id=produccion.id, nota=nota, tipo=kardex.PRODUCIDO,
        )
        db.commit()
        db.refresh(produccion)
        return _produccion_a_schema(produccion)


@router.get("/produccion", response_model=List[schemas.ProduccionOut])
def listar_produccion(
    desde: Optional[datetime.date] = Query(None),
    hasta: Optional[datetime.date] = Query(None),
    db: Session = Depends(get_db),
):
    inicio, fin = _rango(desde, hasta, dias=7)
    filas = (
        db.query(models.Produccion)
        .filter(models.Produccion.fecha >= inicio, models.Produccion.fecha < fin)
        .order_by(models.Produccion.id.desc())
        .limit(200)
        .all()
    )
    return [_produccion_a_schema(p) for p in filas]


@router.get("/preparaciones/vencidas", response_model=List[schemas.Preparacion])
def preparaciones_vencidas(db: Session = Depends(get_db)):
    """Las preparaciones producidas que ya pasaron su vida util y tienen
    existencia: lo que sobro y hay que botar (o confirmar que se uso).

    Se mira la ultima tanda: si salio hace mas horas que su vida util, lo que
    queda es de esa tanda o de antes.
    """
    ahora_ = ahora()
    vencidas = []
    for prep in (
        db.query(models.Ingrediente)
        .filter(
            models.Ingrediente.tipo == "preparacion",
            models.Ingrediente.modo_produccion == "producir",
            models.Ingrediente.vida_util_horas.isnot(None),
            models.Ingrediente.stock_actual > 0,
        )
        .all()
    ):
        ultima = db.query(func.max(models.Produccion.fecha)).filter(models.Produccion.preparacion_id == prep.id).scalar()
        if ultima is None or ultima + datetime.timedelta(hours=prep.vida_util_horas) <= ahora_:
            vencidas.append(_a_schema(db, prep))
    return vencidas


@router.post("/preparaciones/{prep_id}/sobrante", response_model=schemas.SobrantePreparacion)
def sobrante_preparacion(
    prep_id: int, body: schemas.SobrantePreparacionRequest, request: Request, db: Session = Depends(get_db)
):
    """Al cierre sobro guiso: se guarda para mañana o se bota.

    Guardar no mueve nada: la pantalla solo deja constancia de la decision.
    Botar es una merma de siempre (6020 contra 1040), pero depende de como
    vive la preparacion:

      - Si se PRODUCE, tiene stock propio y la merma es de ella misma, con
        tope en lo que hay (pedir botar 2 kg con 1,5 en existencia bota 1,5).
      - Si se DESCUENTA del crudo, nunca tuvo existencia: lo que se bota es
        el pollo y la cebolla que la receta dice que lleva ("almacen
        imaginario"), una merma por cada materia prima, todas con el mismo
        motivo. Asi el costo teorico ve la perdida donde de verdad ocurrio.
    """
    quien = operadores.del_turno(db, request)
    operador_id = quien.id if quien else None
    with costeo.bloqueo_inventario():
        prep = _ingrediente_para_actualizar(db, prep_id)
        if prep.tipo != "preparacion":
            raise HTTPException(status_code=404, detail="Preparación no encontrada")
        if body.accion == "guardar":
            return schemas.SobrantePreparacion(ok=True, movimientos=0)

        motivo = body.motivo or f"Sobró {prep.nombre}: se botó"
        if prep.modo_produccion == "producir":
            cantidad = round(min(body.cantidad, max(prep.stock_actual or 0, 0)), 4)
            a_botar = [(prep, cantidad)] if cantidad > 0 else []
        else:
            # Todos primero y despues se mueven: buscar uno a uno refresca la
            # sesion y perderia lo que ya se le saco al anterior.
            hojas = costeo.explotar(prep, body.cantidad, modo="receta")
            a_botar = [
                (_ingrediente_para_actualizar(db, hoja.id), round(q, 4))
                for hoja, q in hojas.items()
                if hoja.id != prep.id and q > 0
            ]

        detalle = []
        for ing, cantidad in a_botar:
            valor = anotar_merma(db, ing, cantidad, motivo, operador_id)
            detalle.append(
                schemas.SobranteDetalle(
                    ingrediente_id=ing.id, nombre=ing.nombre, cantidad=cantidad, unidad=ing.unidad, valor=valor,
                )
            )
        db.commit()
        return schemas.SobrantePreparacion(
            ok=True,
            movimientos=len(detalle),
            valor=round(sum(d.valor for d in detalle), 2),
            detalle=detalle,
        )


# ── Disponibilidad ──────────────────────────────────────────────────────────


# Desde cuantas tandas y cuanta diferencia vale la pena avisar.
TANDAS_PARA_AVISAR = 3
DESVIO_PARA_AVISAR = 0.05


def rendimientos_recientes(db: Session) -> List[schemas.RendimientoReal]:
    """Las preparaciones cuyas ultimas tandas rinden distinto de su receta.

    La receta dice que 1 kg de guiso lleva 1,43 kg de pollo y tres tandas
    seguidas salen al 88 %: si la preparacion se descuenta del crudo, esa
    diferencia se esconde en las ventas para siempre (8-oct, caso 21). Como
    la receta es POR UNO, lo que se propone es cuanto pollo lleva de verdad
    el kilo (1,61 kg), y lo esperado de cada tanda se recalcula con la
    receta de hoy: ajustada la receta, las tandas viejas dejan de avisar.
    """
    out = []
    for prep in db.query(models.Ingrediente).filter(models.Ingrediente.tipo == "preparacion", models.Ingrediente.activo.isnot(False)).all():
        tandas = (
            db.query(models.Produccion).filter(models.Produccion.preparacion_id == prep.id)
            .order_by(models.Produccion.fecha.desc()).limit(TANDAS_PARA_AVISAR).all()
        )
        por_1 = {l.ingrediente_id: l.cantidad for l in prep.lineas_preparacion if l.cantidad}

        def esperado(t):
            # Con lo que se uso del crudo principal y la receta de HOY.
            if t.principal_id in por_1 and t.usado_principal:
                return t.usado_principal / por_1[t.principal_id]
            return t.cantidad_esperada or 0

        validas = [t for t in tandas if esperado(t) > 0]
        if len(validas) < TANDAS_PARA_AVISAR:
            continue
        razon = sum(t.cantidad for t in validas) / sum(esperado(t) for t in validas)
        if abs(razon - 1) < DESVIO_PARA_AVISAR:
            continue
        fila = schemas.RendimientoReal(preparacion_id=prep.id, nombre=prep.nombre, tandas=len(validas), real_pct=round(razon * 100, 1))
        # El crudo que mas pesa en el costo de la receta: la ultima tanda ya lo
        # sabe; si no, el que mas cuesta.
        lineas = [l for l in prep.lineas_preparacion if l.ingrediente is not None and l.cantidad > 0]
        principal = next((l for l in lineas if l.ingrediente_id == validas[0].principal_id), None)
        if principal is None and lineas:
            principal = max(lineas, key=lambda l: l.cantidad * models._costo_de(l.ingrediente, frozenset({prep.id})))
        if principal is not None and razon > 0:
            fila.crudo_id = principal.ingrediente.id
            fila.crudo = principal.ingrediente.nombre
            fila.unidad = principal.ingrediente.unidad
            fila.receta_cantidad = round(principal.cantidad, 4)
            fila.sugerida_cantidad = round(principal.cantidad / razon, 4)
        out.append(fila)
    return out


@router.get("/preparaciones/rendimientos", response_model=List[schemas.RendimientoReal])
def listar_rendimientos(db: Session = Depends(get_db)):
    return rendimientos_recientes(db)


@router.get("/preparaciones/disponibilidad", response_model=List[schemas.Disponibilidad])
def disponibilidad(db: Session = Depends(get_db)):
    """Cuanto se podria hacer de cada preparacion con el crudo que hay.

    El pollo es UNO: si alcanza para 11 kg de guiso de pollo o para 9 de
    ranchero, no alcanza para los dos. Por eso el crudo que comparten se
    REPARTE (8-oct): a cada preparacion le toca segun lo que se vendio de
    ella en los ultimos 14 dias, o en partes iguales si todavia no hay
    ventas. `potencial` es lo que le toca; `potencial_solo`, lo que saldria
    si todo el crudo fuera para ella.
    """
    preps = (
        db.query(models.Ingrediente)
        .filter(models.Ingrediente.tipo == "preparacion", models.Ingrediente.activo.isnot(False))
        .order_by(models.Ingrediente.nombre)
        .all()
    )
    hojas_de: Dict[int, Dict[models.Ingrediente, float]] = {
        p.id: costeo.explotar(p, 1.0, modo="receta") for p in preps
    }
    uso = _uso_reciente(db, preps)
    # Quien usa cada crudo.
    usan: Dict[int, List[int]] = {}
    for p in preps:
        for h, q in hojas_de[p.id].items():
            if q > 0 and h.id != p.id:
                usan.setdefault(h.id, []).append(p.id)

    def parte(hoja_id: int, prep_id: int):
        """Que fraccion del crudo le toca a esta preparacion, y por que."""
        rivales = usan.get(hoja_id, [prep_id])
        if len(rivales) <= 1:
            return 1.0, ""
        total = sum(uso.get(r, 0) for r in rivales)
        if total > 0:
            return uso.get(prep_id, 0) / total, "ventas"
        return 1.0 / len(rivales), "iguales"

    filas = []
    for prep in preps:
        hojas = {h: q for h, q in hojas_de[prep.id].items() if q > 0 and h.id != prep.id}
        potencial, limita, solo, reparto, segun = None, None, None, None, ""
        for hoja, por_unidad in hojas.items():
            stock = max(hoja.stock_actual or 0, 0)
            fraccion, criterio = parte(hoja.id, prep.id)
            alcanza = stock * fraccion / por_unidad
            solo = stock / por_unidad if solo is None else min(solo, stock / por_unidad)
            if potencial is None or alcanza < potencial:
                potencial, limita = alcanza, hoja
                reparto, segun = (round(fraccion * 100, 1), criterio) if criterio else (None, "")
        comparte = []
        if limita is not None:
            comparte = [
                otra.nombre
                for otra in preps
                if otra.id != prep.id and any(h.id == limita.id for h in hojas_de[otra.id])
            ]
        filas.append(
            schemas.Disponibilidad(
                preparacion_id=prep.id,
                nombre=prep.nombre,
                unidad=prep.unidad,
                stock_actual=round(prep.stock_actual or 0, 4),
                potencial=round(potencial, 3) if potencial is not None else None,
                limita=limita.nombre if limita is not None else None,
                comparte_con=comparte,
                potencial_solo=round(solo, 3) if solo is not None else None,
                reparto_pct=reparto,
                reparto_segun=segun,
            )
        )
    return filas


def _uso_reciente(db: Session, preps) -> Dict[int, float]:
    """Cuanto se vendio de cada preparacion en los ultimos 14 dias, por las
    recetas de lo vendido (50 g de guiso por pastelito x pastelitos)."""
    ids = {p.id for p in preps}
    if not ids:
        return {}
    desde = ahora() - datetime.timedelta(days=14)
    filas = (
        db.query(models.RecetaItem.ingrediente_id, models.RecetaItem.cantidad_por_unidad, models.PedidoItem.cantidad)
        .join(models.PedidoItem, models.PedidoItem.variante_id == models.RecetaItem.variante_id)
        .join(models.Pedido, models.Pedido.id == models.PedidoItem.pedido_id)
        .filter(
            models.RecetaItem.ingrediente_id.in_(ids),
            models.Pedido.estado == "pagado",
            models.Pedido.creado_en >= desde,
        )
        .all()
    )
    uso: Dict[int, float] = {}
    for iid, por, cantidad in filas:
        uso[iid] = uso.get(iid, 0) + (por or 0) * (cantidad or 0)
    return uso


# ── Costo teorico vs real ───────────────────────────────────────────────────


@router.get("/costo-teorico", response_model=List[schemas.CostoTeoricoFila])
def costo_teorico(
    desde: Optional[datetime.date] = Query(None),
    hasta: Optional[datetime.date] = Query(None),
    db: Session = Depends(get_db),
):
    """Lo que debio gastarse segun las recetas, contra lo que dice el conteo.

    Es LA metrica de cualquier restaurante (*food cost* teorico vs real) y
    la que no depende de que la cocina anote nada: el kardex ya sabe lo que
    salio por ventas y produccion (lo teorico), lo que se anoto como merma, y
    lo que el conteo fisico encontro de menos o de mas (la diferencia). Una
    diferencia grande en el pollo es porcion generosa, merma sin anotar o
    algo peor, y se ve por mercancia y en plata.
    """
    inicio, fin = _rango(desde, hasta)
    teoricos = [kardex.VENTA, kardex.REVERSO, kardex.PRODUCCION, kardex.CONSUMO_PERSONAL, kardex.CARGA_INDIRECTO]
    filas = (
        db.query(
            models.MovimientoInventario.ingrediente_id,
            models.MovimientoInventario.tipo,
            func.sum(models.MovimientoInventario.cantidad),
            func.sum(models.MovimientoInventario.valor),
        )
        .filter(
            models.MovimientoInventario.fecha >= inicio,
            models.MovimientoInventario.fecha < fin,
            # La existencia que se declaro al dar de alta (o al estrenar el
            # kardex) tambien es un "ajuste", pero no es lo que encontro un
            # conteo: no es diferencia de nada.
            models.MovimientoInventario.origen.notin_(["alta_insumo", "apertura_kardex"]),
        )
        .group_by(models.MovimientoInventario.ingrediente_id, models.MovimientoInventario.tipo)
        .all()
    )
    por: Dict[int, Dict[str, list]] = {}
    for iid, tipo, cantidad, valor in filas:
        por.setdefault(iid, {})[tipo] = [cantidad or 0, valor or 0]
    salida = []
    for iid, tipos in por.items():
        ing = db.get(models.Ingrediente, iid)
        if ing is None:
            continue
        teorico = -sum(tipos.get(t, [0, 0])[0] for t in teoricos)
        valor_teorico = -sum(tipos.get(t, [0, 0])[1] for t in teoricos)
        mermas = -tipos.get(kardex.MERMA, [0, 0])[0]
        dif, valor_dif = tipos.get(kardex.AJUSTE, [0, 0])
        if not teorico and not mermas and not dif:
            continue
        salida.append(
            schemas.CostoTeoricoFila(
                ingrediente_id=iid,
                nombre=ing.nombre,
                unidad=ing.unidad,
                teorico=round(teorico, 4),
                mermas=round(mermas, 4),
                diferencia_conteo=round(dif, 4),
                valor_teorico=round(valor_teorico, 2),
                valor_diferencia=round(valor_dif, 2),
                pct_desvio=round(-dif / teorico * 100, 1) if teorico > 0 else None,
            )
        )
    # Primero lo que mas plata se fue sin explicacion.
    salida.sort(key=lambda f: f.valor_diferencia)
    return salida


# ── Costos indirectos (aceite de freir) ─────────────────────────────────────


@router.post("/ingredientes/{ingrediente_id}/cargar-indirecto", response_model=schemas.Ingrediente)
def cargar_indirecto(
    ingrediente_id: int, body: schemas.MermaRequest, request: Request, db: Session = Depends(get_db)
):
    """Se lleno la freidora con 5 L: salen del deposito y pasan a costo.

    Nadie sabe cuanto aceite lleva un pastelito, y no hace falta: con lo que
    se carga en el mes y las piezas fritas que se vendieron, el reporte
    calcula el costo por pieza (ver `costos_indirectos`).
    """
    if body.cantidad <= 0:
        raise HTTPException(status_code=400, detail="La cantidad debe ser mayor a cero")
    quien = operadores.del_turno(db, request)
    with costeo.bloqueo_inventario():
        ing = _ingrediente_para_actualizar(db, ingrediente_id)
        if not ing.es_indirecto:
            raise HTTPException(status_code=400, detail=f"«{ing.nombre}» no está marcado como costo indirecto.")
        valor = round(body.cantidad * (ing.costo_unitario or 0), 2)
        kardex.anotar(
            db, ing, -body.cantidad, kardex.CARGA_INDIRECTO,
            origen="carga_indirecto", nota=body.motivo or "Carga a la freidora",
            operador_id=quien.id if quien else None,
        )
        contabilidad.registrar_carga_indirecto(db, ing, valor, ing.id)
        db.commit()
        db.refresh(ing)
        return ing


def costo_indirecto_por_pieza(db: Session, desde: datetime.datetime, hasta: datetime.datetime) -> List[schemas.CostoIndirecto]:
    piezas = (
        db.query(func.sum(models.PedidoItem.cantidad))
        .join(models.Pedido, models.Pedido.id == models.PedidoItem.pedido_id)
        .join(models.Variante, models.Variante.id == models.PedidoItem.variante_id)
        .filter(
            models.Pedido.estado == "pagado",
            models.Pedido.cerrado_en >= desde,
            models.Pedido.cerrado_en < hasta,
            models.Variante.se_frie.is_(True),
        )
        .scalar()
    ) or 0
    salida = []
    for ing in db.query(models.Ingrediente).filter(models.Ingrediente.es_indirecto.is_(True)).all():
        cantidad, valor = (
            db.query(func.sum(models.MovimientoInventario.cantidad), func.sum(models.MovimientoInventario.valor))
            .filter(
                models.MovimientoInventario.ingrediente_id == ing.id,
                models.MovimientoInventario.tipo == kardex.CARGA_INDIRECTO,
                models.MovimientoInventario.fecha >= desde,
                models.MovimientoInventario.fecha < hasta,
            )
            .one()
        )
        cargado = -(cantidad or 0)
        valor = -(valor or 0)
        salida.append(
            schemas.CostoIndirecto(
                ingrediente_id=ing.id,
                nombre=ing.nombre,
                unidad=ing.unidad,
                cargado=round(cargado, 4),
                valor=round(valor, 2),
                piezas=piezas,
                por_pieza=round(valor / piezas, 4) if piezas else None,
                cantidad_por_pieza=round(cargado / piezas, 5) if piezas else None,
            )
        )
    return salida


@router.get("/indirectos", response_model=List[schemas.CostoIndirecto])
def costos_indirectos(
    desde: Optional[datetime.date] = Query(None),
    hasta: Optional[datetime.date] = Query(None),
    db: Session = Depends(get_db),
):
    """El aceite de freir repartido por pieza frita, en el periodo (30 dias
    por defecto). Es el prorrateo por volumen de produccion que se usa en la
    industria para costos indirectos de fabricacion."""
    inicio, fin = _rango(desde, hasta)
    return costo_indirecto_por_pieza(db, inicio, fin)
