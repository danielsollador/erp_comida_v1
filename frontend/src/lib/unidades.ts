/**
 * EL KILO Y EL GRAMO, EL LITRO Y EL MILILITRO: LA MISMA MEDIDA EN DOS TAMAÑOS.
 *
 * La mercancia se guarda en una sola unidad (la de su ficha), pero en todo
 * lugar donde se escribe una cantidad se puede escribir en la otra: 500 g de
 * carne en vez de 0,5 kg, 350 ml de refresco en vez de 0,35 lt. La conversion
 * la hace el sistema; quien escribe no hace cuentas (Leider, 2-oct: "para
 * TODAS estas cosas tienes que poder cambiar entre kg o g, o entre lt o ml,
 * eso es fijo siempre").
 */
const PAREJAS: Record<string, { otra: string; factor: number }> = {
  kg: { otra: 'g', factor: 1000 },
  g: { otra: 'kg', factor: 0.001 },
  lt: { otra: 'ml', factor: 1000 },
  ml: { otra: 'lt', factor: 0.001 },
}

/** La otra cara de la unidad (kg ⇄ g, lt ⇄ ml), o null si no tiene. */
export function otraUnidad(unidad: string): string | null {
  return PAREJAS[unidad]?.otra ?? null
}

/** Cuantas `vista` caben en una `base`: kg → g = 1000, g → kg = 0,001. */
export function factorEntre(base: string, vista: string): number {
  if (base === vista) return 1
  const p = PAREJAS[base]
  return p && p.otra === vista ? p.factor : 1
}

/** Un numero sin el ruido de la coma flotante: 0.30000000000000004 → "0.3". */
export function sinRuido(n: number): string {
  return String(Number(n.toFixed(6)))
}

/** Lee lo que se escribio, con coma o con punto. */
export function leerNumero(texto: string): number {
  return Number(String(texto).trim().replace(',', '.'))
}

/**
 * Lo escrito en `vista`, pasado a la `base` como texto. Vacio sigue vacio, y
 * lo que no es un numero se devuelve tal cual para que lo rechace quien valida.
 */
export function aBase(texto: string, base: string, vista: string): string {
  if (texto.trim() === '') return ''
  const n = leerNumero(texto)
  return Number.isFinite(n) ? sinRuido(n / factorEntre(base, vista)) : texto
}

/** Un texto escrito en `desde`, reescrito en `hacia` (al tocar el interruptor). */
export function convertirTexto(texto: string, base: string, desde: string, hacia: string): string {
  if (texto.trim() === '') return texto
  const n = leerNumero(texto)
  if (!Number.isFinite(n)) return texto
  return sinRuido((n / factorEntre(base, desde)) * factorEntre(base, hacia))
}
