import { unidadDe } from '../../../../frontend/src/lib/inventario'
import { aNumero, sinRuido } from '../../lib/numeros'
import type { Ingrediente } from '../../lib/tipos'
import { colorFranja } from './colores'

/*
 * LAS CUENTAS DE LA OLLA, sin pantalla: las mismas de la web
 * (pages/partes/inventario/Preparaciones.tsx), escritas aparte para que la
 * olla del telefono y la de la tablet digan exactamente lo mismo que la web.
 *
 * LA RECETA ES POR UNO (Leider, 8-oct): lo que lleva 1 kg de guiso ya hecho
 * (o 1 lt, o 1 unidad). Lo que cuesta el kilo es la suma de lo que lleva, y
 * para hacer 10 kg el sistema multiplica. LA OLLA ES EL KILO (11-oct): lo
 * que queda cocido de cada crudo tiene que sumar 1; si se pasa, no se
 * guarda; si no llega, se avisa y se deja guardar.
 */

/** Lo escrito, a numero (coma o punto). Vacio o basura cuentan como 0 en la olla. */
export const aNum = (t: string) => {
  const n = aNumero(t)
  return Number.isFinite(n) ? n : 0
}

/**
 * "1,43", "1.428,57", "0,7": hasta dos decimales, como `toLocaleString('es-VE')`
 * de la web. A mano y sin Intl, por lo mismo que lib/formato: el motor del
 * telefono no siempre trae los datos de idioma.
 */
export function fmtCant(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const r = Math.round(n * 100) / 100
  const [entero, dec] = Math.abs(r).toFixed(2).split('.')
  const decimales = dec.replace(/0+$/, '')
  const conPuntos = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${r < 0 ? '-' : ''}${conPuntos}${decimales ? `,${decimales}` : ''}`
}

/** kg ⇄ g, lt ⇄ ml: la otra cara de la unidad. */
export const OTRA_UNIDAD: Record<string, string> = { kg: 'g', g: 'kg', lt: 'ml', ml: 'lt' }
export const esGrande = (u: string) => u === 'kg' || u === 'lt'

/** "1 kg", "500 g", "2 unidades": lo que entra, en la medida que mejor se lee. */
export const cantidadLegible = (n: number, u: string) =>
  esGrande(u) && n > 0 && n < 1 ? `${fmtCant(n * 1000)} ${OTRA_UNIDAD[u]}` : `${fmtCant(n)} ${unidadDe(n, u)}`

/** "kilo", "litro", "unidad": como se lee la medida de una preparacion. */
export const unidadLarga = (u: string) => (u === 'kg' ? 'kilo' : u === 'lt' ? 'litro' : 'unidad')

/** "unidades" o la unidad tal cual: lo que va despues de "si un dia haces 10". */
export const unidadPlural = (u: string) => (u === 'unidad' ? 'unidades' : u)

// Que mide cada unidad y cuanto vale en la grande (1 g = 0,001 kg). Igual
// que `_MEDIDA` en models.py: lo que se ve aqui es lo que guarda el servidor.
const MEDIDA: Record<string, [string, number]> = { kg: ['peso', 1], g: ['peso', 0.001], lt: ['volumen', 1], ml: ['volumen', 0.001] }
export const mismaMedida = (a: string, b: string) => a === b || (!!MEDIDA[a] && !!MEDIDA[b] && MEDIDA[a][0] === MEDIDA[b][0])
const aLaGrande = (u: string) => MEDIDA[u]?.[1] ?? 1

/** Un renglon de la receta mientras se escribe. */
export type FilaOlla = {
  ingrediente_id: number
  /** Lo que entra, crudo, en la unidad de la ficha. */
  cantidad: string
  /** Lo que se aprovecha de ese crudo al cocinarlo (%). Es de la FICHA del
      crudo (el pollo pierde lo mismo en cualquier guiso) y se guarda ahi. */
  aprovechable: string
  /** Se escribe en la unidad chica (g, ml). */
  enChica?: boolean
}

export type ParteOlla = {
  id: number
  nombre: string
  cantidad: number
  unidad: string
  /** En la medida de la preparacion (500 g suman 0,5 kg a un guiso en kg), o null si se mide distinto. */
  enSuMedida: number | null
  /** Lo que queda ya cocido, en la medida de la preparacion. */
  queda: number
  costo: number
  color: string
}

/**
 * Lo que pesa cada cosa en la olla y lo que queda de cada una; si se pasa
 * del kilo o le falta. Las mismas cuentas, en el mismo orden, que la web.
 */
export function cuentasDeOlla(filas: FilaOlla[], porId: Map<number, Ingrediente>, unidad: string) {
  const partes: ParteOlla[] = []
  filas.forEach((f, i) => {
    const ing = porId.get(f.ingrediente_id)
    if (!ing) return
    const cantidad = aNum(f.cantidad)
    const pct = Math.min(Math.max(aNum(f.aprovechable), 0), 100)
    const enSuMedida = mismaMedida(ing.unidad, unidad) ? (cantidad * aLaGrande(ing.unidad)) / aLaGrande(unidad) : null
    partes.push({
      id: ing.id,
      nombre: ing.nombre,
      cantidad,
      unidad: ing.unidad,
      enSuMedida,
      queda: (enSuMedida ?? 0) * (pct / 100),
      costo: cantidad * (ing.costo_unitario || 0),
      color: colorFranja(i),
    })
  })
  // Lo que cuesta 1 kg (o 1 lt, o 1 unidad): la receta es por uno.
  const costoTanda = partes.reduce((s, p) => s + p.costo, 0)
  // Lo que queda de cada crudo medido como la preparacion (kg con g, lt con
  // ml) deberia sumar ese 1. Si suma 0,7 es que la cocina escribio su tanda
  // y no el kilo: se le ofrece ajustarla. Lo que se mide distinto (la leche
  // en un guiso) no se puede sumar y no estorba: cuenta en el costo igual.
  const enSuUnidad = partes.filter((p) => p.enSuMedida !== null)
  const queda = enSuUnidad.reduce((s, p) => s + p.queda, 0)
  const desajuste = enSuUnidad.length > 0 && queda > 0 && Math.abs(queda - 1) > 0.02
  // Se pasa: no cabe en la olla, no se guarda. Falta: se avisa y se deja
  // guardar, pero solo se puede saber que falta cuando todo se mide como la
  // preparacion (con leche en litros dentro de un guiso en kilos no hay suma).
  const sePasa = queda > 1.02
  const falta = !sePasa && enSuUnidad.length > 0 && queda > 0 && queda < 0.98
  const sinMedir = partes.filter((p) => p.enSuMedida === null).map((p) => p.nombre)
  return { partes, costoTanda, enSuUnidad, queda, desajuste, sePasa, falta, sinMedir }
}

/** Todas las cantidades entre lo que queda: la tanda pasa a ser el kilo. A tres decimales: 1,429 kg se lee; 1,428571 no, y el costo no se entera. */
export function ajustarAUno(filas: FilaOlla[], queda: number): FilaOlla[] {
  if (!(queda > 0)) return filas
  return filas.map((f) => ({
    ...f,
    cantidad: f.cantidad === '' ? '' : sinRuido(Math.round((aNum(f.cantidad) / queda) * 1000) / 1000),
  }))
}

// ── Los textos de la olla, copiados de la web ───────────────────────────────

/** El error al tocar Guardar cuando se pasa del kilo (la web lo pone en rojo arriba). */
export function errorSePasa(queda: number, unidad: string): string {
  const larga = unidadLarga(unidad)
  return (
    `Lo que queda cocido suma ${fmtCant(queda)} ${unidadDe(queda, unidad)} y la receta es lo que lleva 1 ${larga} ya hecho, nada más: ` +
    `si un día haces 10 ${unidadPlural(unidad)}, el sistema multiplica por 10 solo. Baja las cantidades o toca «Ajustar al ${larga}».`
  )
}

/** El primer parrafo del aviso de la olla: por que la olla es 1 kg. La primera frase va en negrita. */
export function porQueElKilo(unidad: string): [string, string] {
  const larga = unidadLarga(unidad)
  return [
    `La receta es lo que lleva 1 ${larga} ya hecho, nada más.`,
    ` Es el inventario teórico: con ella el sistema sabe cuánto crudo se va en cada ${larga} que vendes y cuánto cuesta. Si un día haces 10 ${unidadPlural(unidad)}, multiplica por 10 solo.`,
  ]
}

/** El segundo parrafo: que pasa aqui (se pasa o le falta) y que hacer. */
export function queHacer(sePasa: boolean, queda: number, unidad: string, sinMedir: string[]): string {
  const larga = unidadLarga(unidad)
  if (sePasa)
    return `Aquí lo que queda cocido suma ${fmtCant(queda)} ${unidadDe(queda, unidad)}: en la olla de 1 ${larga} no cabe, y así no se puede guardar. Baja las cantidades o toca «Ajustar al ${larga}», que las reparte en proporción.`
  return (
    `Aquí lo que queda cocido suma ${fmtCant(queda)} ${unidadDe(queda, unidad)}` +
    `${sinMedir.length ? ` (sin contar lo que no se mide en ${unidad}: ${sinMedir.join(', ')})` : ''}: ` +
    `${unidad === 'unidad' ? 'falta' : `faltan ${cantidadLegible(1 - queda, unidad)}`} para el ${larga}. ` +
    `Trata de que siempre dé el ${larga}: sube las cantidades, agrega lo que falta o toca «Ajustar al ${larga}». ` +
    `Si lo guardas así, el ${larga} queda con menos de lo que lleva de verdad y el costo sale bajo.`
  )
}

// ── Fechas como las escribe la web ──────────────────────────────────────────

const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

/** "11/10/2026": la fecha de un conteo o una merma (`toLocaleDateString('es-VE')`). La hora del backend es la del local, sin zona: se lee tal cual. */
export function fechaNumerica(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!a || !m || !d) return iso
  return `${d}/${m}/${a}`
}

/** "dom" de una fecha AAAA-MM-DD: el dia de la semana de una tanda. */
export function diaCorto(iso: string): string {
  const fecha = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(fecha.getTime()) ? '' : DIAS_CORTOS[fecha.getUTCDay()]
}
