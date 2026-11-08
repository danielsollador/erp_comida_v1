"""Descargar una lista como CSV o como Excel.

La mayoria de las listas salen en CSV, que Excel abre con doble clic. Cuando
hacen falta numeros y fechas de verdad, `respuesta_xlsx` da un .xlsx.

El detalle que importa: Excel en Windows adivina la codificacion de un CSV, y
sin el BOM de UTF-8 decide que es Latin-1 y convierte cada tilde en un
simbolo raro. "José" sale "JosÃ©". El BOM al principio del archivo es lo que
le dice a Excel "esto es UTF-8 de verdad".

Con `regional=True`, el CSV sale para un Excel de Venezuela, que separa con `;`
y usa la coma como decimal: con `,` y `.` todo cae en una sola columna o
1234.50 se lee 123450.
"""

import csv
import datetime
import io
import re
import unicodedata
from typing import Iterable, Sequence

from fastapi.responses import Response, StreamingResponse
from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

BOM_UTF8 = "﻿"
TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def nombre_de_archivo(texto: str) -> str:
    """Un nombre de archivo seguro para el header HTTP, que solo admite
    Latin-1. La etiqueta de un rango trae guion largo (–) o tildes -"01/01 –
    02/01"-, y eso hacia reventar la respuesta entera con un 500 en vez de
    descargar el archivo."""
    sin_acentos = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^A-Za-z0-9._-]+", "-", sin_acentos).strip("-")


def _celda_regional(valor):
    """Un texto que empieza con =, +, - o @ lleva un apostrofo delante: un CSV no
    tiene tipos, y Excel lo ejecutaria como formula. Con `lstrip` porque Excel
    tambien ignora los espacios y tabuladores del principio."""
    if isinstance(valor, str):
        return f"'{valor}" if valor.lstrip()[:1] in ("=", "+", "-", "@") else valor
    if isinstance(valor, float):
        return f"{valor:.2f}".replace(".", ",")
    if isinstance(valor, datetime.date):
        return valor.strftime("%d/%m/%Y")
    return valor


def csv_de(encabezados: Sequence[str], filas: Iterable[Sequence], regional: bool = False) -> str:
    buffer = io.StringIO()
    buffer.write(BOM_UTF8)
    escritor = csv.writer(buffer, delimiter=";" if regional else ",")
    escritor.writerow(encabezados)
    for fila in filas:
        escritor.writerow([_celda_regional(v) for v in fila] if regional else fila)
    return buffer.getvalue()


def respuesta_csv(
    nombre_archivo: str, encabezados: Sequence[str], filas: Iterable[Sequence], regional: bool = False
) -> StreamingResponse:
    contenido = csv_de(encabezados, filas, regional=regional)
    return StreamingResponse(
        iter([contenido]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{nombre_archivo}"'},
    )


def _escribir_celda(celda, valor) -> None:
    if isinstance(valor, str):
        # openpyxl convierte en formula lo que empieza con "=", y revienta con
        # caracteres de control: se limpia y se fuerza a texto, tambien al editar.
        celda.value = ILLEGAL_CHARACTERS_RE.sub("", valor)
        celda.data_type = "s"
        celda.number_format = "@"
        return
    celda.value = valor
    if isinstance(valor, float):
        celda.number_format = "#,##0.00"
    elif isinstance(valor, datetime.date):
        celda.number_format = "dd/mm/yyyy"


def xlsx_de(encabezados: Sequence[str], filas: Iterable[Sequence], hoja: str) -> bytes:
    libro = Workbook()
    ws = libro.active
    ws.title = hoja
    anchos = [len(e) for e in encabezados]
    for n, encabezado in enumerate(encabezados, start=1):
        ws.cell(1, n, encabezado).font = Font(bold=True)
    for i, fila in enumerate(filas, start=2):
        for n, valor in enumerate(fila, start=1):
            _escribir_celda(ws.cell(i, n), valor)
            anchos[n - 1] = max(anchos[n - 1], len(str(valor)))
    # Sin ancho, Excel muestra una fecha como ########.
    for n, ancho in enumerate(anchos, start=1):
        ws.column_dimensions[get_column_letter(n)].width = ancho + 3
    ws.freeze_panes = "A2"
    salida = io.BytesIO()
    libro.save(salida)
    return salida.getvalue()


def respuesta_xlsx(nombre_archivo: str, encabezados: Sequence[str], filas: Iterable[Sequence], hoja: str) -> Response:
    return Response(
        content=xlsx_de(encabezados, filas, hoja),
        media_type=TIPO_XLSX,
        headers={"Content-Disposition": f'attachment; filename="{nombre_archivo}"'},
    )
