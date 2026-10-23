"""Lo que la app del telefono pide al abrir, en UNA sola llamada.

POR QUE EXISTE. La portada pedia siete cosas en paralelo y el punto de venta
otras siete. En la laptop del local da igual; en el telefono con datos
moviles de Venezuela cada llamada tarda de uno a dos segundos y el servidor
las atiende de una en una por conexion: la portada tardaba diez segundos en
mostrar algo (Leider, 23-oct, medido en el log de la demo: las siete llegaron
repartidas en tres segundos y la pantalla espera a la ultima). Aqui el
servidor junta todo y lo manda de una vez; para el servidor es lo mismo.

Cada pieza es EXACTAMENTE la que devuelve su endpoint de siempre (se llaman
las mismas funciones): la app no aprende otro formato, solo deja de hacer
siete viajes. Lo que un rol no puede ver (cifras, arranque) viene en null.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import schemas
from ..acceso import auth, permisos
from ..database import get_db
from ..rango import Rango
from ..timeutils import hoy
from . import caja as caja_router
from . import impuestos as impuestos_router
from . import menu as menu_router
from . import operadores as operadores_router
from . import pagos as pagos_router
from . import pedidos as pedidos_router
from . import reportes as reportes_router

router = APIRouter(prefix="/api/app", tags=["app"])


class Inicio(BaseModel):
    resumen: Optional[schemas.ReporteResumen] = None
    pedidos: List[schemas.Pedido]
    cocina: List[schemas.Pedido]
    cobrar: List[schemas.Pedido]
    avisos: Optional[List[schemas.Aviso]] = None
    recorrido: Optional[schemas.Recorrido] = None
    arranque: Optional[schemas.ArranqueLocal] = None


class ArranquePos(BaseModel):
    categorias: List[schemas.Categoria]
    en_cocina: List[schemas.Pedido]
    listos: List[schemas.Pedido]
    por_entregar: List[schemas.Pedido]
    apertura: schemas.EstadoApertura
    puntos_venta: List[schemas.PuntoVenta]
    pabilo: schemas.EstadoPabilo
    fiscal: schemas.ConfiguracionFiscal


def _o_nada(fn):
    """Una pieza secundaria que falle (un aviso, el recorrido) no deja la
    portada en blanco: viene vacia y lo demas se muestra."""
    try:
        return fn()
    except Exception:  # noqa: BLE001
        return None


@router.get("/inicio", response_model=Inicio)
def inicio(request: Request, db: Session = Depends(get_db)):
    """La portada: lo mismo que pages/Inicio.tsx pide a pedazos."""
    s = auth.sesion_actual(request)
    puede = permisos.resumen(s.get("rol"))
    d = hoy()
    return Inicio(
        pedidos=pedidos_router.listar_pedidos(del_dia=True, db=db),
        cocina=pedidos_router.listar_pedidos(en_cocina=True, db=db),
        cobrar=pedidos_router.listar_pedidos(estado="listo", db=db),
        resumen=_o_nada(lambda: reportes_router.resumen(rango=Rango(desde=d, hasta=d), paso=None, categoria_id=[], producto_id=[], db=db)) if puede["ve_kpis"] else None,
        avisos=_o_nada(lambda: reportes_router.avisos(db)) if puede["ve_kpis"] else None,
        recorrido=_o_nada(lambda: reportes_router.recorrido(db)) if puede["ve_kpis"] else None,
        arranque=_o_nada(lambda: reportes_router.arranque(db)) if puede["administrar"] else None,
    )


@router.get("/pos", response_model=ArranquePos)
def pos(request: Request, db: Session = Depends(get_db)):
    """El punto de venta al abrir: el menu, lo que esta en el piso y la caja."""
    auth.sesion_actual(request)
    return ArranquePos(
        categorias=menu_router.listar_categorias(db),
        en_cocina=pedidos_router.listar_pedidos(en_cocina=True, db=db),
        listos=pedidos_router.listar_pedidos(estado="listo", db=db),
        por_entregar=pedidos_router.listar_pedidos(por_entregar=True, db=db),
        apertura=caja_router.estado_de_apertura(db=db),
        puntos_venta=operadores_router.listar_puntos(db),
        pabilo=pagos_router.estado(),
        fiscal=impuestos_router.obtener_config(db),
    )
