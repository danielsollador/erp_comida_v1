"""Cargar una factura de compra desde una foto.

Nada de este archivo guarda facturas. El flujo es:

  1. `POST /lectura`: sube la foto, se guarda como soporte, y el lector
     devuelve un borrador que el frontend usa para PRELLENAR el formulario de
     siempre.
  2. `POST /revision`: mientras alguien revisa, dice si la factura ya parece
     cargada y que precios se salen de lo normal. Solo consulta.
  3. La persona le da Guardar: `POST /facturas`, el mismo de toda la vida,
     sin cambios. Stock, costo promedio, IVA y asientos salen de ahi.
  4. `POST /facturas/{id}/completar`: la foto se engancha a la factura que
     salio, la memoria del proveedor aprende y salen las alertas de precio.
     Un solo pedido que se puede repetir sin duplicar nada: si el wifi se cae
     aqui, el navegador lo reintenta (ver `pendientesCompras.ts`).

Vive aparte de `compras.py` a proposito: el guardado de una factura no tiene
por que enterarse de que existe una camara.
"""

import datetime
import re
import statistics
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from .. import alertas_precio, equivalencias, impuestos, lectura_facturas, models, reposicion, schemas
from ..database import get_db
from ..timeutils import ahora
from .compras_alertas import alerta_a_schema

router = APIRouter(prefix="/api/compras", tags=["compras"])

# Lo que acepta el lector: la foto del papel, o el PDF que el proveedor manda
# por correo o WhatsApp. El frontend achica la foto antes de subirla (queda en
# unos cientos de KB); el tope es para una foto sin achicar o un PDF de
# varias paginas. Un PDF no se achica: se guarda y se lee tal cual.
TIPOS_DE_IMAGEN = ("image/jpeg", "image/png", "image/webp")
TIPO_PDF = "application/pdf"
TAMANO_MAXIMO = 8 * 1024 * 1024

# Una foto leida cuya factura nunca se guardo se borra pasado este plazo. No
# antes: una foto sin factura tambien puede ser de una factura YA guardada
# cuyo "completar" espera en la cola de una tablet sin conexion (ver
# `pendientesCompras.ts`), y esa tablet puede tardar dias en volver.
DIAS_FOTO_SUELTA = 30

# Cuanto se puede alejar un precio de lo que se venia pagando antes de
# avisar. Por debajo de esto es el vaiven normal de un proveedor (y de la
# inflacion de unas semanas); por encima, vale la pena mirar el papel.
PRECIO_FUERA_DE_LO_NORMAL_PCT = 25.0
# Con cuantas compras anteriores se arma la referencia. La mediana, no el
# promedio: una sola compra rara (una oferta, un error viejo) no la mueve.
MUESTRAS_DE_REFERENCIA = 5


@router.get("/lectura", response_model=schemas.EstadoLector)
def estado_lector():
    nombre = lectura_facturas.lector_activo()
    return schemas.EstadoLector(activo=nombre is not None, lector=nombre or "")


@router.post("/lectura", response_model=schemas.LecturaFactura)
def leer_factura(archivo: UploadFile = File(...), db: Session = Depends(get_db)):
    # Sincrona a proposito: FastAPI la corre en un hilo aparte, y asi ni la
    # base ni el lector (que puede tardar segundos) frenan al resto del ERP.
    nombre = lectura_facturas.lector_activo()
    if nombre is None:
        raise HTTPException(
            status_code=503, detail="La lectura de facturas desde foto no está activada."
        )
    tipo = (archivo.content_type or "").lower()
    if tipo not in TIPOS_DE_IMAGEN and tipo != TIPO_PDF:
        raise HTTPException(
            status_code=415, detail="Tiene que ser una foto (JPG, PNG o WEBP) o un PDF."
        )
    imagen = archivo.file.read(TAMANO_MAXIMO + 1)
    if not imagen:
        raise HTTPException(status_code=400, detail="El archivo llegó vacío.")
    if len(imagen) > TAMANO_MAXIMO:
        raise HTTPException(status_code=413, detail="El archivo pesa demasiado (máximo 8 MB).")
    # Que diga PDF no lo hace PDF: un archivo renombrado se guardaria como
    # soporte y despues no abriria. Todo PDF empieza con esta firma.
    if tipo == TIPO_PDF and not imagen.startswith(b"%PDF-"):
        raise HTTPException(status_code=415, detail="El archivo dice ser PDF pero no lo es.")

    soporte = models.SoporteFactura(
        tipo_mime=tipo, tamano=len(imagen), contenido=imagen, lector=nombre
    )
    borrador: Optional[schemas.BorradorFactura] = None
    try:
        fiscal = impuestos.config(db)
        comprador = (
            f"{fiscal.razon_social} ({impuestos.normalizar_rif(fiscal.rif)})" if fiscal.rif else ""
        )
        lectura = lectura_facturas.leer(imagen, tipo, comprador)
        borrador = lectura.borrador
        soporte.lectura = borrador.model_dump_json()
        soporte.tokens_entrada = lectura.tokens_entrada
        soporte.tokens_salida = lectura.tokens_salida
        # Que modelo leyo de verdad (pudo ser el de respaldo): sin esto no se
        # puede medir cual se equivoca mas.
        if lectura.modelo:
            soporte.lector = f"{nombre}:{lectura.modelo}"
    except lectura_facturas.ErrorDeLectura as e:
        # La foto se queda igual: se puede cargar a mano y adjuntarla.
        soporte.error = str(e)

    _limpiar_fotos_sueltas(db)
    db.add(soporte)
    db.commit()
    db.refresh(soporte)
    return schemas.LecturaFactura(
        soporte_id=soporte.id, lector=nombre, borrador=borrador, error=soporte.error or ""
    )


def _limpiar_fotos_sueltas(db: Session) -> int:
    """Borra las fotos leidas que nadie termino de guardar, pasado el plazo.

    Se hace al leer una foto nueva porque es el unico momento en que nacen
    fotos sueltas: si nadie lee fotos, no aparecen nuevas que limpiar. Es un
    DELETE sin traer las imagenes (la columna es diferida).
    """
    limite = ahora() - datetime.timedelta(days=DIAS_FOTO_SUELTA)
    return (
        db.query(models.SoporteFactura)
        .filter(models.SoporteFactura.factura_id.is_(None), models.SoporteFactura.fecha < limite)
        .delete(synchronize_session=False)
    )


def _numero_normalizado(numero: str) -> str:
    """"0004512", "4512" y "N° 4512" son la misma factura en papeles distintos.

    Se queda con letras y digitos y le quita los ceros de relleno: el
    proveedor imprime el numero con ceros y quien lo teclea casi nunca.
    """
    texto = (numero or "").strip().upper()
    # "N° 4512", "Nro. 4512": el prefijo es del papel, no del numero.
    texto = re.sub(r"^(NRO|NUMERO|NÚMERO|NUM|NO|N)[\s.°º:#-]+", "", texto)
    limpio = re.sub(r"[^0-9A-Z]", "", texto)
    return limpio.lstrip("0") or limpio


def _duplicadas(db: Session, body: schemas.RevisionFacturaRequest) -> List[schemas.FacturaParecida]:
    numero = _numero_normalizado(body.numero_factura)
    if not numero:
        return []
    consulta = db.query(models.FacturaCompra)
    if impuestos.rif_valido(body.proveedor_rif or ""):
        # Las facturas se guardan con el RIF ya normalizado.
        consulta = consulta.filter(
            models.FacturaCompra.proveedor_rif == impuestos.normalizar_rif(body.proveedor_rif)
        )
    elif body.proveedor_nombre.strip():
        # Sin RIF todavia (se esta tecleando) el nombre es lo que hay.
        nombre = body.proveedor_nombre.strip().lower()
        consulta = consulta.filter(func.lower(models.FacturaCompra.proveedor_nombre) == nombre)
    else:
        return []
    return [
        schemas.FacturaParecida(
            id=f.id, numero_factura=f.numero_factura, proveedor_nombre=f.proveedor_nombre,
            fecha=f.fecha, total=f.total,
        )
        for f in consulta.order_by(models.FacturaCompra.id.desc()).all()
        if _numero_normalizado(f.numero_factura) == numero
    ]


def _aviso_de_precio(
    db: Session, renglon: schemas.RenglonARevisar, ingrediente: models.Ingrediente
) -> Optional[schemas.AvisoPrecio]:
    costo = renglon.costo_unitario
    if costo <= 0:
        return None
    anteriores = [
        c["costo_unitario"]
        for c in reposicion.historial_de_costos(db, ingrediente.id, limite=MUESTRAS_DE_REFERENCIA)
        if c["costo_unitario"] and c["costo_unitario"] > 0
    ]
    if anteriores:
        referencia, base = statistics.median(anteriores), "compras"
    elif ingrediente.costo_unitario and ingrediente.costo_unitario > 0:
        referencia, base = ingrediente.costo_unitario, "promedio"
    else:
        return None  # nunca se compro ni tiene costo: no hay contra que comparar

    variacion = round((costo / referencia - 1) * 100, 1)
    nivel, mensaje = "normal", ""
    sospechoso = reposicion.salto_sospechoso(costo, referencia)
    if sospechoso:
        nivel, mensaje = "unidad", sospechoso["mensaje"]
    elif referencia / costo - 1 >= reposicion.SALTO_SOSPECHOSO_PCT / 100:
        # El mismo error al reves: la factura dice el precio de 1 kg y la
        # cantidad se tecleo en bultos, o el precio es por unidad de un
        # paquete que nosotros llevamos entero.
        nivel = "unidad"
        mensaje = (
            f"Ese precio es {referencia / costo:.0f} veces menor que lo que se venía "
            f"pagando. Revisa que precio y cantidad estén en {ingrediente.unidad}."
        )
    elif abs(variacion) >= PRECIO_FUERA_DE_LO_NORMAL_PCT:
        nivel = "alto" if variacion > 0 else "bajo"
        mensaje = (
            f"{'Subió' if variacion > 0 else 'Bajó'} {abs(variacion):.0f}% contra "
            + ("lo que se venía pagando." if base == "compras" else "su costo promedio.")
        )
    return schemas.AvisoPrecio(
        indice=renglon.indice, ingrediente_id=ingrediente.id, costo_unitario=costo,
        referencia=round(referencia, 4), base=base, muestras=len(anteriores),
        variacion_pct=variacion, nivel=nivel, mensaje=mensaje,
    )


@router.post("/revision", response_model=schemas.RevisionFactura)
def revisar_factura(body: schemas.RevisionFacturaRequest, db: Session = Depends(get_db)):
    """Lo que conviene mirar antes de darle Guardar. No bloquea nada: avisa.

    Sirve igual para una factura leida de una foto que para una tecleada.
    """
    ids = {r.ingrediente_id for r in body.items if r.ingrediente_id}
    ingredientes = {
        i.id: i for i in db.query(models.Ingrediente).filter(models.Ingrediente.id.in_(ids))
    } if ids else {}
    precios = []
    for renglon in body.items:
        ingrediente = ingredientes.get(renglon.ingrediente_id)
        if ingrediente is None:
            continue
        aviso = _aviso_de_precio(db, renglon, ingrediente)
        if aviso is not None:
            precios.append(aviso)
    rif_aviso, rif_sugerido = _revisar_rif(db, body.proveedor_rif)
    return schemas.RevisionFactura(
        duplicadas=_duplicadas(db, body), precios=precios,
        rif_aviso=rif_aviso, rif_sugerido=rif_sugerido,
    )


def _revisar_rif(db: Session, rif: str):
    propio = impuestos.normalizar_rif(impuestos.config(db).rif or "")
    if propio and impuestos.normalizar_rif(rif) == propio:
        return (
            "Ese es el RIF de la empresa (el comprador), no el del proveedor: "
            "va el del que emite la factura.",
            None,
        )
    if impuestos.rif_digito_ok(rif) is not False:
        return "", None
    leido = impuestos.normalizar_rif(rif)
    conocidos = {}
    for r, nombre in db.query(models.Proveedor.rif, models.Proveedor.nombre).filter(
        models.Proveedor.rif.isnot(None)
    ):
        conocidos.setdefault(impuestos.normalizar_rif(r), nombre)
    for r, nombre in db.query(models.FacturaCompra.proveedor_rif, models.FacturaCompra.proveedor_nombre).distinct():
        conocidos.setdefault(impuestos.normalizar_rif(r or ""), nombre)
    # Si ya se guardo antes, alguien lo comparo con el papel: no se avisa
    # en cada factura de ese proveedor.
    if leido in conocidos:
        return "", None
    parecidos = [
        (r, nombre) for r, nombre in conocidos.items()
        if len(r) == len(leido) and sum(a != b for a, b in zip(r, leido)) == 1
        and impuestos.rif_digito_ok(r)
    ]
    sugerido = schemas.RifConocido(rif=parecidos[0][0], nombre=parecidos[0][1]) if len(parecidos) == 1 else None
    # Hay RIF impresos que no pasan el calculo (Improal, J-33295782-8, en
    # todas sus facturas): por eso no se rechaza, y se dice que mire el papel.
    return (
        "El dígito verificador de este RIF no cuadra. Compáralo con el papel: "
        "si dice lo mismo, está bien leído y puedes dejarlo.",
        sugerido,
    )
    if fecha > hoy():
        return "La fecha de la factura no puede ser futura."
    declarada = (
        db.query(models.DeclaracionIva)
        .filter(models.DeclaracionIva.anio == fecha.year, models.DeclaracionIva.mes == fecha.month)
        .first()
    )
    if declarada:
        return (
            f"El IVA de {declarada.periodo} ya fue declarado: una factura con esa fecha "
            "cambiaría ese Libro de Compras. Consulta con quien lleva la contabilidad."
        )
    return ""


@router.post("/facturas/{factura_id}/soporte")
def adjuntar_soporte(
    factura_id: int, body: schemas.AdjuntarSoporteRequest, db: Session = Depends(get_db)
):
    factura = db.query(models.FacturaCompra).filter_by(id=factura_id).first()
    if factura is None:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    soporte = db.query(models.SoporteFactura).filter_by(id=body.soporte_id).first()
    if soporte is None:
        raise HTTPException(status_code=404, detail="Esa foto no existe")
    if soporte.factura_id == factura_id:
        return {"ok": True}  # reintento del mismo enganche
    if soporte.factura_id is not None:
        raise HTTPException(status_code=409, detail="Esa foto ya respalda otra factura")
    if factura.soporte is not None:
        raise HTTPException(status_code=409, detail="Esta factura ya tiene su foto")
    soporte.factura_id = factura_id
    db.commit()
    return {"ok": True}


@router.post("/facturas/{factura_id}/completar", response_model=schemas.CompletarFactura)
def completar_factura(
    factura_id: int, body: schemas.CompletarFacturaRequest, db: Session = Depends(get_db)
):
    """Todo lo de despues de guardar, en un pedido que se puede repetir.

    Guardar sigue siendo el POST de siempre. Lo que viene despues -enganchar
    la foto, que la memoria del proveedor aprenda, generar las alertas de
    precio- lo manda el navegador, y el wifi se puede caer justo ahi. Por eso
    es UN pedido y se puede mandar las veces que haga falta: la foto y la
    memoria van juntas en una transaccion y quedan marcadas en el soporte, asi
    que un reintento no aprende dos veces; las alertas ya eran idempotentes.
    """
    factura = (
        db.query(models.FacturaCompra)
        .options(joinedload(models.FacturaCompra.items))
        .filter_by(id=factura_id)
        .first()
    )
    if factura is None:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    return _completar(db, factura, body)


def _completar(
    db: Session, factura: models.FacturaCompra, body: schemas.CompletarFacturaRequest
) -> schemas.CompletarFactura:
    factura_id = factura.id
    foto, foto_perdida, aprendidas = False, False, 0
    soporte = None
    if body.soporte_id is not None:
        # Con candado: dos reintentos a la vez esperan uno al otro, y el
        # segundo ya ve la marca del primero.
        soporte = (
            db.query(models.SoporteFactura).filter_by(id=body.soporte_id).with_for_update().first()
        )
        # Ya no esta: el reintento llego despues de DIAS_FOTO_SUELTA y la
        # foto se limpio por suelta. La factura se queda sin foto y sin lo
        # que la memoria iba a aprender de ella, pero las alertas si salen:
        # un 404 aqui haria que el navegador descartara todo.
        foto_perdida = soporte is None
    if soporte is not None:
        if soporte.factura_id not in (None, factura_id):
            raise HTTPException(status_code=409, detail="Esa foto ya respalda otra factura")
        if not soporte.completada:
            if soporte.factura_id is None:
                otra = db.query(models.SoporteFactura).filter_by(factura_id=factura_id).first()
                if otra is not None:
                    raise HTTPException(status_code=409, detail="Esta factura ya tiene su foto")
                soporte.factura_id = factura_id
            if body.renglones:
                aprendidas = equivalencias.aprender_sin_confirmar(
                    db,
                    schemas.AprenderEquivalenciasRequest(
                        proveedor_rif=body.proveedor_rif,
                        proveedor_nombre=body.proveedor_nombre,
                        renglones=body.renglones,
                    ),
                )
            soporte.completada = True
            db.commit()
        foto = True
    elif body.renglones and not foto_perdida:
        raise HTTPException(
            status_code=400, detail="La memoria del proveedor solo aprende de facturas leídas de una foto"
        )

    alertas = alertas_precio.generar(db, factura)
    return schemas.CompletarFactura(
        foto=foto, foto_perdida=foto_perdida, aprendidas=aprendidas,
        alertas=[alerta_a_schema(a) for a in alertas],
    )


@router.post("/lectura/{soporte_id}/al-guardar")
def anotar_al_guardar(soporte_id: int, body: schemas.IntencionGuardar, db: Session = Depends(get_db)):
    """Antes de guardar la factura de esta foto: que hacer cuando quede
    guardada. Si despues el navegador no alcanza a completarla, la
    reconciliacion la reconoce por RIF y numero y lo hace sola."""
    soporte = db.query(models.SoporteFactura).filter_by(id=soporte_id).first()
    if soporte is None:
        raise HTTPException(status_code=404, detail="La foto ya no está guardada. Vuelve a cargarla.")
    if soporte.factura_id is not None:
        raise HTTPException(status_code=409, detail="Esa foto ya respalda otra factura")
    soporte.al_guardar = body.model_dump_json()
    db.commit()
    return {"ok": True}


@router.post("/lectura/reconciliar", response_model=schemas.Reconciliacion)
def reconciliar_endpoint(db: Session = Depends(get_db)):
    return schemas.Reconciliacion(completadas=reconciliar(db))


# Cuanto despues de anotar la intencion se busca su factura. Mas que los
# reintentos del navegador: es para la tablet que se apago y no volvio.
DIAS_RECONCILIAR_ALERTAS = 3


def reconciliar(db: Session) -> int:
    """Termina lo que quedo a medias despues de guardar, sin depender de la
    tablet que lo guardo: la foto con intencion anotada cuya factura ya existe
    se engancha y la memoria aprende; y las facturas recientes sin alertas de
    precio se revisan (es idempotente: las que ya tienen, quedan igual).
    Devuelve cuantas fotos se completaron."""
    completadas = 0
    soportes = (
        db.query(models.SoporteFactura)
        .filter(
            models.SoporteFactura.factura_id.is_(None),
            models.SoporteFactura.completada.isnot(True),
            models.SoporteFactura.al_guardar.isnot(None),
            models.SoporteFactura.al_guardar != "",
        )
        .all()
    )
    for soporte in soportes:
        try:
            intencion = schemas.IntencionGuardar.model_validate_json(soporte.al_guardar)
        except ValueError:
            continue
        rif = impuestos.normalizar_rif(intencion.proveedor_rif)
        candidatas = (
            db.query(models.FacturaCompra)
            .options(joinedload(models.FacturaCompra.items))
            .filter(
                models.FacturaCompra.proveedor_rif == rif,
                models.FacturaCompra.numero_factura == intencion.numero_factura.strip(),
                # La factura es de despues de la foto (con margen por relojes).
                models.FacturaCompra.fecha >= soporte.fecha - datetime.timedelta(minutes=10),
                ~models.FacturaCompra.id.in_(
                    db.query(models.SoporteFactura.factura_id).filter(models.SoporteFactura.factura_id.isnot(None))
                ),
            )
            .order_by(models.FacturaCompra.id.desc())
            .all()
        )
        # Dos facturas iguales sin foto: no se adivina cual es.
        if len(candidatas) != 1:
            continue
        try:
            _completar(db, candidatas[0], schemas.CompletarFacturaRequest(
                soporte_id=soporte.id, proveedor_rif=intencion.proveedor_rif,
                proveedor_nombre=intencion.proveedor_nombre, renglones=intencion.renglones,
            ))
            completadas += 1
        except HTTPException:
            db.rollback()

    # Las alertas de las facturas cargadas a mano (sin foto) que no
    # alcanzaron a pedirse.
    desde = ahora() - datetime.timedelta(days=DIAS_RECONCILIAR_ALERTAS)
    for factura in (
        db.query(models.FacturaCompra)
        .options(joinedload(models.FacturaCompra.items))
        .filter(models.FacturaCompra.fecha >= desde)
        .all()
    ):
        alertas_precio.generar(db, factura)
    return completadas


@router.get("/facturas/{factura_id}/soporte")
def ver_soporte(factura_id: int, db: Session = Depends(get_db)):
    soporte = db.query(models.SoporteFactura).filter_by(factura_id=factura_id).first()
    if soporte is None:
        raise HTTPException(status_code=404, detail="Esta factura no tiene foto")
    return Response(
        content=soporte.contenido,
        media_type=soporte.tipo_mime,
        # nosniff: el navegador lo trata como lo que dice ser y nada mas.
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )
