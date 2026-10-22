"""El mapa de la aplicación para armar guías paso a paso.

La IA arma la guía (qué pasos y qué decir en cada uno), pero SOLO puede
señalar lo que está en este mapa: cada clave es un elemento real de la
pantalla, marcado en el frontend con `data-guia`. Si inventa una clave, el
paso se descarta aquí y nunca llega a la pantalla. Así la guía no puede
apuntar a un botón que no existe.

LOS RECORRIDOS (`RECORRIDOS`). La primera versión dejaba que la IA eligiera
los pasos y la guía de "¿cómo hago una receta?" se quedaba en la pestaña
Recetas, dos veces, sin entrar al armador (Leider, 22-oct-2026: "ni siquiera
me lleva a donde se arma la receta, ni cómo armarla"). Ahora las tareas
comunes tienen su recorrido real, probado en pantalla; la IA lo usa tal cual
y escribe qué hacer en cada paso. Para lo que no tiene recorrido, arma uno
con el mapa.

Cada elemento dice si se TOCA (la guía avanza sola cuando el dueño lo toca:
el paso siguiente suele estar en lo que ese toque abre), se ESCRIBE o se
MIRA (avanza con "Siguiente").

Agregar un elemento = ponerle `data-guia="x"` en el frontend y una línea aquí.
"""
import re

from ..acceso import permisos

T, E, M = "tocar", "escribir", "mirar"

# clave: (ruta, data-guia, módulo que hace falta, acción, qué es)
MAPA: dict = {
    # Compras
    "compras.cargar_factura": ("/compras", "seccion.nueva", "compras", T, "Pestaña «Cargar factura» del módulo Compras."),
    "compras.foto": ("/compras/nueva", "compras.foto", "compras", T, "Opción «Foto o archivo»: se toma la foto de la factura (o se sube el PDF) y la IA llena el formulario."),
    "compras.subir": ("/compras/nueva", "compras.subir", "compras", T, "Botón para tomar la foto de la factura (en teléfono o tablet: «Tomar foto de la factura» o «Elegir de la galería»; en la computadora: «Cargar factura desde foto o PDF»). Después la IA tarda unos segundos en leerla y llena el formulario."),
    "compras.a_mano": ("/compras/nueva", "compras.a-mano", "compras", T, "Opción «A mano»: escribir la factura renglón por renglón."),
    "compras.guardar": ("/compras/nueva", "compras.guardar", "compras", T, "Botón «Guardar factura», abajo, cuando ya se revisó lo que leyó la IA (proveedor, fecha, renglones y total). Nada se registra hasta tocarlo."),
    "compras.facturas": ("/compras", "seccion.facturas", "compras", T, "Pestaña «Facturas»: las compras ya cargadas."),
    "compras.alertas": ("/compras", "seccion.alertas", "compras", T, "Pestaña «Alertas»: mercancías que subieron de precio."),
    "compras.proveedores": ("/compras", "seccion.proveedores", "compras", T, "Pestaña «Proveedores»."),
    # Menú y producto nuevo
    "menu.nuevo_producto": ("/menu", "menu.nuevo-producto", "menu", T, "Botón «+ Producto» de la categoría abierta en El menú. Abre el cuadro «Nuevo producto»."),
    "producto.nombre": ("/menu", "producto.nombre", "menu", E, "Casilla «Nombre» del cuadro Nuevo producto (ej. Empanada de carne)."),
    "producto.precio": ("/menu", "producto.precio", "menu", E, "Casilla «Precio» del cuadro Nuevo producto. Es opcional: si se deja vacía, el botón dice «Crear y armar la receta» y el precio se calcula después con el margen."),
    "producto.crear": ("/menu", "producto.crear", "menu", T, "Botón «Crear producto» / «Crear y armar la receta». Al crearlo, el sistema abre directo el armador de su receta."),
    "menu.cambiar_precios": ("/menu", "menu.cambiar-precios", "menu", T, "Botón «Cambiar precios» de El menú: se escribe lo que se quiere cambiar (\"sube 10% las empanadas\") y se ve antes y después de cada precio antes de aplicar. También sirve para cambiar UN precio."),
    # Recetas
    "menu.recetas": ("/menu", "seccion.recetas", "recetas", T, "Pestaña «Recetas» del módulo Menú: la lista de productos con lo que cuesta hacerlos."),
    "recetas.lista": ("/menu/recetas", "recetas.lista", "recetas", T, "La lista de productos de Recetas. Se toca el producto para abrir su receta (los que no tienen dicen «Toca para crear la receta»). Si el producto tiene variantes (Carne, Pollo), primero se toca para desplegarlas y luego se toca la variante."),
    "recetas.agregar": ("/menu/recetas", "recetas.agregar", "recetas", T, "Dentro del armador, la lista «Toca lo que lleva»: cada mercancía que se toca entra a la receta como un renglón. Arriba hay una casilla «Buscar mercancía»."),
    "recetas.cantidad": ("/menu/recetas", "recetas.cantidad", "recetas", E, "El renglón de una mercancía ya agregada: en su casilla se escribe cuánto lleva para UNA unidad vendida. Viene en gramos o mililitros; tocando la unidad dentro de la casilla se cambia a kg o lt. A la derecha sale lo que cuesta."),
    "recetas.precio": ("/menu/recetas", "recetas.precio", "recetas", E, "Abajo a la izquierda del armador: «Precio de venta» y «Margen (% del precio)». Se escribe uno y el otro se calcula solo; encima se ve «Cuesta hacerlo»."),
    "recetas.guardar": ("/menu/recetas", "recetas.guardar", "recetas", T, "Botón «Guardar receta», arriba a la derecha del armador. Hasta tocarlo no se guarda nada."),
    "recetas.combo": ("/menu/recetas", "recetas.combo", "recetas", T, "Dentro del armador vacío, «¿Es un combo?»: se arma con productos del menú en vez de mercancía."),
    # Inventario
    "inventario.que_comprar": ("/inventario", "seccion.comprar", "inventario", T, "Pestaña «Qué comprar»: lista sugerida según lo que se gasta."),
    "inventario.control": ("/inventario", "seccion.control", "inventario", T, "Pestaña «Control»: conteos y mermas registradas."),
    "inventario.materia_prima": ("/inventario", "seccion.materia-prima", "inventario", T, "Almacén «Materia prima»."),
    "inventario.nueva_mercancia": ("/inventario/materia-prima", "inventario.nueva", "inventario", T, "Botón «Nueva mercancía» dentro de un almacén."),
    "inventario.conteo": ("/inventario/materia-prima", "inventario.conteo", "inventario", T, "Botón «Conteo físico»: contar lo que hay de verdad."),
    # Caja
    "caja.cierre": ("/caja", "caja.cerrar", "caja", T, "Botón «Hacer cierre de caja», abajo en la portada de Caja. Abre el cuadro «Contar la caja»."),
    "caja.conteo": ("/caja", "caja.conteo", "caja", E, "En el cuadro «Contar la caja», una casilla por forma de pago (Efectivo Bs, Efectivo $, Punto, Pago móvil...): se escribe lo que hay de verdad, en la moneda que dice cada una. Se cuenta antes de mirar lo que dice el sistema; lo que no se contó se deja en blanco (un 0 cuenta como faltante)."),
    "caja.conciliar": ("/caja", "caja.conciliar", "caja", T, "Botón «Cerrar y conciliar» al pie del cuadro de conteo: cierra el día y muestra lo que sobró o faltó."),
    "caja.registrar_gasto": ("/caja", "caja.registrar-gasto", "caja", T, "Enlace «Registrar uno» de Gastos y retiros en la portada de Caja: lleva a anotar un gasto pagado de la gaveta."),
    "caja.gastos": ("/caja", "seccion.movimientos", "caja", T, "Pestaña «Gastos y retiros»: anotar un gasto pagado de la gaveta o un retiro del dueño. NO es parte del cierre."),
    "caja.historial": ("/caja", "seccion.historial", "caja", T, "Pestaña «Historial» de cierres."),
    # Reportes
    "reportes.ventas": ("/reportes", "seccion.ventas", "reportes", T, "Reportes › Ventas."),
    "reportes.perdidas": ("/reportes", "seccion.perdidas", "reportes", T, "Reportes › Pérdidas (mermas)."),
    "reportes.a_medida": ("/reportes", "seccion.a_medida", "reportes", T, "Reportes › A medida: armar un reporte propio."),
    "reportes.pedir": ("/reportes/a_medida", "reportes.pedir", "reportes", E, "Casilla «Pídelo con tus palabras» de Reportes › A medida: se escribe el reporte que se quiere (\"empanadas por día esta semana\"), se toca Armar y se arma solo."),
    # Configuración
    "config.usuarios": ("/configuracion", "seccion.usuarios", "usuarios", T, "Configuración › Usuarios."),
    "config.crear_usuario": ("/configuracion/usuarios", "usuarios.crear", "usuarios", T, "Botón «Crear usuario» de Configuración › Usuarios. Abre el formulario."),
    "usuarios.datos": ("/configuracion/usuarios", "usuarios.datos", "usuarios", E, "Formulario de usuario nuevo: Nombre, Usuario para entrar (minúsculas, sin espacios), Rol (Caja, Cocina, Dueño...) y la contraseña dos veces (mínimo 8 caracteres). Debajo dice a qué módulos entra con ese rol."),
    "usuarios.guardar": ("/configuracion/usuarios", "usuarios.guardar", "usuarios", T, "Botón «Crear usuario» al pie del formulario."),
    "config.roles": ("/configuracion", "seccion.roles", "usuarios", T, "Configuración › Roles: a qué módulos entra cada rol."),
    "config.pago_movil": ("/configuracion", "seccion.pago-movil", "usuarios", T, "Configuración › Pago móvil: verificar pagos con el banco."),
    "config.lenguaje": ("/configuracion", "seccion.lenguaje", None, T, "Configuración › Lenguaje: palabras sencillas o técnicas."),
    "tasa.calculadora": ("/tasa", "seccion.calculadora", "tasa", T, "Tasa de cambio › Calculadora Bs ⇄ $."),
}

# Tareas comunes -> sus pasos reales, en orden. Probados en pantalla.
RECORRIDOS: dict = {
    "Armar (o cambiar) la receta de un producto que ya existe": [
        "menu.recetas", "recetas.lista", "recetas.agregar", "recetas.cantidad", "recetas.precio", "recetas.guardar"],
    "Crear un producto nuevo con su receta": [
        "menu.nuevo_producto", "producto.nombre", "producto.precio", "producto.crear",
        "recetas.agregar", "recetas.cantidad", "recetas.precio", "recetas.guardar"],
    "Cargar una factura de compra con foto": ["compras.cargar_factura", "compras.foto", "compras.subir", "compras.guardar"],
    "Cargar una factura a mano": ["compras.cargar_factura", "compras.a_mano", "compras.guardar"],
    "Hacer el cierre de caja": ["caja.cierre", "caja.conteo", "caja.conciliar"],
    "Crear el usuario de alguien del equipo": ["config.usuarios", "config.crear_usuario", "usuarios.datos", "usuarios.guardar"],
    "Cambiar uno o varios precios": ["menu.cambiar_precios"],
    "Pedir un reporte con palabras": ["reportes.a_medida", "reportes.pedir"],
    "Anotar un gasto pagado de la caja": ["caja.gastos"],
}

MAX_PASOS = 8


def claves_para(rol: str) -> dict:
    return {k: v for k, v in MAPA.items() if v[2] is None or permisos.puede_modulo(rol, v[2])}


def declaracion(rol: str) -> dict:
    claves = claves_para(rol)
    lista = "\n".join(f"- {k} ({v[3]}): {v[4]}" for k, v in claves.items())
    recorridos = "\n".join(
        f"- {tarea}: {' → '.join(pasos)}" for tarea, pasos in RECORRIDOS.items() if all(p in claves for p in pasos)
    )
    return {
        "name": "armar_guia",
        "description": (
            "Arma una guía paso a paso que se recorre sobre la pantalla real, resaltando cada elemento. "
            "Úsala cuando el usuario pregunte CÓMO hacer algo en la aplicación.\n\n"
            "Si la tarea está en RECORRIDOS, usa EXACTAMENTE esos elementos en ese orden. Si no, arma la "
            f"secuencia con el MAPA, hasta {MAX_PASOS} pasos, en el orden en que se tocan, sin repetir elemento y "
            "terminando en el botón que guarda o termina la tarea.\n"
            "En cada paso, el texto dice qué hacer ahí y qué escribir, con un ejemplo del negocio (\"escribe 80 g "
            "de harina para una empanada\"), y si el siguiente paso aparece después de tocarlo. No te limites a "
            "repetir el nombre del botón. Los pasos (tocar) avanzan solos cuando el usuario toca el elemento.\n\n"
            f"RECORRIDOS:\n{recorridos}\n\nMAPA (clave (acción): qué es):\n{lista}"
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
                            "titulo": {"type": "string", "description": "3 a 6 palabras: lo que se hace en este paso."},
                            "texto": {"type": "string", "description": "Una a tres frases: qué hacer aquí, con un ejemplo, y qué va a pasar."},
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
        ruta, ancla, _, accion, _ = claves[k]
        # Dos pasos seguidos en el mismo elemento no enseñan nada (era el
        # defecto de la guía de recetas: la pestaña dos veces).
        if salida and salida[-1]["ancla"] == ancla:
            continue
        salida.append({
            "ruta": ruta,
            "ancla": ancla,
            "accion": accion,
            "titulo": re.sub(r"^\s*(paso\s*)?\d+[.):-]\s*", "", str(p.get("titulo", "")), flags=re.I)[:60],
            "texto": str(p.get("texto", ""))[:400],
        })
    return salida[:MAX_PASOS]
