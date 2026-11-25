"""Gestion de la tasa de cambio del dia.

Dos cosas aparte (specs/tasa.md): la tasa OFICIAL, que el refresco escribe tal
como la publica el BCV (dolar, euro y paralelo) y nadie pisa, y la tasa de
COBRO, que el dueno elige --dolar, euro o una propia-- y es con la que se pasan
a bolivares los precios en divisa al cobrar. Muchos locales cobran a una tasa
propia y el sistema tiene que respetar esa decision sin tocar la oficial.
"""

import datetime
import logging
import threading
import time
from typing import Optional

from sqlalchemy.orm import Session

from . import models, rates
from .database import SessionLocal
from .timeutils import ahora, hoy

log = logging.getLogger("erp.tasas")

INTERVALO_REFRESCO_MIN = 30


def tasa_vigente(db: Session) -> Optional[models.TasaCambio]:
    """La tasa mas reciente que no sea del futuro.

    Se busca "la ultima hasta hoy" y no "la de hoy" a proposito: si el local
    abrio un lunes feriado sin internet y no hay fila de hoy, se sigue cobrando
    con la del viernes en vez de quedarse en cero.
    """
    return (
        db.query(models.TasaCambio)
        .filter(models.TasaCambio.fecha <= hoy())
        .order_by(models.TasaCambio.fecha.desc())
        .first()
    )


def tasa_al(db: Session, fecha: datetime.date) -> Optional[models.TasaCambio]:
    """La tasa que valia ese dia: la ultima guardada hasta esa fecha.

    Es la que pasa a bolivares una factura en dolares para el Libro de
    Compras: la de su fecha de emision, no la del dia en que se carga. Un
    sabado o un feriado no tienen fila propia y vale la del ultimo dia habil,
    igual que en `tasa_vigente`. None si no hay ninguna guardada hasta esa
    fecha (el ERP empezo a guardar tasas despues).
    """
    return (
        db.query(models.TasaCambio)
        .filter(models.TasaCambio.fecha <= fecha)
        .order_by(models.TasaCambio.fecha.desc())
        .first()
    )


ETIQUETAS_COBRO = {"bcv": "Dólar BCV", "eur": "Euro BCV", "manual": "Manual"}


def config_fila(db: Session) -> models.Configuracion:
    """La unica fila de parametros del local. Se crea la primera vez que se
    pide: no hace falta sembrarla al arrancar, y asi nunca hay dos filas
    peleando por ser "la" configuracion."""
    fila = db.query(models.Configuracion).first()
    if fila is None:
        fila = models.Configuracion(vender_sin_inventario=False)
        db.add(fila)
        db.commit()
        db.refresh(fila)
    return fila


def _fila_del_euro(db: Session) -> Optional[models.TasaCambio]:
    return (
        db.query(models.TasaCambio)
        .filter(models.TasaCambio.fecha <= hoy(), models.TasaCambio.eur.isnot(None))
        .order_by(models.TasaCambio.fecha.desc())
        .first()
    )


def euro_vigente(db: Session) -> Optional[float]:
    """El ultimo euro BCV guardado hasta hoy: si hoy el BCV no lo dio, se sigue
    con el de ayer en vez de caer al dolar sin avisar."""
    fila = _fila_del_euro(db)
    return fila.eur if fila else None


def aviso_euro_viejo(db: Session) -> Optional[str]:
    """El euro guardado es de un dia anterior al del dolar: se sigue cobrando
    con el, pero se dice, para que alguien lo cargue a mano si hace falta."""
    oficial, euro = tasa_vigente(db), _fila_del_euro(db)
    if oficial is None or euro is None or euro.fecha >= oficial.fecha:
        return None
    return (f"El euro es del {euro.fecha.strftime('%d/%m')}: el BCV no ha dado uno más nuevo. "
            "Si ya cambió, cárgalo a mano.")


def cobro(db: Session) -> dict:
    """Con que tasa se pasa a bolivares lo que se cobra: elegida por el dueno,
    aparte de la tasa oficial.

    bcv = el dolar de hoy; eur = el euro de hoy; manual = la que se escribio y
    dura hasta que se cambie (avisa si es de otro dia). Si la elegida no se
    puede cumplir (no hay euro, o falta la manual) cae al dolar y lo dice."""
    oficial = tasa_vigente(db)
    c = config_fila(db)
    fuente = c.tasa_cobro if c.tasa_cobro in ETIQUETAS_COBRO else "bcv"
    tasa, aviso = None, None
    if fuente == "eur":
        tasa = euro_vigente(db)
        if not tasa:
            fuente, aviso = "bcv", "No hay euro del BCV guardado: se cobra al dólar."
        else:
            aviso = aviso_euro_viejo(db)
    elif fuente == "manual":
        tasa = c.tasa_cobro_manual
        if not tasa:
            fuente, aviso = "bcv", "Falta la tasa manual: se cobra al dólar."
    if fuente == "bcv":
        tasa = oficial.bcv if oficial else None
    manual_en = c.tasa_cobro_manual_en if fuente == "manual" else None
    return {
        "fuente": fuente,
        "etiqueta": ETIQUETAS_COBRO[fuente],
        "tasa": tasa,
        "manual_en": manual_en.isoformat() if manual_en else None,
        "vieja": bool(manual_en and manual_en.date() < hoy()),
        "aviso": aviso,
    }


def tasa_de_cobro(db: Session) -> Optional[float]:
    """Bs por dolar con los que se cobra, se da el vuelto y se paga en bolivares."""
    return cobro(db)["tasa"]


def fijar_cobro(db: Session, fuente: str, manual: Optional[float] = None) -> dict:
    """Elige la tasa de cobro. No toca el dolar ni el euro del BCV."""
    c = config_fila(db)
    c.tasa_cobro = fuente
    if fuente == "manual":
        c.tasa_cobro_manual = manual
        c.tasa_cobro_manual_en = ahora()
    db.commit()
    return cobro(db)


def _pasar_manual_a_cobro(db: Session, fila: models.TasaCambio) -> None:
    """Una fila del dia marcada 'manual' es el parche de antes: el dueno pegaba
    en la casilla del dolar la tasa con la que queria cobrar. Ese valor pasa a
    ser la tasa de cobro manual, y la fila vuelve a ser la oficial."""
    c = config_fila(db)
    if (c.tasa_cobro or "bcv") == "bcv" and not c.tasa_cobro_manual:
        c.tasa_cobro, c.tasa_cobro_manual, c.tasa_cobro_manual_en = "manual", fila.bcv, fila.actualizado_en or ahora()
    fila.origen = "auto"


def refrescar(db: Session, forzar: bool = False) -> bool:
    """Baja las tasas reales y las guarda en la fila de hoy.

    Devuelve True si quedo con datos en vivo. Escribe siempre la tasa oficial;
    la tasa con la que se cobra es otra cosa (`cobro`) y no se toca. `forzar`
    solo se salta la cache de 10 minutos.
    """
    anclas = rates.obtener_anclas(forzar=forzar)
    if not anclas:
        return False

    # El BCV publica en la tarde la tasa que rige desde su "Fecha Valor", que
    # es el proximo dia habil. Guardarla en la fila de hoy hacia que lo que se
    # cobraba y facturaba esa tarde saliera a la tasa de manana. Va en su
    # fecha; hoy conserva la suya y solo se le actualiza el paralelo.
    valor = fecha_valor(anclas.get("actualizado"))
    if valor and valor > hoy():
        _guardar_futura(db, valor, anclas)
        return True

    fecha = hoy()
    fila = db.query(models.TasaCambio).filter(models.TasaCambio.fecha == fecha).first()

    if fila and fila.origen == "manual":
        _pasar_manual_a_cobro(db, fila)

    # Cada valor cae al anterior si su fuente fallo, en vez de perderse. Y
    # un salto absurdo no se guarda (QA nov: el euro paso de 999 a 6 de un dia
    # para otro por leer mal el punto de los miles): queda el anterior.
    previa = tasa_al(db, fecha - datetime.timedelta(days=1))
    bcv = razonable(anclas["bcv"], previa.bcv if previa else None, "bcv")
    # El euro se compara con el de ayer solo si el de ayer tenia sentido al
    # lado del dolar: el que se guardo mal (1,18 con el dolar en 897) no puede
    # impedir que entre el bueno.
    eur_previo = previa.eur if previa and previa.eur and bcv and 0.8 < previa.eur / bcv < 1.6 else None
    eur = razonable(anclas.get("eur"), eur_previo, "eur") or (fila.eur if fila else None)
    paralelo = anclas.get("paralelo") or (fila.paralelo if fila else None)
    if not bcv:
        return False

    if fila:
        fila.bcv = bcv
        fila.eur = eur
        fila.paralelo = paralelo
        fila.origen = "auto"
        fila.actualizado_en = ahora()
    else:
        db.add(
            models.TasaCambio(
                fecha=fecha, bcv=bcv, eur=eur, paralelo=paralelo, origen="auto"
            )
        )
    db.commit()
    return True


# Mas que esto contra la tasa anterior no es un dia de mercado: es un error de
# lectura o de tecleo.
SALTO_MAXIMO = 0.30
saltos_rechazados: dict = {}


def salto(nuevo: Optional[float], anterior: Optional[float]) -> float:
    if not nuevo or not anterior:
        return 0.0
    return abs(nuevo / anterior - 1)


def razonable(nuevo: Optional[float], anterior: Optional[float], que: str) -> Optional[float]:
    """El valor nuevo, o el anterior si el salto es absurdo (se anota)."""
    if salto(nuevo, anterior) > SALTO_MAXIMO:
        log.warning("Tasa %s descartada: %s contra %s el dia anterior", que, nuevo, anterior)
        saltos_rechazados[que] = {"leida": nuevo, "anterior": anterior, "en": ahora().isoformat()}
        return anterior
    saltos_rechazados.pop(que, None)
    return nuevo


def _bs(valor: float) -> str:
    """1400.0 -> '1.400,00': miles con punto y decimales con coma, solo en la cifra."""
    return f"{valor:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


def _texto_salto() -> Optional[str]:
    s = saltos_rechazados.get("bcv")
    if not s:
        return None
    return (f"El BCV publicó {_bs(s['leida'])} Bs y el día anterior era {_bs(s['anterior'])}: "
            "es un salto de más de 30 %, así que se dejó la anterior. "
            "Si es correcto, fíjala a mano en Tasa de cambio.")


_MESES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7,
    "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
}


def fecha_valor(texto: Optional[str]) -> Optional[datetime.date]:
    """'08 Octubre 2026' (lo que imprime el BCV) -> date. None si no se entiende."""
    partes = (texto or "").strip().lower().split()
    if len(partes) != 3 or partes[1] not in _MESES:
        return None
    try:
        return datetime.date(int(partes[2]), _MESES[partes[1]], int(partes[0]))
    except ValueError:
        return None


def _guardar_futura(db: Session, valor: datetime.date, anclas: dict) -> None:
    """La tasa ya publicada que rige desde `valor`, y hoy sin tocar su oficial."""
    futura = db.query(models.TasaCambio).filter(models.TasaCambio.fecha == valor).first()
    if futura is None:
        db.add(models.TasaCambio(fecha=valor, bcv=anclas["bcv"], eur=anclas.get("eur"), paralelo=anclas.get("paralelo"), origen="auto"))
    elif futura.origen != "manual":
        futura.bcv = anclas["bcv"]
        futura.eur = anclas.get("eur") or futura.eur
        futura.paralelo = anclas.get("paralelo") or futura.paralelo
        futura.actualizado_en = ahora()

    de_hoy = db.query(models.TasaCambio).filter(models.TasaCambio.fecha == hoy()).first()
    if de_hoy is not None and de_hoy.origen == "manual":
        # El parche de antes: la fila de hoy vuelve a ser la oficial (la ultima
        # publicada) y lo que se habia escrito pasa a tasa de cobro.
        previa = tasa_al(db, hoy() - datetime.timedelta(days=1))
        _pasar_manual_a_cobro(db, de_hoy)
        if previa is not None:
            de_hoy.bcv, de_hoy.eur = previa.bcv, previa.eur or de_hoy.eur
    if de_hoy is None:
        # Un sabado o la tarde de un feriado: hoy vale la ultima publicada
        # hasta hoy. Se le hace su fila para que no se lea como desactualizada.
        previa = tasa_al(db, hoy())
        if previa is not None:
            db.add(models.TasaCambio(fecha=hoy(), bcv=previa.bcv, eur=previa.eur, paralelo=anclas.get("paralelo") or previa.paralelo, origen="auto"))
    elif anclas.get("paralelo"):
        de_hoy.paralelo = anclas["paralelo"]
    db.commit()


def fijar_manual(db: Session, bcv: float, paralelo: Optional[float] = None) -> dict:
    """La tasa que el dueno escribe a mano con la que quiere cobrar hoy.

    Es la tasa de cobro 'manual': ya no se guarda en la casilla del dolar, que
    sigue siendo la oficial del BCV (specs/tasa.md). Solo si todavia no hay
    ninguna tasa guardada se crea la fila del dia para que haya con que
    convertir hasta que llegue la oficial."""
    fila = tasa_vigente(db)
    if fila is None:
        db.add(models.TasaCambio(fecha=hoy(), bcv=bcv, paralelo=paralelo, origen="manual"))
    elif paralelo is not None and fila.fecha == hoy():
        fila.paralelo = paralelo
    db.flush()
    return fijar_cobro(db, "manual", bcv)


def historial(db: Session, desde: datetime.date, hasta_exclusivo: datetime.date):
    return (
        db.query(models.TasaCambio)
        .filter(models.TasaCambio.fecha >= desde, models.TasaCambio.fecha < hasta_exclusivo)
        .order_by(models.TasaCambio.fecha.desc())
        .all()
    )


def estado(db: Session) -> dict:
    """Todo lo que la interfaz necesita saber de la tasa, en una sola llamada."""
    fila = tasa_vigente(db)
    semana = (
        db.query(models.TasaCambio)
        .filter(models.TasaCambio.fecha <= hoy() - datetime.timedelta(days=7))
        .order_by(models.TasaCambio.fecha.desc())
        .first()
    )

    bcv = fila.bcv if fila else None
    paralelo = fila.paralelo if fila else None
    brecha = round((paralelo / bcv - 1) * 100, 1) if bcv and paralelo else None
    # La misma cuenta contra el euro: quien cobra en euro quiere saber cuanto
    # le falta a su tasa para alcanzar al paralelo (Savora, 25-nov).
    eur = euro_vigente(db)
    brecha_eur = round((paralelo / eur - 1) * 100, 1) if eur and paralelo else None
    variacion = (
        round((bcv / semana.bcv - 1) * 100, 2) if bcv and semana and semana.bcv else None
    )
    # Solo lo que ya esta en memoria: bajar tasas aca podia colgar la peticion
    # hasta 45 segundos si las fuentes no responden, y este endpoint lo llama
    # el encabezado de TODAS las pantallas. Del refresco se encarga el hilo de
    # fondo, que si puede darse el lujo de esperar.
    anclas = rates.anclas_en_cache() or {}
    minutos_sin_contacto = rates.minutos_desde_ultima_conexion()

    return {
        "fecha": fila.fecha.isoformat() if fila else hoy().isoformat(),
        "bcv": bcv,
        "eur": eur,
        "paralelo": paralelo,
        "brecha_pct": brecha,
        "brecha_eur_pct": brecha_eur,
        "variacion_semana_pct": variacion,
        "origen": fila.origen if fila else None,
        "actualizado_en": fila.actualizado_en.isoformat() if fila and fila.actualizado_en else None,
        "en_vivo": rates.hay_conexion(),
        "minutos_sin_contacto": minutos_sin_contacto,
        "fuente_actualizada": anclas.get("actualizado"),
        # Vieja si es de otro dia, o si hace rato que no se logra hablar con
        # las fuentes: con el dolar moviendose, una tasa de hace horas ya
        # miente aunque sea del mismo dia.
        "desactualizada": bool(fila and fila.fecha < hoy())
        or (minutos_sin_contacto is None or minutos_sin_contacto > rates.MINUTOS_PARA_CONSIDERAR_CAIDA),
        "salto_rechazado": _texto_salto(),
        "cobro": cobro(db),
    }


def _loop_refresco():
    while True:
        db = SessionLocal()
        try:
            refrescar(db)
        except Exception as e:  # nunca debe tumbar el servidor
            log.warning("fallo el refresco de tasas: %s", e)
        finally:
            db.close()
        time.sleep(INTERVALO_REFRESCO_MIN * 60)


def iniciar_refresco_automatico():
    hilo = threading.Thread(target=_loop_refresco, daemon=True)
    hilo.start()
