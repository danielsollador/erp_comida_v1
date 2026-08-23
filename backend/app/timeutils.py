"""Manejo de fechas en hora local del local comercial.

El servidor corre en el mismo local (mini PC / laptop detras del mostrador),
asi que la hora local del sistema ES la hora del negocio. Usar utcnow() haria
que el "dia" cierre a las 8pm en Venezuela (UTC-4), partiendo las ventas de la
noche en dos dias distintos.
"""

import datetime

# strftime("%B") devuelve el mes en ingles segun el locale del sistema.
MESES_ES = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
]


def ahora() -> datetime.datetime:
    return datetime.datetime.now()


def inicio_del_dia(fecha: datetime.date) -> datetime.datetime:
    return datetime.datetime(fecha.year, fecha.month, fecha.day)


def hoy() -> datetime.date:
    return datetime.datetime.now().date()


def rango_periodo(periodo: str):
    """Devuelve (inicio, fin_exclusivo, etiqueta) para dia | semana | mes."""
    dia_actual = hoy()

    if periodo == "semana":
        inicio_fecha = dia_actual - datetime.timedelta(days=dia_actual.weekday())
        etiqueta = f"Semana del {inicio_fecha.strftime('%d/%m')}"
    elif periodo == "mes":
        inicio_fecha = dia_actual.replace(day=1)
        etiqueta = f"{MESES_ES[inicio_fecha.month - 1]} {inicio_fecha.year}"
    else:
        inicio_fecha = dia_actual
        etiqueta = dia_actual.strftime("%d/%m/%Y")

    inicio = inicio_del_dia(inicio_fecha)
    fin = inicio_del_dia(dia_actual) + datetime.timedelta(days=1)
    return inicio, fin, etiqueta
