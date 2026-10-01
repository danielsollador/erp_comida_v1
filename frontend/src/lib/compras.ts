import type { Ingrediente } from './types'

// El valor que viaja y se guarda NO cambia: "Insumos" es la clave con la que
// la contabilidad decide a que cuenta va cada compra, y la llevan las facturas
// que ya estan cargadas. Lo que cambia es la palabra que se lee: quien carga
// una factura de proveedor compra mercancia, no "insumos" -- esa palabra es de
// Inventario, donde lo mismo ya entro al deposito y va a una receta.
export const CATEGORIAS = [
  { valor: 'Insumos', texto: 'Mercancía' },
  { valor: 'Servicios', texto: 'Servicios' },
  { valor: 'Activos', texto: 'Activos' },
  { valor: 'Otros', texto: 'Otros' },
]

/** Como se lee una categoria guardada. Es el mismo mapa, al reves. */
export const TEXTO_CATEGORIA: Record<string, string> = Object.fromEntries(CATEGORIAS.map((c) => [c.valor, c.texto]))

/**
 * Lo que el sistema entiende por la unidad del papel, para compararla con la
 * de la mercancía. "UND" y "unidad" son lo mismo; "UND" y "kg" no.
 */
const UNIDADES: Record<string, string> = {
  KG: 'kg', KGS: 'kg', KILO: 'kg', KILOS: 'kg',
  G: 'g', GR: 'g', GRS: 'g',
  L: 'lt', LT: 'lt', LTS: 'lt', LITRO: 'lt', LITROS: 'lt',
  ML: 'ml',
  UND: 'unidad', UNID: 'unidad', UN: 'unidad', U: 'unidad', UNIDAD: 'unidad', UNIDADES: 'unidad',
  PAQ: 'paquete', PAQUETE: 'paquete',
}

export function unidadDistinta(unidadPapel: string, unidadNuestra: string | undefined): boolean {
  const papel = unidadPapel.trim().toUpperCase().replace(/\.$/, '')
  if (!papel || !unidadNuestra) return false
  return (UNIDADES[papel] ?? papel.toLowerCase()) !== unidadNuestra
}

/** "1 BULTO = 20 kg", o nada si es uno a uno. */
export function conversion(factor: number, unidadPapel: string, unidad: string): string {
  if (Math.abs(factor - 1) < 1e-9) return ''
  return `1 ${unidadPapel || 'unidad del papel'} = ${Number(factor.toFixed(4))} ${unidad}`
}

function palabras(texto: string): string[] {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9ñ]+/)
    .filter((p) => p.length >= 3)
}

/**
 * La mercancía nuestra que más se parece a lo que dice el papel, para
 * proponerla con un toque. Solo cuando una sale claramente primera: con un
 * empate no se adivina. Es la ayuda de la primera vez; después manda la
 * memoria del proveedor, que sabe lo que de verdad se eligió.
 */
export function sugerirMercancia(descripcion: string, ingredientes: Ingrediente[]): Ingrediente | null {
  const delPapel = palabras(descripcion)
  if (delPapel.length === 0) return null
  const puntaje = (ing: Ingrediente) =>
    palabras(ing.nombre).filter((p) =>
      delPapel.some((q) => q === p || (p.length >= 4 && (q.startsWith(p) || p.startsWith(q)))),
    ).length
  const ordenadas = ingredientes
    .map((ing) => ({ ing, puntos: puntaje(ing) }))
    .filter((x) => x.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos)
  if (ordenadas.length === 0) return null
  if (ordenadas.length > 1 && ordenadas[1].puntos === ordenadas[0].puntos) return null
  return ordenadas[0].ing
}

/** Días entre una fecha AAAA-MM-DD y hoy (positivo = en el pasado). */
export function diasDesde(fecha: string, hoyISO: string): number {
  return Math.round(
    (new Date(`${hoyISO}T12:00:00`).getTime() - new Date(`${fecha}T12:00:00`).getTime()) / 86400000,
  )
}
