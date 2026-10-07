"""Comparar texto que escribio una persona.

POR QUE EXISTE. Media aplicacion identifica cosas por su nombre --la
categoria de envios, un insumo en la planilla de conteo-- y el nombre lo
escribe el dueño: con tilde o sin ella, en mayusculas, con un espacio de mas.
Comparar esas cadenas tal cual fallaba en silencio, y el silencio es lo
peligroso: la categoria de envios se duplicaba sola en el siguiente
despliegue y nadie relacionaba una cosa con la otra.

Es SOLO para comparar. Lo que se guarda y lo que se muestra es siempre el
texto tal como lo escribio el dueño.
"""

import unicodedata


def comparable(texto: str) -> str:
    """El texto listo para comparar: sin tildes, sin mayusculas y con los
    espacios colapsados.

    >>> comparable("  Azúcar  MORENA ") == comparable("azucar morena")
    True
    """
    plano = unicodedata.normalize("NFD", texto or "")
    sin_tildes = "".join(c for c in plano if not unicodedata.combining(c))
    return " ".join(sin_tildes.lower().split())


def nombre_limpio(texto: str) -> str:
    """El nombre como se guarda: sin espacios de mas ni palabras repetidas
    seguidas.

    Las palabras repetidas no son teoria: en produccion hubo una "crema de
    leche leche leche leche" (el dedo que se queda en el autocompletar del
    telefono). Se quita la repeticion SEGUIDA y nada mas: "pan de pan" es un
    nombre posible y se respeta.

    >>> nombre_limpio("  Crema de  leche Leche leche ")
    'Crema de leche'
    """
    palabras = (texto or "").split()
    limpias = []
    for p in palabras:
        if limpias and comparable(limpias[-1]) == comparable(p):
            continue
        limpias.append(p)
    return " ".join(limpias)
