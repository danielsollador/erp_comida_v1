import { Share } from 'react-native'
import { etiquetaMetodo } from '../../../../frontend/src/lib/pagos'
import { apiVentas } from '../../lib/api-ventas'
import { miles } from '../../lib/formato'
import { fmtBs } from '../../lib/moneda'
import { fechaCorta, horaCorta } from '../../lib/numeros'
import type { Ticket } from '../../lib/tipos'

/**
 * EL COMPROBANTE DEL CLIENTE, el mismo de lib/ticket.ts de la web.
 *
 * En la web se abre una ventana y se imprime en la termica del mostrador. Un
 * telefono no tiene impresora a la vista: el ticket sale como texto al menu
 * de compartir del sistema, y desde ahi va por WhatsApp al cliente o a la app
 * de la impresora bluetooth. En la vista web de la app se imprime como en la
 * web. Lanza si el servidor no da el ticket; quien llama decide como avisar.
 */
export const TEXTO_BOTON_TICKET = process.env.EXPO_OS === 'web' ? 'Imprimir ticket' : 'Compartir ticket'

const usd = (n: number) => `$${miles(n)}`

function lineas(t: Ticket): string[] {
  const l: string[] = [`Pedido #${t.numero}`]
  if (t.cliente) l.push(t.cliente)
  l.push(`${fechaCorta(t.fecha, true)}, ${horaCorta(t.fecha)}`)
  if (t.operador) l.push(`Le atendió: ${t.operador}`)
  if (t.punto_venta) l.push(t.punto_venta)
  l.push('--------------------------')
  for (const i of t.items) l.push(`${i.cantidad} x ${i.nombre}  ${usd(i.subtotal)}`)
  l.push('--------------------------')
  if (t.descuento) l.push(`Subtotal  ${usd(t.subtotal)}`, `Descuento  -${usd(t.descuento)}`)
  if (t.propina) l.push(`Propina  ${usd(t.propina)}`)
  l.push(`TOTAL  ${usd(t.a_cobrar)}`)
  if (t.total_bs) l.push(`En bolívares  ${fmtBs(t.total_bs)}`)
  if (t.tasa_bcv) l.push(`tasa ${t.tasa_bcv}`)
  if (t.facturado && t.base_imponible != null) {
    l.push('--------------------------', `Base imponible  ${usd(t.base_imponible)}`)
    if (t.iva != null) l.push(`IVA  ${usd(t.iva)}`)
  }
  if (t.numero_factura) l.push(`Factura ${t.numero_factura}`)
  l.push('--------------------------')
  for (const p of t.pagos) {
    l.push(`${etiquetaMetodo(p.metodo)}  ${usd(p.monto)}`)
    if (p.referencia) l.push(`ref. ${p.referencia}`)
    if (p.vuelto_monto) l.push(`Vuelto  ${usd(p.vuelto_monto)}`)
  }
  l.push('--------------------------', 'Gracias por su compra')
  return l
}

export async function sacarTicket(pedidoId: number): Promise<void> {
  const t = await apiVentas.ticket(pedidoId)
  if (process.env.EXPO_OS !== 'web') {
    await Share.share({ title: `Ticket ${t.numero}`, message: lineas(t).join('\n') })
    return
  }
  const ventana = globalThis.open('', '_blank', 'width=320,height=600')
  if (!ventana) throw new Error('El navegador bloqueó la ventana del ticket. Permite las ventanas emergentes.')
  // Lo que escribio una persona (el cliente, la referencia) se escapa.
  const esc = (v: string) =>
    v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
  ventana.document.write(
    `<html><head><title>Ticket ${t.numero}</title><style>body{font-family:ui-monospace,monospace;font-size:12px;width:280px;margin:0;padding:8px;white-space:pre-wrap}</style></head><body>${lineas(t)
      .map(esc)
      .join('\n')}</body></html>`,
  )
  ventana.document.close()
  ventana.focus()
  ventana.print()
}
