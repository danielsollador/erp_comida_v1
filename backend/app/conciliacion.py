"""Conciliar el banco contra los cobros (22-oct).

El cierre de caja dice CUÁNTO falta en el banco; el estado de cuenta dice QUÉ
entró. Esto los cruza y deja a la vista las dos listas que importan:

  - cobrado en el sistema y no está en el banco: el pago móvil "ya te lo
    mandé" que nunca llegó, la transferencia anotada dos veces.
  - entró al banco y no es ningún cobro: un pago que nadie registró, o plata
    que no es venta (un préstamo, un aporte).

Cómo se cruza:
  - Pago móvil y transferencias, uno a uno: mismo monto en Bs (con una
    tolerancia mínima por redondeo de la tasa) y fecha del cobro o del día
    siguiente. Si hay varios candidatos, gana el que tiene la referencia.
  - Punto de venta, por día: el banco no abona cada tarjeta sino el lote del
    terminal (TD POS / TC POS), y lo abona ese día o el siguiente. Se
    compara la suma.

Lee el PDF del Banco Provincial tal como lo baja la banca en línea, o un CSV
o Excel de cualquier banco con fecha, descripción y monto (o débito y
crédito). Solo lee: no guarda el estado de cuenta ni toca ningún cobro.
"""

import csv
import datetime
import io
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from . import models, schemas, tasas
from .timeutils import inicio_del_dia

# Hasta cuánto pueden diferir los Bs de un cobro y del banco: la tasa del
# cobro y lo que de verdad mandó el cliente no siempre dan el mismo centavo.
TOLERANCIA_BS = 1.0
TOLERANCIA_PCT = 0.005
INDIVIDUALES = ("Pago movil", "Transferencia", "Banco")
PUNTO = ("Punto de venta", "Tarjeta")
ES_LOTE = re.compile(r"\b(TD|TC|TDD|TDC)\s*POS\b|\bPOS\b|\bLOTE\b", re.I)
ES_COMISION = re.compile(r"\bCOMIS|\bCOM\b|\bCOM\.|COMISION", re.I)


class ErrorDeLectura(ValueError):
    """El archivo no se pudo leer como estado de cuenta; el mensaje dice por qué."""


@dataclass
class Movimiento:
    fecha: datetime.date
    concepto: str
    monto: float  # + abono, - cargo
    referencia: str = ""
    saldo: Optional[float] = None


@dataclass
class Lectura:
    banco: str
    movimientos: List[Movimiento] = field(default_factory=list)
    # Renglones cuyo monto no cuadra con el saldo: si hay, la lectura no es fiable.
    descuadres: int = 0


# ── Leer el archivo ─────────────────────────────────────────────────────────

def numero(texto: str) -> float:
    """"1,234.56", "1.234,56", "-12,5" o "1234.5" a número."""
    t = (texto or "").strip().replace(" ", "").replace("Bs", "").replace("$", "")
    negativo = t.startswith("-") or (t.startswith("(") and t.endswith(")"))
    t = t.strip("-()")
    if "," in t and "." in t:
        t = t.replace(",", "") if t.rfind(".") > t.rfind(",") else t.replace(".", "").replace(",", ".")
    elif "," in t:
        t = t.replace(".", "").replace(",", ".") if len(t.split(",")[-1]) <= 2 else t.replace(",", "")
    if not t:
        raise ValueError("vacío")
    valor = float(t)
    return -valor if negativo else valor


def _fecha(texto: str) -> datetime.date:
    texto = texto.strip()
    for formato in ("%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d", "%d-%m-%y", "%d/%m/%y"):
        try:
            return datetime.datetime.strptime(texto[:10], formato).date()
        except ValueError:
            continue
    raise ValueError(f"fecha «{texto}»")


_RENGLON_PROVINCIAL = re.compile(
    r"^(?P<ref>\d{4,})\s+(?P<concepto>.*?)(?P<fvalor>\d{2}-\d{2}-\d{4})\s+(?P<monto>[\d,]+\.\d{2})"
    r"(?P<foper>\d{2}-\d{2}-\d{4})\s+(?P<saldo>-?[\d,]+\.\d{2})\s*$"
)
_SALDO_ANTERIOR = re.compile(r"SALDO ANTERIOR\s+(-?[\d,]+\.\d{2})")


def leer_provincial(texto: str) -> Lectura:
    """El PDF del Provincial, ya pasado a texto: un renglón por movimiento,
    con el monto sin signo. El signo sale del saldo, que de paso comprueba
    que no se perdió ni se leyó mal ningún renglón."""
    lectura = Lectura(banco="Banco Provincial")
    saldo = None
    for linea in texto.splitlines():
        linea = linea.strip()
        anterior = _SALDO_ANTERIOR.search(linea)
        if anterior and saldo is None:
            saldo = numero(anterior.group(1))
            continue
        m = _RENGLON_PROVINCIAL.match(linea)
        if not m:
            continue
        monto = numero(m["monto"])
        nuevo = numero(m["saldo"])
        if saldo is not None and abs((nuevo - saldo) - monto) <= 0.011:
            firmado = monto
        elif saldo is not None and abs((saldo - nuevo) - monto) <= 0.011:
            firmado = -monto
        else:
            lectura.descuadres += 1
            firmado = monto if saldo is None or nuevo >= saldo else -monto
        saldo = nuevo
        lectura.movimientos.append(Movimiento(
            fecha=_fecha(m["foper"]), concepto=" ".join(m["concepto"].split()),
            monto=round(firmado, 2), referencia=m["ref"], saldo=nuevo,
        ))
    return lectura


def _texto_del_pdf(contenido: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:  # pragma: no cover - la imagen lo trae
        raise ErrorDeLectura("El servidor no puede leer PDF todavía: sube el estado de cuenta en Excel o CSV.")
    try:
        lector = PdfReader(io.BytesIO(contenido))
        return "\n".join(p.extract_text() or "" for p in lector.pages)
    except Exception:
        raise ErrorDeLectura("No se pudo abrir el PDF. Si tiene clave, bájalo de nuevo sin clave o en Excel.")


def _clave(texto: str) -> str:
    t = unicodedata.normalize("NFKD", str(texto or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z]", "", t)


_COLUMNAS = {
    "fecha": ("fecha", "foper", "fechaoperacion", "fechavalor", "date"),
    "concepto": ("concepto", "descripcion", "detalle", "transaccion", "description"),
    "referencia": ("referencia", "ref", "nroreferencia", "numero", "documento"),
    "monto": ("monto", "importe", "montobs", "amount"),
    "cargo": ("cargo", "cargos", "debito", "debitos", "debe", "retiro"),
    "abono": ("abono", "abonos", "credito", "creditos", "haber", "deposito"),
    "saldo": ("saldo", "balance"),
}


def leer_tabla(filas: List[List[str]], banco: str = "Estado de cuenta") -> Lectura:
    """Un CSV o Excel de cualquier banco: busca la fila de títulos y lee
    fecha, descripción y el monto (o débito y crédito por separado)."""
    for i, fila in enumerate(filas[:30]):
        claves = [_clave(c) for c in fila]
        donde = {}
        for campo, nombres in _COLUMNAS.items():
            for j, k in enumerate(claves):
                if k in nombres and campo not in donde:
                    donde[campo] = j
        if "fecha" in donde and ("monto" in donde or "abono" in donde):
            break
    else:
        raise ErrorDeLectura("No encontré las columnas: hace falta una de fecha y una de monto (o débito y crédito).")

    lectura = Lectura(banco=banco)

    def celda(fila, campo):
        j = donde.get(campo)
        return str(fila[j]).strip() if j is not None and j < len(fila) and fila[j] is not None else ""

    for fila in filas[i + 1:]:
        try:
            fecha = _fecha(celda(fila, "fecha"))
        except ValueError:
            continue  # totales, renglones en blanco
        try:
            if "monto" in donde:
                monto = numero(celda(fila, "monto"))
            else:
                abono = numero(celda(fila, "abono")) if celda(fila, "abono") else 0.0
                cargo = numero(celda(fila, "cargo")) if celda(fila, "cargo") else 0.0
                monto = abs(abono) - abs(cargo)
        except ValueError:
            continue
        saldo = None
        if celda(fila, "saldo"):
            try:
                saldo = numero(celda(fila, "saldo"))
            except ValueError:
                pass
        lectura.movimientos.append(Movimiento(
            fecha=fecha, concepto=celda(fila, "concepto"), monto=round(monto, 2),
            referencia=celda(fila, "referencia"), saldo=saldo,
        ))
    return lectura


def leer(nombre: str, contenido: bytes) -> Lectura:
    nombre = (nombre or "").lower()
    if nombre.endswith(".pdf") or contenido[:4] == b"%PDF":
        texto = _texto_del_pdf(contenido)
        lectura = leer_provincial(texto)
        if not lectura.movimientos:
            raise ErrorDeLectura("Ese PDF no tiene el formato del Banco Provincial. Bájalo en Excel o CSV y súbelo así.")
    elif nombre.endswith((".xlsx", ".xlsm")):
        from openpyxl import load_workbook

        try:
            libro = load_workbook(io.BytesIO(contenido), read_only=True, data_only=True)
        except Exception:
            raise ErrorDeLectura("No se pudo abrir el Excel.")
        hoja = libro.worksheets[0]
        filas = [[("" if c is None else (c.strftime("%d/%m/%Y") if isinstance(c, (datetime.date, datetime.datetime)) else str(c))) for c in f]
                 for f in hoja.iter_rows(values_only=True)]
        lectura = leer_tabla(filas)
    else:
        try:
            texto = contenido.decode("utf-8-sig")
        except UnicodeDecodeError:
            texto = contenido.decode("latin-1")
        # El separador se prueba en vez de adivinarlo: los bancos ponen un
        # titulo suelto arriba y eso confunde al detector de csv.
        lectura = None
        for separador in (";", ",", "\t", "|"):
            try:
                lectura = leer_tabla(list(csv.reader(io.StringIO(texto), delimiter=separador)))
                break
            except ErrorDeLectura:
                continue
        if lectura is None:
            raise ErrorDeLectura("No encontré las columnas: hace falta una de fecha y una de monto (o débito y crédito).")
    if not lectura.movimientos:
        raise ErrorDeLectura("El archivo no trae movimientos.")
    return lectura


# ── Cruzar con los cobros ───────────────────────────────────────────────────

@dataclass
class _Cobro:
    metodo: str
    tipo: str
    pedido_id: int
    numero: int
    cliente: str
    fecha: datetime.datetime
    monto: float
    bs: float
    referencia: str


def _cobros(db: Session, desde: datetime.date, hasta: datetime.date) -> List[_Cobro]:
    inicio = inicio_del_dia(desde)
    fin = inicio_del_dia(hasta + datetime.timedelta(days=1))
    salida: List[_Cobro] = []
    pedidos = (
        db.query(models.Pedido)
        .filter(models.Pedido.estado == "pagado", models.Pedido.cerrado_en >= inicio, models.Pedido.cerrado_en < fin)
        .all()
    )
    for p in pedidos:
        if p.devuelto:
            continue
        for pago in p.pagos:
            if pago.metodo not in INDIVIDUALES + PUNTO:
                continue
            bs = pago.monto_bs if pago.monto_bs else pago.monto * (p.tasa_bcv or 0)
            salida.append(_Cobro(
                metodo="Punto de venta" if pago.metodo in PUNTO else ("Transferencia" if pago.metodo == "Banco" else pago.metodo),
                tipo="venta", pedido_id=p.id, numero=p.numero, cliente=p.cliente or "", fecha=p.cerrado_en,
                monto=round(pago.monto, 2), bs=round(bs, 2), referencia=(pago.referencia or "").strip(),
            ))
    tasa_de: Dict[datetime.date, float] = {}
    for a in db.query(models.AbonoFiado).filter(models.AbonoFiado.fecha >= inicio, models.AbonoFiado.fecha < fin).all():
        metodo = a.metodo_pago or ""
        if metodo not in INDIVIDUALES + PUNTO:
            continue
        dia = a.fecha.date()
        if dia not in tasa_de:
            t = tasas.tasa_al(db, dia)
            tasa_de[dia] = (t.bcv if t else 0) or 0
        salida.append(_Cobro(
            metodo="Punto de venta" if metodo in PUNTO else ("Transferencia" if metodo == "Banco" else metodo),
            tipo="abono", pedido_id=a.pedido_id, numero=a.pedido.numero if a.pedido else 0,
            cliente=(a.pedido.cliente or "") if a.pedido else "", fecha=a.fecha,
            monto=round(a.monto, 2), bs=round(a.monto * tasa_de[dia], 2), referencia=(a.referencia or "").strip(),
        ))
    salida.sort(key=lambda c: c.fecha)
    return salida


def _digitos(texto: str) -> str:
    return re.sub(r"\D", "", texto or "")


def _misma_referencia(cobro: _Cobro, mov: Movimiento) -> bool:
    """La referencia que anotó la cajera suele ser los últimos dígitos de la
    del banco; la del banco va en el concepto o en su columna."""
    ref = _digitos(cobro.referencia)
    if len(ref) < 4:
        return False
    numeros = re.findall(r"\d{4,}", f"{mov.concepto} {mov.referencia}")
    return any(n.endswith(ref[-6:]) or ref.endswith(n[-6:]) for n in numeros)


def _parecido(a: float, b: float) -> bool:
    return abs(a - b) <= max(TOLERANCIA_BS, TOLERANCIA_PCT * max(abs(a), abs(b)))


def _vista_cobro(c: _Cobro) -> schemas.CobroConciliable:
    return schemas.CobroConciliable(
        metodo=c.metodo, tipo=c.tipo, pedido_id=c.pedido_id, numero=c.numero, cliente=c.cliente,
        fecha=c.fecha, monto=c.monto, bs=c.bs, referencia=c.referencia,
    )


def _vista_mov(m: Movimiento) -> schemas.MovimientoBanco:
    return schemas.MovimientoBanco(fecha=m.fecha, concepto=m.concepto, monto=m.monto, referencia=m.referencia)


def conciliar(db: Session, lectura: Lectura) -> schemas.ResultadoConciliacion:
    movs = lectura.movimientos
    desde = min(m.fecha for m in movs)
    hasta = max(m.fecha for m in movs)
    abonos = [m for m in movs if m.monto > 0]
    lotes = [m for m in abonos if ES_LOTE.search(m.concepto)]
    sueltos = [m for m in abonos if not ES_LOTE.search(m.concepto)]
    comisiones = round(-sum(m.monto for m in movs if m.monto < 0 and ES_COMISION.search(m.concepto)), 2)

    # Un dia antes: lo que se cobro el ultimo dia del estado anterior entra
    # al banco el primero de este.
    cobros = _cobros(db, desde - datetime.timedelta(days=1), hasta)
    individuales = [c for c in cobros if c.metodo != "Punto de venta"]

    usados: set = set()
    pares: List[schemas.ParConciliado] = []
    sin_banco: List[schemas.CobroConciliable] = []
    for c in individuales:
        dia = c.fecha.date()
        candidatos = [
            (i, m) for i, m in enumerate(sueltos)
            if i not in usados and 0 <= (m.fecha - dia).days <= 1 and _parecido(c.bs, m.monto)
        ]
        if not candidatos:
            if dia >= desde:
                sin_banco.append(_vista_cobro(c))
            continue
        candidatos.sort(key=lambda x: (not _misma_referencia(c, x[1]), (x[1].fecha - dia).days, abs(x[1].monto - c.bs)))
        i, m = candidatos[0]
        usados.add(i)
        pares.append(schemas.ParConciliado(cobro=_vista_cobro(c), movimiento=_vista_mov(m),
                                           por_referencia=_misma_referencia(c, m)))
    sin_sistema = [_vista_mov(m) for i, m in enumerate(sueltos) if i not in usados]

    # El punto, por dia: lo cobrado el dia D contra los lotes de D o D+1.
    por_dia: Dict[datetime.date, float] = {}
    for c in cobros:
        if c.metodo == "Punto de venta":
            por_dia[c.fecha.date()] = por_dia.get(c.fecha.date(), 0.0) + c.bs
    lotes_dia: Dict[datetime.date, List[Movimiento]] = {}
    for m in lotes:
        lotes_dia.setdefault(m.fecha, []).append(m)
    dias_usados: set = set()
    puntos: List[schemas.DiaPunto] = []
    for dia in sorted(set(por_dia) | set(lotes_dia)):
        if dia not in por_dia:
            continue
        sistema = round(por_dia[dia], 2)
        opciones = [d for d in (dia, dia + datetime.timedelta(days=1)) if d in lotes_dia and d not in dias_usados]
        if opciones:
            elegido = min(opciones, key=lambda d: (abs(sum(l.monto for l in lotes_dia[d]) - sistema), d))
            dias_usados.add(elegido)
            banco = round(sum(l.monto for l in lotes_dia[elegido]), 2)
            puntos.append(schemas.DiaPunto(fecha=dia, fecha_banco=elegido, sistema_bs=sistema, banco_bs=banco,
                                           diferencia_bs=round(banco - sistema, 2), lotes=len(lotes_dia[elegido])))
        elif dia >= desde:
            puntos.append(schemas.DiaPunto(fecha=dia, sistema_bs=sistema, banco_bs=0, diferencia_bs=-sistema, lotes=0))
    lotes_sueltos = [_vista_mov(m) for d, ms in sorted(lotes_dia.items()) if d not in dias_usados for m in ms]

    return schemas.ResultadoConciliacion(
        banco=lectura.banco, desde=desde, hasta=hasta, movimientos=len(movs), descuadres_lectura=lectura.descuadres,
        abonos_bs=round(sum(m.monto for m in abonos), 2), comisiones_bs=comisiones,
        conciliados=pares, sin_banco=sin_banco, sin_sistema=sin_sistema, puntos=puntos, lotes_sin_ventas=lotes_sueltos,
    )
