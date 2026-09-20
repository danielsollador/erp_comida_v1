import { api } from './api'
import { fmtBs } from './moneda'
import { etiquetaMetodo } from './pagos'

/**
 * El comprobante del cliente, en una ventana lista para imprimir.
 *
 * Vive aqui y no dentro del punto de venta porque se imprime desde dos
 * sitios: al cobrar, y despues desde Ventas -- el cliente pide el ticket
 * cuando ya se guardo la comanda, o la impresora estaba sin papel. Dos copias
 * del mismo HTML serian dos tickets distintos el dia que cambie un total.
 *
 * Lanza si el servidor no da el ticket; quien llama decide como avisar.
 */
export async function imprimirTicket(pedidoId: number): Promise<void> {
  const t = await api.ticket(pedidoId)
  const ventana = window.open('', '_blank', 'width=320,height=600')
  if (!ventana) throw new Error('El navegador bloqueó la ventana del ticket. Permite las ventanas emergentes.')
  const linea = (izq: string, der: string) => `<div class="l"><span>${izq}</span><span>${der}</span></div>`
  // El ticket se arma pegando texto, no con el DOM, asi que lo que escribio
  // una persona hay que escaparlo. El nombre del cliente lo teclea la cajera
  // en el mostrador y puede traer un "&" o un "<" sin ninguna mala intencion;
  // pegado en crudo rompe el comprobante, y en el peor caso mete etiquetas en
  // una ventana del propio dominio.
  const esc = (v: unknown) =>
    String(v ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
    )
  ventana.document.write(`
    <html><head><title>Ticket ${t.numero}</title><style>
      body{font-family:ui-monospace,monospace;font-size:12px;width:280px;margin:0;padding:8px}
      h1{font-size:14px;text-align:center;margin:0 0 2px}
      .c{text-align:center}.l{display:flex;justify-content:space-between}
      hr{border:none;border-top:1px dashed #000;margin:6px 0}
      .tot{font-size:15px;font-weight:bold}
      @media print{body{width:auto}}
    </style></head><body>
    <h1>Pedido #${t.numero}</h1>
    ${t.cliente ? `<div class="c" style="font-weight:bold">${esc(t.cliente)}</div>` : ''}
    <div class="c">${new Date(t.fecha).toLocaleString('es-VE')}</div>
    ${t.operador ? `<div class="c">Le atendió: ${esc(t.operador)}</div>` : ''}
    ${t.punto_venta ? `<div class="c">${esc(t.punto_venta)}</div>` : ''}
    <hr>
    ${t.items.map((i) => linea(`${i.cantidad} x ${esc(i.nombre)}`, `$${i.subtotal.toFixed(2)}`)).join('')}
    <hr>
    ${t.descuento ? linea('Subtotal', `$${t.subtotal.toFixed(2)}`) : ''}
    ${t.descuento ? linea('Descuento', `-$${t.descuento.toFixed(2)}`) : ''}
    ${t.propina ? linea('Propina', `$${t.propina.toFixed(2)}`) : ''}
    <div class="l tot"><span>TOTAL</span><span>$${t.a_cobrar.toFixed(2)}</span></div>
    ${t.total_bs ? linea('En bolívares', fmtBs(t.total_bs)) : ''}
    ${t.tasa_bcv ? `<div class="c" style="font-size:10px">tasa ${t.tasa_bcv}</div>` : ''}
    ${t.facturado && t.base_imponible != null ? '<hr>' : ''}
    ${t.facturado && t.base_imponible != null ? linea('Base imponible', `$${t.base_imponible.toFixed(2)}`) : ''}
    ${t.facturado && t.iva != null ? linea('IVA', `$${t.iva.toFixed(2)}`) : ''}
    ${t.numero_factura ? `<div class="c">Factura ${esc(t.numero_factura)}</div>` : ''}
    <hr>
    ${t.pagos
      .map(
        (p) =>
          linea(etiquetaMetodo(p.metodo), `$${p.monto.toFixed(2)}`) +
          (p.referencia ? `<div class="c" style="font-size:10px">ref. ${esc(p.referencia)}</div>` : '') +
          (p.vuelto_monto ? linea('Vuelto', `$${p.vuelto_monto.toFixed(2)}`) : ''),
      )
      .join('')}
    <hr><div class="c">Gracias por su compra</div>
    </body></html>`)
  ventana.document.close()
  ventana.focus()
  ventana.print()
}
