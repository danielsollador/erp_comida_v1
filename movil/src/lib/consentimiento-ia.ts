import * as almacen from './almacen'
import { confirmar } from './dialogo'

/**
 * EL PERMISO PARA LEER FACTURAS CON IA.
 *
 * La foto o el PDF de la factura sale del telefono hacia Google Gemini (por
 * el servidor del negocio, pero sale). Apple (guia 5.1.2(i)) pide que la
 * persona lo sepa y lo acepte ANTES del primer envio, con el proveedor por su
 * nombre, y que pueda retirar el permiso. Se pregunta una vez y se recuerda
 * en el telefono; en Configuracion > Mi cuenta se ve y se retira.
 */
const CLAVE = 'vp_consentimiento_ia'

export const PROVEEDOR_IA = 'Google Gemini'

export async function tieneConsentimiento(): Promise<boolean> {
  try {
    return (await almacen.leer(CLAVE)) === 'si'
  } catch {
    return false
  }
}

export function darConsentimiento(): Promise<void> {
  return almacen.guardar(CLAVE, 'si')
}

export function retirarConsentimiento(): Promise<void> {
  return almacen.borrar(CLAVE)
}

/**
 * Si ya se dio, sigue; si no, pregunta y lo guarda. `false` = la persona
 * prefirio cargar la factura a mano: no se manda nada.
 */
export async function pedirConsentimiento(): Promise<boolean> {
  if (await tieneConsentimiento()) return true
  const acepta = await confirmar({
    titulo: 'Leer la factura con inteligencia artificial',
    texto:
      `Para llenar el formulario, la foto o el PDF de esta factura se envía a ${PROVEEDOR_IA} (un servicio de Google), ` +
      'junto con el nombre y el RIF de tu negocio para distinguir comprador de proveedor. Google procesa el documento y ' +
      'devuelve los datos; tú los revisas antes de guardar.\n\n' +
      'Puedes cargar la factura a mano sin usar esto, y retirar este permiso cuando quieras en Configuración → Mi cuenta.',
    aceptar: 'Permitir y leer',
    cancelar: 'Cargar a mano',
  })
  if (acepta) await darConsentimiento()
  return acepta
}
