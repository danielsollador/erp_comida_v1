"""Conciliacion bancaria (Contabilidad, 23-oct), al estilo de Odoo.

El estado de cuenta se sube, se guarda, y cada movimiento termina explicado:

  1. Los cobros del sistema (pago movil, transferencia, lotes del punto) se
     reconocen solos (conciliacion.py). Ya estan en los libros con la venta.
  2. Lo que se repite cada mes y no es venta --comisiones, mantenimiento, el
     ITF, intereses-- lo explica una REGLA: "si el concepto dice COMIS y es un
     cargo, va a 6070 Comisiones bancarias". Las reglas se escriben una vez y
     aplican a todos los estados de cuenta que vengan.
  3. «Registrar en contabilidad» convierte lo que proponen las reglas en
     asientos contra la cuenta del banco, en dolares a la tasa BCV del dia
     del movimiento (los libros van en dolares; el banco, en bolivares).
  4. Lo que queda se resuelve a mano: a una cuenta, o ignorado.

Nada se asienta solo: las reglas proponen y la persona registra. Volver a
subir el mismo estado de cuenta no duplica movimientos (`huella`).
"""

import collections
import datetime
import hashlib
import re
import unicodedata
from typing import Dict, Iterable, List, Optional

from sqlalchemy.orm import Session

from . import conciliacion, contabilidad, models, schemas, tasas
from .timeutils import ahora, inicio_del_dia

CUENTA_BANCO = "1020"
ORIGEN = "conciliacion_banco"
# Palabras que no sirven para sugerir una regla: estan en todo.
_GENERICAS = {"de", "la", "el", "del", "a", "en", "por", "bca", "elect", "empresa", "pn", "trf", "p"}


class ErrorConciliacion(ValueError):
    """Lo que se pidio no se puede hacer; el mensaje dice por que."""


def _normal(texto: str) -> str:
    return unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode().lower()


def _huella(cuenta: str, m: conciliacion.Movimiento) -> str:
    base = f"{cuenta}|{m.fecha.isoformat()}|{m.monto:.2f}|{m.referencia}|{_normal(m.concepto)}|{m.saldo}"
    return hashlib.sha1(base.encode("utf-8")).hexdigest()


def _aplica(regla: models.ReglaBanco, linea: models.LineaExtracto) -> bool:
    if not regla.activa:
        return False
    if regla.sentido == "cargo" and linea.monto >= 0 or regla.sentido == "abono" and linea.monto <= 0:
        return False
    return _normal(regla.contiene).strip() in _normal(linea.concepto)


def _reglas(db: Session) -> List[models.ReglaBanco]:
    # La mas especifica primero: "COMIS. CR.I" antes que "COM".
    return sorted(db.query(models.ReglaBanco).filter(models.ReglaBanco.activa.is_(True)).all(),
                  key=lambda r: (-len(r.contiene.strip()), r.id))


def aplicar_reglas(db: Session, lineas: Iterable[models.LineaExtracto]) -> int:
    """Propone la cuenta de lo pendiente segun las reglas. No asienta nada."""
    reglas = _reglas(db)
    propuestas = 0
    for l in lineas:
        if l.estado not in ("pendiente", "propuesta") or l.regla_id is None and l.estado == "propuesta":
            continue
        regla = next((r for r in reglas if _aplica(r, l)), None)
        if regla:
            l.estado, l.regla_id, l.cuenta = "propuesta", regla.id, regla.cuenta
            l.detalle = f"Regla «{regla.nombre}»"
            propuestas += 1
        elif l.estado == "propuesta":
            l.estado, l.regla_id, l.cuenta, l.detalle = "pendiente", None, "", ""
    return propuestas


def subir(db: Session, nombre: str, contenido: bytes, usuario: str, cuenta: str = CUENTA_BANCO) -> models.ExtractoBanco:
    lectura = conciliacion.leer(nombre, contenido)
    if not contabilidad_tiene(db, cuenta):
        raise ErrorConciliacion(f"La cuenta {cuenta} no existe en el plan de cuentas.")
    # Primero se cruza con los cobros: marca cada movimiento que es un cobro.
    conciliacion.conciliar(db, lectura)
    vistas = {h for (h,) in db.query(models.LineaExtracto.huella).all()}
    extracto = models.ExtractoBanco(
        banco=lectura.banco, cuenta=cuenta, archivo=(nombre or "")[:200],
        desde=min(m.fecha for m in lectura.movimientos), hasta=max(m.fecha for m in lectura.movimientos),
        saldo_final=next((m.saldo for m in reversed(lectura.movimientos) if m.saldo is not None), None),
        descuadres=lectura.descuadres, cargado_en=ahora(), cargado_por=usuario,
    )
    db.add(extracto)
    db.flush()
    nuevas = []
    # Dos movimientos iguales en el mismo estado (sin saldo que los distinga,
    # en un CSV) son dos: la huella lleva cuantas veces se vio ese mismo.
    repetidos: Dict[str, int] = collections.Counter()
    for m in lectura.movimientos:
        base = _huella(cuenta, m)
        repetidos[base] += 1
        h = base if repetidos[base] == 1 else f"{base}#{repetidos[base]}"
        if h in vistas:
            continue  # ya se habia subido: no se duplica
        vistas.add(h)
        nuevas.append(models.LineaExtracto(
            extracto_id=extracto.id, fecha=m.fecha, concepto=m.concepto[:300], referencia=m.referencia[:60],
            monto=m.monto, saldo=m.saldo, huella=h, estado=m.estado, detalle=m.detalle[:300],
            pedidos=",".join(str(p) for p in m.pedidos),
        ))
    if not nuevas:
        db.rollback()
        raise ErrorConciliacion("Ese estado de cuenta ya estaba cargado: no tiene movimientos nuevos.")
    db.add_all(nuevas)
    db.flush()
    aplicar_reglas(db, nuevas)
    db.commit()
    db.refresh(extracto)
    return extracto


def contabilidad_tiene(db: Session, codigo: str) -> bool:
    return db.query(models.CuentaContable.id).filter_by(codigo=codigo).first() is not None


def _tasa(db: Session, fecha: datetime.date) -> Optional[float]:
    t = tasas.tasa_al(db, fecha)
    return t.bcv if t and t.bcv else None


def registrar(db: Session, extracto: models.ExtractoBanco, ids: Optional[List[int]] = None) -> int:
    """Asienta lo que proponen las reglas (o lo que se mando a una cuenta a
    mano). Un asiento por movimiento, como lo pide el auditor: cada renglon
    del banco tiene el suyo y se puede seguir."""
    hechas = 0
    for l in extracto.lineas:
        if l.estado != "propuesta" or (ids is not None and l.id not in ids):
            continue
        tasa = _tasa(db, l.fecha)
        if not tasa:
            raise ErrorConciliacion(f"No hay tasa BCV del {l.fecha:%d/%m/%Y}: cárgala en Tasa para registrar ese día.")
        if not contabilidad_tiene(db, l.cuenta):
            raise ErrorConciliacion(f"La cuenta {l.cuenta} no existe en el plan de cuentas.")
        usd = round(abs(l.monto) / tasa, 2)
        if usd < 0.01:
            l.estado, l.detalle = "ignorado", "Menos de un centavo de dólar: no se asienta."
            continue
        if l.monto < 0:
            partidas = [(l.cuenta, usd, 0.0), (extracto.cuenta, 0.0, usd)]
        else:
            partidas = [(extracto.cuenta, usd, 0.0), (l.cuenta, 0.0, usd)]
        asiento = contabilidad.crear_asiento(
            db, f"Banco: {l.concepto[:120]} (Bs {abs(l.monto):,.2f} a {tasa:,.2f})", partidas,
            origen=ORIGEN, referencia_id=l.id,
            fecha=inicio_del_dia(l.fecha) + datetime.timedelta(hours=12),
        )
        l.estado, l.asiento_id, l.tasa, l.monto_usd = "registrado", asiento.id, tasa, usd
        hechas += 1
    db.commit()
    return hechas


def marcar(db: Session, linea: models.LineaExtracto, accion: str, cuenta: str = "") -> None:
    if linea.estado == "registrado":
        raise ErrorConciliacion("Ese movimiento ya tiene su asiento: si estaba mal, anúlalo en Asientos.")
    if accion == "cuenta":
        if not contabilidad_tiene(db, cuenta):
            raise ErrorConciliacion(f"La cuenta {cuenta} no existe en el plan de cuentas.")
        linea.estado, linea.cuenta, linea.regla_id, linea.detalle = "propuesta", cuenta, None, "Elegida a mano"
    elif accion == "ignorar":
        linea.estado, linea.detalle = "ignorado", "Ignorado a mano"
    elif accion == "pendiente":
        linea.estado, linea.cuenta, linea.regla_id, linea.detalle = "pendiente", "", None, ""
    else:
        raise ErrorConciliacion("Acción desconocida.")
    db.commit()


def sugerencias(lineas: List[models.LineaExtracto], reglas: List[models.ReglaBanco]) -> List[schemas.SugerenciaRegla]:
    """Lo que mas se repite entre lo pendiente: candidatos a regla. "COMIS. CR.I
    OB" aparece 70 veces al mes; una regla y listo."""
    conteo: Dict[tuple, list] = collections.defaultdict(list)
    for l in lineas:
        if l.estado != "pendiente":
            continue
        palabras = [p for p in re.findall(r"[a-z]{3,}", _normal(l.concepto)) if p not in _GENERICAS][:2]
        if not palabras:
            continue
        conteo[(" ".join(palabras), "cargo" if l.monto < 0 else "abono")].append(l)
    salida = []
    for (texto, sentido), ls in sorted(conteo.items(), key=lambda x: -len(x[1])):
        if len(ls) < 3 or any(_normal(r.contiene) in texto for r in reglas):
            continue
        cuenta = "6070" if sentido == "cargo" and re.search(r"comis|mant|itf|igtf|cargo|cuota", texto) else ""
        salida.append(schemas.SugerenciaRegla(
            contiene=texto.upper(), sentido=sentido, veces=len(ls), total_bs=round(sum(abs(l.monto) for l in ls), 2),
            ejemplo=ls[0].concepto[:120], cuenta=cuenta,
        ))
    return salida[:6]


def _vista_linea(l: models.LineaExtracto) -> schemas.LineaConciliacion:
    return schemas.LineaConciliacion(
        id=l.id, fecha=l.fecha, concepto=l.concepto, referencia=l.referencia, monto=l.monto, estado=l.estado,
        detalle=l.detalle, pedidos=[int(p) for p in l.pedidos.split(",") if p.strip().isdigit()],
        cuenta=l.cuenta, asiento_id=l.asiento_id, monto_usd=l.monto_usd,
    )


def vista(db: Session, extracto: models.ExtractoBanco) -> schemas.DetalleExtracto:
    lineas = sorted(extracto.lineas, key=lambda l: (l.fecha, l.id))
    por_estado: Dict[str, List[models.LineaExtracto]] = collections.defaultdict(list)
    for l in lineas:
        por_estado[l.estado].append(l)
    def total(estado): return round(sum(abs(l.monto) for l in por_estado[estado]), 2)
    explicadas = sum(len(por_estado[e]) for e in ("cobro", "registrado", "ignorado"))
    nombres = {c.codigo: c.nombre for c in db.query(models.CuentaContable).all()}
    reglas = db.query(models.ReglaBanco).order_by(models.ReglaBanco.id).all()
    return schemas.DetalleExtracto(
        id=extracto.id, banco=extracto.banco, cuenta=extracto.cuenta, archivo=extracto.archivo,
        desde=extracto.desde, hasta=extracto.hasta, saldo_final=extracto.saldo_final, descuadres=extracto.descuadres,
        movimientos=len(lineas), conciliado_pct=round(100 * explicadas / len(lineas), 1) if lineas else 0,
        resumen=[schemas.ResumenEstado(estado=e, movimientos=len(por_estado[e]), total_bs=total(e))
                 for e in ("cobro", "registrado", "propuesta", "pendiente", "ignorado")],
        lineas=[_vista_linea(l) for l in lineas],
        sugerencias=sugerencias(lineas, reglas),
        cuentas={k: v for k, v in nombres.items()},
    )


def resumen_de(e: models.ExtractoBanco) -> schemas.ExtractoResumen:
    pendientes = sum(1 for l in e.lineas if l.estado in ("pendiente", "propuesta"))
    return schemas.ExtractoResumen(id=e.id, banco=e.banco, archivo=e.archivo, desde=e.desde, hasta=e.hasta,
                                   movimientos=len(e.lineas), pendientes=pendientes, cargado_en=e.cargado_en)


def vista_regla(r: models.ReglaBanco) -> schemas.Regla:
    return schemas.Regla(id=r.id, nombre=r.nombre, contiene=r.contiene, sentido=r.sentido, cuenta=r.cuenta, activa=r.activa)
