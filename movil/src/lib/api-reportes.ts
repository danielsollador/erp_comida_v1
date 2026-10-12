import { rango, req } from './api'
import type {
  Categoria,
  CategoriaInsumo,
  DefinicionReporte,
  FuenteDinamica,
  Ingrediente,
  ReporteCombos,
  ReporteGuardado,
  ReporteInventario,
  ReportePerdidas,
  ReporteResumen,
  ResultadoDinamico,
  ValorCampo,
} from './tipos'

/**
 * LAS LLAMADAS DE REPORTES, las mismas de la web (frontend/src/lib/api.ts:
 * `reporte`, `reporteCombos`, `reportePerdidas`, `reporteInventario` y los
 * reportes a medida). Lo que hace cada una esta en
 * backend/app/routers/reportes.py y reportes_dinamicos.py.
 */

export type RangoFechas = { desde: string; hasta: string }

/**
 * Los filtros de Reportes: una parte del menu (Resumen y Ventas) o una parte
 * del inventario (Perdidas e Inventario). VARIOS A LA VEZ (Leider, 11-oct):
 * el servidor los recibe repetidos, `categoria_id=1&categoria_id=2`.
 */
export type FiltroMenuQuery = { categoria_id?: number[]; producto_id?: number[] }
export type FiltroDepositoQuery = { categoria_id?: number[]; ingrediente_id?: number[] }

const conFiltro = (f?: Record<string, number[] | undefined>) =>
  Object.entries(f ?? {})
    .flatMap(([k, v]) => (v ?? []).map((x) => `${k}=${x}`))
    .join('&')

/** `?desde=…&hasta=…&lo-demas`, sin pedazos vacios. */
const consulta = (r: RangoFechas, ...extra: string[]) => `?${[rango(r.desde, r.hasta), ...extra].filter(Boolean).join('&')}`

export const apiReportes = {
  // `paso` fuerza el grano de la serie (dia | semana | mes). Sin el, el
  // servidor lo elige por el largo del rango.
  resumen: (r: RangoFechas, paso?: string, filtro?: FiltroMenuQuery) =>
    req<ReporteResumen>(`/reportes/resumen${consulta(r, paso ? `paso=${paso}` : '', conFiltro(filtro))}`),
  combos: (r: RangoFechas, filtro?: FiltroMenuQuery) => req<ReporteCombos>(`/reportes/combos${consulta(r, conFiltro(filtro))}`),
  perdidas: (r: RangoFechas, filtro?: FiltroDepositoQuery) =>
    req<ReportePerdidas>(`/reportes/perdidas${consulta(r, conFiltro(filtro))}`),
  inventario: (r: RangoFechas, filtro?: FiltroDepositoQuery) =>
    req<ReporteInventario>(`/reportes/inventario${consulta(r, conFiltro(filtro))}`),

  // Las listas de los filtros: el menu, los cajones y las mercancias.
  categorias: () => req<Categoria[]>('/menu/categorias'),
  cajones: () => req<CategoriaInsumo[]>('/inventario/categorias'),
  mercancias: () => req<Ingrediente[]>('/inventario/ingredientes'),

  // ── A medida ──
  catalogo: () => req<FuenteDinamica[]>('/reportes/dinamico/catalogo'),
  /** Por POST: la definicion (campos, medidas, filtros) viaja en el cuerpo. */
  consultar: (d: DefinicionReporte, r: RangoFechas) =>
    req<ResultadoDinamico>('/reportes/dinamico/consulta', {
      method: 'POST',
      body: JSON.stringify({ ...d, desde: r.desde, hasta: r.hasta }),
    }),
  valores: (fuente: string, campo: string, r: RangoFechas) =>
    req<ValorCampo[]>('/reportes/dinamico/valores', {
      method: 'POST',
      body: JSON.stringify({ fuente, campo, desde: r.desde, hasta: r.hasta }),
    }),
  /** La ruta del CSV (para `descargar` de lib/archivos), como el enlace de la web. */
  rutaExportar: (d: DefinicionReporte, r: RangoFechas) =>
    `/reportes/dinamico/exportar?q=${encodeURIComponent(JSON.stringify({ ...d, desde: r.desde, hasta: r.hasta }))}`,
  guardados: () => req<ReporteGuardado[]>('/reportes/dinamico/guardados'),
  guardar: (nombre: string, definicion: DefinicionReporte, periodo: string | null) =>
    req<ReporteGuardado>('/reportes/dinamico/guardados', {
      method: 'POST',
      body: JSON.stringify({ nombre, definicion, periodo }),
    }),
  actualizar: (id: string, nombre: string, definicion: DefinicionReporte, periodo: string | null) =>
    req<ReporteGuardado>(`/reportes/dinamico/guardados/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ nombre, definicion, periodo }),
    }),
  borrar: (id: string) => req<{ ok: boolean }>(`/reportes/dinamico/guardados/${id}`, { method: 'DELETE' }),
}
