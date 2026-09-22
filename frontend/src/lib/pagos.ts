import type { Dialogo } from '../components/dialogo'

// "Tarjeta" NO esta: es el mismo terminal que "Punto de venta" (Leider,
// 21-sep: "punto de venta y tarjeta es el mismo ya que punto de ventas es
// POS"). Eran dos botones para el mismo cobro, y en el cierre dos filas que
// se cuadraban por separado contra un solo lote impreso. El valor viejo se
// sigue leyendo en las ventas ya cargadas: el arqueo lo traduce.
export const METODOS_PAGO = [
  'Efectivo Bs',
  'Efectivo $',
  'Pago movil',
  'Punto de venta',
  'Transferencia',
  'Zelle',
]

// Una deuda que nace no es plata que se mueve, asi que no hay comprobante que
// pedir: llega despues, cuando se salde. 'Fiado' es la venta a credito;
// 'Credito' es como le llama Compras a lo mismo del otro lado.
const SIN_COMPROBANTE = new Set(['Fiado', 'Credito'])

/**
 * Si este metodo de pago tiene que traer su numero de confirmacion.
 *
 * La regla se escribe UNA vez y como funcion, no como lista, porque cada
 * modulo tiene su propio vocabulario: el punto de venta dice "Transferencia"
 * y Compras dice "Banco". Derivar el conjunto de la lista de ventas dejaba
 * "Banco" fuera en el frontend y dentro en el backend -- la pantalla no
 * pedia el comprobante y el servidor rechazaba el pago con un 400.
 */
export function necesitaReferencia(metodo: string): boolean {
  return !metodo.startsWith('Efectivo') && !SIN_COMPROBANTE.has(metodo)
}

// Los de la lista de ventas, ya filtrados. Vive aca y no dentro del POS
// porque la regla no es del POS: es de cualquier pantalla que aplique un
// pago. Cobrar un credito desde Caja o desde Ventas entra la misma plata por
// la misma gaveta, y estaba aceptandola sin comprobante.
export const METODOS_CON_REFERENCIA = new Set(METODOS_PAGO.filter(necesitaReferencia))

/**
 * El comprobante del pago, si el metodo lo lleva.
 *
 * Devuelve '' cuando no hace falta (efectivo) y `null` si el usuario cancelo,
 * para que quien llame corte sin registrar nada. Se pregunta antes de mandar
 * el cobro para no chocar contra el 400 del backend con el dialogo ya cerrado.
 */
export async function pedirReferencia(
  metodo: string,
  pedirTexto: Dialogo['pedirTexto'],
): Promise<string | null> {
  if (!necesitaReferencia(metodo)) return ''
  return await pedirTexto({
    titulo: `Referencia del pago por ${metodo}`,
    etiqueta: 'Referencia',
    placeholder: 'Número de confirmación, ticket o comprobante',
  })
}

// 'Fiado' sigue siendo el valor que se guarda y se compara en toda la
// contabilidad (cambiarlo rompe reportes de ventas ya cerradas); esto solo
// traduce como se le llama delante del cliente. Un pago mixto llega como
// "Efectivo $ + Fiado", asi que hay que traducir cada parte por separado.
export function etiquetaMetodo(metodo: string): string {
  return metodo
    .split(' + ')
    .map((parte) => (parte === 'Fiado' ? 'A crédito' : parte))
    .join(' + ')
}
