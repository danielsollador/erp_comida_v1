"""Que puede hacer cada rol. Una sola tabla, consultada por el middleware.

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

ROLES = ("admin", "dueno", "caja", "cocina")

DESCRIPCION = {
    "admin": "Vertigo: administra todos los locales y crea dueños.",
    "dueno": "Dueño: todo dentro de su local, incluidas las cuentas de su gente.",
    "caja": "Mostrador: vende, cobra, cierra caja, compras e inventario.",
    "cocina": "Cocina: solo ve las comandas y las marca listas.",
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
    r = (rol or "").strip().lower()
    return r if r in ROLES else "cocina"


def es_vertigo(rol: str | None) -> bool:
    """El equipo de la plataforma: ve todos los locales y el hub."""
    return normalizar(rol) == "admin"


def administra(rol: str | None) -> bool:
    """Administra un local: contabilidad, respaldos, cuentas. Admin y dueño."""
    return normalizar(rol) in ("admin", "dueno")


def opera(rol: str | None) -> bool:
    """Vende y cobra: admin, dueño y caja."""
    return normalizar(rol) in ("admin", "dueno", "caja")


def roles_que_puede_asignar(rol: str | None) -> tuple[str, ...]:
    """Que cuentas puede crear cada quien. Un dueño no fabrica administradores
    de Vertigo ni otros dueños de otros locales."""
    if es_vertigo(rol):
        return ROLES
    if administra(rol):
        return ("dueno", "caja", "cocina")
    return ()


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
    if r in ("admin", "dueno"):
        return True
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
            "administrar": r in ("admin", "dueno"),
            "operar": r in ("admin", "dueno", "caja"),
            "cocina": True}
