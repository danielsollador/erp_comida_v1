"""Reemplazo atomico de un archivo, que aguanta a Windows.

POR QUE EXISTE. `users.json` y `roles.json` se escriben igual: a un temporal y
luego `os.replace`, para que un corte a mitad no deje a todo el local sin
poder entrar. En Linux --el servidor-- eso es atomico y no falla nunca.

En Windows no: el destino no se puede reemplazar mientras otro proceso lo
tiene abierto, y en un equipo gestionado el antivirus abre cada archivo recien
escrito para analizarlo. La ventana es de milisegundos, pero cae justo encima
del `replace` y el guardado falla con "Acceso denegado" cada tantas veces. Sin
esto, crear un usuario en la maquina de desarrollo falla al azar y el mensaje
que sale --"esa carpeta tiene que pertenecer al usuario del contenedor"--
manda a buscar el problema al sitio equivocado.

Reintentar unos milisegundos lo resuelve. En Linux el primer intento acierta
siempre, asi que no cuesta nada.
"""
from __future__ import annotations

import os
import time

# Cinco intentos en menos de medio segundo. Si despues de eso sigue bloqueado
# no es el antivirus: son permisos de verdad, y el error tiene que salir.
ESPERAS = (0.0, 0.02, 0.05, 0.1, 0.2)


def reemplazar(temporal, destino) -> None:
    """Mueve `temporal` sobre `destino`, reintentando si Windows lo bloquea."""
    for i, espera in enumerate(ESPERAS):
        if espera:
            time.sleep(espera)
        try:
            os.replace(temporal, destino)
            return
        except PermissionError:
            # El ultimo intento deja salir el error: a esas alturas ya no es
            # una ventana del antivirus.
            if i == len(ESPERAS) - 1:
                raise
