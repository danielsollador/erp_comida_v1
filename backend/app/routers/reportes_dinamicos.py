"""Reportes a medida: catalogo, consulta, exportar y reportes guardados.

El motor esta en `reporte_dinamico.py`; aqui solo se traduce la peticion, se
aplican los permisos y se guardan las definiciones con nombre.
"""
import datetime
import json
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models, reporte_dinamico as rd
from ..acceso import auth, permisos
from ..database import get_db
from ..exportar_csv import nombre_de_archivo, respuesta_csv
from ..rango import Rango
from ..timeutils import ahora

router = APIRouter(prefix="/api/reportes/dinamico", tags=["reportes"])


class Definicion(BaseModel):
    fuente: str
    filas: List[str] = []
    columna: Optional[str] = None
    medidas: List[str] = []
    filtros: Dict[str, List[str]] = {}


class PedidoConsulta(Definicion):
    desde: datetime.date
    hasta: datetime.date


class PedidoValores(BaseModel):
    fuente: str
    campo: str
    desde: datetime.date
    hasta: datetime.date


class ReporteGuardadoIn(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=80)
    definicion: Definicion
    # El atajo de fechas con que abre ("mes", "7d"...), o None
    # para abrir con el periodo que este elegido en la pantalla.
    periodo: Optional[str] = None


# Los reportes que trae el sistema. Son las preguntas que ya hizo el cliente,
# y sirven de ejemplo de lo que se puede armar.
DE_FABRICA = [
    {"id": "f-cajera-dia", "nombre": "Ventas por cajera y día", "periodo": "mes",
     "definicion": {"fuente": "ventas", "filas": ["dia"], "columna": "cajera", "medidas": ["ventas"]}},
    {"id": "f-productos", "nombre": "Productos más vendidos", "periodo": "mes",
     "definicion": {"fuente": "productos", "filas": ["producto"], "medidas": ["unidades", "ventas", "pedidos"]}},
    {"id": "f-categoria-mes", "nombre": "Ventas por categoría y mes", "periodo": "anio",
     "definicion": {"fuente": "productos", "filas": ["categoria"], "columna": "mes", "medidas": ["ventas"]}},
    {"id": "f-hora-dia", "nombre": "Pedidos por hora y día de la semana", "periodo": "30d",
     "definicion": {"fuente": "ventas", "filas": ["hora"], "columna": "dia_semana", "medidas": ["pedidos"]}},
    {"id": "f-cobros-metodo", "nombre": "Cobros por método y día", "periodo": "semana",
     "definicion": {"fuente": "cobros", "filas": ["dia"], "columna": "metodo", "medidas": ["monto"]}},
    {"id": "f-compras-proveedor", "nombre": "Compras por proveedor", "periodo": "mes",
     "definicion": {"fuente": "compras", "filas": ["proveedor"], "medidas": ["monto", "documentos"]}},
    {"id": "f-mermas-insumo", "nombre": "Mermas por insumo y motivo", "periodo": "mes",
     "definicion": {"fuente": "mermas", "filas": ["insumo", "motivo"], "medidas": ["valor", "cantidad"]}},
]


def _ve_sensibles(request: Request) -> bool:
    return permisos.administra(auth.sesion_actual(request).get("rol"))


def _rango(desde: datetime.date, hasta: datetime.date):
    inicio, fin, etiqueta = Rango(desde=desde, hasta=hasta).resolver()
    return inicio, fin, etiqueta


def _consulta(p: PedidoConsulta) -> rd.Consulta:
    inicio, fin, _ = _rango(p.desde, p.hasta)
    return rd.Consulta(
        fuente=p.fuente, inicio=inicio, fin=fin, filas=p.filas, columna=p.columna,
        medidas=p.medidas, filtros=p.filtros,
    )


@router.get("/catalogo")
def catalogo(request: Request):
    return rd.catalogo(_ve_sensibles(request))


@router.post("/consulta")
def consultar(p: PedidoConsulta, request: Request, db: Session = Depends(get_db)):
    try:
        resultado = rd.consultar(db, _consulta(p), _ve_sensibles(request))
    except rd.ErrorDeConsulta as e:
        raise HTTPException(status_code=400, detail=str(e))
    resultado["etiqueta"] = _rango(p.desde, p.hasta)[2]
    return resultado


@router.post("/valores")
def valores(p: PedidoValores, db: Session = Depends(get_db)):
    inicio, fin, _ = _rango(p.desde, p.hasta)
    try:
        return rd.valores_posibles(db, p.fuente, p.campo, inicio, fin)
    except rd.ErrorDeConsulta as e:
        raise HTTPException(status_code=400, detail=str(e))


def _numero(v, formato: str):
    """Un conteo va sin decimales: "16", no "16.0", que Excel muestra igual
    pero confunde a quien abre el archivo en otro programa."""
    if v is None:
        return ""
    return int(round(v)) if formato == "entero" else v


@router.get("/exportar")
def exportar(q: str, request: Request, db: Session = Depends(get_db)):
    """El mismo resultado de la pantalla, como CSV para Excel.

    Por GET y con la consulta en `q` (JSON), como las demas exportaciones del
    ERP: un enlace normal, que la tablet descarga sin trucos de JavaScript.
    """
    try:
        p = PedidoConsulta.model_validate_json(q)
    except ValueError:
        raise HTTPException(status_code=400, detail="La consulta a exportar no se entiende.")
    try:
        r = rd.consultar(db, _consulta(p), _ve_sensibles(request))
    except rd.ErrorDeConsulta as e:
        raise HTTPException(status_code=400, detail=str(e))
    encabezados = [c["nombre"] for c in r["campos_fila"]]
    medidas = r["medidas"]
    if r["columna"]:
        for v in r["columna"]["valores"]:
            for m in medidas:
                encabezados.append(f"{v['etiqueta']} · {m['nombre']}" if len(medidas) > 1 else v["etiqueta"])
        encabezados += [f"Total · {m['nombre']}" if len(medidas) > 1 else "Total" for m in medidas]
    else:
        encabezados += [m["nombre"] for m in medidas]

    def celdas(valores: dict) -> list:
        salida = []
        if r["columna"]:
            for v in r["columna"]["valores"]:
                cel = valores.get("por_columna", {}).get(v["valor"], {})
                salida += [_numero(cel.get(m["id"]), m["formato"]) for m in medidas]
        salida += [_numero(valores["total"].get(m["id"]), m["formato"]) for m in medidas]
        return salida

    filas = [f["etiquetas"] + celdas(f) for f in r["filas"]]
    filas.append(["Total"] + [""] * (len(r["campos_fila"]) - 1) + celdas(r["totales"]) if r["campos_fila"]
                 else celdas(r["totales"]))
    nombre = nombre_de_archivo(f"reporte-{p.fuente}-{p.desde}-{p.hasta}") + ".csv"
    return respuesta_csv(nombre, encabezados, filas)


# ── Reportes guardados ───────────────────────────────────────────────────────


def _a_dict(r: models.ReporteGuardado) -> dict:
    datos = json.loads(r.definicion or "{}")
    return {
        "id": str(r.id),
        "nombre": r.nombre,
        "definicion": datos.get("definicion", {}),
        "periodo": datos.get("periodo"),
        "creado_por": r.creado_por or "",
        "de_fabrica": False,
    }


def _validar(db: Session, d: Definicion, request: Request) -> None:
    """Que la definicion se pueda abrir: fuente, campos y medidas existen y
    quien guarda puede ver lo que guarda."""
    fuente = rd.FUENTES.get(d.fuente)
    if fuente is None:
        raise HTTPException(400, f"No existe la fuente «{d.fuente}».")
    try:
        for c in d.filas + ([d.columna] if d.columna else []) + list(d.filtros):
            fuente.campo(c)
        medidas = [fuente.medida(m) for m in d.medidas]
    except rd.ErrorDeConsulta as e:
        raise HTTPException(400, str(e))
    if not medidas:
        raise HTTPException(400, "Elige al menos una medida.")
    if any(m.sensible for m in medidas) and not _ve_sensibles(request):
        raise HTTPException(403, "Costo y margen solo los ve quien administra el local.")


@router.get("/guardados")
def listar_guardados(db: Session = Depends(get_db)):
    propios = [_a_dict(r) for r in db.query(models.ReporteGuardado).order_by(models.ReporteGuardado.nombre)]
    fabrica = [{**f, "creado_por": "", "de_fabrica": True} for f in DE_FABRICA]
    return propios + fabrica


@router.post("/guardados")
def guardar(r: ReporteGuardadoIn, request: Request, db: Session = Depends(get_db)):
    _validar(db, r.definicion, request)
    fila = models.ReporteGuardado(
        nombre=r.nombre.strip(),
        fuente=r.definicion.fuente,
        definicion=json.dumps({"definicion": r.definicion.model_dump(), "periodo": r.periodo}),
        creado_por=auth.quien(request) or "",
        creado_en=ahora(),
        actualizado_en=ahora(),
    )
    db.add(fila)
    db.commit()
    db.refresh(fila)
    return _a_dict(fila)


def _el_guardado(db: Session, reporte_id: str, request: Request) -> models.ReporteGuardado:
    if not reporte_id.isdigit():
        raise HTTPException(400, "Los reportes del sistema no se cambian: guarda una copia con otro nombre.")
    fila = db.get(models.ReporteGuardado, int(reporte_id))
    if fila is None:
        raise HTTPException(404, "Ese reporte ya no existe.")
    # Lo cambia quien lo creo o quien administra el local.
    if not _ve_sensibles(request) and (fila.creado_por or "") != (auth.quien(request) or ""):
        raise HTTPException(403, "Solo quien lo creó o el dueño puede cambiar este reporte.")
    return fila


@router.put("/guardados/{reporte_id}")
def actualizar(reporte_id: str, r: ReporteGuardadoIn, request: Request, db: Session = Depends(get_db)):
    fila = _el_guardado(db, reporte_id, request)
    _validar(db, r.definicion, request)
    fila.nombre = r.nombre.strip()
    fila.fuente = r.definicion.fuente
    fila.definicion = json.dumps({"definicion": r.definicion.model_dump(), "periodo": r.periodo})
    fila.actualizado_en = ahora()
    db.commit()
    db.refresh(fila)
    return _a_dict(fila)


@router.delete("/guardados/{reporte_id}")
def borrar(reporte_id: str, request: Request, db: Session = Depends(get_db)):
    fila = _el_guardado(db, reporte_id, request)
    db.delete(fila)
    db.commit()
    return {"ok": True}
