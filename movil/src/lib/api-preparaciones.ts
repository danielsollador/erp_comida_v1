import { rango, req } from './api'
import type {
  Categoria,
  Configuracion,
  ConteoDetalle,
  ConteoResumen,
  CostoIndirecto,
  CostoParaPrecios,
  CostoTeoricoFila,
  DatosIngrediente,
  DatosPreparacion,
  Disponibilidad,
  Ingrediente,
  Merma,
  PlanillaLeida,
  Preparacion,
  Produccion,
  ResultadoConteo,
  SobranteInventario,
  SobrantePreparacion,
  Sustitucion,
  Variante,
} from './tipos'

/**
 * PREPARACIONES, CONTEO FISICO Y CONTROL: las MISMAS llamadas de la web
 * (frontend/src/lib/api.ts), con los mismos cuerpos. Lo que hace cada ruta
 * esta en backend/app/routers/preparaciones.py e inventario.py; aqui solo se
 * piden, con la sesion de la app (`req`: token, 401 = salir, errores en
 * palabras).
 *
 * La mercancia (`ingredientes`) se pide aqui tambien aunque la lista de
 * mercancia tenga su propio modulo: la olla necesita el crudo con su costo y
 * su % aprovechable, y el conteo, todo lo que se cuenta.
 */

/** Las preparaciones cuyas ultimas tandas rinden distinto de su receta. En la web el tipo va escrito en la llamada misma (api.rendimientosReales). */
export type RendimientoReal = {
  preparacion_id: number
  nombre: string
  tandas: number
  real_pct: number
  crudo_id: number | null
  crudo: string
  unidad: string
  receta_cantidad: number | null
  sugerida_cantidad: number | null
}

export const apiPreparaciones = {
  // ── La mercancia ──
  ingredientes: () => req<Ingrediente[]>('/inventario/ingredientes'),
  /** El % que se aprovecha es de la ficha del crudo: la olla lo guarda ahi. */
  actualizarIngrediente: (id: number, d: DatosIngrediente) =>
    req<Ingrediente>(`/inventario/ingredientes/${id}`, { method: 'PUT', body: JSON.stringify({ ...d, confirmar: false }) }),

  // ── Las preparaciones ──
  preparaciones: () => req<Preparacion[]>('/inventario/preparaciones'),
  crear: (d: DatosPreparacion) =>
    req<Preparacion>('/inventario/preparaciones', { method: 'POST', body: JSON.stringify(d) }),
  actualizar: (id: number, d: DatosPreparacion) =>
    req<Preparacion>(`/inventario/preparaciones/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  disponibilidad: () => req<Disponibilidad[]>('/inventario/preparaciones/disponibilidad'),
  vencidas: () => req<Preparacion[]>('/inventario/preparaciones/vencidas'),
  rendimientos: () => req<RendimientoReal[]>('/inventario/preparaciones/rendimientos'),
  /** Al cierre: lo que sobro se guarda para mañana o se bota (y sale el crudo por la receta). */
  sobrante: (id: number, cuerpo: { cantidad: number; accion: 'botar' | 'guardar'; motivo?: string }) =>
    req<SobrantePreparacion>(`/inventario/preparaciones/${id}/sobrante`, { method: 'POST', body: JSON.stringify(cuerpo) }),

  // ── Las tandas ──
  tandas: () => req<Produccion[]>('/inventario/produccion'),
  /** `forzar`: ya se dijo que si cuando el crudo no alcanzaba (queda en negativo). */
  anotarTanda: (d: {
    preparacion_id: number
    cantidad: number
    usado?: { ingrediente_id: number; cantidad: number }[]
    nota?: string
    forzar?: boolean
  }) => req<Produccion>('/inventario/produccion', { method: 'POST', body: JSON.stringify(d) }),

  // ── El conteo fisico ──
  /** Todo el inventario de una vez; lo que no se anoto no se toca. */
  contar: (items: { ingrediente_id: number; stock_real: number }[], ciego: boolean, motivo = 'Conteo fisico') =>
    req<ResultadoConteo>('/inventario/conteo', { method: 'POST', body: JSON.stringify({ items, motivo, ciego }) }),
  /** Lee la planilla llena y dice lo que entendio. NO guarda nada. */
  leerPlanilla: (datos: FormData) =>
    req<PlanillaLeida>('/inventario/conteos/leer-planilla', { method: 'POST', body: datos }),
  /** Las rutas de los CSV, para `descargar` de lib/archivos. */
  rutaPlanilla: '/inventario/conteos/planilla',
  rutaExportarConteo: (id: number) => `/inventario/conteos/${id}/exportar`,
  conteos: (desde: string, hasta: string) => req<ConteoResumen[]>(`/inventario/conteos?${rango(desde, hasta)}`),
  conteo: (id: number) => req<ConteoDetalle>(`/inventario/conteos/${id}`),

  // ── El control ──
  costoTeorico: (desde: string, hasta: string) => req<CostoTeoricoFila[]>(`/inventario/costo-teorico?${rango(desde, hasta)}`),
  indirectos: (desde: string, hasta: string) => req<CostoIndirecto[]>(`/inventario/indirectos?${rango(desde, hasta)}`),
  mermas: (desde: string, hasta: string) => req<Merma[]>(`/inventario/mermas?${rango(desde, hasta)}`),
  revertirMerma: (id: number) => req<Ingrediente>(`/inventario/mermas/${id}/revertir`, { method: 'POST' }),
  sobrantes: (desde: string, hasta: string) => req<SobranteInventario[]>(`/inventario/sobrantes?${rango(desde, hasta)}`),
  revertirSobrante: (id: number) => req<Ingrediente>(`/inventario/sobrantes/${id}/revertir`, { method: 'POST' }),
  config: () => req<Configuracion>('/config'),
  fijarCostoParaPrecios: (costo_para_precios: CostoParaPrecios) =>
    req<Configuracion>('/config/costo-precios', { method: 'PUT', body: JSON.stringify({ costo_para_precios }) }),
  /** El menu, para marcar que se frie (el aceite por unidad). */
  categoriasMenu: () => req<Categoria[]>('/menu/categorias'),
  /** Solo la marca de fritura: el resto de la variante va tal cual estaba. */
  marcarFritura: (v: { id: number; nombre: string; precio: number; activo: boolean }, se_frie: boolean) =>
    req<Variante>(`/menu/variantes/${v.id}`, {
      method: 'PUT',
      body: JSON.stringify({ nombre: v.nombre, precio: v.precio, activo: v.activo, se_frie }),
    }),

  // ── Los cambios de hoy ("hoy el pollo es pavo") ──
  sustituciones: () => req<Sustitucion[]>('/inventario/sustituciones'),
  crearSustitucion: (d: { original_id: number; sustituto_id: number; factor: number; nota?: string }) =>
    req<Sustitucion>('/inventario/sustituciones', { method: 'POST', body: JSON.stringify(d) }),
  terminarSustitucion: (id: number) => req<{ ok: boolean }>(`/inventario/sustituciones/${id}`, { method: 'DELETE' }),
}
