import { ALMACENES } from '../../../../frontend/src/lib/tiposArticulo'
import { apiInventario } from '../../lib/api-inventario'
import { periodoDe } from '../../lib/numeros'
import type {
  CategoriaInsumo,
  Configuracion,
  ConteoResumen,
  FacturaCompra,
  InflacionInsumos,
  Ingrediente,
  Merma,
  SugerenciaCompra,
  TipoArticulo,
} from '../../lib/tipos'

/*
 * LO QUE CARGA CADA SECCION DE INVENTARIO. Las mismas llamadas de la web
 * (pages/Inventario.tsx, `cargar`), pero cada seccion pide solo lo que
 * muestra: la portada no necesita la inflacion ni una lista de mercancia las
 * facturas. Lo que no es la mercancia misma puede fallar sin tumbar la
 * pantalla (un rol sin Compras no ve las facturas): queda vacio, como en la web.
 *
 * El inventario es lo que hay hoy: sin filtro de fechas (Leider, 8-oct). Las
 * perdidas y el gasto en desechables miran los ultimos 30 dias.
 */

export type Seccion = 'almacenes' | 'comprar' | 'materia-prima' | 'reventa' | 'consumibles' | 'desechables' | 'categorias'

export const SECCIONES: Seccion[] = ['almacenes', 'comprar', 'materia-prima', 'reventa', 'consumibles', 'desechables', 'categorias']

export type DatosInventario = {
  ingredientes: Ingrediente[]
  categorias: CategoriaInsumo[]
  sugerencias: SugerenciaCompra[]
  mermas: Merma[]
  conteos: ConteoResumen[]
  facturas: FacturaCompra[]
  inflacion: InflacionInsumos | null
  config: Configuracion | null
}

const nada = <T>(valor: T) => () => valor

export async function cargarInventario(seccion: Seccion): Promise<DatosInventario> {
  const { desde, hasta } = periodoDe('30d')
  const portada = seccion === 'almacenes'
  const [ingredientes, categorias, sugerencias, mermas, conteos, facturas, inflacion, config] = await Promise.all([
    apiInventario.ingredientes(),
    seccion === 'categorias' || seccion === 'materia-prima' || seccion === 'reventa' || seccion === 'consumibles'
      ? apiInventario.categorias().catch(nada<CategoriaInsumo[]>([]))
      : Promise.resolve<CategoriaInsumo[]>([]),
    portada || seccion === 'comprar' ? apiInventario.sugerencias().catch(nada<SugerenciaCompra[]>([])) : Promise.resolve([]),
    portada ? apiInventario.mermas(desde, hasta).catch(nada<Merma[]>([])) : Promise.resolve([]),
    portada ? apiInventario.conteos(desde, hasta).catch(nada<ConteoResumen[]>([])) : Promise.resolve([]),
    portada || seccion === 'desechables' ? apiInventario.facturas(desde, hasta).catch(nada<FacturaCompra[]>([])) : Promise.resolve([]),
    seccion === 'comprar' ? apiInventario.inflacion().catch(nada(null)) : Promise.resolve(null),
    apiInventario.config().catch(nada(null)),
  ])
  return { ingredientes, categorias, sugerencias, mermas, conteos, facturas, inflacion, config }
}

/** Lo que importa de un almacen: cuantas, bajo minimo, sin costo y la plata. */
export type ResumenAlmacen = {
  tipo: TipoArticulo
  mercancias: number
  bajoMinimo: number
  sinCosto: number
  /** Stock × costo promedio. Para desechables, lo gastado en el periodo. */
  plata: number
  /** Solo materia prima: cuantas preparaciones hay. */
  preparaciones?: number
}

/** Lo gastado en desechables en las facturas del periodo. */
export function gastoEnDesechables(facturas: FacturaCompra[]): number {
  return facturas.reduce((s, f) => s + f.items.filter((i) => i.tipo === 'desechable').reduce((x, i) => x + i.subtotal, 0), 0)
}

export function resumenes(ingredientes: Ingrediente[], gastoDesechables: number): ResumenAlmacen[] {
  const activos = ingredientes.filter((i) => i.activo !== false)
  return ALMACENES.map((a) => {
    const propios = activos.filter((i) => i.tipo === a.valor)
    return {
      tipo: a.valor,
      mercancias: propios.length,
      bajoMinimo: a.destino === 'gasto' ? 0 : propios.filter((i) => i.stock_actual <= i.stock_minimo).length,
      sinCosto: propios.filter((i) => !i.costo_unitario).length,
      plata:
        a.destino === 'gasto'
          ? gastoDesechables
          : propios.reduce((s, i) => s + Math.max(i.stock_actual, 0) * (i.costo_unitario || 0), 0),
      preparaciones: a.valor === 'insumo' ? activos.filter((i) => i.tipo === 'preparacion').length : undefined,
    }
  })
}
