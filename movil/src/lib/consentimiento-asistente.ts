import * as almacen from './almacen'
import { confirmar } from './dialogo'

/**
 * EL PERMISO PARA USAR EL ASISTENTE (Pregúntame, reportes con palabras y
 * cambiar precios diciéndolo).
 *
 * La pregunta y los datos del negocio que hagan falta para responderla
 * (ventas, productos, precios) salen hacia Anthropic, por el servidor del
 * negocio. Igual que la lectura de facturas (consentimiento-ia.ts): Apple
 * (5.1.2(i)) y la ficha de Google Play piden que la persona lo sepa y lo
 * acepte ANTES del primer envío, con el proveedor por su nombre, y que pueda
 * retirarlo. Se pregunta una vez y se recuerda en el teléfono; en
 * Configuración > Mi cuenta se ve y se retira.
 */
const CLAVE = 'vp_consentimiento_asistente'

export const PROVEEDOR_ASISTENTE = 'Claude, de Anthropic'

export async function tieneConsentimientoAsistente(): Promise<boolean> {
  try {
    return (await almacen.leer(CLAVE)) === 'si'
  } catch {
    return false
  }
}

export function darConsentimientoAsistente(): Promise<void> {
  return almacen.guardar(CLAVE, 'si')
}

export function retirarConsentimientoAsistente(): Promise<void> {
  return almacen.borrar(CLAVE)
}

/**
 * Si ya se dio, sigue; si no, pregunta y lo guarda. `false` = la persona no
 * quiso: no se manda nada.
 */
export async function pedirConsentimientoAsistente(): Promise<boolean> {
  if (await tieneConsentimientoAsistente()) return true
  const acepta = await confirmar({
    titulo: 'Usar el asistente con inteligencia artificial',
    texto:
      `Para responderte, lo que escribes se envía a ${PROVEEDOR_ASISTENTE} (un servicio de inteligencia artificial), ` +
      'junto con los datos de tu negocio que hagan falta para la respuesta: ventas, productos, precios o inventario. ' +
      'Anthropic procesa la pregunta y devuelve la respuesta.\n\n' +
      'Todo lo demás de la app funciona sin esto, y puedes retirar este permiso cuando quieras en Configuración → Mi cuenta.',
    aceptar: 'Permitir',
    cancelar: 'Ahora no',
  })
  if (acepta) await darConsentimientoAsistente()
  return acepta
}
