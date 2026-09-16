"""El filtro de fechas de todo el ERP: un solo sitio que entiende "desde /
hasta", y que sigue entendiendo lo que ya habia.

POR QUE EXISTE. Cada lista con fecha se filtraba a su manera: Reportes con
`periodo=dia|semana|mes`, los gastos con `dias=30`, las facturas con
`dias=60`, las mermas con `dias=30`, y el Libro de Ventas con `anio` y `mes`.
Ninguna dejaba pedir "del 3 al 17" ni "el trimestre pasado". Leider (16-sep):
"no has puesto filtros de fechas por ningun lado y eso es SUPER importante...
tanto filtros dinamicos donde puedas elegir tu, como filtros exactos: este
mes, mes anterior, 90 dias, este año".

COMO SE USA. El endpoint declara la dependencia y resuelve con SU valor por
defecto, que es lo que hacia antes:

    @router.get("/gastos")
    def listar_gastos(rango: Rango = Depends(), db=Depends(get_db)):
        inicio, fin, _ = rango.resolver(dias=30)

`desde` y `hasta` son fechas (AAAA-MM-DD), las dos INCLUSIVE: "del 1 al 16"
incluye el 16 entero. Por dentro se convierten a [inicio, fin) con `fin` a la
medianoche siguiente, que es como filtran todas las consultas del ERP.

LOS PARAMETROS VIEJOS SIGUEN VALIENDO. `periodo`, `anio`+`mes` y `dias` se
aceptan igual que antes: un enlace guardado, o el hub, no se rompen. Cuando
llegan `desde`/`hasta`, mandan ellos.
"""

import datetime
from typing import Optional

from fastapi import HTTPException, Query
from pydantic.fields import FieldInfo

from .timeutils import MESES_ES, hoy, inicio_del_dia, rango_periodo

# Mas de esto no es un filtro, es un volcado; y `_serie` por dias sobre veinte
# años daria siete mil puntos.
MAX_DIAS = 366 * 5


def _valor(v):
    return None if isinstance(v, FieldInfo) else v


class Rango:
    def __init__(
        self,
        desde: Optional[datetime.date] = Query(None, description="Primer dia, inclusive (AAAA-MM-DD)"),
        hasta: Optional[datetime.date] = Query(None, description="Ultimo dia, inclusive (AAAA-MM-DD)"),
        periodo: Optional[str] = Query(None, description="dia | semana | mes (forma vieja)"),
        anio: Optional[int] = Query(None),
        mes: Optional[int] = Query(None),
        dias: Optional[int] = Query(None, description="Los ultimos N dias (forma vieja)"),
    ):
        # Construido a mano (tests, otros routers) los defaults llegan como el
        # propio `Query(None)`, no como None: se limpian.
        self.desde = _valor(desde)
        self.hasta = _valor(hasta)
        self.periodo = _valor(periodo)
        self.anio = _valor(anio)
        self.mes = _valor(mes)
        self.dias = _valor(dias)

    @property
    def explicito(self) -> bool:
        """Si quien llama pidio un rango, o dejo el de la pantalla."""
        return any(v is not None for v in (self.desde, self.hasta, self.periodo, self.anio, self.mes, self.dias))

    def resolver(
        self, periodo: str = "dia", dias: Optional[int] = None
    ) -> tuple[datetime.datetime, datetime.datetime, str]:
        """(inicio, fin_exclusivo, etiqueta).

        `periodo` y `dias` son lo que vale si la peticion no trae nada: cada
        endpoint conserva asi su comportamiento de siempre.
        """
        if self.desde is not None or self.hasta is not None:
            d = self.desde or self.hasta
            h = self.hasta or self.desde
            assert d is not None and h is not None
            if d > h:
                d, h = h, d
            if (h - d).days > MAX_DIAS:
                raise HTTPException(400, f"El rango no puede pasar de {MAX_DIAS // 365} años.")
            return inicio_del_dia(d), inicio_del_dia(h) + datetime.timedelta(days=1), etiqueta(d, h)

        if self.anio and self.mes:
            if not 1 <= self.mes <= 12:
                raise HTTPException(400, "El mes va de 1 a 12.")
            return rango_periodo("mes", self.anio, self.mes)

        n = self.dias if self.dias is not None else dias
        if n is not None and self.periodo is None:
            n = max(1, min(n, MAX_DIAS))
            h = hoy()
            d = h - datetime.timedelta(days=n - 1)
            return inicio_del_dia(d), inicio_del_dia(h) + datetime.timedelta(days=1), etiqueta(d, h)

        p = self.periodo if self.periodo in ("dia", "semana", "mes") else periodo
        return rango_periodo(p)


def etiqueta(desde: datetime.date, hasta: datetime.date) -> str:
    """Como se nombra el rango en pantalla: "16/09/2026", "01/09 – 16/09/2026"."""
    if desde == hasta:
        if desde == hoy():
            return "Hoy"
        return desde.strftime("%d/%m/%Y")
    if desde.day == 1 and hasta == _fin_de_mes(desde):
        return f"{MESES_ES[desde.month - 1]} {desde.year}"
    if desde.year == hasta.year:
        return f"{desde.strftime('%d/%m')} – {hasta.strftime('%d/%m/%Y')}"
    return f"{desde.strftime('%d/%m/%Y')} – {hasta.strftime('%d/%m/%Y')}"


def _fin_de_mes(d: datetime.date) -> datetime.date:
    siguiente = datetime.date(d.year + (d.month // 12), (d.month % 12) + 1, 1)
    return siguiente - datetime.timedelta(days=1)


def granularidad(inicio: datetime.datetime, fin: datetime.datetime) -> str:
    """Con que paso se dibuja una serie de este rango: hora | dia | semana | mes.

    Un dia se mira por horas; hasta dos meses, por dias; hasta un año, por
    semanas; mas, por meses. Es lo que cabe en una pantalla sin que las
    etiquetas se pisen.
    """
    dias = (fin - inicio).days
    if dias <= 1:
        return "hora"
    if dias <= 62:
        return "dia"
    if dias <= 370:
        return "semana"
    return "mes"


def dias_transcurridos(inicio: datetime.datetime, fin: datetime.datetime) -> int:
    """Cuantos dias del rango ya pasaron (contando hoy). Para promedios.

    "Este mes" el dia 3 son 3 dias, no 30: dividir lo vendido entre los dias
    del mes entero daria una media artificialmente baja durante todo el mes.
    """
    tope = min(fin, inicio_del_dia(hoy()) + datetime.timedelta(days=1))
    return max(1, (tope - inicio).days)


def anterior(inicio: datetime.datetime, fin: datetime.datetime) -> tuple[datetime.datetime, datetime.datetime]:
    """La ventana inmediatamente anterior, del mismo tamaño."""
    duracion = fin - inicio
    return inicio - duracion, inicio


def serie(
    puntos, inicio: datetime.datetime, fin: datetime.datetime, paso: Optional[str] = None
) -> list[dict]:
    """Agrupa (fecha, monto) en el paso que toca, con los huecos en cero.

    `puntos` es un iterable de (datetime, monto). Devuelve una lista de
    {etiqueta, ventas, pedidos} ordenada en el tiempo, con TODOS los tramos
    del rango aunque no hayan vendido nada: un grafico que se salta los dias
    en cero esconde justo los dias que hay que mirar.
    """
    paso = paso or granularidad(inicio, fin)
    acumulado: dict[str, dict] = {}
    orden: list[str] = []

    def clave_de(t: datetime.datetime) -> str:
        if paso == "hora":
            return f"{t.hour:02d}:00"
        if paso == "dia":
            return t.strftime("%d/%m")
        if paso == "semana":
            lunes = (t - datetime.timedelta(days=t.weekday())).date()
            return lunes.strftime("%d/%m")
        return f"{MESES_ES[t.month - 1][:3]} {t.year % 100:02d}"

    # Los tramos del rango, todos, en orden.
    t = inicio
    if paso == "hora":
        for h in range(24):
            k = f"{h:02d}:00"
            acumulado[k] = {"etiqueta": k, "ventas": 0.0, "pedidos": 0}
            orden.append(k)
    else:
        if paso == "semana":
            t = inicio - datetime.timedelta(days=inicio.weekday())
        elif paso == "mes":
            t = inicio.replace(day=1)
        while t < fin:
            k = clave_de(t)
            if k not in acumulado:
                acumulado[k] = {"etiqueta": k, "ventas": 0.0, "pedidos": 0}
                orden.append(k)
            if paso == "dia":
                t += datetime.timedelta(days=1)
            elif paso == "semana":
                t += datetime.timedelta(days=7)
            else:
                t = datetime.datetime(t.year + (t.month // 12), (t.month % 12) + 1, 1)

    for fecha, monto in puntos:
        if fecha is None:
            continue
        k = clave_de(fecha)
        e = acumulado.get(k)
        if e is None:
            continue
        e["ventas"] += monto
        e["pedidos"] += 1

    salida = []
    for k in orden:
        e = acumulado[k]
        salida.append({"etiqueta": k, "ventas": round(e["ventas"], 2), "pedidos": int(e["pedidos"])})
    # Por horas: solo desde la primera venta hasta la ultima. Las 24 barras con
    # 16 en cero (de medianoche a la apertura) aplastaban las que importan.
    if paso == "hora":
        con_algo = [i for i, e in enumerate(salida) if e["pedidos"]]
        if con_algo:
            salida = salida[con_algo[0] : con_algo[-1] + 1]
        else:
            salida = []
    return salida
