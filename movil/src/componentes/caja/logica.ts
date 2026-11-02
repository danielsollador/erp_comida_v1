import { METODOS_CON_REFERENCIA } from '../../../../frontend/src/lib/pagos'
import { aNumero, sinRuido } from '../../lib/numeros'
import type { CobroDelDia, LineaMetodo } from '../../lib/tipos'
import type { Conteo } from '../../lib/api-caja'

/*
 * LAS REGLAS DEL CIERRE DE CAJA, sin pantalla: las mismas cuentas que hace
 * frontend/src/pages/Caja.tsx y components/abrirCaja.tsx, copiadas tal cual
 * porque esos archivos tocan el navegador y no pueden entrar a la app. Si la
 * web cambia una regla, cambia aqui.
 */

export type IdSeccion = 'cierre' | 'movimientos' | 'historial'

/** Las secciones de la web, en su orden. */
export const SECCIONES: { id: IdSeccion; texto: string }[] = [
  { id: 'cierre', texto: 'Cierre de caja' },
  { id: 'movimientos', texto: 'Gastos y retiros' },
  { id: 'historial', texto: 'Historial' },
]

export const CATEGORIAS_GASTO = ['Insumos', 'Servicios', 'Sueldos', 'Otros']

/**
 * Lo que se cuenta o se coteja EN BOLIVARES: la gaveta de bolivares, el lote
 * del punto, el pago movil y la transferencia. Lo demas --dolares y Zelle--
 * va en dolares. El sistema guarda todo en dolares, asi que lo tecleado en
 * bolivares se convierte a la tasa del dia antes de viajar.
 */
export const EN_BOLIVARES = new Set(['Efectivo Bs', 'Punto de venta', 'Pago movil', 'Transferencia'])

// Los billetes que de verdad andan. Lo que no sea un billete entero va en
// "sueltos", asi que una denominacion que falte aqui no impide contar.
export const BILLETES_USD = [100, 50, 20, 10, 5, 2, 1]
export const BILLETES_BS = [500, 200, 100, 50, 20, 10, 5]

export const redondear2 = (n: number) => Math.round(n * 100) / 100

/** Menos de un centavo es cero: "cuadra". */
export const cuadra = (n: number) => Math.abs(n) < 0.01

/** "1 pedido", "3 pedidos": el plural escrito bien, no "pedido(s)". */
export function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`
}

/** Lo que entro por esta via: ventas, mas lo que los libros saben y no es venta (un fiado viejo cobrado). */
export function entradaDe(l: LineaMetodo): number {
  return l.ventas + Math.max(l.otros, 0)
}

/** Lo que salio por esta via: gastos y retiros, mas lo que el desglose no puede atribuir (pagarle a un proveedor). */
export function salidaDe(l: LineaMetodo): number {
  return l.salidas - Math.min(l.otros, 0)
}

/** Un cobro que debia traer referencia y no la trae (los de antes de exigirla). */
export function sinReferencia(c: CobroDelDia): boolean {
  return METODOS_CON_REFERENCIA.has(c.metodo) && !c.referencia
}

// ── Abrir: contar la gaveta por billete ─────────────────────────────────────

/** Lo tecleado en una gaveta: billete -> cuantos, y "sueltos" (monedas y lo que no es un billete entero). */
export type FilasGaveta = Record<string, string>

/**
 * El desglose limpio de una gaveta, y su total en la moneda de la gaveta.
 * null = no se toco: "no conte esa gaveta" es distinto de "conte y estaba
 * vacia", y la segunda asienta una diferencia.
 */
export function desgloseDe(filas: FilasGaveta | undefined): { desglose: Record<string, number>; total: number } | null {
  if (!filas) return null
  const desglose: Record<string, number> = {}
  let total = 0
  for (const [clave, texto] of Object.entries(filas)) {
    const n = aNumero(texto)
    if (!texto.trim() || !Number.isFinite(n) || n <= 0) continue
    desglose[clave] = n
    total += clave === 'sueltos' ? n : Number(clave) * n
  }
  if (Object.keys(desglose).length === 0) return null
  return { desglose, total: redondear2(total) }
}

// ── Cerrar: un numero por forma de pago ─────────────────────────────────────

/**
 * Lo que se va a mandar al cerrar: solo lo que tenga un numero escrito. En
 * blanco NO viaja como cero. Lo tecleado en bolivares se guarda en dolares, a
 * la tasa del dia; sin tasa no hay como convertir y esa forma no viaja.
 */
export function conteosDe(lineas: LineaMetodo[], contados: Record<string, string>, bcv: number): Conteo[] {
  return lineas.flatMap((l) => {
    const escrito = (contados[l.metodo] ?? '').trim()
    if (!escrito) return []
    const tecleado = aNumero(escrito)
    if (!Number.isFinite(tecleado) || tecleado < 0) return []
    if (EN_BOLIVARES.has(l.metodo)) {
      if (bcv <= 0) return []
      return [{ metodo: l.metodo, contado: redondear2(tecleado / bcv) }]
    }
    return [{ metodo: l.metodo, contado: tecleado }]
  })
}

/**
 * Al corregir se arranca con lo que se reporto, en la moneda de cada forma:
 * teclearlo todo otra vez para cambiar un digito es lo que hace que nadie
 * corrija nada. Con coma decimal, como lo pone el teclado del telefono.
 */
export function contadosIniciales(lineas: LineaMetodo[], bcv: number): Record<string, string> {
  return Object.fromEntries(
    lineas
      .filter((l) => l.contado !== null)
      .map((l) => {
        const contado = l.contado as number
        const valor = EN_BOLIVARES.has(l.metodo) && bcv > 0 ? redondear2(contado * bcv) : contado
        return [l.metodo, sinRuido(valor).replace('.', ',')]
      }),
  )
}

// ── Fechas ──────────────────────────────────────────────────────────────────
// Todo con la fecha AAAA-MM-DD del local (Caracas) y a mediodia UTC: asi el
// dia de la semana no se corre por la zona del telefono.

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]
// Los de la web (lib/fechas.ts), para que el rango se lea igual en las dos.
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function partes(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number)
  return { a, m, d }
}

const mayuscula = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`

export function sumarDias(iso: string, n: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** "Domingo, 11 de octubre" (con el año si no es el de hoy). */
export function diaLargo(iso: string, hoy: string): string {
  const { a, m, d } = partes(iso)
  const semana = DIAS[new Date(`${iso.slice(0, 10)}T12:00:00Z`).getUTCDay()]
  return `${mayuscula(semana)}, ${d} de ${MESES[m - 1]}${a !== partes(hoy).a ? ` de ${a}` : ''}`
}

/** Como se nombra un dia en la lista para elegirlo: "Hoy", "Ayer" o "Viernes, 9 de octubre". */
export function nombreDelDia(iso: string, hoy: string): string {
  if (iso === hoy) return 'Hoy'
  if (iso === sumarDias(hoy, -1)) return 'Ayer'
  return diaLargo(iso, hoy)
}

/** "11/10": la fecha de las listas de la web (dia y mes a dos cifras). */
export function diaMes(iso: string): string {
  const { m, d } = partes(iso)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
}

/** "30/9/2026": un dia entero, como lo escribe la web (toLocaleDateString de es-VE). */
export function fechaVE(iso: string): string {
  const { a, m, d } = partes(iso)
  return `${d}/${m}/${a}`
}

/** "16 sep", "1–16 sep", "12 ago – 16 sep": el periodo rotulado como en la web (etiquetaRango). */
export function etiquetaRango(desde: string, hasta: string, hoy: string): string {
  const d = partes(desde)
  const h = partes(hasta)
  const esteAno = h.a === partes(hoy).a
  const f = (x: { a: number; m: number; d: number }, conAno: boolean) =>
    `${x.d} ${MESES_CORTOS[x.m - 1]}${conAno ? ` ${x.a}` : ''}`
  if (desde === hasta) return f(d, !esteAno)
  if (d.a !== h.a) return `${f(d, true)} – ${f(h, true)}`
  if (d.m === h.m) return `${d.d}–${f(h, !esteAno)}`
  return `${f(d, false)} – ${f(h, !esteAno)}`
}
