import type { ConceptoGasto, Ingrediente } from './types'

// El valor que viaja y se guarda NO cambia: "Insumos" es la clave con la que
// la contabilidad decide a que cuenta va cada compra, y la llevan las facturas
// que ya estan cargadas. Lo que cambia es la palabra que se lee: quien carga
// una factura de proveedor compra mercancia, no "insumos" -- esa palabra es de
// Inventario, donde lo mismo ya entro al deposito y va a una receta.
//
// "Suministros" (6-oct): la limpieza, los desechables y la papeleria no tenian
// donde ir. Como "Mercancia" pedian emparejar cada renglon con el inventario
// (nadie cuenta bidones de cloro) y como "Otros" no se encontraban despues.
// Contablemente es gasto, igual que Servicios.
export const CATEGORIAS = [
  { valor: 'Insumos', texto: 'Mercancía para inventario', ayuda: 'Comida, bebidas y lo que va a recetas: entra al inventario renglón por renglón.' },
  { valor: 'Suministros', texto: 'Limpieza y suministros', ayuda: 'Cloro, bolsas, papel, desechables, papelería: va a gasto, sin renglones.' },
  { valor: 'Servicios', texto: 'Servicios', ayuda: 'Luz, agua, internet, gas, reparaciones, delivery: va a gasto.' },
  { valor: 'Activos', texto: 'Equipos y mobiliario', ayuda: 'Neveras, cocinas, mesas: entra al balance y se deprecia con los meses.' },
  { valor: 'Otros', texto: 'Otros gastos', ayuda: 'Lo que no encaja en lo anterior: va a gasto.' },
]

/**
 * Lo que la factura cobra y NO es mercancía (7-oct). Antes se elegía una
 * categoría para la factura entera, y una factura de pollo que también
 * cobraba el flete no tenía cómo decirlo. Ahora cada renglón dice qué es: la
 * mercancía por su ficha, y lo demás por uno de estos. El flete va aparte
 * porque lleva retención de ISLR propia.
 */
export const CONCEPTOS: { valor: ConceptoGasto; texto: string; ayuda: string; ejemplo: string }[] = [
  { valor: 'Flete', texto: 'Flete', ayuda: 'El transporte que cobra el proveedor.', ejemplo: 'Flete, traslado, envío' },
  { valor: 'Servicio', texto: 'Servicio', ayuda: 'Luz, agua, internet, gas, reparaciones.', ejemplo: 'Internet de octubre' },
  { valor: 'Equipo', texto: 'Equipo', ayuda: 'Neveras, cocinas, mesas: se deprecia con los meses.', ejemplo: 'Licuadora industrial' },
  { valor: 'Otro', texto: 'Otro gasto', ayuda: 'Lo que no encaja en lo anterior.', ejemplo: 'Qué es' },
]

export const TEXTO_CONCEPTO: Record<ConceptoGasto, string> = Object.fromEntries(CONCEPTOS.map((c) => [c.valor, c.texto])) as Record<
  ConceptoGasto,
  string
>

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

/** La unidad del papel en las nuestras ("KGS" -> "kg"), o '' si no se sabe. */
export function unidadNuestra(unidadPapel: string): string {
  const papel = unidadPapel.trim().toUpperCase().replace(/\.$/, '')
  return UNIDADES[papel] ?? ''
}

/**
 * El nombre para una mercancía nueva a partir del renglón del papel: sin el
 * código de artículo ni la marca de exento, y en minúsculas como los nombres
 * de Inventario. "GASNK0040172 NARU MANI MIXTO 0,090 KG. (E)" ->
 * "Naru mani mixto 0,090 kg.".
 */
export function nombreDesdePapel(descripcion: string): string {
  const limpio = descripcion
    .replace(/\(\s*E\s*\)/gi, ' ')
    .split(/\s+/)
    // Un código: una palabra larga con dígitos al inicio del renglón.
    .filter((p, i) => !(i === 0 && p.length >= 6 && /\d/.test(p)))
    .join(' ')
    .trim()
    .toLowerCase()
  return limpio.charAt(0).toUpperCase() + limpio.slice(1)
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

// Palabras que no dicen que es la mercancia. "con" llego a proponer
// "Refresco concentrado" para un "SUETER CON TEXTURA".
const VACIAS = new Set(['con', 'sin', 'para', 'por', 'los', 'las', 'del', 'und', 'unid', 'tipo', 'marca'])

function palabras(texto: string): string[] {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9ñ]+/)
    .filter((p) => p.length >= 3 && !VACIAS.has(p) && !/^\d+$/.test(p))
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
      // Por prefijo solo entre palabras de 4+ letras: "harin" con "harina"
      // si, "con" con "concentrado" no.
      delPapel.some((q) => q === p || (Math.min(p.length, q.length) >= 4 && (q.startsWith(p) || p.startsWith(q)))),
    ).length
  const ordenadas = ingredientes
    .map((ing) => ({ ing, puntos: puntaje(ing) }))
    .filter((x) => x.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos)
  if (ordenadas.length === 0) return null
  if (ordenadas.length > 1 && ordenadas[1].puntos === ordenadas[0].puntos) return null
  return ordenadas[0].ing
}

/**
 * El IVA que retiene un cliente contribuyente especial sobre una venta con
 * IVA incluido, en dólares. Misma cuenta que el servidor, al céntimo: IVA
 * desglosado del total y el % en céntimos enteros con la mitad hacia arriba
 * (6,90 × 75 % = 5,18). Si no diera lo mismo, la caja rechazaría el cobro.
 */
export function ivaRetenido(totalConIva: number, pct: number, tasaIvaPct = 16): number {
  const base = Math.round((totalConIva / (1 + tasaIvaPct / 100)) * 100) / 100
  const ivaCentimos = Math.round((totalConIva - base) * 100)
  return Math.floor((ivaCentimos * Math.round(pct * 100) + 5000) / 10000) / 100
}

/** Días entre una fecha AAAA-MM-DD y hoy (positivo = en el pasado). */
export function diasDesde(fecha: string, hoyISO: string): number {
  return Math.round(
    (new Date(`${hoyISO}T12:00:00`).getTime() - new Date(`${fecha}T12:00:00`).getTime()) / 86400000,
  )
}
