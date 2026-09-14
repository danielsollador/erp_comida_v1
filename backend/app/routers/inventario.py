import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import contabilidad, costeo, models, reposicion, schemas
from ..database import get_db
from ..timeutils import hoy, inicio_del_dia

router = APIRouter(prefix="/api/inventario", tags=["inventario"])


def _ingrediente_para_actualizar(db: Session, ingrediente_id: int) -> models.Ingrediente:
    """Trae el insumo listo para modificarle el stock.

    `with_for_update()` no hace nada en SQLite pero sí bloquea la fila en
    Postgres, que es a donde iria esto si algun dia corre en la nube con varias
    instancias: ahi el candado de proceso ya no alcanza.
    """
    # La sesion pudo haber leido este insumo antes de que otro hilo lo tocara.
    db.expire_all()
    ingrediente = (
        db.query(models.Ingrediente)
        .filter(models.Ingrediente.id == ingrediente_id)
        .with_for_update()
        .first()
    )
    if not ingrediente:
        raise HTTPException(status_code=404, detail="Ingrediente no encontrado")
    return ingrediente


@router.get("/ingredientes", response_model=List[schemas.Ingrediente])
def listar_ingredientes(db: Session = Depends(get_db)):
    ingredientes = db.query(models.Ingrediente).order_by(models.Ingrediente.nombre).all()
    return [_con_reposicion(i, reposicion.costos_reposicion(db)) for i in ingredientes]


def _con_reposicion(ingrediente: models.Ingrediente, ultimos: dict) -> schemas.Ingrediente:
    """Le pega al insumo lo que costaria reponerlo hoy.

    `costo_unitario` es el promedio ponderado (lo que costo lo que hay en el
    deposito); esto es lo que cuesta comprar mas. Mientras el promedio no se
    mueve, el dueno cree que su margen sigue igual.
    """
    salida = schemas.Ingrediente.model_validate(ingrediente)
    ultimo = ultimos.get(ingrediente.id)
    if ultimo:
        salida.costo_reposicion = round(ultimo["costo"], 4)
        salida.ultima_compra = ultimo["fecha"]
        salida.variacion_pct = reposicion.variacion_pct(
            ultimo["costo"], ingrediente.costo_unitario
        )
    return salida


@router.get("/ingredientes/{ingrediente_id}/costos", response_model=List[schemas.CompraDeInsumo])
def historial_de_costos(ingrediente_id: int, db: Session = Depends(get_db)):
    """Cuanto ha costado este insumo, compra por compra.

    El dato existia desde el primer dia en cada linea de factura y en cada
    compra suelta; no habia por donde verlo. En un pais con inflacion, la curva
    del costo de tus insumos es informacion de primera necesidad.
    """
    if not db.query(models.Ingrediente).filter_by(id=ingrediente_id).first():
        raise HTTPException(status_code=404, detail="Insumo no encontrado")
    return reposicion.historial_de_costos(db, ingrediente_id)


@router.get("/inflacion", response_model=Optional[schemas.InflacionInsumos])
def inflacion(dias: int = 30, db: Session = Depends(get_db)):
    """Cuanto subio la canasta de insumos. None si no hay con que comparar."""
    return reposicion.inflacion_de_insumos(db, dias)


@router.post("/ingredientes", response_model=schemas.Ingrediente)
def crear_ingrediente(ingrediente: schemas.IngredienteCreate, db: Session = Depends(get_db)):
    db_ingrediente = models.Ingrediente(**ingrediente.model_dump())
    db.add(db_ingrediente)
    db.commit()
    db.refresh(db_ingrediente)
    return db_ingrediente


@router.put("/ingredientes/{ingrediente_id}", response_model=schemas.Ingrediente)
def actualizar_ingrediente(
    ingrediente_id: int, ingrediente: schemas.IngredienteCreate, db: Session = Depends(get_db)
):
    db_ingrediente = db.query(models.Ingrediente).filter(models.Ingrediente.id == ingrediente_id).first()
    if not db_ingrediente:
        raise HTTPException(status_code=404, detail="Ingrediente no encontrado")

    # El stock NO se toca por aca: moverlo sin asiento separa el inventario
    # contable del real en silencio. Para eso esta "Contar" (ajustar_stock),
    # que registra la merma o el sobrante como corresponde.
    datos = ingrediente.model_dump()
    datos.pop("stock_actual", None)
    for key, value in datos.items():
        setattr(db_ingrediente, key, value)
    db.commit()
    db.refresh(db_ingrediente)
    return db_ingrediente


@router.post("/ingredientes/{ingrediente_id}/comprar", response_model=schemas.ImpactoDeCompra)
def registrar_compra(
    ingrediente_id: int, body: schemas.ComprarIngredienteRequest, db: Session = Depends(get_db)
):
    if body.cantidad <= 0:
        raise HTTPException(status_code=400, detail="La cantidad debe ser mayor a cero")

    # Leer el stock, promediar y escribirlo es una sola operacion logica: sin
    # el candado, dos compras simultaneas leian el mismo stock y la ultima
    # pisaba a la anterior (medido: de 10 compras de 1 kg entro 1 sola).
    with costeo.bloqueo_inventario():
        db_ingrediente = _ingrediente_para_actualizar(db, ingrediente_id)

        # Costo de esta compra puntual: lo que se pago, o si no se informo, se
        # asume el mismo costo promedio que ya tenia (compra informal sin dato).
        if body.costo_total is not None and body.costo_total > 0:
            costo_de_esta_compra = round(body.costo_total / body.cantidad, 4)
            valor = round(body.costo_total, 2)
        else:
            costo_de_esta_compra = db_ingrediente.costo_unitario or 0
            valor = round(body.cantidad * costo_de_esta_compra, 2)

        # Se calcula ANTES de promediar: despues de mezclar, el costo anterior
        # ya no se puede reconstruir.
        costo_anterior = db_ingrediente.costo_unitario or 0
        salto = reposicion.variacion_pct(costo_de_esta_compra, costo_anterior)

        # El costo del insumo se PROMEDIA con lo que ya habia, no se pisa - ver
        # costeo.py. Asi el costo (y el margen que se le muestra al dueno) no
        # salta de golpe cada vez que un proveedor sube el precio.
        costeo.registrar_entrada(db_ingrediente, body.cantidad, costo_de_esta_compra)
        # Cada compra suelta queda como un registro propio. Antes el asiento usaba
        # el id del ingrediente como referencia, asi que todas las compras del mismo
        # insumo compartian referencia y ninguna se podia rastrear.
        compra = models.CompraSuelta(
            ingrediente_id=db_ingrediente.id,
            cantidad=body.cantidad,
            costo_unitario=costo_de_esta_compra,
        )
        db.add(compra)
        db.flush()
        contabilidad.registrar_compra_insumo(db, db_ingrediente, round(valor, 2), compra.id)
        db.commit()
        db.refresh(db_ingrediente)

        # Aviso en el momento de la compra, no un mes despues cuando el
        # promedio por fin refleje la subida. Para entonces ya vendiste
        # semanas con el margen viejo en pantalla y el nuevo en la realidad.
        revisar = salto is not None and salto >= reposicion.SALTO_QUE_IMPORTA_PCT
        return schemas.ImpactoDeCompra(
            ingrediente=_con_reposicion(db_ingrediente, reposicion.costos_reposicion(db)),
            costo_anterior=round(costo_anterior, 4),
            costo_pagado=round(costo_de_esta_compra, 4),
            salto_pct=salto,
            revisar_precios=revisar,
            productos=(
                reposicion.impacto_en_productos(
                    db, db_ingrediente.id, costo_de_esta_compra, costo_anterior
                )
                if revisar
                else []
            ),
        )


@router.post("/ingredientes/{ingrediente_id}/merma", response_model=schemas.Ingrediente)
def registrar_merma(
    ingrediente_id: int, body: schemas.MermaRequest, db: Session = Depends(get_db)
):
    """Lo que se daño, quemó o botó. Sin esto el stock del sistema nunca cuadra."""
    if body.cantidad <= 0:
        raise HTTPException(status_code=400, detail="La cantidad debe ser mayor a cero")

    with costeo.bloqueo_inventario():
        db_ingrediente = _ingrediente_para_actualizar(db, ingrediente_id)
        db_ingrediente.stock_actual -= body.cantidad
        db_merma = models.Merma(
            ingrediente_id=ingrediente_id, cantidad=body.cantidad, motivo=body.motivo
        )
        db.add(db_merma)
        db.flush()
        contabilidad.registrar_merma(
            db,
            db_ingrediente,
            round(body.cantidad * (db_ingrediente.costo_unitario or 0), 2),
            db_merma.id,
        )
        db.commit()
        db.refresh(db_ingrediente)
        return db_ingrediente


@router.post("/ingredientes/{ingrediente_id}/ajustar", response_model=schemas.Ingrediente)
def ajustar_stock(
    ingrediente_id: int, body: schemas.AjusteStockRequest, db: Session = Depends(get_db)
):
    """Conteo fisico: lo que dice la balanza manda sobre lo que dice el sistema."""
    with costeo.bloqueo_inventario():
        db_ingrediente = _ingrediente_para_actualizar(db, ingrediente_id)

        faltante = (db_ingrediente.stock_actual or 0) - body.stock_real
        valor = round(abs(faltante) * (db_ingrediente.costo_unitario or 0), 2)
        if faltante > 0:
            db_merma = models.Merma(
                ingrediente_id=ingrediente_id, cantidad=faltante, motivo=body.motivo
            )
            db.add(db_merma)
            db.flush()
            contabilidad.registrar_merma(db, db_ingrediente, valor, db_merma.id)
        elif faltante < 0 and valor > 0:
            # Sobra mercancia respecto al sistema. Antes se subia el stock en
            # silencio, sin asiento: el inventario contable quedaba por debajo del
            # real para siempre (era la unica salida para corregir una merma
            # duplicada, y dejaba los libros peor que antes).
            contabilidad.registrar_sobrante_inventario(db, db_ingrediente, valor, ingrediente_id)

        db_ingrediente.stock_actual = body.stock_real
        db.commit()
        db.refresh(db_ingrediente)
        return db_ingrediente


@router.get("/mermas", response_model=List[schemas.Merma])
def listar_mermas(dias: int = 30, db: Session = Depends(get_db)):
    """Historial de lo que se perdio. Sin esto el dueno no puede auditar su
    perdida mas sensible ni darse cuenta de un registro duplicado."""
    desde = inicio_del_dia(hoy()) - datetime.timedelta(days=dias)
    mermas = (
        db.query(models.Merma)
        .filter(models.Merma.fecha >= desde)
        .order_by(models.Merma.id.desc())
        .all()
    )
    return [
        schemas.Merma(
            id=m.id,
            ingrediente_id=m.ingrediente_id,
            ingrediente_nombre=m.ingrediente.nombre,
            unidad=m.ingrediente.unidad,
            cantidad=m.cantidad,
            valor=round(m.cantidad * (m.ingrediente.costo_unitario or 0), 2),
            motivo=m.motivo,
            fecha=m.fecha,
            revertida=m.revertida,
        )
        for m in mermas
    ]


@router.post("/mermas/{merma_id}/revertir", response_model=schemas.Ingrediente)
def revertir_merma(merma_id: int, db: Session = Depends(get_db)):
    """Deshace una merma mal registrada SIN borrarla.

    Se devuelve el stock y se genera un asiento de reverso. La merma original
    queda marcada, no se borra: un error documentado vale mas que un error
    desaparecido, y es la misma disciplina que ya aplicamos en Compras.
    """
    with costeo.bloqueo_inventario():
        merma = db.query(models.Merma).filter(models.Merma.id == merma_id).first()
        if not merma:
            raise HTTPException(status_code=404, detail="Merma no encontrada")
        if merma.revertida:
            raise HTTPException(status_code=409, detail="Esta merma ya fue revertida")

        ingrediente = _ingrediente_para_actualizar(db, merma.ingrediente_id)
        valor = round(merma.cantidad * (ingrediente.costo_unitario or 0), 2)
        ingrediente.stock_actual = (ingrediente.stock_actual or 0) + merma.cantidad
        merma.revertida = True
        if valor > 0:
            contabilidad.registrar_reverso_merma(db, ingrediente, valor, merma.id)
        db.commit()
        db.refresh(ingrediente)
        return ingrediente


@router.get("/recetas/{variante_id}", response_model=List[schemas.RecetaItem])
def ver_receta(variante_id: int, db: Session = Depends(get_db)):
    items = (
        db.query(models.RecetaItem).filter(models.RecetaItem.variante_id == variante_id).all()
    )
    return [
        schemas.RecetaItem(
            id=i.id,
            ingrediente_id=i.ingrediente_id,
            ingrediente_nombre=i.ingrediente.nombre,
            unidad=i.ingrediente.unidad,
            cantidad_por_unidad=i.cantidad_por_unidad,
        )
        for i in items
    ]


@router.put("/recetas/{variante_id}", response_model=List[schemas.RecetaItem])
def actualizar_receta(
    variante_id: int, items: List[schemas.RecetaItemInput], db: Session = Depends(get_db)
):
    variante = db.query(models.Variante).filter(models.Variante.id == variante_id).first()
    if not variante:
        raise HTTPException(status_code=404, detail="Variante no encontrada")

    db.query(models.RecetaItem).filter(models.RecetaItem.variante_id == variante_id).delete()
    for item in items:
        db.add(
            models.RecetaItem(
                variante_id=variante_id,
                ingrediente_id=item.ingrediente_id,
                cantidad_por_unidad=item.cantidad_por_unidad,
            )
        )
    db.commit()
    return ver_receta(variante_id, db)


def _consumo_diario(db: Session, dias: int = 14) -> dict:
    """Cuanto se gasta al dia de cada insumo, segun lo que se vendio de verdad.

    Con esto la sugerencia deja de ser "ya cruzaste el minimo" (que avisa
    tarde) y pasa a ser "esto te dura N dias", que es lo que deja comprar a
    tiempo.
    """
    desde = inicio_del_dia(hoy()) - datetime.timedelta(days=dias)
    pedidos = (
        db.query(models.Pedido)
        .filter(models.Pedido.estado == "pagado", models.Pedido.cerrado_en >= desde)
        .all()
    )
    recetas = {}
    for receta in db.query(models.RecetaItem).all():
        recetas.setdefault(receta.variante_id, []).append(receta)

    consumo = {}
    for pedido in pedidos:
        for item in pedido.items:
            for receta in recetas.get(item.variante_id, []):
                consumo[receta.ingrediente_id] = consumo.get(
                    receta.ingrediente_id, 0
                ) + costeo.consumo_bruto(receta, item.cantidad)
    return {ing_id: total / dias for ing_id, total in consumo.items()}


@router.get("/sugerencias", response_model=List[schemas.SugerenciaCompra])
def sugerencias_compra(db: Session = Depends(get_db)):
    consumo_diario = _consumo_diario(db)
    sugerencias = []
    for ing in db.query(models.Ingrediente).all():
        por_dia = consumo_diario.get(ing.id, 0)
        dias_restantes = (ing.stock_actual / por_dia) if por_dia > 0 else None
        bajo_minimo = ing.stock_actual <= ing.stock_minimo
        # Se avisa tambien si el consumo real dice que no llega a la proxima
        # semana, aunque todavia no haya cruzado el minimo.
        se_acaba_pronto = dias_restantes is not None and dias_restantes <= 7

        if not bajo_minimo and not se_acaba_pronto:
            continue

        objetivo = max(ing.stock_objetivo, ing.stock_minimo)
        if por_dia > 0:
            # Al menos dos semanas de consumo real, que es como compra el local.
            objetivo = max(objetivo, por_dia * 14)
        cantidad = round(max(objetivo - ing.stock_actual, 0), 2)
        if cantidad <= 0:
            continue

        if dias_restantes is not None:
            razon = (
                f"Quedan {ing.stock_actual:g} {ing.unidad}. Al ritmo de las ultimas 2 semanas "
                f"({por_dia:.2f} {ing.unidad}/dia) te duran {dias_restantes:.1f} dias."
            )
        else:
            razon = (
                f"Quedan {ing.stock_actual:g} {ing.unidad}, por debajo del minimo de "
                f"{ing.stock_minimo:g} {ing.unidad}."
            )
        sugerencias.append(
            schemas.SugerenciaCompra(
                ingrediente_id=ing.id,
                ingrediente_nombre=ing.nombre,
                unidad=ing.unidad,
                stock_actual=ing.stock_actual,
                stock_minimo=ing.stock_minimo,
                cantidad_sugerida=cantidad,
                dias_restantes=round(dias_restantes, 1) if dias_restantes is not None else None,
                razon=razon,
            )
        )
    sugerencias.sort(key=lambda s: s.dias_restantes if s.dias_restantes is not None else 999)
    return sugerencias
