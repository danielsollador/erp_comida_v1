"""Descargar una lista como CSV, listo para abrir en Excel.

No se uso una libreria de .xlsx (openpyxl) a proposito: un CSV lo abre Excel
igual de bien con doble clic, y evita meter una dependencia binaria pesada
solo para escribir filas y columnas.

El detalle que importa: Excel en Windows adivina la codificacion de un CSV, y
sin el BOM de UTF-8 decide que es Latin-1 y convierte cada tilde en un
simbolo raro. "José" sale "JosÃ©". El BOM al principio del archivo es lo que
le dice a Excel "esto es UTF-8 de verdad".
"""

import csv
import io
import re
import unicodedata
from typing import Iterable, Sequence

from fastapi.responses import StreamingResponse

BOM_UTF8 = "﻿"


def nombre_de_archivo(texto: str) -> str:
    """Un nombre de archivo seguro para el header HTTP, que solo admite
    Latin-1. La etiqueta de un rango trae guion largo (–) o tildes -"01/01 –
    02/01"-, y eso hacia reventar la respuesta entera con un 500 en vez de
    descargar el archivo."""
    sin_acentos = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^A-Za-z0-9._-]+", "-", sin_acentos).strip("-")


def csv_de(encabezados: Sequence[str], filas: Iterable[Sequence]) -> str:
    buffer = io.StringIO()
    buffer.write(BOM_UTF8)
    escritor = csv.writer(buffer)
    escritor.writerow(encabezados)
    for fila in filas:
        escritor.writerow(fila)
    return buffer.getvalue()


def respuesta_csv(nombre_archivo: str, encabezados: Sequence[str], filas: Iterable[Sequence]) -> StreamingResponse:
    contenido = csv_de(encabezados, filas)
    return StreamingResponse(
        iter([contenido]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{nombre_archivo}"'},
    )
