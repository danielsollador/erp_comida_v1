/**
 * UN MONTO SE LEE IGUAL EN TODA LA APP (web y app movil).
 *
 * En Venezuela los miles van con punto y los decimales con coma: «17.922,45».
 * Cada pantalla leia a su manera: el cierre tomaba «5.000» Bs como 5, Compras
 * guardaba «17.922» como 17,92 (la Harina PAN quedo a $0,002 el kilo) y Pagos
 * leia «17922.45» como 1.792.245 (QA de noviembre, R1 de specs/qa.md).
 *
 *   «17.922,45» «17922,45» «17922.45» → 17922,45
 *   «5.000» «1.250.000»               → miles (en un monto)
 *   «896.1225» «2240.31» «0.500»      → decimales
 *
 * Un solo punto seguido de exactamente tres digitos es miles en un monto. En
 * una cantidad (`miles: false`) es decimal: «1.250» kg es kilo y cuarto.
 */
export function leerMonto(texto: string | number | null | undefined, { miles = true } = {}): number {
  if (typeof texto === 'number') return texto
  let t = String(texto ?? '')
    .trim()
    .replace(/bs\.?|\$|usd|€|\s/gi, '')
  if (t === '') return NaN
  let signo = 1
  if (t.startsWith('-') || t.startsWith('−')) {
    signo = -1
    t = t.slice(1)
  }
  if (!/^[\d.,]+$/.test(t)) return NaN
  const puntos = (t.match(/\./g) || []).length
  const comas = (t.match(/,/g) || []).length
  if (puntos && comas) {
    const decimal = t.lastIndexOf(',') > t.lastIndexOf('.') ? ',' : '.'
    const otro = decimal === ',' ? '.' : ','
    t = t.split(otro).join('').replace(decimal, '.')
  } else if (comas) {
    t = comas > 1 ? t.split(',').join('') : t.replace(',', '.')
  } else if (puntos > 1) {
    t = t.split('.').join('')
  } else if (puntos === 1 && miles && /^[1-9]\d{0,2}\.\d{3}$/.test(t)) {
    t = t.replace('.', '')
  }
  const n = Number(t)
  return Number.isFinite(n) ? signo * n : NaN
}

/** Como `leerMonto`, pero lo vacio o ilegible vale 0 (para sumas en pantalla). */
export function montoO0(texto: string | number | null | undefined, opciones?: { miles?: boolean }): number {
  const n = leerMonto(texto, opciones)
  return Number.isFinite(n) ? n : 0
}

/**
 * Lo tecleado en una casilla de monto, reescrito sin ambiguedad mientras se
 * escribe: «5.000» pasa a «5000» y «2.240,31» a «2240.31». Lo que todavia no
 * se puede decidir («5.0», «17,») se deja como va.
 */
export function normalizarTecleo(texto: string): string {
  const t = texto.replace(/\s/g, '')
  if (t === '' || t === '-' || /[.,]$/.test(t)) return t.replace(/,$/, '.')
  const n = leerMonto(t)
  if (!Number.isFinite(n)) return texto
  const puntos = (t.match(/\./g) || []).length
  const comas = (t.match(/,/g) || []).length
  if (!comas && puntos === 1 && !/^-?[1-9]\d{0,2}\.\d{3}$/.test(t)) return t
  if (!comas && !puntos) return t
  return String(n)
}
