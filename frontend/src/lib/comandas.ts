/**
 * Una sola definicion de "quien tiene esta comanda", para las dos pantallas.
 *
 * Cocina y punto de venta hacen la misma pregunta desde lados opuestos del
 * mostrador, y si cada una la responde por su cuenta las dos respuestas se
 * separan. Ya paso: la portada contaba `estado='pendiente'` y la pantalla de
 * cocina contaba los renglones sin preparar, y una decia 2 donde la otra decia
 * 981. Aqui se responde una vez.
 */
import type { Pedido } from './types'

/**
 * Lo mismo que MINUTOS_EDITANDO en el backend, y tiene que seguir siendolo.
 *
 * El backend es quien manda -- el rechaza la peticion aunque la pantalla crea
 * otra cosa. Esto es para pintar: sin el, una comanda que la caja abrio y
 * abandono se veria bloqueada en cocina para siempre, aunque el servidor ya la
 * deje marcar.
 */
export const MINUTOS_EDITANDO = 5

function minutosDesde(iso: string | null): number | null {
  if (!iso) return null
  // El backend guarda hora local del local comercial, sin zona horaria: un ISO
  // sin offset se parsea como hora local, que es justo lo que queremos. Solo
  // hay que recortarle los microsegundos, que JS no entiende.
  const fecha = new Date(iso.replace(/(\.\d{3})\d+$/, '$1'))
  if (Number.isNaN(fecha.getTime())) return null
  return Math.max(0, (Date.now() - fecha.getTime()) / 60000)
}

/** El punto de venta tiene la comanda abierta AHORA: la cocina no la toca. */
export function editandoAhora(pedido: Pedido): boolean {
  const minutos = minutosDesde(pedido.editando_desde)
  return minutos !== null && minutos < MINUTOS_EDITANDO
}

/**
 * La comanda esta EN EL SARTEN ahora: el punto de venta no la edita.
 *
 * Las dos condiciones, igual que en el backend. `cocinando_desde` no se limpia
 * solo, asi que mirar solo esa marca dejaria "en preparacion" para siempre una
 * comanda que la cocina despacho hace horas -- y la caja no podria corregir
 * nunca una venta ya cobrada, que es justo para lo que se hizo la edicion.
 */
export function enPreparacion(pedido: Pedido): boolean {
  return Boolean(pedido.cocinando_desde) && pedido.items.some((i) => !i.preparado)
}

/**
 * Por que NO se puede editar esta comanda, en palabras, o null si si se puede.
 *
 * Devuelve el motivo y no un booleano a proposito: un boton apagado sin
 * explicacion hace que la cajera lo toque tres veces y despues llame por
 * telefono.
 */
export function porQueNoSeEdita(pedido: Pedido): string | null {
  if (pedido.estado === 'anulado') return 'Este pedido está anulado'
  if (pedido.devuelto) return 'Esta venta se devolvió entera'
  if (enPreparacion(pedido))
    return `${pedido.cocinando_por || 'La cocina'} ya está preparando esta comanda`
  // Lo que la cocina ya termino no se edita: la comida esta hecha y en la
  // barra. Lo que toca es anular, o devolver y volver a cobrar.
  if (pedido.items.length > 0 && pedido.items.every((i) => i.preparado))
    return 'La cocina ya terminó esta comanda: ya no se edita'
  if (editandoAhora(pedido)) return `${pedido.editando_por || 'Otra caja'} la está editando`
  // Una venta cobrada AYER ya entro al cierre de caja de ayer: moverle el monto
  // hoy deja la gaveta diciendo una cosa y los libros otra. El servidor la
  // rechaza igual; aca se apaga el boton para no hacer teclear una edicion
  // entera antes de decir que no.
  if (pedido.estado === 'pagado' && pedido.cerrado_en && !esDeHoy(pedido.cerrado_en))
    return 'Esta venta es de otro día y ya entró al cierre de caja'
  return null
}

function esDeHoy(iso: string): boolean {
  const fecha = new Date(iso.replace(/(\.\d{3})\d+$/, '$1'))
  if (Number.isNaN(fecha.getTime())) return true
  return fecha.toDateString() === new Date().toDateString()
}
