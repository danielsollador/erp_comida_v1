import { hoyEnCaracas, inicioDelMes } from './formato'

/**
 * Lo que se escribe en un campo numerico, a numero. Acepta coma o punto
 * decimal ("1,5" y "1.5" son lo mismo: el teclado del telefono en español
 * pone coma). Vacio o basura = NaN, para que quien llama decida.
 */
export function aNumero(texto: string | number | null | undefined): number {
  if (typeof texto === 'number') return texto
  const limpio = String(texto ?? '').trim().replace(/\s/g, '').replace(',', '.')
  if (limpio === '' || limpio === '.' || limpio === '-') return NaN
  return Number(limpio)
}

/** Sin los decimales que deja la coma flotante (0,1 + 0,2): hasta 6 cifras. */
export function sinRuido(n: number): string {
  return String(Math.round(n * 1e6) / 1e6)
}

/**
 * LOS PERIODOS DE SIEMPRE, como los atajos de la web (lib/fechas.ts): el dia
 * del local (Caracas), no el del telefono. `desde` y `hasta` en AAAA-MM-DD,
 * ambos incluidos.
 */
export type IdPeriodo = 'hoy' | 'ayer' | '7d' | '30d' | 'mes' | 'mes_pasado' | '90d'

export type Periodo = { id: IdPeriodo; desde: string; hasta: string; etiqueta: string }

function restarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - dias)
  return d.toISOString().slice(0, 10)
}

export const PERIODOS: { id: IdPeriodo; texto: string }[] = [
  { id: 'hoy', texto: 'Hoy' },
  { id: 'ayer', texto: 'Ayer' },
  { id: '7d', texto: 'Últimos 7 días' },
  { id: '30d', texto: 'Últimos 30 días' },
  { id: 'mes', texto: 'Este mes' },
  { id: 'mes_pasado', texto: 'Mes pasado' },
  { id: '90d', texto: 'Últimos 90 días' },
]

export function periodoDe(id: IdPeriodo): Periodo {
  const hoy = hoyEnCaracas()
  const etiqueta = PERIODOS.find((p) => p.id === id)?.texto ?? ''
  switch (id) {
    case 'hoy':
      return { id, desde: hoy, hasta: hoy, etiqueta }
    case 'ayer': {
      const ayer = restarDias(hoy, 1)
      return { id, desde: ayer, hasta: ayer, etiqueta }
    }
    case '7d':
      return { id, desde: restarDias(hoy, 6), hasta: hoy, etiqueta }
    case '30d':
      return { id, desde: restarDias(hoy, 29), hasta: hoy, etiqueta }
    case '90d':
      return { id, desde: restarDias(hoy, 89), hasta: hoy, etiqueta }
    case 'mes':
      return { id, desde: inicioDelMes(), hasta: hoy, etiqueta }
    case 'mes_pasado': {
      const fin = restarDias(inicioDelMes(), 1)
      return { id, desde: `${fin.slice(0, 8)}01`, hasta: fin, etiqueta }
    }
  }
}

/** "12 oct" / "12 oct 2025": una fecha AAAA-MM-DD (o ISO con hora) en corto. */
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic']
export function fechaCorta(iso: string | null | undefined, conAno = false): string {
  if (!iso) return '—'
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!a || !m || !d) return iso
  return `${d} ${MESES_CORTOS[m - 1]}${conAno ? ` ${a}` : ''}`
}

/**
 * La hora de un momento ISO en la hora del local: "3:45 p. m.".
 *
 * El backend guarda la hora LOCAL del negocio sin zona ("2026-10-11T15:45:00",
 * ver backend/app/timeutils.py): esa se lee tal cual, sin convertir. Solo una
 * hora con zona (Z o +hh:mm) se pasa a la de Caracas (UTC−4).
 */
export function horaCorta(iso: string | null | undefined): string {
  if (!iso) return ''
  let h: number
  let min: number
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(iso)) {
    const d = new Date(new Date(iso).getTime() - 4 * 3600_000)
    if (Number.isNaN(d.getTime())) return ''
    h = d.getUTCHours()
    min = d.getUTCMinutes()
  } else {
    const m = /T(\d{2}):(\d{2})/.exec(iso)
    if (!m) return ''
    h = Number(m[1])
    min = Number(m[2])
  }
  return `${h % 12 === 0 ? 12 : h % 12}:${String(min).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`
}
