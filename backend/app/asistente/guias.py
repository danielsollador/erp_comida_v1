"""El mapa de la aplicación para armar guías paso a paso.

La IA arma la guía (qué pasos y qué decir en cada uno), pero SOLO puede
señalar lo que está en este mapa: cada clave es un elemento real de la
pantalla, marcado en el frontend con `data-guia`. Si inventa una clave, el
paso se descarta aquí y nunca llega a la pantalla. Así la guía no puede
apuntar a un botón que no existe.

Agregar un elemento = ponerle `data-guia="x"` en el frontend y una línea aquí.
"""
import re

from ..acceso import permisos

# clave: (ruta, data-guia, módulo que hace falta, qué es)
MAPA: dict = {
    "compras.cargar_factura": ("/compras", "seccion.nueva", "compras", "Pestaña «Cargar factura» del módulo Compras."),
    "compras.foto": ("/compras/nueva", "compras.foto", "compras", "Opción «Foto o archivo»: la IA lee la factura desde una foto o PDF."),
    "compras.a_mano": ("/compras/nueva", "compras.a-mano", "compras", "Opción «A mano»: escribir la factura renglón por renglón."),
    "compras.facturas": ("/compras/nueva", "seccion.facturas", "compras", "Pestaña «Facturas»: las compras ya cargadas."),
    "compras.alertas": ("/compras", "seccion.alertas", "compras", "Pestaña «Alertas»: mercancías que subieron de precio."),
    "compras.proveedores": ("/compras", "seccion.proveedores", "compras", "Pestaña «Proveedores»."),
    "menu.nuevo_producto": ("/menu", "menu.nuevo-producto", "menu", "Botón «+ Producto» de la categoría abierta en El menú."),
    "menu.recetas": ("/menu", "seccion.recetas", "recetas", "Pestaña «Recetas»: qué lleva cada producto y su costo."),
    "inventario.que_comprar": ("/inventario", "seccion.comprar", "inventario", "Pestaña «Qué comprar»: lista sugerida según lo que se gasta."),
    "inventario.control": ("/inventario", "seccion.control", "inventario", "Pestaña «Control»: conteos y mermas registradas."),
    "inventario.materia_prima": ("/inventario", "seccion.materia-prima", "inventario", "Almacén «Materia prima»."),
    "inventario.nueva_mercancia": ("/inventario/materia-prima", "inventario.nueva", "inventario", "Botón «Nueva mercancía» dentro de un almacén."),
    "inventario.conteo": ("/inventario/materia-prima", "inventario.conteo", "inventario", "Botón «Conteo físico»: contar lo que hay de verdad."),
    "caja.cierre": ("/caja", "caja.cerrar", "caja", "Botón «Hacer cierre de caja» (está en la portada de Caja): contar lo que hay en cada gaveta al final del día. Es el único paso del cierre."),
    "caja.gastos": ("/caja", "seccion.movimientos", "caja", "Pestaña «Gastos y retiros»: anotar un gasto pagado de la gaveta o un retiro del dueño. NO es parte del cierre."),
    "caja.historial": ("/caja", "seccion.historial", "caja", "Pestaña «Historial» de cierres."),
    "reportes.ventas": ("/reportes", "seccion.ventas", "reportes", "Reportes › Ventas."),
    "reportes.perdidas": ("/reportes", "seccion.perdidas", "reportes", "Reportes › Pérdidas (mermas)."),
    "reportes.a_medida": ("/reportes", "seccion.a_medida", "reportes", "Reportes › A medida: armar un reporte propio."),
    "config.usuarios": ("/configuracion", "seccion.usuarios", "usuarios", "Configuración › Usuarios."),
    "config.crear_usuario": ("/configuracion/usuarios", "usuarios.crear", "usuarios", "Botón «Crear usuario»."),
    "config.roles": ("/configuracion", "seccion.roles", "usuarios", "Configuración › Roles: a qué módulos entra cada rol."),
    "config.pago_movil": ("/configuracion", "seccion.pago-movil", "usuarios", "Configuración › Pago móvil: verificar pagos con el banco."),
    "config.lenguaje": ("/configuracion", "seccion.lenguaje", None, "Configuración › Lenguaje: palabras sencillas o técnicas."),
    "tasa.calculadora": ("/tasa", "seccion.calculadora", "tasa", "Tasa de cambio › Calculadora Bs ⇄ $."),
}


def claves_para(rol: str) -> dict:
    return {k: v for k, v in MAPA.items() if v[2] is None or permisos.puede_modulo(rol, v[2])}


def declaracion(rol: str) -> dict:
    claves = claves_para(rol)
    lista = "\n".join(f"- {k}: {v[3]}" for k, v in claves.items())
    return {
        "name": "armar_guia",
        "description": (
            "Arma una guía paso a paso que se recorre sobre la pantalla real, resaltando cada elemento. "
            "Úsala cuando el usuario pregunte CÓMO hacer algo en la aplicación. Entre 2 y 6 pasos, en el orden "
            "en que se tocan. Solo puedes usar estos elementos:\n" + lista
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "pasos": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "elemento": {"type": "string", "enum": list(claves)},
                            "titulo": {"type": "string", "description": "3 a 6 palabras."},
                            "texto": {"type": "string", "description": "Una o dos frases: qué tocar y qué va a pasar."},
                        },
                        "required": ["elemento", "titulo", "texto"],
                    },
                }
            },
            "required": ["pasos"],
        },
    }


def validar(rol: str, pasos: list) -> list:
    """Los pasos que existen y que este rol puede ver, ya listos para la pantalla."""
    claves = claves_para(rol)
    salida = []
    for p in pasos or []:
        k = (p or {}).get("elemento")
        if k not in claves:
            continue
        ruta, ancla, _, _ = claves[k]
        salida.append({"ruta": ruta, "ancla": ancla, "titulo": re.sub(r"^\s*(paso\s*)?\d+[.):-]\s*", "", str(p.get("titulo", "")), flags=re.I)[:60], "texto": str(p.get("texto", ""))[:280]})
    return salida[:6]
