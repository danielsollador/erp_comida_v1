import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertasAlGuardar, BandejaAlertas } from '../components/AlertasPrecio'
import { MemoriaProveedores, VerSoporte } from '../components/FacturaDesdeFoto'
import NavBar from '../components/NavBar'
import { useSeccion } from '../components/Secciones'
import BarraFiltros from '../components/BarraFiltros'
import { useDeshacer } from '../components/Deshacer'
import { useRango } from '../lib/fechas'
import { useDialogo } from '../components/dialogo'
import { DestinoPlata, PuntoTipo, type ParteDeLaPlata } from '../components/compras/Almacenes'
import Icono from '../components/Icono'
import { Tabla, Th, useBuscador, useOrden } from '../components/Tabla'
import { Boton, Campo, Cifra, Modal, Pagina, Pastilla, Seccion, Vacio } from '../components/ui'
import { api } from '../lib/api'
import { TEXTO_CATEGORIA, TEXTO_CONCEPTO } from '../lib/compras'
import { fmtNum } from '../lib/moneda'
import { ALMACEN_DE } from '../lib/tiposArticulo'
import CargarFactura from './partes/compras/CargarFactura'
import { cuantosPendientes, procesarPendientes } from '../lib/pendientesCompras'
import { pedirReferencia } from '../lib/pagos'
import type { AlertaPrecio, ConfiguracionFiscal, FacturaCompra, Ingrediente, Proveedor, Reclamo } from '../lib/types'

/**
 * Compras: lo que entra al negocio y a dónde va la plata.
 *
 * La primera pantalla responde las preguntas del dueño sin pasar por la
 * contabilidad: cuánto se compró en el período, cuánto fue al depósito y
 * cuánto a gasto, qué se debe y a quién. Cada factura lleva los puntos de
 * color de sus almacenes (ver lib/tiposArticulo.ts), así que de un vistazo
 * se ve si fue carne, refrescos o servilletas.
 */

const SECCIONES = [
  { id: 'facturas', texto: 'Facturas' },
  { id: 'nueva', texto: 'Cargar factura' },
  { id: 'alertas', texto: 'Alertas' },
  { id: 'proveedores', texto: 'Proveedores' },
]

export default function Compras() {
  const [seccion, irA] = useSeccion(SECCIONES)
  // Las alertas de precio sin ver, en el nombre de la pestaña: es lo que hace
  // que el dueño se entere aunque la factura la haya cargado otro.
  const [alertasPendientes, setAlertasPendientes] = useState(0)
  const [alertasAlGuardar, setAlertasAlGuardar] = useState<AlertaPrecio[]>([])
  const secciones = useMemo(
    () => SECCIONES.map((s) => (s.id === 'alertas' && alertasPendientes > 0 ? { ...s, contador: alertasPendientes } : s)),
    [alertasPendientes],
  )
  const alCambiarPendientes = useCallback((n: number) => setAlertasPendientes(n), [])
  // Facturas guardadas desde ESTE dispositivo a las que les falta la foto, la
  // memoria o las alertas porque se cayo la conexion justo despues.
  const [porCompletar, setPorCompletar] = useState(cuantosPendientes())
  const reintentarPendientes = useCallback(async () => {
    if ((await procesarPendientes()) > 0) {
      api
        .listarAlertasPrecio(true)
        .then((l) => setAlertasPendientes(l.length))
        .catch(() => undefined)
    }
    setPorCompletar(cuantosPendientes())
  }, [])
  useEffect(() => {
    const t = setTimeout(reintentarPendientes, 0)
    window.addEventListener('online', reintentarPendientes)
    return () => {
      clearTimeout(t)
      window.removeEventListener('online', reintentarPendientes)
    }
  }, [reintentarPendientes])
  // Tres meses: una factura a credito se paga a 30 o 60 dias, y hay que verla.
  const [rango, setRango] = useRango('90d')
  const [facturas, setFacturas] = useState<FacturaCompra[]>([])
  // Lo que no llegó y los proveedores todavía deben (de cualquier fecha).
  const [reclamos, setReclamos] = useState<Reclamo[]>([])
  const orden = useOrden<FacturaCompra>(
    {
      fecha: (f) => new Date(f.fecha),
      factura: (f) => f.numero_factura,
      proveedor: (f) => f.proveedor_nombre,
      total: (f) => f.total,
      estado: (f) => (f.pagada ? 'Pagada' : 'Pendiente'),
    },
    '-fecha',
  )
  // Es la lista que mas crece del ERP: una fila por factura, para siempre.
  const buscador = useBuscador<FacturaCompra>(
    (f) => [f.numero_factura, f.proveedor_nombre, f.proveedor_rif, f.descripcion, ...f.items.map((i) => i.ingrediente_nombre)],
    'Buscar por factura, proveedor, RIF o mercancía',
  )
  const buscadorProveedores = useBuscador<Proveedor>(
    (p) => [p.nombre, p.rif, p.telefono, p.contacto],
    'Buscar por nombre, RIF o teléfono',
  )
  const [ingredientes, setIngredientes] = useState<Ingrediente[]>([])
  const [fiscal, setFiscal] = useState<ConfiguracionFiscal>({ tasa_iva: 16 })
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [fichaProveedor, setFichaProveedor] = useState<Proveedor | 'nuevo' | null>(null)
  const [error, setError] = useState('')
  const dialogo = useDialogo()
  const [verSoporte, setVerSoporte] = useState<number | null>(null)
  const [abierta, setAbierta] = useState<number | null>(null)

  // Con que forma de pago se va a saldar cada factura a credito pendiente.
  const [liquidacion, setLiquidacion] = useState<Record<number, string>>({})
  const [pagando, setPagando] = useState<number | null>(null)

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rango])

  function cargar() {
    api.listarFacturasCompra(rango).then(setFacturas)
    api.listarReclamos().then(setReclamos).catch(() => undefined)
    api.listarIngredientes().then((l) => setIngredientes(l.filter((i) => i.activo !== false)))
    api.configFiscal().then(setFiscal)
    api.listarProveedores().then(setProveedores)
    api
      .listarAlertasPrecio(true)
      .then((l) => setAlertasPendientes(l.length))
      .catch(() => undefined)
  }

  async function guardarProveedor(datos: Omit<Proveedor, 'id' | 'activo'>) {
    if (fichaProveedor && fichaProveedor !== 'nuevo') {
      await api.editarProveedor(fichaProveedor.id, datos)
    } else {
      await api.crearProveedor(datos)
    }
    setFichaProveedor(null)
    api.listarProveedores().then(setProveedores)
  }

  const { deshacible, oculto } = useDeshacer()

  function archivarProveedor(p: Proveedor) {
    deshacible({
      clave: `proveedor:${p.id}`,
      texto: p.activo ? `${p.nombre} archivado` : `${p.nombre} de vuelta`,
      ejecutar: () => api.archivarProveedor(p.id, !p.activo),
      revertir: () => api.archivarProveedor(p.id, p.activo),
      alTerminar: () => void api.listarProveedores().then(setProveedores),
      alFallar: (e) => setError(e instanceof Error ? e.message : 'No se pudo'),
    })
  }

  async function notaCredito(f: FacturaCompra) {
    // El espejo de la devolucion de venta. Sin esto, el unico camino era un
    // ajuste de inventario, que registra la diferencia como MERMA.
    const tipo = (await dialogo.elegir({
      titulo: `Nota de crédito de ${f.proveedor_nombre}`,
      texto: `Sobre la factura ${f.numero_factura}. ¿Qué pasó?`,
      opciones: [
        { valor: 'faltante_anotar', texto: 'Llegó menos de lo facturado', detalle: 'Todavía sin nota del proveedor: lo que falta sale del inventario y queda como reclamo, no como pérdida.' },
        ...((f.reclamos?.length ?? 0) > 0
          ? [{ valor: 'faltante', texto: 'Llegó la nota por lo que faltó', detalle: `Cierra lo reclamado: ${f.reclamos!.map((r) => `${r.cantidad} ${r.unidad} de ${r.ingrediente_nombre}`).join(', ')}.` }]
          : []),
        { valor: 'devolucion', texto: 'Devolución', detalle: 'La mercancía vuelve al proveedor y sale del inventario.' },
        { valor: 'descuento', texto: 'Descuento', detalle: 'Te quedas la mercancía y te rebajan el costo.' },
      ],
    })) as 'devolucion' | 'descuento' | 'faltante' | 'faltante_anotar' | null
    if (!tipo) return

    if (tipo === 'faltante_anotar') {
      const r = await dialogo.pedir({
        titulo: 'Lo que no llegó',
        texto: 'Cuánto faltó de cada renglón. Queda como reclamo al proveedor hasta que mande su nota de crédito.',
        ancho: 'md',
        campos: [
          { nombre: 'motivo', etiqueta: 'Qué pasó', placeholder: 'Llegaron 8 de 10', opcional: true },
          ...f.items.map((it) => ({
            nombre: `item_${it.ingrediente_id}`,
            etiqueta: it.ingrediente_nombre,
            sufijo: `${it.unidad}, la factura trae ${it.cantidad}`,
            tipo: 'numero' as const,
            valor: 0,
            max: it.cantidad,
          })),
        ],
        aceptar: 'Anotar faltante',
      })
      if (!r) return
      const items = f.items
        .map((it) => ({ ingrediente_id: it.ingrediente_id, cantidad: Number(r[`item_${it.ingrediente_id}`]) }))
        .filter((it) => it.cantidad > 0)
      if (items.length === 0) return
      await accionFactura(() => api.anotarFaltantes(f.id, items, r.motivo))
      return
    }

    if (tipo === 'faltante') {
      const numero = await dialogo.pedirTexto({ titulo: 'Nota de crédito por lo que faltó', etiqueta: 'Número de la nota de crédito' })
      if (!numero) return
      await accionFactura(() => api.crearNotaCredito(f.id, { numero, tipo: 'faltante' }))
      return
    }

    if (tipo === 'descuento') {
      const r = await dialogo.pedir({
        titulo: 'Descuento del proveedor',
        campos: [
          { nombre: 'numero', etiqueta: 'Número de la nota de crédito' },
          { nombre: 'base', etiqueta: 'Cuánto te acreditaron, sin IVA', sufijo: '$', tipo: 'numero', min: 0.01 },
          { nombre: 'motivo', etiqueta: 'Motivo', placeholder: 'Mandó menos, llegó dañado, descuento...', opcional: true },
        ],
        aceptar: 'Registrar',
      })
      if (!r) return
      await accionFactura(() => api.crearNotaCredito(f.id, { numero: r.numero, tipo, motivo: r.motivo, base_imponible: Number(r.base) }))
      return
    }

    const r = await dialogo.pedir({
      titulo: 'Devolución al proveedor',
      texto: 'Cuánto vuelve de cada renglón. Deja en 0 lo que se queda.',
      ancho: 'md',
      campos: [
        { nombre: 'numero', etiqueta: 'Número de la nota de crédito' },
        { nombre: 'motivo', etiqueta: 'Motivo', placeholder: 'Mandó menos, llegó dañado...', opcional: true },
        ...f.items.map((it) => ({
          nombre: `item_${it.ingrediente_id}`,
          etiqueta: it.ingrediente_nombre,
          sufijo: `${it.unidad}, la factura trae ${it.cantidad}`,
          tipo: 'numero' as const,
          valor: 0,
          max: it.cantidad,
        })),
      ],
      aceptar: 'Registrar devolución',
    })
    if (!r) return
    const items = f.items
      .map((it) => ({ ingrediente_id: it.ingrediente_id, cantidad: Number(r[`item_${it.ingrediente_id}`]) }))
      .filter((it) => it.cantidad > 0)
    if (items.length === 0) {
      await dialogo.avisar({ titulo: 'Nada que devolver', texto: 'No se indicó ninguna cantidad a devolver.', tono: 'ojo' })
      return
    }
    await accionFactura(() => api.crearNotaCredito(f.id, { numero: r.numero, tipo, motivo: r.motivo, items }))
  }

  async function accionFactura(fn: () => Promise<unknown>) {
    try {
      await fn()
      cargar()
    } catch (e) {
      await dialogo.avisar({ titulo: 'No se pudo registrar la nota de crédito', texto: e instanceof Error ? e.message : undefined, tono: 'mal' })
    }
  }

  async function borrar(f: FacturaCompra) {
    if (f.items.length > 0) {
      await dialogo.avisar({
        titulo: 'Esta factura no se puede borrar',
        texto: 'Ya actualizó el stock de su mercancía. Si hubo un error, regístrale una nota de crédito.',
        tono: 'ojo',
      })
      return
    }
    deshacible({
      clave: `factura:${f.id}`,
      texto: 'Factura borrada',
      ejecutar: () => api.eliminarFacturaCompra(f.id),
      alTerminar: cargar,
      alFallar: (e) => setError(e instanceof Error ? e.message : 'No se pudo borrar'),
    })
  }

  async function marcarPagada(f: FacturaCompra) {
    const forma = liquidacion[f.id] || 'Efectivo'
    const referencia = await pedirReferencia(forma, dialogo.pedirTexto)
    if (referencia === null) return
    setError('')
    setPagando(f.id)
    try {
      await api.pagarFacturaCompra(f.id, forma, referencia)
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar el pago')
    } finally {
      setPagando(null)
    }
  }

  // Un pago a cuenta: lo que se le da hoy al proveedor, sin saldar la factura.
  async function abonar(f: FacturaCompra) {
    const forma = liquidacion[f.id] || 'Efectivo'
    const debe = f.saldo ?? f.a_pagar
    const monto = await dialogo.pedirNumero({
      titulo: `Abono a ${f.proveedor_nombre}`,
      texto: `Factura ${f.numero_factura}: se deben $${fmtNum(debe, 2)}${f.abonado ? ` (ya se abonaron $${fmtNum(f.abonado, 2)})` : ''}.`,
      etiqueta: 'Cuánto se le paga hoy',
      sufijo: '$',
      min: 0,
      aceptar: 'Registrar abono',
    })
    if (monto === null || !(monto > 0)) return
    const referencia = await pedirReferencia(forma, dialogo.pedirTexto)
    if (referencia === null) return
    setError('')
    setPagando(f.id)
    try {
      await api.abonarFacturaCompra(f.id, monto, forma, referencia)
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar el abono')
    } finally {
      setPagando(null)
    }
  }

  const hoy = new Date()
  const visibles = facturas.filter((f) => !oculto(`factura:${f.id}`))
  const pendientes = visibles
    .filter((f) => f.forma_pago === 'Credito' && !f.pagada)
    .sort((a, b) => {
      const va = a.fecha_vencimiento ? new Date(a.fecha_vencimiento).getTime() : Infinity
      const vb = b.fecha_vencimiento ? new Date(b.fecha_vencimiento).getTime() : Infinity
      return va - vb
    })
  // Lo que se le debe al proveedor: sin el IVA retenido, que es del SENIAT.
  const totalPendiente = pendientes.reduce((sum, f) => sum + (f.saldo ?? f.a_pagar ?? f.total), 0)
  function diasVencida(f: FacturaCompra): number | null {
    if (!f.fecha_vencimiento) return null
    return Math.floor((hoy.getTime() - new Date(f.fecha_vencimiento).getTime()) / 86400000)
  }
  const vencidas = pendientes.filter((f) => (diasVencida(f) ?? -1) > 0)

  // A donde fue la plata del periodo: por tipo de mercancia, y lo que no es
  // mercancia (servicios, equipos) aparte, sin IVA.
  const resumen = useMemo(() => {
    const por = new Map<string, number>()
    let otros = 0
    let base = 0
    for (const f of visibles) {
      base += f.base_imponible
      const gastos = f.gastos ?? []
      if (f.items.length === 0 && gastos.length === 0) {
        otros += f.base_imponible
        continue
      }
      // El recargo y el descuento caen parejo sobre la mercancia y lo demas.
      const suma = f.items.reduce((s, i) => s + i.subtotal, 0) + gastos.reduce((s, g) => s + g.monto, 0)
      const factor = suma > 0 ? f.base_imponible / suma : 1
      for (const i of f.items) por.set(i.tipo, (por.get(i.tipo) ?? 0) + i.subtotal * factor)
      for (const g of gastos) otros += g.monto * factor
    }
    const partes: ParteDeLaPlata[] = [...por].map(([tipo, monto]) => ({ tipo: tipo as Ingrediente['tipo'], monto }))
    const deposito = partes.filter((p) => ALMACEN_DE[p.tipo].destino === 'deposito').reduce((s, p) => s + p.monto, 0)
    return { partes, otros, base, deposito, gasto: Math.max(0, Math.round((base - deposito) * 100) / 100) }
  }, [visibles])

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Compras" secciones={secciones} seccion={seccion} alCambiarSeccion={irA} />
      <Pagina>
        {seccion === 'facturas' && (
          <>
            <BarraFiltros rango={rango} alCambiar={setRango} />
            {error && <p className="text-peligro-600 text-sm">{error}</p>}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <Cifra titulo="Comprado" valor={`$${fmtNum(resumen.base, 2)}`} detalle={`${visibles.length} factura${visibles.length === 1 ? '' : 's'} · sin IVA`} />
              <Cifra titulo="Al inventario" valor={`$${fmtNum(resumen.deposito, 2)}`} detalle="Mercancía que entró al stock" />
              <Cifra titulo="A gasto" valor={`$${fmtNum(resumen.gasto, 2)}`} detalle="Desechables, servicios, equipos" />
              <Cifra
                titulo="Por pagar"
                valor={`$${fmtNum(totalPendiente, 2)}`}
                detalle={vencidas.length > 0 ? `${vencidas.length} vencida${vencidas.length === 1 ? '' : 's'}` : pendientes.length > 0 ? `${pendientes.length} a crédito` : 'Nada pendiente'}
                tono={vencidas.length > 0 ? 'alerta' : 'normal'}
              />
            </div>

            {(resumen.partes.length > 0 || resumen.otros > 0) && (
              <Seccion titulo="A dónde fue la plata" ayuda="Lo comprado en el período, repartido por lo que es. Cada color es un almacén.">
                <DestinoPlata
                  partes={resumen.partes}
                  pie={
                    resumen.otros > 0 ? (
                      <p className="mt-1 text-sm text-neutral-600">
                        Sin renglones (servicios, equipos, otros gastos){' '}
                        <span className="font-semibold tabular-nums text-neutral-900">${fmtNum(resumen.otros, 2)}</span>
                      </p>
                    ) : undefined
                  }
                />
              </Seccion>
            )}

            {reclamos.length > 0 && (
              <Seccion
                titulo="Lo que los proveedores deben"
                ayuda="Mercancía facturada que no llegó. Cuando llegue la nota de crédito, regístrala en la factura; si nunca llega, dala por perdida."
                accion={
                  <span className="text-sm text-neutral-500">
                    Nos deben <span className="font-display font-semibold text-neutral-900 tabular-nums">${fmtNum(reclamos.reduce((s, r) => s + r.valor, 0), 2)}</span>
                  </span>
                }
              >
                <div className="space-y-2">
                  {reclamos.map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-neutral-500/6 px-3 py-2.5 text-sm">
                      <span className="font-medium flex-1 min-w-[160px]">
                        {r.cantidad} {r.unidad} de {r.ingrediente_nombre}
                        <span className="block text-xs text-neutral-500">
                          {r.proveedor_nombre} · fact. {r.numero_factura} · {new Date(r.fecha).toLocaleDateString('es-VE')}
                          {(r.dias ?? 0) > 0 && (
                            <span className={(r.dias ?? 0) > 7 ? 'text-peligro-600 font-semibold' : ''}> · hace {r.dias} {r.dias === 1 ? 'día' : 'días'}</span>
                          )}
                          {r.motivo && ` · ${r.motivo}`}
                        </span>
                      </span>
                      <span className="font-semibold tabular-nums w-24 text-right">${fmtNum(r.valor, 2)}</span>
                      <Boton
                        tono="suave"
                        className="!py-1.5 !px-3 !text-xs"
                        onClick={async () => {
                          if (!(await dialogo.confirmar({ titulo: '¿Dar por perdido?', texto: `El proveedor no va a acreditar ${r.cantidad} ${r.unidad} de ${r.ingrediente_nombre}: pasa a pérdida ($${fmtNum(r.valor, 2)}).`, aceptar: 'Dar por perdido', peligro: true })))
                            return
                          await accionFactura(() => api.darReclamoPorPerdido(r.id))
                        }}
                      >
                        Dar por perdido
                      </Boton>
                    </div>
                  ))}
                </div>
              </Seccion>
            )}

            {pendientes.length > 0 && (
              <Seccion
                titulo="Cuentas por pagar"
                ayuda="Lo que se compró a crédito y todavía no se ha pagado, lo más urgente primero."
                accion={
                  <span className="text-sm text-neutral-500">
                    Debemos <span className="font-display font-semibold text-neutral-900 tabular-nums">${fmtNum(totalPendiente, 2)}</span>
                  </span>
                }
              >
                <div className="space-y-2">
                  {pendientes.map((f) => {
                    const dias = diasVencida(f)
                    const vencida = dias !== null && dias > 0
                    return (
                      <div key={f.id} className={`flex flex-wrap items-center gap-2 rounded-xl px-3 py-2.5 text-sm ${vencida ? 'bg-peligro-500/10' : 'bg-neutral-500/6'}`}>
                        <span className="font-medium flex-1 min-w-[140px]">
                          {f.proveedor_nombre}
                          <span className="block text-xs text-neutral-500 font-mono">{f.numero_factura}</span>
                        </span>
                        <span className={`text-xs ${vencida ? 'text-peligro-600 font-semibold' : 'text-neutral-500'}`}>
                          {f.fecha_vencimiento
                            ? vencida
                              ? `Vencida hace ${dias} días`
                              : `Vence ${new Date(f.fecha_vencimiento).toLocaleDateString('es-VE')}`
                            : 'Sin fecha de vencimiento'}
                        </span>
                        <span className="font-semibold tabular-nums w-28 text-right">
                          ${fmtNum(f.saldo ?? f.a_pagar ?? f.total, 2)}
                          {!!f.abonado && <span className="block text-[11px] font-normal text-neutral-500">abonado ${fmtNum(f.abonado, 2)}</span>}
                        </span>
                        <select
                          value={liquidacion[f.id] || 'Efectivo'}
                          onChange={(e) => setLiquidacion((prev) => ({ ...prev, [f.id]: e.target.value }))}
                          className="border border-neutral-300 rounded-lg px-2 py-1 text-xs"
                          aria-label="Con qué se paga"
                        >
                          <option value="Efectivo">Efectivo</option>
                          <option value="Banco">Banco</option>
                        </select>
                        <Boton tono="suave" onClick={() => void abonar(f)} disabled={pagando === f.id} className="!py-1.5 !px-3 !text-xs">
                          Abonar
                        </Boton>
                        <Boton onClick={() => marcarPagada(f)} disabled={pagando === f.id} className="!py-1.5 !px-3 !text-xs">
                          {f.abonado ? 'Pagar el resto' : 'Marcar pagada'}
                        </Boton>
                      </div>
                    )
                  })}
                </div>
              </Seccion>
            )}

            <Tabla orden={orden} buscador={buscador} glosario="compras" className="vp-losa overflow-hidden">
              <table className="w-full text-sm">
                <thead className="text-neutral-500 text-xs">
                  <tr>
                    <Th clave="fecha">Fecha</Th>
                    <Th clave="proveedor">Proveedor</Th>
                    <Th>Qué trajo</Th>
                    <Th clave="total" alinear="derecha">Total</Th>
                    <Th clave="estado">Pago</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {orden.ordenar(buscador.filtrar(visibles)).map((f) => (
                    <FilaFactura
                      key={f.id}
                      f={f}
                      abierta={abierta === f.id}
                      alAbrir={() => setAbierta((a) => (a === f.id ? null : f.id))}
                      alVerSoporte={() => setVerSoporte(f.id)}
                      alNotaCredito={() => notaCredito(f)}
                      alBorrar={() => borrar(f)}
                    />
                  ))}
                  {visibles.length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        <Vacio
                          icono="compras"
                          titulo="Todavía no hay facturas"
                          detalle="Carga la primera desde «Cargar factura»: de ahí salen el costo de la mercancía y el IVA que se puede descontar."
                          accion={<Boton onClick={() => irA('nueva')}>Cargar factura</Boton>}
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Tabla>
          </>
        )}

        {seccion === 'nueva' && (
          <CargarFactura
            ingredientes={ingredientes}
            setIngredientes={setIngredientes}
            proveedores={proveedores}
            fiscal={fiscal}
            porCompletar={porCompletar}
            onReintentar={reintentarPendientes}
            onGuardada={(alertas) => {
              if (alertas.length > 0) setAlertasAlGuardar(alertas)
              setPorCompletar(cuantosPendientes())
              cargar()
            }}
            onVerFacturas={() => irA('facturas')}
          />
        )}

        {seccion === 'alertas' && <BandejaAlertas onPendientes={alCambiarPendientes} />}

        {alertasAlGuardar.length > 0 && <AlertasAlGuardar alertas={alertasAlGuardar} onCerrar={() => setAlertasAlGuardar([])} />}

        {seccion === 'proveedores' && (
          <>
            <Seccion
              titulo="Proveedores"
              ayuda="Elegir uno al cargar una factura completa su nombre y su RIF solos."
              accion={<Boton onClick={() => setFichaProveedor('nuevo')}>Nuevo proveedor</Boton>}
            >
              {proveedores.length === 0 ? (
                <Vacio titulo="Sin proveedores registrados" detalle="Se pueden seguir cargando facturas igual, tipeando el nombre." />
              ) : (
                <Tabla buscador={buscadorProveedores}>
                  <table className="w-full text-sm">
                    <thead className="text-neutral-500 text-xs">
                      <tr>
                        <Th>Nombre</Th>
                        <Th>RIF</Th>
                        <Th>Teléfono</Th>
                        <Th>Contacto</Th>
                        <Th />
                      </tr>
                    </thead>
                    <tbody>
                      {buscadorProveedores.filtrar(proveedores).map((p) => (
                        <tr key={p.id} className={`border-t border-neutral-100 ${!p.activo ? 'opacity-50' : ''}`}>
                          <td className="p-2.5 font-medium">{p.nombre}</td>
                          <td className="p-2.5 tabular-nums text-neutral-500">{p.rif || '—'}</td>
                          <td className="p-2.5 text-neutral-500">{p.telefono || '—'}</td>
                          <td className="p-2.5 text-neutral-500">{p.contacto || '—'}</td>
                          <td className="p-2.5 text-right whitespace-nowrap">
                            {!p.activo && <Pastilla tono="neutro">archivado</Pastilla>}{' '}
                            <button onClick={() => setFichaProveedor(p)} className="text-xs text-acento-700 font-medium mr-3">
                              Editar
                            </button>
                            <button onClick={() => archivarProveedor(p)} className="text-xs text-neutral-500 font-medium">
                              {p.activo ? 'Archivar' : 'Reactivar'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Tabla>
              )}
            </Seccion>
            <MemoriaProveedores proveedores={proveedores} />
          </>
        )}

        {verSoporte !== null && <VerSoporte facturaId={verSoporte} onCerrar={() => setVerSoporte(null)} />}

        {fichaProveedor && (
          <FichaProveedor
            proveedor={fichaProveedor === 'nuevo' ? null : fichaProveedor}
            onCerrar={() => setFichaProveedor(null)}
            onGuardar={guardarProveedor}
          />
        )}
      </Pagina>
    </div>
  )
}

/**
 * Una factura en la lista: de quién, qué trajo (los puntos de sus almacenes
 * y una línea en palabras) y cuánto. Tocarla abre los renglones.
 */
function FilaFactura({
  f,
  abierta,
  alAbrir,
  alVerSoporte,
  alNotaCredito,
  alBorrar,
}: {
  f: FacturaCompra
  abierta: boolean
  alAbrir: () => void
  alVerSoporte: () => void
  alNotaCredito: () => void
  alBorrar: () => void
}) {
  // "3 materia prima · 1 desechable": lo que trajo, contado por almacén.
  const porTipo = new Map<Ingrediente['tipo'], number>()
  for (const it of f.items) porTipo.set(it.tipo, (porTipo.get(it.tipo) ?? 0) + 1)
  const tipos = [...porTipo.entries()]
  const gastos = f.gastos ?? []
  return (
    <>
      <tr className="border-t border-neutral-100 align-top cursor-pointer hover:bg-neutral-500/5" onClick={alAbrir}>
        <td className="p-3 whitespace-nowrap">
          {new Date(f.fecha).toLocaleDateString('es-VE')}
          <span className="block text-xs text-neutral-400 font-mono">{f.numero_factura}</span>
        </td>
        <td className="p-3 font-medium">{f.proveedor_nombre}</td>
        <td className="p-3 text-neutral-600">
          {f.items.length > 0 || gastos.length > 0 ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {tipos.map(([tipo, n]) => (
                <span key={tipo} className="inline-flex items-center gap-1.5">
                  <PuntoTipo tipo={tipo} />
                  {n} {ALMACEN_DE[tipo].texto.toLowerCase()}
                </span>
              ))}
              {gastos.map((g) => (
                <span key={`g-${g.id}`} className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="w-2 h-2 rounded-full ring-1 ring-neutral-400" />
                  {TEXTO_CONCEPTO[g.concepto].toLowerCase()}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-xs">
              {TEXTO_CATEGORIA[f.categoria] ?? f.categoria}
              {f.descripcion && <span className="text-neutral-400"> · {f.descripcion}</span>}
            </span>
          )}
        </td>
        <td className="text-right p-3 tabular-nums font-semibold whitespace-nowrap">
          ${fmtNum(f.total, 2)}
          <span className="block text-[11px] font-normal text-neutral-400">
            base {fmtNum(f.base_imponible, 2)} · IVA {fmtNum(f.iva, 2)}
          </span>
        </td>
        <td className="p-3">
          {f.forma_pago === 'Credito' ? (
            <Pastilla tono={f.pagada ? 'bien' : 'ojo'}>{f.pagada ? 'Pagada' : 'Por pagar'}</Pastilla>
          ) : (
            <span className="text-xs text-neutral-400">
              {f.forma_pago === 'Mixto' && f.pagos?.length ? f.pagos.map((p) => p.forma_pago).join(' + ') : f.forma_pago}
            </span>
          )}
        </td>
        <td className="p-3 text-right">
          <span className={`inline-block text-neutral-400 transition-transform ${abierta ? 'rotate-90' : ''}`}>
            <Icono nombre="chevron" size={16} />
          </span>
        </td>
      </tr>
      {abierta && (
        <tr className="bg-neutral-500/4">
          <td colSpan={6} className="px-3 pb-3 pt-1">
            <div className="rounded-2xl bg-neutral-500/6 p-3 sm:p-4">
              {f.items.length > 0 || gastos.length > 0 ? (
                <ul className="divide-y divide-neutral-500/10">
                  {f.items.map((it) => (
                    <li key={it.id} className="flex items-center gap-3 py-2 text-sm">
                      <PuntoTipo tipo={it.tipo} />
                      <span className="font-medium flex-1 min-w-0 truncate">{it.ingrediente_nombre}</span>
                      <span className="text-xs text-neutral-500 shrink-0">{ALMACEN_DE[it.tipo].destino === 'gasto' ? 'a gasto' : 'al inventario'}</span>
                      <span className="tabular-nums text-neutral-600 shrink-0">
                        {fmtNum(it.cantidad, it.cantidad % 1 ? 2 : 0)} {it.unidad} × ${fmtNum(it.costo_unitario, 2)}
                        {it.exento && <span className="text-neutral-400"> · exento</span>}
                      </span>
                      <span className="tabular-nums font-semibold w-20 text-right shrink-0">${fmtNum(it.subtotal, 2)}</span>
                    </li>
                  ))}
                  {gastos.map((g) => (
                    <li key={`g-${g.id}`} className="flex items-center gap-3 py-2 text-sm">
                      <span aria-hidden className="w-2 h-2 rounded-full ring-1 ring-neutral-400 shrink-0" />
                      <span className="font-medium flex-1 min-w-0 truncate">
                        {TEXTO_CONCEPTO[g.concepto]}
                        {g.descripcion && <span className="font-normal text-neutral-500"> · {g.descripcion}</span>}
                      </span>
                      <span className="text-xs text-neutral-500 shrink-0">{g.concepto === 'Equipo' ? 'a equipos' : 'a gasto'}</span>
                      {g.exento && <span className="text-xs text-neutral-400 shrink-0">exento</span>}
                      <span className="tabular-nums font-semibold w-20 text-right shrink-0">${fmtNum(g.monto, 2)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-neutral-600">{f.descripcion || 'Sin detalle.'}</p>
              )}
              {(f.recargo > 0 || f.descuento > 0) && (
                <p className="text-xs text-neutral-500 mt-2">
                  {f.recargo > 0 && `+$${fmtNum(f.recargo, 2)} de recargo`}
                  {f.recargo > 0 && f.descuento > 0 && ' · '}
                  {f.descuento > 0 && `−$${fmtNum(f.descuento, 2)} de descuento`}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs">
                <span className="text-neutral-500">
                  RIF {f.proveedor_rif || '—'}
                  {f.fecha_emision && ` · emitida ${new Date(`${f.fecha_emision}T12:00:00`).toLocaleDateString('es-VE')}`}
                  {f.tasa_bcv && ` · tasa ${fmtNum(f.tasa_bcv, 2)}`}
                  {f.referencia_pago && ` · ref. ${f.referencia_pago}`}
                </span>
                <span className="flex-1" />
                {f.tiene_soporte && (
                  <button onClick={alVerSoporte} className="font-semibold text-acento-700">
                    Ver el original
                  </button>
                )}
                <button onClick={alNotaCredito} className="font-semibold text-neutral-700" title="El proveedor mandó menos, o te dio un descuento">
                  Nota de crédito
                </button>
                <button onClick={alBorrar} className="font-semibold text-peligro-600">
                  Borrar
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function FichaProveedor({
  proveedor,
  onCerrar,
  onGuardar,
}: {
  proveedor: Proveedor | null
  onCerrar: () => void
  onGuardar: (datos: Omit<Proveedor, 'id' | 'activo'>) => Promise<void>
}) {
  const [nombre, setNombre] = useState(proveedor?.nombre ?? '')
  const [rif, setRif] = useState(proveedor?.rif ?? '')
  const [telefono, setTelefono] = useState(proveedor?.telefono ?? '')
  const [direccion, setDireccion] = useState(proveedor?.direccion ?? '')
  const [contacto, setContacto] = useState(proveedor?.contacto ?? '')
  const [nota, setNota] = useState(proveedor?.nota ?? '')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    if (!nombre.trim()) {
      setError('El nombre es obligatorio')
      return
    }
    setError('')
    setGuardando(true)
    try {
      await onGuardar({ nombre: nombre.trim(), rif: rif.trim() || null, telefono, direccion, contacto, nota })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      titulo={proveedor ? proveedor.nombre : 'Nuevo proveedor'}
      onCerrar={onCerrar}
      pie={
        <>
          <Boton tono="suave" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton onClick={guardar} disabled={guardando}>
            Guardar
          </Boton>
        </>
      }
    >
      {error && <p className="text-peligro-600 text-sm mb-3">{error}</p>}
      <div className="space-y-3">
        <Campo etiqueta="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <Campo etiqueta="RIF" value={rif} onChange={(e) => setRif(e.target.value)} placeholder="J-12345678-9 (opcional)" />
        <Campo etiqueta="Teléfono" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
        <Campo etiqueta="Dirección" value={direccion} onChange={(e) => setDireccion(e.target.value)} />
        <Campo etiqueta="Persona de contacto" value={contacto} onChange={(e) => setContacto(e.target.value)} />
        <Campo etiqueta="Nota" value={nota} onChange={(e) => setNota(e.target.value)} />
      </div>
    </Modal>
  )
}
