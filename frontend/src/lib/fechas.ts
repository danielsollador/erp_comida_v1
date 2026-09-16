import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * EL RANGO DE FECHAS DE TODO EL ERP: que es, como se nombra y donde vive.
 *
 * POR QUE EXISTE. Cada pantalla con fechas tenia lo suyo, o nada: Reportes
 * tres botones (hoy / semana / mes), los gastos "los ultimos 30 dias" sin
 * boton alguno, las facturas 60 dias, el Libro de Ventas solo el mes en
 * curso. No habia forma de ver el mes pasado, ni el trimestre, ni "del 3 al
 * 17". Leider (16-sep): "no has puesto filtros de fechas por ningun lado y
 * eso es SUPER importante... tanto filtros dinamicos donde puedas elegir tu,
 * como filtros exactos: este mes, mes anterior, 90 dias, este año".
 *
 * EL RANGO VIVE EN LA URL (`?r=mes`, o `?d=2026-09-01&h=2026-09-16`), igual
 * que la seccion (`?s=`): volver atras vuelve al rango anterior, recargar no
 * lo pierde, y un enlace a "las ventas de agosto" es un enlace de verdad.
 *
 * LAS FECHAS VIAJAN COMO `AAAA-MM-DD`, en la hora local: es lo que el backend
 * entiende (`rango.py`) y no depende de la zona horaria de nadie. El control
 * que las elige esta en `components/Fechas.tsx`.
 */

export type Rango = {
  /** AAAA-MM-DD, inclusive. */
  desde: string
  /** AAAA-MM-DD, inclusive. */
  hasta: string
  /** El atajo que lo produjo, o `personal` si se marco en el calendario. */
  clave: ClaveRango
}

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

/** Los atajos ("filtros exactos"), en el orden en que se ofrecen. */
export const ATAJOS: { clave: ClaveRango; texto: string }[] = [
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

export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

// ── Fechas sin zona horaria ──────────────────────────────────────────────
//
// Todo se hace con `Date` locales a medianoche y se serializa a mano: usar
// `toISOString()` corre la fecha un dia hacia atras despues de las 8 pm en
// Venezuela, que es cuando mas se vende.

export function aIso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${dia}`
}

export function deIso(s: string): Date {
  const [a, m, d] = s.split('-').map(Number)
  return new Date(a, m - 1, d)
}

export function hoy(): Date {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function sumarDias(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

const ES_ISO = /^\d{4}-\d{2}-\d{2}$/

/** Las fechas que corresponden a un atajo, hoy. */
export function rangoDe(clave: ClaveRango): Rango {
  const h = hoy()
  const lunes = sumarDias(h, -((h.getDay() + 6) % 7))
  const primero = new Date(h.getFullYear(), h.getMonth(), 1)
  const r = (desde: Date, hasta: Date): Rango => ({ desde: aIso(desde), hasta: aIso(hasta), clave })
  switch (clave) {
    case 'hoy':
      return r(h, h)
    case 'ayer':
      return r(sumarDias(h, -1), sumarDias(h, -1))
    case 'semana':
      return r(lunes, h)
    case 'semana_pasada':
      return r(sumarDias(lunes, -7), sumarDias(lunes, -1))
    case 'mes':
      return r(primero, h)
    case 'mes_pasado':
      return r(new Date(h.getFullYear(), h.getMonth() - 1, 1), sumarDias(primero, -1))
    case '7d':
      return r(sumarDias(h, -6), h)
    case '30d':
      return r(sumarDias(h, -29), h)
    case '90d':
      return r(sumarDias(h, -89), h)
    case 'anio':
      return r(new Date(h.getFullYear(), 0, 1), h)
    case 'anio_pasado':
      return r(new Date(h.getFullYear() - 1, 0, 1), new Date(h.getFullYear() - 1, 11, 31))
    default:
      return r(h, h)
  }
}

/** "16 sep", "1–16 sep", "12 ago – 16 sep", "12 dic 2025 – 16 sep 2026". */
export function etiquetaRango(r: Rango): string {
  const d = deIso(r.desde)
  const h = deIso(r.hasta)
  const anioDistinto = d.getFullYear() !== h.getFullYear()
  const esteAnio = h.getFullYear() === hoy().getFullYear()
  const f = (x: Date, conAnio: boolean) =>
    `${x.getDate()} ${MESES_CORTOS[x.getMonth()]}${conAnio ? ` ${x.getFullYear()}` : ''}`
  if (r.desde === r.hasta) return f(d, !esteAnio)
  if (anioDistinto) return `${f(d, true)} – ${f(h, true)}`
  if (d.getMonth() === h.getMonth()) return `${d.getDate()}–${f(h, !esteAnio)}`
  return `${f(d, false)} – ${f(h, !esteAnio)}`
}

/** El nombre del atajo, si lo hay. */
export function nombreRango(r: Rango): string {
  return ATAJOS.find((a) => a.clave === r.clave)?.texto ?? 'Personalizado'
}

/** Cuantos dias abarca, contando los dos extremos. */
export function diasDe(r: Rango): number {
  return Math.round((deIso(r.hasta).getTime() - deIso(r.desde).getTime()) / 86400000) + 1
}

/** Los parametros para el API: `desde=…&hasta=…`. */
export function queryRango(r: Rango): string {
  return `desde=${r.desde}&hasta=${r.hasta}`
}

/**
 * El rango de la pantalla, leido de la URL.
 *
 * `porDefecto` es lo que se ve al entrar: "hoy" en Reportes, "este mes" en
 * Ventas, "30 dias" donde antes se listaban 30 dias. Se guarda solo lo que se
 * aparta del defecto, asi la URL limpia sigue siendo la pantalla tal cual.
 */
export function useRango(porDefecto: ClaveRango = 'hoy'): [Rango, (r: Rango) => void] {
  const [params, setParams] = useSearchParams()
  const r = params.get('r') as ClaveRango | null
  const d = params.get('d')
  const h = params.get('h')

  const rango = useMemo<Rango>(() => {
    if (d && h && ES_ISO.test(d) && ES_ISO.test(h)) {
      return d <= h ? { desde: d, hasta: h, clave: 'personal' } : { desde: h, hasta: d, clave: 'personal' }
    }
    if (r && ATAJOS.some((a) => a.clave === r)) return rangoDe(r)
    return rangoDe(porDefecto)
  }, [r, d, h, porDefecto])

  const fijar = useCallback(
    (nuevo: Rango) => {
      // Se conservan los demas parametros (la seccion `s`, sobre todo).
      const p = new URLSearchParams(params)
      p.delete('r')
      p.delete('d')
      p.delete('h')
      if (nuevo.clave === 'personal') {
        p.set('d', nuevo.desde)
        p.set('h', nuevo.hasta)
      } else if (nuevo.clave !== porDefecto) {
        p.set('r', nuevo.clave)
      }
      setParams(p, { replace: true })
    },
    [params, setParams, porDefecto],
  )

  return [rango, fijar]
}
