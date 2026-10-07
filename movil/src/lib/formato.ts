/**
 * Cifras y fechas como las escribe la web: miles con punto y decimales con
 * coma ($1.508,50), y el signo menos delante del simbolo (−$4,42).
 *
 * Sin Intl a proposito: el motor de JavaScript del telefono no siempre trae
 * los datos de idioma, y una cifra que sale distinta en Android que en iPhone
 * es peor que una funcion de diez lineas.
 */
export function miles(n: number, decimales = 2): string {
  const [entero, dec] = Math.abs(n).toFixed(decimales).split('.')
  const conPuntos = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${n < 0 ? '−' : ''}${conPuntos}${dec ? `,${dec}` : ''}`
}

export function dolares(n: number | null | undefined, decimales = 2): string {
  if (n === null || n === undefined) return '—'
  return `${n < 0 ? '−' : ''}$${miles(Math.abs(n), decimales)}`
}

export function bolivares(n: number | null | undefined, decimales = 2): string {
  if (n === null || n === undefined) return '—'
  return `${n < 0 ? '−' : ''}Bs ${miles(Math.abs(n), decimales)}`
}

/**
 * EL DIA DEL LOCAL, NO EL DEL TELEFONO. Venezuela esta en UTC−4 todo el año
 * (sin horario de verano desde 2016). En la tablet, un reloj en otra zona
 * hacia que despues de las 8 p. m. "hoy" ya fuera mañana y "Vendido hoy"
 * marcara $0 (6-oct): aqui el dia sale de la hora universal menos cuatro.
 */
function ahoraEnCaracas(): Date {
  return new Date(Date.now() - 4 * 3600_000)
}

export function hoyEnCaracas(): string {
  return ahoraEnCaracas().toISOString().slice(0, 10)
}

export function inicioDelMes(): string {
  return `${hoyEnCaracas().slice(0, 8)}01`
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

export function fechaDeHoy(): string {
  const d = ahoraEnCaracas()
  const dia = DIAS[d.getUTCDay()]
  return `${dia[0].toUpperCase()}${dia.slice(1)}, ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`
}

export function nombreDelMes(): string {
  const d = ahoraEnCaracas()
  const mes = MESES[d.getUTCMonth()]
  return `${mes[0].toUpperCase()}${mes.slice(1)} ${d.getUTCFullYear()}`
}

export function saludo(): string {
  const h = ahoraEnCaracas().getUTCHours()
  if (h < 12) return 'Buenos días'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

/** La inicial del dia de una fecha AAAA-MM-DD: L M M J V S D. */
export function inicialDelDia(fecha: string): string {
  return ['D', 'L', 'M', 'M', 'J', 'V', 'S'][new Date(`${fecha}T12:00:00Z`).getUTCDay()]
}
