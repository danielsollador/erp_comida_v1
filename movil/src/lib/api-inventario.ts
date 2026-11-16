import { rango, req } from './api'
import type {
  Categoria,
  CategoriaInsumo,
  CompraDeInsumo,
  Configuracion,
  ConteoResumen,
  DatosIngrediente,
  Equivalencia,
  ExtractoInsumo,
  FacturaCompra,
  ImpactoDeCompra,
  InflacionInsumos,
  Ingrediente,
  Merma,
  Producto,
  ReporteInventario,
  SugerenciaCompra,
} from './tipos'

/**
 * LAS LLAMADAS DE INVENTARIO, las mismas rutas que usa la web
 * (frontend/src/lib/api.ts) con la sesion de la app. Lo que hace cada una
 * esta en backend/app/routers/inventario.py; aqui solo se piden.
 */
export const apiInventario = {
  // ── La mercancia ──
  ingredientes: () => req<Ingrediente[]>('/inventario/ingredientes'),
  crear: (d: DatosIngrediente) =>
    req<Ingrediente>('/inventario/ingredientes', { method: 'POST', body: JSON.stringify(d) }),
  /** `confirmar`: ya se dijo que si a pasar a desechable con stock o a archivar algo que va en recetas. */
  actualizar: (id: number, d: DatosIngrediente, confirmar = false) =>
    req<Ingrediente>(`/inventario/ingredientes/${id}`, { method: 'PUT', body: JSON.stringify({ ...d, confirmar }) }),
  fusionar: (id: number, destino_id: number, factor = 1) =>
    req<Ingrediente>(`/inventario/ingredientes/${id}/fusionar`, {
      method: 'POST',
      body: JSON.stringify({ destino_id, factor }),
    }),

  // ── Los movimientos de una ──
  comprar: (id: number, cantidad: number, costo_total: number | undefined, metodo_pago: string) =>
    req<ImpactoDeCompra>(`/inventario/ingredientes/${id}/comprar`, {
      method: 'POST',
      body: JSON.stringify({ cantidad, costo_total: costo_total ?? null, metodo_pago }),
    }),
  /** `forzar`: anotarla aunque sea mas de lo que hay (se confirmo). */
  merma: (id: number, cantidad: number, motivo: string, forzar = false) =>
    req<Ingrediente>(`/inventario/ingredientes/${id}/merma`, {
      method: 'POST',
      body: JSON.stringify({ cantidad, motivo, forzar }),
    }),
  consumoPersonal: (id: number, cantidad: number, motivo: string, forzar = false) =>
    req<Ingrediente>(`/inventario/ingredientes/${id}/consumo-personal`, {
      method: 'POST',
      body: JSON.stringify({ cantidad, motivo, forzar }),
    }),
  ajustar: (id: number, stock_real: number) =>
    req<Ingrediente>(`/inventario/ingredientes/${id}/ajustar`, {
      method: 'POST',
      body: JSON.stringify({ stock_real, motivo: 'Conteo fisico' }),
    }),
  cargarIndirecto: (id: number, cantidad: number, motivo = '') =>
    req<Ingrediente>(`/inventario/ingredientes/${id}/cargar-indirecto`, {
      method: 'POST',
      body: JSON.stringify({ cantidad, motivo }),
    }),

  // ── Lo que le paso ──
  historialCostos: (id: number) => req<CompraDeInsumo[]>(`/inventario/ingredientes/${id}/costos`),
  /** Con `desde` el extracto trae saldo inicial y totales del periodo. */
  movimientos: (id: number, limite = 200, desde?: string) =>
    req<ExtractoInsumo>(
      `/inventario/ingredientes/${id}/movimientos?limite=${limite}${desde ? `&desde=${desde}T00:00:00` : ''}`,
    ),
  /** La ruta del CSV del extracto, para `descargar` de lib/archivos. */
  rutaExportarMovimientos: (id: number, desde?: string) =>
    `/inventario/ingredientes/${id}/movimientos/exportar${desde ? `?desde=${desde}T00:00:00` : ''}`,
  /** Para cuanto alcanza: el reporte de inventario pedido solo para esta mercancia. */
  ritmo: (id: number, desde: string, hasta: string) =>
    req<ReporteInventario>(`/reportes/inventario?${rango(desde, hasta)}&ingrediente_id=${id}`),
  equivalencias: () => req<Equivalencia[]>('/compras/equivalencias'),

  // ── El almacen entero ──
  sugerencias: () => req<SugerenciaCompra[]>('/inventario/sugerencias'),
  mermas: (desde: string, hasta: string) => req<Merma[]>(`/inventario/mermas?${rango(desde, hasta)}`),
  conteos: (desde: string, hasta: string) => req<ConteoResumen[]>(`/inventario/conteos?${rango(desde, hasta)}`),
  facturas: (desde: string, hasta: string) => req<FacturaCompra[]>(`/compras/facturas?${rango(desde, hasta)}`),
  inflacion: (dias = 30) => req<InflacionInsumos | null>(`/inventario/inflacion?dias=${dias}`),
  config: () => req<Configuracion>('/config'),
  venderSinInventario: (vender_sin_inventario: boolean) =>
    req<Configuracion>('/config/inventario', { method: 'PUT', body: JSON.stringify({ vender_sin_inventario }) }),

  // ── Las categorias (los cajones del inventario) ──
  categorias: () => req<CategoriaInsumo[]>('/inventario/categorias'),
  crearCategoria: (nombre: string) =>
    req<CategoriaInsumo>('/inventario/categorias', { method: 'POST', body: JSON.stringify({ nombre }) }),
  renombrarCategoria: (id: number, nombre: string) =>
    req<CategoriaInsumo>(`/inventario/categorias/${id}`, { method: 'PUT', body: JSON.stringify({ nombre }) }),
  borrarCategoria: (id: number) => req<{ sin_categoria: number }>(`/inventario/categorias/${id}`, { method: 'DELETE' }),

  // ── Venderla en el menu (reventa) ──
  categoriasMenu: () => req<Categoria[]>('/menu/categorias'),
  alMenu: (id: number, d: { categoria_id: number; precio: number; nombre?: string }) =>
    req<Producto>(`/menu/desde-mercancia/${id}`, { method: 'POST', body: JSON.stringify(d) }),
}
