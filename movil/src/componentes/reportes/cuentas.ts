import { useCallback } from 'react'
import { hoyEnCaracas, miles } from '../../lib/formato'
import { fmtBs, useMoneda } from '../../lib/moneda'
import { usePalabras } from '../configuracion/Lenguaje'

/*
 * LAS CUENTAS Y LAS PALABRAS DE REPORTES Y TASA, sin nada de pantalla: el
 * formato de las cifras, el recorte de la serie, el orden de las tablas, los
 * periodos que guardan los reportes a medida y los nombres que cambian con
 * Configuracion › Lenguaje. Lo que en la web esta repartido entre
 * pages/partes/reportes/comunes.tsx, lib/moneda.tsx, lib/fechas.ts y
 * lib/palabras.ts.
 */

// ── Cifras ──────────────────────────────────────────────────────────────────

/** Para contar cosas: "1.250", sin decimales. */
export const enteros = (n: number) => miles(Math.round(n), 0)

/** Una cifra con sus decimales y el formato de la web: 875,65. */
export const num = (n: number, decimales = 2) => miles(n, decimales)

/**
 * Una cantidad de mercancia, con hasta dos decimales y sin ceros de relleno:
 * "2 kg", "0,04 kg", "1,5 kg" (lo que en la web es `maximumFractionDigits: 2`).
 */
export function cantidad(n: number): string {
  return miles(n, 2).replace(/,?0+$/, '')
}

/**
 * Un porcentaje tal como lo manda el servidor (15.7), con la coma de aqui:
 * "15,7%". La web lo escribe con el numero crudo.
 */
export const pct = (n: number) => `${String(n).replace('.', ',')}%`

/** "El mes pasado" -> "El mes pasado"; "ayer" -> "Ayer". */
export function capitalizar(texto: string): string {
  return texto ? `${texto[0].toUpperCase()}${texto.slice(1)}` : texto
}

/** "1 pedido", "2 pedidos": el plural que toca. */
export const plural = (n: number, uno: string, varios: string) => `${enteros(n)} ${n === 1 ? uno : varios}`

/** El grano de la serie en palabras: el servidor dice "dia" sin tilde. */
export const grano = (g: string) => (g === 'dia' ? 'día' : g)

// ── Moneda ──────────────────────────────────────────────────────────────────

export type Dinero = (x: number, d?: number) => string

const SUFIJOS = { usd: 'USD', bs: 'Bs', usd_calle: 'USD paralelo', eur: 'EUR' } as const

/** El signo menos delante del simbolo: "−$4,42", como la web. */
function conSigno(simbolo: string, valor: number, cuerpo: string) {
  return valor < 0 ? `−${simbolo}${cuerpo}` : `${simbolo}${cuerpo}`
}

/**
 * LOS MONTOS DE UN PERIODO, A LA TASA DE ESE PERIODO (el `fmtCongelado` de la
 * web, lib/moneda.tsx). En la vista en bolivares manda la tasa MEDIA del
 * periodo, sacada de los bolivares que de verdad entraron: con la de hoy, el
 * resumen del mes pasado cambiaria solo cada vez que se mueve el dolar.
 *
 * En dolares es lo mismo que `fmt`. Vive aqui porque lib/moneda.tsx de la app
 * todavia no trae `fmtCongelado` (ver el informe).
 */
export function useDinero(tasaPeriodo: number | null) {
  const { vista, tasa, fmt } = useMoneda()
  const dinero: Dinero = useCallback(
    (usd: number, decimales?: number) => {
      if (!tasaPeriodo || vista === 'usd') return fmt(usd, decimales)
      const d = decimales ?? 2
      const bcv = tasaPeriodo
      switch (vista) {
        case 'bs':
          return fmtBs(usd * bcv, 2)
        case 'usd_calle': {
          if (!tasa?.paralelo) return '…'
          const v = (usd * bcv) / tasa.paralelo
          return conSigno('$', v, miles(Math.abs(v), d))
        }
        case 'eur': {
          if (!tasa?.eur) return '…'
          const v = (usd * bcv) / tasa.eur
          return conSigno('€', v, miles(Math.abs(v), d))
        }
        default:
          return fmt(usd, decimales)
      }
    },
    [tasaPeriodo, vista, tasa, fmt],
  )
  const corto = useCallback((x: number) => dinero(x, 0), [dinero])
  return { dinero, corto, fmt, sufijo: SUFIJOS[vista] }
}

// ── Palabras (Configuracion › Lenguaje) ─────────────────────────────────────

/**
 * Lo que tiene dos nombres en Reportes, con los nombres de la web de hoy
 * (frontend/src/lib/palabras.ts: "Valor en inventario", ya no "en deposito").
 */
const TERMINOS: Record<string, { tecnico: string; sencillo: string }> = {
  'kpi.ganancia_neta': { tecnico: 'Ganancia neta', sencillo: 'Te quedó' },
  'kpi.ticket_promedio': { tecnico: 'Ticket promedio', sencillo: 'Gasta en promedio cada cliente' },
  'kpi.valor_deposito': { tecnico: 'Valor en inventario', sencillo: 'Plata en mercancía' },
  'kpi.bajo_minimo': { tecnico: 'Bajo mínimo', sencillo: 'Por debajo del mínimo' },
  'kpi.bajo_minimo_agotadas': { tecnico: 'Bajo mínimo o agotadas', sencillo: 'Por debajo del mínimo o agotadas' },
  'productos.uds': { tecnico: 'Uds', sencillo: 'Vendidos' },
}

/** El nombre que toca segun el modo de palabras elegido, y el otro (para la ayuda). */
export function usePalabra() {
  const { modo } = usePalabras()
  const nombre = useCallback(
    (clave: string, porDefecto = '') => {
      const t = TERMINOS[clave]
      if (!t) return porDefecto
      return modo === 'tecnico' ? t.tecnico : t.sencillo
    },
    [modo],
  )
  /** En modo sencillo, como se le suele llamar (la linea de la ayuda). */
  const otroNombre = useCallback(
    (clave: string) => {
      const t = TERMINOS[clave]
      if (!t || modo === 'tecnico') return undefined
      return `A esto se le suele llamar «${t.tecnico}».`
    },
    [modo],
  )
  return { nombre, otroNombre }
}

// ── La serie ────────────────────────────────────────────────────────────────

/**
 * La serie sin los tramos vacios de los EXTREMOS (comunes.recortarSerie de
 * la web): un tramo en cero en medio es informacion, pero los ceros de antes
 * del primer pedido y despues del ultimo solo son el periodo que se pidio. La
 * serie anterior se corta por los mismos indices: va tramo a tramo.
 */
export function recortarSerie<T extends { pedidos: number; ventas: number }>(
  serie: T[],
  anterior: T[],
): { serie: T[]; anterior: T[] } {
  const conDato = serie.map((p) => p.pedidos > 0 || p.ventas !== 0)
  const desde = conDato.indexOf(true)
  if (desde === -1) return { serie, anterior }
  const hasta = conDato.lastIndexOf(true)
  return {
    serie: serie.slice(desde, hasta + 1),
    anterior: anterior.length === serie.length ? anterior.slice(desde, hasta + 1) : anterior,
  }
}

// ── Orden de las tablas ─────────────────────────────────────────────────────

export type ValorOrden = string | number | null | undefined

/** Para comparar textos sin que importen tildes ni mayusculas. */
function llano(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * Como compara la web (components/Tabla.tsx): lo vacio siempre al final,
 * numeros como numeros y textos sin tildes. Sin `localeCompare` con idioma: el
 * motor del telefono no siempre trae los datos de idioma.
 */
export function comparar(a: ValorOrden, b: ValorOrden, dir: 'asc' | 'desc'): number {
  const vacioA = a == null || a === ''
  const vacioB = b == null || b === ''
  if (vacioA && vacioB) return 0
  if (vacioA) return 1
  if (vacioB) return -1
  const signo = dir === 'asc' ? 1 : -1
  if (typeof a === 'number' && typeof b === 'number') return signo * (a - b)
  const x = llano(String(a))
  const y = llano(String(b))
  return signo * (x < y ? -1 : x > y ? 1 : 0)
}

// ── Los periodos que guarda un reporte a medida ─────────────────────────────

/**
 * Los atajos de la web (lib/fechas.ts, ATAJOS). Un reporte guardado abre con
 * uno de estos ("semana", "anio"...), y la app solo trae siete en su selector:
 * los que faltan se calculan aqui, en el dia de Caracas.
 */
export const ATAJOS: { clave: string; texto: string }[] = [
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

function mover(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** Las fechas de un atajo que el selector de la app no tiene. */
export function rangoDeAtajo(clave: string): { desde: string; hasta: string } | null {
  const hoy = hoyEnCaracas()
  const diaSemana = new Date(`${hoy}T12:00:00Z`).getUTCDay()
  const lunes = mover(hoy, -((diaSemana + 6) % 7))
  const anio = Number(hoy.slice(0, 4))
  switch (clave) {
    case 'semana':
      return { desde: lunes, hasta: hoy }
    case 'semana_pasada':
      return { desde: mover(lunes, -7), hasta: mover(lunes, -1) }
    case 'anio':
      return { desde: `${anio}-01-01`, hasta: hoy }
    case 'anio_pasado':
      return { desde: `${anio - 1}-01-01`, hasta: `${anio - 1}-12-31` }
    default:
      return null
  }
}
