import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import contabilidad, costeo, kardex, models, reposicion, schemas
from ..database import get_db
from ..timeutils import ahora, hoy, inicio_del_dia

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


@router.get(
    "/ingredientes/{ingrediente_id}/movimientos", response_model=schemas.ExtractoInsumo
)
def extracto(ingrediente_id: int, limite: int = 200, db: Session = Depends(get_db)):
    """Que paso con este insumo, en orden. El extracto bancario del deposito.

    Es la respuesta a "la carne bajo 3 kg hoy, explicame eso", que antes
    obligaba a abrir cuatro pantallas y aun asi dejaba fuera el consumo del
    personal y las compras sueltas.
    """
    ing = db.query(models.Ingrediente).filter(models.Ingrediente.id == ingrediente_id).first()
    if not ing:
        raise HTTPException(status_code=404, detail="Insumo no encontrado")

    movs = kardex.movimientos_de(db, ingrediente_id, limite)
    total = db.query(func.sum(models.MovimientoInventario.cantidad)).filter(
        models.MovimientoInventario.ingrediente_id == ingrediente_id
    ).scalar() or 0
    saldo_libro = round(total, 4)
    stock = round(ing.stock_actual or 0, 4)

    return schemas.ExtractoInsumo(
        ingrediente_id=ing.id,
        nombre=ing.nombre,
        unidad=ing.unidad,
        stock_actual=stock,
        saldo_segun_libro=saldo_libro,
        # Se compara y se dice. Un descuadre aca significa que alguien movio el
        # stock sin pasar por el kardex, y eso es un error de programacion que
        # no se puede quedar callado.
        cuadra=abs(saldo_libro - stock) < 0.001,
        movimientos=[
            schemas.MovimientoInventario(
                id=m.id, fecha=m.fecha, tipo=m.tipo,
                etiqueta=kardex.ETIQUETAS.get(m.tipo, m.tipo),
                cantidad=m.cantidad, costo_unitario=m.costo_unitario,
                valor=m.valor, saldo=m.saldo, origen=m.origen or "",
                referencia_id=m.referencia_id,
                operador=None, nota=m.nota or "",
            )
            for m in movs
        ],
    )


@router.get("/existencias", response_model=schemas.InventarioEnFecha)
def existencias_en_fecha(fecha: Optional[datetime.datetime] = None, db: Session = Depends(get_db)):
    """Cuanto habia y cuanto valia el inventario en una fecha.

    Antes esta pregunta -la que hace el contador para cerrar un mes- solo se
    podia responder en total y reconstruyendo desde los asientos, nunca por
    insumo. La valorizacion usa el costo del ULTIMO movimiento hasta esa
    fecha, no el promedio de hoy: valorar existencias viejas con el costo
    actual es contar la inflacion como si fuera mercancia.
    """
    corte = fecha or ahora()
    filas = []
    total = 0.0
    for ing in db.query(models.Ingrediente).order_by(models.Ingrediente.nombre).all():
        cantidad = kardex.existencia_a(db, ing.id, corte)
        if abs(cantidad) < 0.00005:
            continue
        ultimo = (
            db.query(models.MovimientoInventario)
            .filter(
                models.MovimientoInventario.ingrediente_id == ing.id,
                models.MovimientoInventario.fecha <= corte,
            )
            .order_by(models.MovimientoInventario.fecha.desc(), models.MovimientoInventario.id.desc())
            .first()
        )
        # Con el PROMEDIO de ese momento, que es el criterio de la cuenta 1040.
        # Con el precio de la ultima compra, este informe y el balance daban
        # numeros distintos por el mismo inventario.
        costo = (ultimo.costo_promedio if ultimo else None) or ing.costo_unitario or 0
        valor = round(cantidad * costo, 2)
        total += valor
        filas.append(schemas.ExistenciaEnFecha(
            ingrediente_id=ing.id, nombre=ing.nombre, unidad=ing.unidad,
            cantidad=cantidad, costo_unitario=round(costo, 4), valor=valor,
        ))
    return schemas.InventarioEnFecha(fecha=corte, total=round(total, 2), insumos=filas)


@router.get("/consumo", response_model=List[schemas.ConsumoDeInsumo])
def consumo(dias: int = 30, db: Session = Depends(get_db)):
    """Cuanto se gasta de verdad por dia, medido, y para cuantos dias alcanza.

    El minimo de cada insumo se pone a dedo una vez y se queda viejo. Esto se
    mide solo: sale del libro de movimientos.
    """
    hasta = ahora()
    desde = hasta - datetime.timedelta(days=dias)
    filas = []
    for ing in db.query(models.Ingrediente).filter(models.Ingrediente.activo.is_(True)).all():
        por_dia = kardex.consumo_por_dia(db, ing.id, desde, hasta)
        stock = ing.stock_actual or 0
        filas.append(schemas.ConsumoDeInsumo(
            ingrediente_id=ing.id, nombre=ing.nombre, unidad=ing.unidad,
            por_dia=por_dia,
            dias_de_stock=round(stock / por_dia, 1) if por_dia > 0 else None,
        ))
    filas.sort(key=lambda f: (f.dias_de_stock is None, f.dias_de_stock))
    return filas


@router.get("/inflacion", response_model=Optional[schemas.InflacionInsumos])
def inflacion(dias: int = 30, db: Session = Depends(get_db)):
    """Cuanto subio la canasta de insumos. None si no hay con que comparar."""
    return reposicion.inflacion_de_insumos(db, dias)


@router.post("/ingredientes", response_model=schemas.Ingrediente)
def crear_ingrediente(ingrediente: schemas.IngredienteCreate, db: Session = Depends(get_db)):
    datos = ingrediente.model_dump()
    # Nace en cero y es el movimiento el que lo deja en su existencia. Dar de
    # alta un insumo que ya tiene mercancia en el deposito TAMBIEN es un
    # movimiento: esa mercancia entro alguna vez. Sin esa fila el extracto
    # arranca en cero mientras el stock dice diez, y el libro no cuadra desde
    # el primer dia.
    inicial = datos.pop("stock_actual", 0) or 0
    db_ingrediente = models.Ingrediente(stock_actual=0, **datos)
    db.add(db_ingrediente)
    db.flush()
    if inicial:
        kardex.anotar(
            db, db_ingrediente, inicial, kardex.AJUSTE,
            origen="alta_insumo", nota="Existencia declarada al crear el insumo",
        )
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
        # Cada compra suelta queda como un registro propio. Antes el asiento usaba
        # el id del ingrediente como referencia, asi que todas las compras del mismo
        # insumo compartian referencia y ninguna se podia rastrear.
        #
        # Se crea ANTES de mover el stock porque el movimiento del kardex apunta
        # a esta fila: sin id, el extracto diria "compra" sin decir cual.
        compra = models.CompraSuelta(
            ingrediente_id=db_ingrediente.id,
            cantidad=body.cantidad,
            costo_unitario=costo_de_esta_compra,
        )
        db.add(compra)
        db.flush()
        costeo.registrar_entrada(
            db_ingrediente, body.cantidad, costo_de_esta_compra, db,
            origen="compra_suelta", referencia_id=compra.id,
            nota="Compra sin factura",
        )
        if not contabilidad.metodo_de_pago_valido(body.metodo_pago):
            raise HTTPException(
                status_code=400,
                detail="La compra se paga desde una gaveta (Efectivo Bs, Efectivo $) o del Banco",
            )
        contabilidad.registrar_compra_insumo(
            db, db_ingrediente, round(valor, 2), compra.id, body.metodo_pago
        )
        db.commit()
        db.refresh(db_ingrediente)

        # Aviso en el momento de la compra, no un mes despues cuando el
        # promedio por fin refleje la subida. Para entonces ya vendiste
        # semanas con el margen viejo en pantalla y el nuevo en la realidad.
        revisar = salto is not None and salto >= reposicion.SALTO_QUE_IMPORTA_PCT
        sospecha = reposicion.salto_sospechoso(costo_de_esta_compra, costo_anterior)
        return schemas.ImpactoDeCompra(
            ingrediente=_con_reposicion(db_ingrediente, reposicion.costos_reposicion(db)),
            costo_anterior=round(costo_anterior, 4),
            costo_pagado=round(costo_de_esta_compra, 4),
            salto_pct=salto,
            revisar_precios=revisar,
            posible_error_de_unidad=sospecha["mensaje"] if sospecha else None,
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
        db_merma = models.Merma(
            ingrediente_id=ingrediente_id, cantidad=body.cantidad, motivo=body.motivo
        )
        db.add(db_merma)
        db.flush()
        kardex.anotar(
            db, db_ingrediente, -body.cantidad, kardex.MERMA,
            origen="merma", referencia_id=db_merma.id, nota=body.motivo,
        )
        contabilidad.registrar_merma(
            db,
            db_ingrediente,
            round(body.cantidad * (db_ingrediente.costo_unitario or 0), 2),
            db_merma.id,
        )
        db.commit()
        db.refresh(db_ingrediente)
        return db_ingrediente


def _aplicar_conteo(
    db: Session, ingrediente: models.Ingrediente, stock_real: float, motivo: str
) -> schemas.AjusteConteo:
    """Lo que dice la balanza manda sobre lo que dice el sistema.

    La diferencia no se pisa en silencio: el faltante queda como Merma y el
    sobrante como SobranteInventario, cada uno con su asiento, para que el
    inventario contable y el real no se separen sin dejar rastro.
    """
    sistema = ingrediente.stock_actual or 0
    faltante = sistema - stock_real
    valor = round(abs(faltante) * (ingrediente.costo_unitario or 0), 2)
    if faltante > 0:
        db_merma = models.Merma(
            ingrediente_id=ingrediente.id, cantidad=faltante, motivo=motivo, por_conteo=True
        )
        db.add(db_merma)
        db.flush()
        contabilidad.registrar_merma(db, ingrediente, valor, db_merma.id)
    elif faltante < 0 and valor > 0:
        # Sobra mercancia respecto al sistema. Antes se subia el stock en
        # silencio, sin asiento: el inventario contable quedaba por debajo del
        # real para siempre (era la unica salida para corregir una merma
        # duplicada, y dejaba los libros peor que antes).
        #
        # Y despues, con asiento pero sin fila propia: el faltante se podia
        # revertir (queda como Merma) y el sobrante no, aunque el error de
        # tecleo es el mismo. Ahora cada sobrante tiene su registro, con su
        # propia referencia contable - dos sobrantes del mismo insumo ya no
        # comparten referencia.
        db_sobrante = models.SobranteInventario(
            ingrediente_id=ingrediente.id, cantidad=abs(faltante), motivo=motivo
        )
        db.add(db_sobrante)
        db.flush()
        contabilidad.registrar_sobrante_inventario(db, ingrediente, valor, db_sobrante.id)

    # El ajuste se anota como UN movimiento por la diferencia, no fijando el
    # numero: el libro tiene que poder explicar el salto igual que explica una
    # venta. `anotar` mueve el stock, asi que aca no se asigna a mano.
    if abs(stock_real - sistema) > 0.00005:
        kardex.anotar(
            db, ingrediente, stock_real - sistema, kardex.AJUSTE,
            origen="conteo", nota=motivo,
        )
    # Se vuelca ya: el siguiente insumo del lote vuelve a `expire_all()` y un
    # cambio sin volcar se perderia.
    db.flush()
    return schemas.AjusteConteo(
        ingrediente_id=ingrediente.id,
        nombre=ingrediente.nombre,
        unidad=ingrediente.unidad,
        sistema=round(sistema, 4),
        contado=stock_real,
        diferencia=round(stock_real - sistema, 4),
        valor=valor,
    )


@router.post("/ingredientes/{ingrediente_id}/ajustar", response_model=schemas.Ingrediente)
def ajustar_stock(
    ingrediente_id: int, body: schemas.AjusteStockRequest, db: Session = Depends(get_db)
):
    """Conteo fisico de UN insumo (desde su ficha)."""
    with costeo.bloqueo_inventario():
        db_ingrediente = _ingrediente_para_actualizar(db, ingrediente_id)
        _aplicar_conteo(db, db_ingrediente, body.stock_real, body.motivo)
        db.commit()
        db.refresh(db_ingrediente)
        return db_ingrediente


@router.post("/conteo", response_model=schemas.ResultadoConteo)
def conteo_fisico(body: schemas.ConteoRequest, db: Session = Depends(get_db)):
    """El inventario fisico de verdad: se cuenta TODO de una vez.

    Contar insumo por insumo desde su fila obligaba a diez dialogos para diez
    insumos y, peor, a decidir en cada uno; aqui se recorre el deposito con la
    tablet, se anota lo que hay y se guarda una sola vez. Lo que no se anoto
    no se toca. Todo o nada: si un id no existe, ningun stock cambia.
    """
    if not body.items:
        raise HTTPException(status_code=400, detail="No se conto ningun insumo")
    ids = [i.ingrediente_id for i in body.items]
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=400, detail="Un insumo aparece dos veces en el conteo")

    with costeo.bloqueo_inventario():
        # Primero se buscan TODOS: un id que no existe tiene que fallar antes
        # de que el primer stock cambie, no a mitad del lote.
        ingredientes = [_ingrediente_para_actualizar(db, item.ingrediente_id) for item in body.items]
        ajustes = [
            _aplicar_conteo(db, ingrediente, item.stock_real, body.motivo)
            for ingrediente, item in zip(ingredientes, body.items)
        ]
        db.commit()

    return schemas.ResultadoConteo(
        ajustes=[a for a in ajustes if a.diferencia != 0],
        faltante_valor=round(sum(a.valor for a in ajustes if a.diferencia < 0), 2),
        sobrante_valor=round(sum(a.valor for a in ajustes if a.diferencia > 0), 2),
        sin_cambio=sum(1 for a in ajustes if a.diferencia == 0),
    )


@router.post("/ingredientes/{ingrediente_id}/consumo-personal", response_model=schemas.Ingrediente)
def consumo_personal(
    ingrediente_id: int, body: schemas.MermaRequest, db: Session = Depends(get_db)
):
    """El empleado se comio una empanada.

    Sale inventario sin venta, pero NO es merma: una merma es plata que se
    perdio y sirve para detectar desperdicio o robo. Esto es un costo laboral
    autorizado, y mezclarlo con la merma contamina justo el indicador que el
    dueno usa para vigilar la cocina.
    """
    if body.cantidad <= 0:
        raise HTTPException(status_code=400, detail="La cantidad debe ser mayor a cero")
    with costeo.bloqueo_inventario():
        ingrediente = _ingrediente_para_actualizar(db, ingrediente_id)
        valor = round(body.cantidad * (ingrediente.costo_unitario or 0), 2)
        kardex.anotar(
            db, ingrediente, -body.cantidad, kardex.CONSUMO_PERSONAL,
            origen="consumo_personal", nota=body.motivo,
        )
        contabilidad.registrar_consumo_personal(db, ingrediente, valor, ingrediente_id, body.motivo)
        db.commit()
        db.refresh(ingrediente)
        return _con_reposicion(ingrediente, reposicion.costos_reposicion(db))


@router.get("/sobrantes", response_model=List[schemas.SobranteInventario])
def listar_sobrantes(dias: int = 30, db: Session = Depends(get_db)):
    desde = inicio_del_dia(hoy()) - datetime.timedelta(days=dias)
    sobrantes = (
        db.query(models.SobranteInventario)
        .filter(models.SobranteInventario.fecha >= desde)
        .order_by(models.SobranteInventario.id.desc())
        .all()
    )
    return [
        schemas.SobranteInventario(
            id=s.id,
            ingrediente_id=s.ingrediente_id,
            ingrediente_nombre=s.ingrediente.nombre,
            unidad=s.ingrediente.unidad,
            cantidad=s.cantidad,
            valor=round(s.cantidad * (s.ingrediente.costo_unitario or 0), 2),
            motivo=s.motivo or "",
            fecha=s.fecha.isoformat(),
            revertido=bool(s.revertido),
        )
        for s in sobrantes
    ]


@router.post("/sobrantes/{sobrante_id}/revertir", response_model=schemas.Ingrediente)
def revertir_sobrante(sobrante_id: int, db: Session = Depends(get_db)):
    """Deshace un conteo mal tecleado hacia arriba (500 en vez de 50).

    El faltante siempre tuvo vuelta atras porque quedaba como Merma; el
    sobrante no, aunque es el mismo dedo en el mismo formulario.
    """
    with costeo.bloqueo_inventario():
        sobrante = (
            db.query(models.SobranteInventario)
            .filter(models.SobranteInventario.id == sobrante_id)
            .first()
        )
        if not sobrante:
            raise HTTPException(status_code=404, detail="Sobrante no encontrado")
        if sobrante.revertido:
            raise HTTPException(status_code=409, detail="Ese sobrante ya fue revertido")

        ingrediente = _ingrediente_para_actualizar(db, sobrante.ingrediente_id)
        valor = round(sobrante.cantidad * (ingrediente.costo_unitario or 0), 2)
        kardex.anotar(
            db, ingrediente, -sobrante.cantidad, kardex.REVERSO,
            origen="sobrante_revertido", referencia_id=sobrante.id,
            nota="Se deshace un sobrante de conteo",
        )
        contabilidad.registrar_reverso_sobrante_inventario(db, ingrediente, valor, sobrante.id)
        sobrante.revertido = True
        db.commit()
        db.refresh(ingrediente)
        return _con_reposicion(ingrediente, reposicion.costos_reposicion(db))


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
    # El valor sale del movimiento, que lo lleva congelado. Calcularlo con el
    # costo de HOY revaloraba una merma de hace tres meses al precio de hoy: el
    # informe de perdidas se movia solo cada vez que subia un proveedor.
    congelado = {
        mv.referencia_id: abs(mv.valor)
        for mv in db.query(models.MovimientoInventario)
        .filter(
            models.MovimientoInventario.origen == "merma",
            models.MovimientoInventario.referencia_id.in_([m.id for m in mermas] or [0]),
        )
        .all()
    }
    return [
        schemas.Merma(
            id=m.id,
            ingrediente_id=m.ingrediente_id,
            ingrediente_nombre=m.ingrediente.nombre,
            unidad=m.ingrediente.unidad,
            cantidad=m.cantidad,
            valor=congelado.get(
                m.id, round(m.cantidad * (m.ingrediente.costo_unitario or 0), 2)
            ),
            motivo=m.motivo,
            fecha=m.fecha,
            revertida=m.revertida,
            por_conteo=bool(m.por_conteo),
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
        kardex.anotar(
            db, ingrediente, merma.cantidad, kardex.REVERSO,
            origen="merma_revertida", referencia_id=merma.id,
            nota="Se deshace una merma",
        )
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
    db.flush()

    # Los precios de venta tenian historial y las recetas no: no habia como
    # responder "por que cambio mi costo en marzo". Se guarda la composicion
    # completa y su costo, para poder leerla sin reconstruir deltas.
    partes = []
    costo = 0.0
    for item in items:
        ingrediente = (
            db.query(models.Ingrediente)
            .filter(models.Ingrediente.id == item.ingrediente_id)
            .first()
        )
        if ingrediente is None:
            continue
        partes.append(
            f"{ingrediente.nombre} {item.cantidad_por_unidad:g} {ingrediente.unidad}"
        )
        costo += item.cantidad_por_unidad * (ingrediente.costo_efectivo or 0)
    db.add(
        models.CambioReceta(
            variante_id=variante_id,
            composicion="; ".join(partes) or "(sin receta)",
            costo_resultante=round(costo, 4),
        )
    )
    db.commit()
    return ver_receta(variante_id, db)


@router.get("/recetas/{variante_id}/historial", response_model=List[schemas.CambioReceta])
def historial_receta(variante_id: int, db: Session = Depends(get_db)):
    """Como ha cambiado la receta de ese producto, y que costo dejaba cada una."""
    return (
        db.query(models.CambioReceta)
        .filter(models.CambioReceta.variante_id == variante_id)
        .order_by(models.CambioReceta.id.desc())
        .limit(30)
        .all()
    )


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
    # Lo archivado no se compra: si sigue bajo minimo es porque ya no se usa.
    for ing in db.query(models.Ingrediente).filter(models.Ingrediente.activo.isnot(False)).all():
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
