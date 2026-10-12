import { req } from './api'
import type { Categoria, CostoVariante, Ingrediente, Producto, RecetaItem, Variante } from './tipos'

/**
 * MENU Y RECETAS: las MISMAS llamadas de la web (frontend/src/lib/api.ts,
 * bloques del menu y de recetas), con los mismos cuerpos. Lo que hace cada
 * una esta en backend/app/routers/menu.py e inventario.py.
 *
 * Quitar del menu nunca borra: retira (activo = false) y tiene su reverso
 * (`reactivar…`). Por eso la app puede hacerlo de una y ofrecer "Deshacer",
 * como la web, en vez de preguntar antes.
 */
export type ItemCombo = { variante_id: number; nombre: string; cantidad: number }

export type CostosParaPrecios = {
  metodo: string
  por_ingrediente: Record<string, number>
  indirecto_por_pieza: number
}

const json = (metodo: string, cuerpo: unknown): RequestInit => ({ method: metodo, body: JSON.stringify(cuerpo) })

export const apiMenu = {
  listarCategorias: () => req<Categoria[]>('/menu/categorias'),
  crearCategoria: (nombre: string, orden = 0) => req<Categoria>('/menu/categorias', json('POST', { nombre, orden })),
  /**
   * Cambia SOLO lo que se le pasa: el backend ignora lo que no venga. Mandar
   * la categoria entera devolvia al menu una retirada al renombrarla.
   */
  actualizarCategoria: (id: number, cambios: { nombre?: string; orden?: number; color?: string; va_a_cocina?: boolean }) =>
    req<Categoria>(`/menu/categorias/${id}`, json('PUT', cambios)),
  /** El orden de los productos de una categoria: asi salen en el menu y en el mostrador. */
  ordenarProductos: (categoriaId: number, ids: number[]) =>
    req<{ ok: boolean }>(`/menu/categorias/${categoriaId}/orden-productos`, json('PUT', { ids })),
  eliminarCategoria: (id: number) => req<{ ok: boolean }>(`/menu/categorias/${id}`, { method: 'DELETE' }),
  reactivarCategoria: (id: number) => req<Categoria>(`/menu/categorias/${id}/reactivar`, { method: 'POST' }),

  crearProducto: (categoria_id: number, nombre: string, variantes: { nombre: string; precio: number }[]) =>
    req<Producto>('/menu/productos', json('POST', { categoria_id, nombre, activo: true, variantes })),
  actualizarProducto: (id: number, p: { categoria_id: number; nombre: string; activo: boolean }) =>
    req<Producto>(`/menu/productos/${id}`, json('PUT', p)),
  eliminarProducto: (id: number) => req<{ ok: boolean }>(`/menu/productos/${id}`, { method: 'DELETE' }),
  reactivarProducto: (id: number) => req<Producto>(`/menu/productos/${id}/reactivar`, { method: 'POST' }),

  crearVariante: (producto_id: number, nombre: string, precio: number) =>
    req<Variante>(`/menu/productos/${producto_id}/variantes`, json('POST', { nombre, precio, activo: true })),
  actualizarVariante: (id: number, nombre: string, precio: number, activo = true) =>
    req<Variante>(`/menu/variantes/${id}`, json('PUT', { nombre, precio, activo })),
  eliminarVariante: (id: number) => req<{ ok: boolean }>(`/menu/variantes/${id}`, { method: 'DELETE' }),
  reactivarVariante: (id: number) => req<Variante>(`/menu/variantes/${id}/reactivar`, { method: 'POST' }),

  /** Una sola llamada para todo el menu: cuanto cuesta cada variante y cual no tiene receta. */
  costosVariantes: () => req<CostoVariante[]>('/menu/costos'),
  /** Costo de 1 unidad utilizable de cada mercancia con el metodo de precios, y el aceite por pieza. */
  costosParaPrecios: () => req<CostosParaPrecios>('/menu/costos-para-precios'),

  listarIngredientes: () => req<Ingrediente[]>('/inventario/ingredientes'),
  verReceta: (varianteId: number) => req<RecetaItem[]>(`/inventario/recetas/${varianteId}`),
  actualizarReceta: (varianteId: number, items: { ingrediente_id: number; cantidad_por_unidad: number }[]) =>
    req<RecetaItem[]>(`/inventario/recetas/${varianteId}`, json('PUT', items)),
  /** Lo que lleva un combo (otros productos del menu). Vacio = no es combo. */
  verCombo: (varianteId: number) => req<ItemCombo[]>(`/inventario/combos/${varianteId}`),
  guardarCombo: (varianteId: number, items: { variante_id: number; cantidad: number }[]) =>
    req<ItemCombo[]>(`/inventario/combos/${varianteId}`, json('PUT', items)),
}
