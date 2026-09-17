"""Que puede hacer cada rol. Una sola tabla, consultada por el middleware.

DOS MUNDOS, Y NO SE MIRAN. `admin` es el rol INTERNO de Vertigo --la empresa
que opera la plataforma-- y no es un rol del restaurante: no aparece en la
lista de nadie que no sea Vertigo, no se lo puede asignar nadie mas, y el
local no tiene por que enterarse de que existe. Dentro del negocio el rol mas
alto es `dueno`, y por encima de el no hay nada que el pueda ver: ni otros
locales, ni la gente de Vertigo, ni los roles que otro local se invento.

UN ROL ES UNA LISTA DE MODULOS. Los cuatro de fabrica son atajos sobre esa
misma lista, y el dueño puede crear los suyos (ver `roles.py`) cuando ninguno
le sirve: un mesonero que solo toma pedidos, un encargado sin acceso a la
contabilidad. Antes el rol se describia con una frase ("Mostrador: vende,
cobra, cierra caja") y esa frase no dice lo unico que importa al repartir una
llave: A QUE PANTALLAS ENTRA.

  admin   Vertigo: el equipo que opera la plataforma. Administra TODOS los
          locales desde el hub (vertigopro.tech), crea dueños, y dentro de
          cualquier local puede todo. No es un rol del restaurante.
  dueno   El dueño del negocio. Dentro de SU local puede todo: contabilidad,
          impuestos, respaldos y las cuentas de su gente. No ve otros locales
          ni la administracion de Vertigo.
  caja    Quien atiende el mostrador: vende, cobra, anula, cierra caja, carga
          compras e inventario, ve reportes. No toca contabilidad ni impuestos
          ni las cuentas de los demas.
  cocina  Solo la pantalla de cocina: ve las comandas y las marca preparadas o
          listas. No crea pedidos ni cobra.

El rol viaja dentro de la sesion firmada, no en la peticion: si lo mandara el
navegador, ser administrador seria escribir "admin" en un JSON.
"""
from __future__ import annotations

from .. import settings
from . import roles as roles_a_medida

ROLES = ("admin", "dueno", "caja", "cocina")

DESCRIPCION = {
    "admin": "Vertigo: administra todos los locales y crea dueños.",
    "dueno": "Dueño: todo dentro de su local, incluidos los usuarios de su gente.",
    "caja": "Mostrador: vende, cobra, cierra caja, compras e inventario.",
    "cocina": "Cocina: solo ve las comandas y las marca listas.",
}

# ── Los modulos del ERP ─────────────────────────────────────────────────────
#
# La misma lista que se ve en la barra lateral, y las rutas de API que necesita
# cada uno:
#   rutas        acceso completo (leer y escribir)
#   lectura      solo GET; lo que el modulo necesita mirar pero no le pertenece
#                (el POS lee el menu, no lo edita)
#   escribe_solo excepciones puntuales de escritura, por sufijo o prefijo de
#                ruta. Es lo que hace que la cocina pueda marcar una comanda
#                lista sin poder crear pedidos ni cobrar.
MODULOS: dict[str, dict] = {
    "pos": {
        "nombre": "Punto de venta",
        "rutas": ("/api/pedidos",),
        "lectura": ("/api/menu", "/api/puntos-venta", "/api/operadores", "/api/inventario"),
    },
    "cocina": {
        "nombre": "Cocina",
        "rutas": (),
        "lectura": ("/api/pedidos", "/api/menu"),
        "escribe_solo": ("/api/pedidos/items/", "/marcar-listo"),
    },
    "reportes": {"nombre": "Reportes", "rutas": (), "lectura": ("/api/reportes",)},
    "ventas": {"nombre": "Ventas", "rutas": (), "lectura": ("/api/ventas",)},
    "menu": {"nombre": "Menú", "rutas": ("/api/menu",), "lectura": ("/api/inventario",)},
    "recetas": {
        "nombre": "Recetas",
        "rutas": ("/api/inventario/recetas",),
        "lectura": ("/api/inventario", "/api/menu"),
    },
    "inventario": {"nombre": "Inventario", "rutas": ("/api/inventario",)},
    "compras": {
        "nombre": "Compras",
        "rutas": ("/api/compras",),
        "lectura": ("/api/inventario",),
    },
    "caja": {
        "nombre": "Cierre de caja",
        "rutas": ("/api/caja", "/api/puntos-venta"),
        "lectura": ("/api/pedidos", "/api/reportes"),
    },
    "tasa": {"nombre": "Tasa de cambio", "rutas": ("/api/tasas", "/api/config")},
    "contabilidad": {"nombre": "Contabilidad", "rutas": ("/api/contabilidad", "/api/respaldos")},
    "impuestos": {"nombre": "Impuestos", "rutas": ("/api/impuestos",)},
    "usuarios": {"nombre": "Usuarios", "rutas": ("/api/usuarios",)},
}

# Los roles de fabrica a los que el local puede recortarles modulos.
#
# `dueno` NO: es el rol mas alto del negocio y el unico que reparte usuarios,
# asi que quitarle un modulo seria la unica forma de que nadie en el local
# pudiera volver a ponerselo. `admin` tampoco: es de Vertigo, no del negocio.
AJUSTABLES = ("caja", "cocina")

# Los modulos que un rol a medida puede incluir. `usuarios` NO: repartir
# cuentas es del dueño, y ademas los routers de usuarios exigen rol de
# administrador aparte del middleware -- un rol a medida con ese modulo pasaria
# el middleware y chocaria contra el router, que es la peor forma de fallar.
MODULOS_A_MEDIDA = tuple(m for m in MODULOS if m != "usuarios")

# Que modulos trae cada rol de fabrica.
_TODOS = tuple(MODULOS)
MODULOS_POR_ROL: dict[str, tuple[str, ...]] = {
    "admin": _TODOS,
    "dueno": _TODOS,
    "caja": ("pos", "cocina", "reportes", "ventas", "menu", "recetas", "inventario",
             "compras", "caja", "tasa"),
    "cocina": ("cocina",),
}

# Lo que solo quien administra (admin o dueño) puede ver. Contabilidad e
# impuestos son la utilidad real del negocio; los respaldos son la base
# completa; los usuarios, las llaves.
SOLO_ADMINISTRA = ("/api/contabilidad", "/api/impuestos", "/api/respaldos",
                   "/api/usuarios")

# La cartera de locales de Vertigo. Solo el equipo de la plataforma.
SOLO_VERTIGO = ("/api/agencia",)

# Lecturas que no comprometen nada y que las pantallas piden al cargar, sea
# quien sea: la tasa del dia y la configuracion (que hoy es solo la tasa).
LECTURA_LIBRE = ("/api/tasas", "/api/config")

# Los operadores y las cajas fisicas se LEEN desde el POS (para elegir caja),
# pero se crean y desactivan desde la administracion.
SOLO_ADMINISTRA_ESCRITURA = ("/api/operadores", "/api/puntos-venta")


def normalizar(rol: str | None) -> str:
    """El rol tal como se va a evaluar. Uno desconocido cae en `cocina`, que es
    el mas restringido: ante la duda, lo menos."""
    r = (rol or "").strip().lower()
    if r in ROLES:
        return r
    return r if roles_a_medida.existe(r) else "cocina"


def es_a_medida(rol: str | None) -> bool:
    return normalizar(rol) not in ROLES


def es_vertigo(rol: str | None) -> bool:
    """El equipo de la plataforma: ve todos los locales y el hub."""
    return normalizar(rol) == "admin"


def administra(rol: str | None) -> bool:
    """Administra un local: contabilidad, respaldos, cuentas. Admin y dueño."""
    return normalizar(rol) in ("admin", "dueno")


def opera(rol: str | None) -> bool:
    """Vende y cobra: admin, dueño, caja y cualquier rol con el punto de venta."""
    r = normalizar(rol)
    if r in ("admin", "dueno", "caja"):
        return True
    return "pos" in modulos_de(r)


def _local_actual() -> str | None:
    """El local de ESTE panel. En el hub no hay local: no hay nada que recortar."""
    return None if settings.ES_HUB else settings.LOCAL_SLUG


def es_ajustable(rol: str | None) -> bool:
    """Si a este rol se le pueden cambiar los modulos desde la pantalla."""
    r = normalizar(rol)
    return r in AJUSTABLES or es_a_medida(r)


def esta_ajustado(rol: str | None) -> bool:
    """Si este local ya le recorto los modulos a ese rol de fabrica."""
    r = normalizar(rol)
    return r in AJUSTABLES and roles_a_medida.ajuste(r, _local_actual()) is not None


def modulos_de(rol: str | None) -> tuple[str, ...]:
    """A que modulos entra este rol, con el recorte del local si lo hay."""
    r = normalizar(rol)
    if r in AJUSTABLES:
        propio = roles_a_medida.ajuste(r, _local_actual())
        if propio is not None:
            return propio
    if r in MODULOS_POR_ROL:
        return MODULOS_POR_ROL[r]
    return roles_a_medida.modulos_de(r)


def nombre_de(rol: str | None) -> str:
    """Como se llama el rol en pantalla."""
    r = normalizar(rol)
    if r in ROLES:
        return {"admin": "Vertigo", "dueno": "Dueño", "caja": "Caja", "cocina": "Cocina"}[r]
    ficha = roles_a_medida.buscar(r)
    return ficha["nombre"] if ficha else r


def descripcion_de(rol: str | None) -> str:
    r = normalizar(rol)
    if r in DESCRIPCION:
        return DESCRIPCION[r]
    ficha = roles_a_medida.buscar(r)
    return (ficha.get("descripcion") or "") if ficha else ""


def puede_modulo(rol: str | None, modulo: str) -> bool:
    return modulo in modulos_de(rol)


def roles_que_puede_asignar(rol: str | None, local: str | None = None) -> tuple[str, ...]:
    """Que roles puede repartir cada quien, EN ESTE ORDEN de jerarquia.

    Es tambien la lista que ve en pantalla, y por eso importa lo que NO trae:

      * `admin` (Vertigo) solo para Vertigo. Es el rol interno de la
        plataforma; que el dueño de un local lo viera listado ya seria
        contarle que existe un escalon por encima del suyo.
      * los roles a medida, solo los de SU local: viven en un archivo
        compartido con el hub, asi que sin filtrar el dueño de un local
        veria --y podria borrar-- los que se invento el vecino.
    """
    if es_vertigo(rol):
        return ROLES + tuple(r["id"] for r in roles_a_medida.listar())
    if administra(rol):
        return ("dueno", "caja", "cocina") + tuple(
            r["id"] for r in roles_a_medida.de_local(local))
    return ()


def _por_modulos(rol: str, metodo: str, ruta: str) -> bool:
    """Lo que un rol a medida puede hacer: SOLO lo que sus modulos nombran.

    Niega por defecto. Un modulo nuevo en el ERP no queda abierto por descuido:
    queda cerrado hasta que se declare en `MODULOS` y alguien lo agregue al
    rol.
    """
    escribe = metodo.upper() not in ("GET", "HEAD")
    for m in modulos_de(rol):
        d = MODULOS.get(m)
        if not d:
            continue
        if d.get("rutas") and ruta.startswith(tuple(d["rutas"])):
            return True
        if not escribe and d.get("lectura") and ruta.startswith(tuple(d["lectura"])):
            return True
        if escribe and any(p in ruta for p in d.get("escribe_solo", ())):
            return True
    return False


def permitido(rol: str | None, metodo: str, ruta: str) -> bool:
    """Si este rol puede hacer ESTA peticion. Se evalua con sesion ya valida."""
    r = normalizar(rol)
    metodo = metodo.upper()
    escribe = metodo not in ("GET", "HEAD")

    # La clave propia la cambia cada quien, sea el rol que sea.
    if ruta == "/api/usuarios/mi/clave":
        return True
    if ruta.startswith(SOLO_VERTIGO):
        return r == "admin"

    if r not in ROLES:
        # Rol a medida: la tasa del dia y la configuracion se leen siempre
        # (las pide cualquier pantalla al cargar); lo demas, solo sus modulos.
        if not escribe and ruta.startswith(LECTURA_LIBRE):
            return True
        return _por_modulos(r, metodo, ruta)

    if r in ("admin", "dueno"):
        return True

    # Un rol de fabrica QUE ESTE LOCAL RECORTO se evalua por sus modulos, que
    # niegan por defecto -- el mismo motor de los roles a medida. Sin recortar
    # sigue el camino de siempre, que es el que lleva años funcionando: nadie
    # cambia de cerradura por una pantalla que no toco.
    if esta_ajustado(r):
        if not escribe and ruta.startswith(LECTURA_LIBRE):
            return True
        return _por_modulos(r, metodo, ruta)

    if ruta.startswith(SOLO_ADMINISTRA):
        return False
    if escribe and ruta.startswith(SOLO_ADMINISTRA_ESCRITURA):
        return False
    if r == "caja":
        return True

    # cocina
    if not escribe:
        return ruta.startswith(("/api/pedidos", "/api/menu") + LECTURA_LIBRE)
    if metodo == "POST":
        return (ruta.startswith("/api/pedidos/items/")
                or ruta.endswith("/marcar-listo"))
    return False


def resumen(rol: str | None) -> dict:
    """Lo que el frontend necesita para esconder lo que no toca. Es comodidad
    visual: la cerradura es `permitido`, en el middleware."""
    r = normalizar(rol)
    return {"vertigo": r == "admin",
            "administrar": administra(r),
            "operar": opera(r),
            "cocina": True,
            # A que modulos entra: con esto la barra lateral muestra solo lo
            # suyo, sin que cada pantalla tenga que deducirlo del nombre del rol.
            "modulos": list(modulos_de(r))}
