import { useCallback } from 'react'
import { fmtBs, useMoneda } from '../../lib/moneda'
import { hoyEnCaracas, miles } from '../../lib/formato'
import type { EstadoVenta, VentaFila } from '../../lib/tipos'

/*
 * LA LOGICA DE VENTAS, la de pages/Ventas.tsx y lib/fechas.ts de la web:
 * que paso con cada venta, como se filtra, el periodo y como se escriben
 * los montos viejos. Sin pantalla: la usan la lista, el detalle y las
 * secciones.
 */

// ── Que paso con la venta ───────────────────────────────────────────────────

// Las dos anuladas no son el mismo problema: una es comida botada (perdida
// real) y la otra un cliente que se arrepintio antes de que se tocara nada.
// El filtro las separa aunque las dos sean `anulada` en el backend.
export type FiltroEstado = EstadoVenta | 'todas' | 'anulada_perdida' | 'anulada_inventario'
export type Tono = 'neutro' | 'bien' | 'ojo' | 'mal' | 'acento'

export const ESTADOS: { clave: FiltroEstado; texto: string; tono: Tono }[] = [
  { clave: 'todas', texto: 'Todas', tono: 'neutro' },
  { clave: 'cobrada', texto: 'Cobradas', tono: 'bien' },
  { clave: 'fiada', texto: 'A crédito', tono: 'ojo' },
  { clave: 'devuelta', texto: 'Devueltas', tono: 'mal' },
  { clave: 'anulada_perdida', texto: 'Anuladas: pérdida', tono: 'mal' },
  { clave: 'anulada_inventario', texto: 'Anuladas: sin tocar', tono: 'neutro' },
  { clave: 'abierta', texto: 'Abiertas', tono: 'acento' },
]

export const TEXTO_ESTADO: Record<EstadoVenta, string> = {
  cobrada: 'Cobrada',
  fiada: 'A crédito',
  devuelta: 'Devuelta',
  anulada: 'Anulada',
  abierta: 'Abierta',
}

/** A que filtro pertenece esta fila. Una anulada vieja sin `anulado_es_perdida` cae en "anulada" a secas. */
export function claveDeFila(v: VentaFila): FiltroEstado {
  if (v.estado !== 'anulada' || v.anulado_es_perdida === null) return v.estado
  return v.anulado_es_perdida ? 'anulada_perdida' : 'anulada_inventario'
}

/** La pastilla de una venta: texto y tono, como `PastillaEstado` de la web. */
export function estadoDe(v: VentaFila): { texto: string; tono: Tono } {
  if (v.estado === 'anulada') {
    if (v.anulado_es_perdida === true) return { texto: 'Anulada: pérdida', tono: 'mal' }
    if (v.anulado_es_perdida === false) return { texto: 'Anulada: sin tocar', tono: 'neutro' }
    return { texto: 'Anulada', tono: 'neutro' }
  }
  return { texto: TEXTO_ESTADO[v.estado], tono: ESTADOS.find((e) => e.clave === v.estado)?.tono ?? 'neutro' }
}

/** Anulada o devuelta: se ve, tachada, pero no suma. */
export const apagada = (v: VentaFila) => v.estado === 'anulada' || v.estado === 'devuelta'

// ── El periodo (lib/fechas.ts de la web) ────────────────────────────────────

export type ClaveRango =
  | 'hoy'
  | 'ayer'
  | 'semana'
  | 'semana_pasada'
  | '7d'
  | '30d'
  | 'mes'
  | 'mes_pasado'
  | '90d'
  | 'anio'
  | 'anio_pasado'
  | 'personal'

export type Rango = { desde: string; hasta: string; clave: ClaveRango }

/** Los atajos de la web, en el mismo orden y con las mismas palabras. */
export const ATAJOS: { clave: Exclude<ClaveRango, 'personal'>; texto: string }[] = [
  { clave: 'hoy', texto: 'Hoy' },
  { clave: 'ayer', texto: 'Ayer' },
  { clave: 'semana', texto: 'Esta semana' },
  { clave: 'semana_pasada', texto: 'Semana pasada' },
  { clave: 'mes', texto: 'Este mes' },
  { clave: 'mes_pasado', texto: 'Mes anterior' },
  { clave: '7d', texto: 'Últimos 7 días' },
  { clave: '30d', texto: 'Últimos 30 días' },
  { clave: '90d', texto: 'Últimos 90 días' },
  { clave: 'anio', texto: 'Este año' },
  { clave: 'anio_pasado', texto: 'Año anterior' },
]

/** Ventas abre en "este mes": es el tramo que se revisa. */
export const RANGO_POR_DEFECTO: ClaveRango = 'mes'

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const ES_ISO = /^\d{4}-\d{2}-\d{2}$/

// Fechas como dias de calendario (a mediodia UTC, para que ninguna zona las corra).
const aDia = (iso: string) => new Date(`${iso}T12:00:00Z`)
const aIso = (d: Date) => d.toISOString().slice(0, 10)
const sumar = (d: Date, n: number) => {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + n)
  return r
}

/**
 * Las fechas de un atajo, HOY EN EL LOCAL. La web usa el reloj del equipo;
 * la app, el de Caracas: un telefono con otra zona despues de las 8 p. m. ya
 * estaria en "mañana".
 */
export function rangoDe(clave: Exclude<ClaveRango, 'personal'>): Rango {
  const h = aDia(hoyEnCaracas())
  const lunes = sumar(h, -((h.getUTCDay() + 6) % 7))
  const primero = new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth(), 1, 12))
  const r = (desde: Date, hasta: Date): Rango => ({ desde: aIso(desde), hasta: aIso(hasta), clave })
  switch (clave) {
    case 'hoy':
      return r(h, h)
    case 'ayer':
      return r(sumar(h, -1), sumar(h, -1))
    case 'semana':
      return r(lunes, h)
    case 'semana_pasada':
      return r(sumar(lunes, -7), sumar(lunes, -1))
    case 'mes':
      return r(primero, h)
    case 'mes_pasado':
      return r(new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth() - 1, 1, 12)), sumar(primero, -1))
    case '7d':
      return r(sumar(h, -6), h)
    case '30d':
      return r(sumar(h, -29), h)
    case '90d':
      return r(sumar(h, -89), h)
    case 'anio':
      return r(new Date(Date.UTC(h.getUTCFullYear(), 0, 1, 12)), h)
    case 'anio_pasado':
      return r(new Date(Date.UTC(h.getUTCFullYear() - 1, 0, 1, 12)), new Date(Date.UTC(h.getUTCFullYear() - 1, 11, 31, 12)))
  }
}

/** El rango que dice la URL (`?r=90d`, o `?d=…&h=…`), como `useRango` de la web. */
export function rangoDeUrl(r?: string, d?: string, h?: string): Rango {
  if (d && h && ES_ISO.test(d) && ES_ISO.test(h)) {
    return d <= h ? { desde: d, hasta: h, clave: 'personal' } : { desde: h, hasta: d, clave: 'personal' }
  }
  const atajo = ATAJOS.find((a) => a.clave === r)
  return rangoDe(atajo ? atajo.clave : (RANGO_POR_DEFECTO as Exclude<ClaveRango, 'personal'>))
}

/** "16 sep", "1–16 sep", "12 ago – 16 sep", "12 dic 2025 – 16 sep 2026". */
export function etiquetaRango(r: Rango): string {
  const d = aDia(r.desde)
  const h = aDia(r.hasta)
  const esteAnio = h.getUTCFullYear() === aDia(hoyEnCaracas()).getUTCFullYear()
  const f = (x: Date, conAnio: boolean) => `${x.getUTCDate()} ${MESES_CORTOS[x.getUTCMonth()]}${conAnio ? ` ${x.getUTCFullYear()}` : ''}`
  if (r.desde === r.hasta) return f(d, !esteAnio)
  if (d.getUTCFullYear() !== h.getUTCFullYear()) return `${f(d, true)} – ${f(h, true)}`
  if (d.getUTCMonth() === h.getUTCMonth()) return `${d.getUTCDate()}–${f(h, !esteAnio)}`
  return `${f(d, false)} – ${f(h, !esteAnio)}`
}

export function nombreRango(r: Rango): string {
  return ATAJOS.find((a) => a.clave === r.clave)?.texto ?? 'Personalizado'
}

/** Si el periodo llega hasta hoy: el resumen aclara que todavia no termina. */
export const incluyeHoy = (hasta: string) => hasta >= hoyEnCaracas()

// ── Los montos viejos ───────────────────────────────────────────────────────

/**
 * `fmtCongelado` de la web (lib/moneda.tsx): un monto historico se escribe
 * con la tasa A LA QUE SE COBRO, no con la de hoy. Sin esto, en bolivares la
 * venta del mes pasado cambiaria sola cada vez que se mueve el dolar. En
 * dolares es lo mismo que `fmt`. La app todavia no lo tiene en lib/moneda;
 * se arma aqui con la vista y la tasa de `useMoneda`.
 */
export function useDinero() {
  const { fmt, vista, tasa } = useMoneda()
  return useCallback(
    (usd: number | null | undefined, tasaCongelada: number | null | undefined, decimales?: number) => {
      if (usd === null || usd === undefined) return '—'
      if (vista === 'usd' || !tasaCongelada) return fmt(usd, decimales)
      const d = decimales ?? 2
      const signo = (s: string, v: number) => (v < 0 ? `−${s}${miles(Math.abs(v), d)}` : `${s}${miles(Math.abs(v), d)}`)
      switch (vista) {
        case 'bs':
          return fmtBs(usd * tasaCongelada, 2)
        case 'usd_calle':
          return tasa?.paralelo ? signo('$', (usd * tasaCongelada) / tasa.paralelo) : '…'
        case 'eur':
          return tasa?.eur ? signo('€', (usd * tasaCongelada) / tasa.eur) : '…'
        default:
          return fmt(usd, decimales)
      }
    },
    [fmt, vista, tasa],
  )
}

/** Dolares tal cual, para lo que se teclea en dolares ("$12,50. ¿Cómo paga?"). */
export const enDolares = (n: number) => `$${miles(n)}`
