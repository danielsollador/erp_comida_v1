import { rango, req } from './api'
import { formularioConArchivo } from './archivos'
import type {
  AlertaPrecio,
  ConceptoGasto,
  ConfiguracionFiscal,
  CuerpoCompletarFactura,
  DatosIngrediente,
  Equivalencia,
  FacturaCompra,
  Ingrediente,
  LecturaFactura,
  NotaCreditoCompra,
  Proveedor,
  ProveedorResumen,
  Reclamo,
  RevisionFactura,
  SugerenciaRenglon,
  TasaDeUnaFecha,
} from './tipos'

/**
 * COMPRAS: las MISMAS llamadas de la web (frontend/src/lib/api.ts, bloque de
 * compras), con los mismos cuerpos. Lo que hace cada una esta en
 * backend/app/routers/compras.py y compras_lectura.py; aqui solo se piden.
 * El backend no distingue si le habla la tablet o el telefono.
 */

/** Lo que viaja al guardar una factura (el cuerpo de `POST /compras/facturas`). */
export type NuevaFacturaCompra = {
  numero_factura: string
  proveedor_nombre: string
  /** La impresa en el papel (AAAA-MM-DD). El periodo lo decide la fecha de registro. */
  fecha_emision?: string
  proveedor_rif: string
  numero_control?: string
  /** La moneda del papel; los montos de aqui van SIEMPRE en dolares. */
  moneda?: '$' | 'Bs'
  tasa_bcv?: number
  /** Siendo agente de retencion: 0, 75 o 100. */
  retencion_pct?: number
  categoria: string
  forma_pago: string
  descripcion?: string
  /** `exento` solo viaja cuando ESTA factura contradice a la ficha; `empaque_trae`, si vino en empaque. */
  items?: { ingrediente_id: number; cantidad: number; costo_unitario: number; exento?: boolean; empaque_trae?: number }[]
  /** Lo que no es mercancia, renglon por renglon: flete, servicio, equipo. */
  gastos?: { concepto: ConceptoGasto; descripcion?: string; monto: number; exento?: boolean; vida_util_meses?: number }[]
  iva?: number
  recargo?: number
  descuento?: number
  fecha_vencimiento?: string
  confirmar_duplicado?: boolean
  referencia_pago?: string
  pagos?: { forma_pago: string; monto: number; referencia?: string }[]
}

export type NotaCreditoNueva = {
  numero: string
  tipo: 'devolucion' | 'descuento' | 'faltante'
  motivo?: string
  base_imponible?: number
  items?: { ingrediente_id: number; cantidad: number }[]
}

/** Lo que se le manda a la revision mientras se llena el formulario. */
export type PedidoRevision = {
  proveedor_rif: string
  proveedor_nombre: string
  numero_factura: string
  /** `costo_unitario` en dolares, como se va a guardar. */
  items: { indice: number; ingrediente_id: number; costo_unitario: number; cantidad?: number }[]
}

export const apiCompras = {
  // ── Facturas ──
  /** Del periodo (desde y hasta inclusive). */
  facturas: (desde: string, hasta: string) => req<FacturaCompra[]>(`/compras/facturas?${rango(desde, hasta)}`),
  /** Las de los ultimos N dias (5 años como mucho): para encontrar una factura sin saber su fecha. */
  facturasDeLosUltimos: (dias: number) => req<FacturaCompra[]>(`/compras/facturas?dias=${dias}`),
  crearFactura: (f: NuevaFacturaCompra) =>
    req<FacturaCompra>('/compras/facturas', { method: 'POST', body: JSON.stringify(f) }),
  eliminarFactura: (id: number) => req<{ ok: boolean }>(`/compras/facturas/${id}`, { method: 'DELETE' }),
  pagarFactura: (id: number, forma_pago: string, referencia?: string) =>
    req<FacturaCompra>(`/compras/facturas/${id}/pagar`, { method: 'POST', body: JSON.stringify({ forma_pago, referencia }) }),
  abonarFactura: (id: number, monto: number, forma_pago: string, referencia?: string) =>
    req<FacturaCompra>(`/compras/facturas/${id}/abonos`, {
      method: 'POST',
      body: JSON.stringify({ monto, forma_pago, referencia }),
    }),

  // ── Notas de credito, faltantes y reclamos ──
  notasCredito: (facturaId: number) => req<NotaCreditoCompra[]>(`/compras/facturas/${facturaId}/notas-credito`),
  crearNotaCredito: (facturaId: number, datos: NotaCreditoNueva) =>
    req<NotaCreditoCompra>(`/compras/facturas/${facturaId}/notas-credito`, { method: 'POST', body: JSON.stringify(datos) }),
  anotarFaltantes: (id: number, items: { ingrediente_id: number; cantidad: number }[], motivo?: string) =>
    req<FacturaCompra>(`/compras/facturas/${id}/faltantes`, { method: 'POST', body: JSON.stringify({ items, motivo }) }),
  reclamos: () => req<Reclamo[]>('/compras/reclamos'),
  darReclamoPorPerdido: (id: number) => req<Reclamo>(`/compras/reclamos/${id}/perder`, { method: 'POST' }),

  // ── Factura desde foto ──
  // Nada de esto guarda facturas: la lectura propone, el formulario de
  // siempre guarda, y despues la foto se engancha a la factura que salio.
  estadoLector: () => req<{ activo: boolean; lector: string }>('/compras/lectura'),
  /** La foto o el PDF, tal como salio de la camara, la galeria o el selector. */
  leerFactura: async (archivo: { uri: string; nombre: string; tipo: string }) =>
    req<LecturaFactura>('/compras/lectura', { method: 'POST', body: await formularioConArchivo('archivo', archivo) }),
  revisarFactura: (r: PedidoRevision) =>
    req<RevisionFactura>('/compras/revision', { method: 'POST', body: JSON.stringify(r) }),
  /** Antes de guardar la factura de una foto: que hacer cuando quede guardada. */
  anotarAlGuardar: (soporteId: number, intencion: Omit<CuerpoCompletarFactura, 'soporte_id'> & { numero_factura: string }) =>
    req<{ ok: boolean }>(`/compras/lectura/${soporteId}/al-guardar`, { method: 'POST', body: JSON.stringify(intencion) }),
  reconciliar: () => req<{ completadas: number }>('/compras/lectura/reconciliar', { method: 'POST' }),
  completarFactura: (facturaId: number, cuerpo: CuerpoCompletarFactura) =>
    req<{ foto: boolean; foto_perdida: boolean; aprendidas: number; alertas: AlertaPrecio[] }>(
      `/compras/facturas/${facturaId}/completar`,
      { method: 'POST', body: JSON.stringify(cuerpo) },
    ),
  /** La ruta (sin /api) de la foto o el PDF guardado de una factura. */
  rutaSoporte: (facturaId: number) => `/compras/facturas/${facturaId}/soporte`,

  // ── Memoria por proveedor ──
  buscarEquivalencias: (proveedor_rif: string, renglones: { descripcion: string; unidad: string }[]) =>
    req<SugerenciaRenglon[]>('/compras/equivalencias/buscar', {
      method: 'POST',
      body: JSON.stringify({ proveedor_rif, renglones }),
    }),
  equivalencias: () => req<Equivalencia[]>('/compras/equivalencias'),
  aprenderEquivalencias: (cuerpo: Omit<CuerpoCompletarFactura, 'soporte_id'>) =>
    req<{ aprendidas: number }>('/compras/equivalencias/aprender', { method: 'POST', body: JSON.stringify(cuerpo) }),
  olvidarEquivalencia: (id: number) => req<unknown>(`/compras/equivalencias/${id}`, { method: 'DELETE' }),
  /** Los servicios ya cargados alguna vez ("Internet", "Luz"), los mas repetidos primero. */
  servicios: () => req<string[]>('/compras/servicios'),

  // ── Alertas de precio ──
  alertas: (pendientes = false) => req<AlertaPrecio[]>(`/compras/alertas${pendientes ? '?pendientes=true' : ''}`),
  marcarAlertaVista: (id: number) => req<AlertaPrecio>(`/compras/alertas/${id}/visto`, { method: 'POST' }),

  // ── Proveedores ──
  proveedores: () => req<Proveedor[]>('/proveedores'),
  crearProveedor: (p: Omit<Proveedor, 'id' | 'activo'>) =>
    req<Proveedor>('/proveedores', { method: 'POST', body: JSON.stringify(p) }),
  editarProveedor: (id: number, p: Omit<Proveedor, 'id' | 'activo'>) =>
    req<Proveedor>(`/proveedores/${id}`, { method: 'PUT', body: JSON.stringify(p) }),
  archivarProveedor: (id: number, activo: boolean) =>
    req<Proveedor>(`/proveedores/${id}/archivar?activo=${activo}`, { method: 'POST' }),
  /** La ficha: cuanto se le compro, cuanto se le debe y sus ultimas facturas. */
  resumenProveedor: (id: number) => req<ProveedorResumen>(`/proveedores/${id}/resumen`),

  // ── Lo que la carga necesita de otros modulos ──
  // (Las mismas rutas que Inventario e Impuestos; aqui solo se leen y se
  // crea una mercancia nueva sin salir de la factura.)
  ingredientes: () => req<Ingrediente[]>('/inventario/ingredientes'),
  crearIngrediente: (i: DatosIngrediente) =>
    req<Ingrediente>('/inventario/ingredientes', { method: 'POST', body: JSON.stringify(i) }),
  configFiscal: () => req<ConfiguracionFiscal>('/impuestos/config'),
  /** La tasa BCV de una fecha (o la del ultimo dia con tasa antes de esa fecha). */
  tasaDeFecha: (fecha: string) => req<TasaDeUnaFecha>(`/tasas/al?fecha=${encodeURIComponent(fecha)}`),
}
