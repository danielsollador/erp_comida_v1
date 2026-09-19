import type { Dialogo } from '../components/dialogo'

export const METODOS_PAGO = [
  'Efectivo Bs',
  'Efectivo $',
  'Pago movil',
  'Punto de venta',
  'Tarjeta',
  'Transferencia',
  'Zelle',
]

// Todo lo que no es un billete deja un numero de confirmacion en alguna parte,
// y el backend lo exige (ver contabilidad.METODOS_CON_REFERENCIA). Vive aca y
// no dentro del POS porque la regla no es del POS: es de cualquier pantalla
// que aplique un pago. Cobrar un credito desde Caja o desde Ventas entra la
// misma plata por la misma gaveta, y estaba aceptandola sin comprobante.
export const METODOS_CON_REFERENCIA = new Set(
  METODOS_PAGO.filter((m) => !m.startsWith('Efectivo')),
)

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
  if (!METODOS_CON_REFERENCIA.has(metodo)) return ''
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
