import { useEffect, useMemo, useState, type ReactNode } from 'react'
import NavBar from '../components/NavBar'
import { useSeccion } from '../components/Secciones'
import { FiltroFechas } from '../components/Fechas'
import { Tabla, Th, useOrden } from '../components/Tabla'
import { Cifra, Pagina, Pastilla, Seccion, Vacio } from '../components/ui'
import { api } from '../lib/api'
import { etiquetaRango, nombreRango, useRango } from '../lib/fechas'
import { fmtBs, fmtNum, useMoneda } from '../lib/moneda'
import { etiquetaMetodo } from '../lib/pagos'
import type { EstadoVenta, ListaVentas, PuntoSerie, ResumenVentas, VentaFila } from '../lib/types'

/**
 * VENTAS: cada venta del periodo, que paso con ella, y los numeros de arriba.
 *
 * POR QUE APARTE DE REPORTES. Reportes opina (ganancia, margen, avisos, que se
 * vende junto). Aqui no se opina: se muestra la lista de TODAS las ventas
 * --cobradas, fiadas, devueltas, anuladas, abiertas-- con quien la cobro y
 * como, y encima lo que un dueño pregunta primero: cuanto vendi, cuanto vendo
 * al dia, cuanta plata se me esta yendo. Leider (16-sep): "un historial con
 * todas las ventas, que paso con ellas, y KPIs relevantes, media de ventas al
 * dia, cuanto dinero se esta mermando, donde haya un filtro de fecha obvio".
 *
 * El filtro de fecha es el del encabezado, el mismo de todas las pantallas.
 * Abre en "este mes": es el tramo que se revisa.
 */

const SECCIONES = [
  { id: 'historial', texto: 'Historial' },
  { id: 'resumen', texto: 'Resumen' },
  { id: 'perdidas', texto: 'Pérdidas' },
]

const ESTADOS: { clave: EstadoVenta | 'todas'; texto: string; tono: 'neutro' | 'bien' | 'ojo' | 'mal' | 'acento' }[] = [
  { clave: 'todas', texto: 'Todas', tono: 'neutro' },
  { clave: 'cobrada', texto: 'Cobradas', tono: 'bien' },
  { clave: 'fiada', texto: 'A crédito', tono: 'ojo' },
  { clave: 'devuelta', texto: 'Devueltas', tono: 'mal' },
  { clave: 'anulada', texto: 'Anuladas', tono: 'neutro' },
  { clave: 'abierta', texto: 'Abiertas', tono: 'acento' },
]

const TEXTO_ESTADO: Record<EstadoVenta, string> = {
  cobrada: 'Cobrada',
  fiada: 'A crédito',
  devuelta: 'Devuelta',
  anulada: 'Anulada',
  abierta: 'Abierta',
}

function PastillaEstado({ estado }: { estado: EstadoVenta }) {
  const tono = ESTADOS.find((e) => e.clave === estado)?.tono ?? 'neutro'
  return <Pastilla tono={tono}>{TEXTO_ESTADO[estado]}</Pastilla>
}

const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleString('es-VE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function Ventas() {
  const [seccion, irA] = useSeccion(SECCIONES)
  const [rango, setRango] = useRango('mes')
  const [lista, setLista] = useState<ListaVentas | null>(null)
  const [resumen, setResumen] = useState<ResumenVentas | null>(null)
  // Para que rango llegaron los datos: si no es el de ahora, se esta cargando.
  const [cargado, setCargado] = useState('')
  const cargando = cargado !== `${rango.desde}/${rango.hasta}`

  useEffect(() => {
    Promise.all([api.ventas(rango), api.resumenVentas(rango)]).then(([l, r]) => {
      setLista(l)
      setResumen(r)
      setCargado(`${rango.desde}/${rango.hasta}`)
    })
  }, [rango])

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar
        titulo="Ventas"
        secciones={SECCIONES}
        seccion={seccion}
        alCambiarSeccion={irA}
        filtro={<FiltroFechas rango={rango} alCambiar={setRango} />}
      />
      <Pagina>
        {cargando && !lista && <p className="text-neutral-400 text-sm">Cargando...</p>}

        {seccion === 'historial' && lista && <Historial lista={lista} etiqueta={etiquetaRango(rango)} />}
        {seccion === 'resumen' && resumen && <Resumen r={resumen} nombre={nombreRango(rango)} />}
        {seccion === 'perdidas' && resumen && lista && <Perdidas r={resumen} lista={lista} />}
      </Pagina>
    </div>
  )
}

// ── Historial ────────────────────────────────────────────────────────────────

function Historial({ lista, etiqueta }: { lista: ListaVentas; etiqueta: string }) {
  const { fmtCongelado } = useMoneda()
  const [estado, setEstado] = useState<EstadoVenta | 'todas'>('todas')
  const [busqueda, setBusqueda] = useState('')
  const [abierta, setAbierta] = useState<number | null>(null)
  const orden = useOrden<VentaFila>(
    {
      numero: (v) => v.numero,
      fecha: (v) => new Date(v.fecha),
      detalle: (v) => v.detalle,
      estado: (v) => TEXTO_ESTADO[v.estado],
      pago: (v) => v.pago,
      quien: (v) => v.operador,
      total: (v) => v.total,
    },
    '-fecha',
  )

  const conteo = useMemo(() => {
    const c: Record<string, number> = { todas: lista.filas.length }
    for (const v of lista.filas) c[v.estado] = (c[v.estado] ?? 0) + 1
    return c
  }, [lista])

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return lista.filas.filter((v) => {
      if (estado !== 'todas' && v.estado !== estado) return false
      if (!q) return true
      return (
        String(v.numero).includes(q) ||
        v.cliente.toLowerCase().includes(q) ||
        v.detalle.toLowerCase().includes(q) ||
        v.operador.toLowerCase().includes(q) ||
        v.pago.toLowerCase().includes(q) ||
        (v.numero_factura ?? '').toLowerCase().includes(q)
      )
    })
  }, [lista, estado, busqueda])

  // Lo que suma lo visible, sin lo que no se vendio: una anulada no es venta.
  const cuentan = visibles.filter((v) => v.estado !== 'anulada' && v.estado !== 'devuelta')
  const totalVisible = cuentan.reduce((s, v) => s + v.total, 0)
  // En bolivares, cada venta entro a la tasa de SU dia. Se suma con la tasa
  // media ponderada de lo que hay a la vista y no con la de hoy: si no, el
  // total de un mes viejo cambiaria solo cada vez que se mueve el dolar.
  const tasaMedia =
    totalVisible > 0
      ? cuentan.reduce((s, v) => s + v.total * (v.tasa_bcv ?? 0), 0) / totalVisible || null
      : null

  return (
    <Seccion
      titulo={`Ventas · ${etiqueta}`}
      ayuda={`${lista.total} venta(s) en el período. Toca una fila para ver el detalle.`}
      accion={
        <span className="text-sm text-neutral-500">
          Vendido:{' '}
          <span className="font-semibold text-neutral-900 tabular-nums">
            {fmtCongelado(totalVisible, tasaMedia)}
          </span>
        </span>
      }
      plano
    >
      <div className="px-4 pb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto">
          {ESTADOS.map((e) => {
            const n = conteo[e.clave] ?? 0
            if (e.clave !== 'todas' && n === 0) return null
            const activo = estado === e.clave
            return (
              <button
                key={e.clave}
                type="button"
                onClick={() => setEstado(e.clave)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border ${
                  activo ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white border-neutral-200 text-neutral-600'
                }`}
              >
                {e.texto} <span className={activo ? 'opacity-70' : 'text-neutral-400'}>{n}</span>
              </button>
            )
          })}
        </div>
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar: número, cliente, producto, quién cobró…"
          className="ml-auto w-full sm:w-72 border border-neutral-300 rounded-lg px-3 py-2 text-sm"
        />
      </div>

      {lista.recortado && (
        <p className="mx-4 mb-3 text-xs bg-aviso-50 border border-aviso-200 text-aviso-800 rounded-lg px-3 py-2">
          Hay más de {lista.filas.length} ventas en este período y solo se muestran las más recientes.
          Acorta el rango arriba para verlas todas.
        </p>
      )}

      {visibles.length === 0 ? (
        <Vacio
          icono="ventas"
          titulo={lista.filas.length === 0 ? 'Sin ventas en este período' : 'Nada coincide con el filtro'}
          detalle={lista.filas.length === 0 ? 'Cambia el período arriba, o cobra un pedido en el punto de venta.' : undefined}
        />
      ) : (
        <Tabla orden={orden} glosario="ventas">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
              <tr>
                <Th clave="numero">#</Th>
                <Th clave="fecha">Fecha</Th>
                <Th clave="detalle">Qué se vendió</Th>
                <Th clave="estado">Qué pasó</Th>
                <Th clave="pago" className="hidden md:table-cell">Cómo se pagó</Th>
                <Th clave="quien" className="hidden lg:table-cell">Quién</Th>
                <Th clave="total" alinear="derecha">Total</Th>
              </tr>
            </thead>
            <tbody>
              {orden.ordenar(visibles).map((v) => {
                const desplegada = abierta === v.id
                const apagada = v.estado === 'anulada' || v.estado === 'devuelta'
                return (
                  <FilaVenta
                    key={v.id}
                    v={v}
                    apagada={apagada}
                    desplegada={desplegada}
                    alTocar={() => setAbierta(desplegada ? null : v.id)}
                    total={fmtCongelado(v.total, v.tasa_bcv)}
                    fmtCongelado={fmtCongelado}
                  />
                )
              })}
            </tbody>
          </table>
        </Tabla>
      )}
    </Seccion>
  )
}

function FilaVenta({
  v,
  apagada,
  desplegada,
  alTocar,
  total,
  fmtCongelado,
}: {
  v: VentaFila
  apagada: boolean
  desplegada: boolean
  alTocar: () => void
  total: string
  fmtCongelado: (usd: number | null | undefined, tasa: number | null | undefined) => string
}) {
  return (
    <>
      <tr
        onClick={alTocar}
        className={`border-t border-neutral-100 cursor-pointer hover:bg-neutral-50 ${apagada ? 'text-neutral-400' : ''}`}
        aria-expanded={desplegada}
      >
        <td className="p-3 tabular-nums font-medium">{v.numero}</td>
        <td className="p-3 tabular-nums whitespace-nowrap">{fechaCorta(v.fecha)}</td>
        <td className="p-3">
          <span className={apagada ? 'line-through' : ''}>{v.detalle || '—'}</span>
          {v.cliente && <span className="block text-xs text-neutral-400">{v.cliente}</span>}
        </td>
        <td className="p-3">
          <PastillaEstado estado={v.estado} />
          {v.estado === 'fiada' && v.fiado_pendiente > 0 && (
            <span className="block text-[11px] text-aviso-700 mt-0.5">
              debe {fmtCongelado(v.fiado_pendiente, v.tasa_bcv)}
            </span>
          )}
        </td>
        <td className="p-3 hidden md:table-cell">
          {etiquetaMetodo(v.pago) || '—'}
          {v.facturado && <span className="block text-[11px] text-neutral-400">factura {v.numero_factura ?? ''}</span>}
        </td>
        <td className="p-3 hidden lg:table-cell">
          {v.operador || '—'}
          {v.punto_venta && <span className="block text-[11px] text-neutral-400">{v.punto_venta}</span>}
        </td>
        <td className={`p-3 text-right tabular-nums font-semibold ${apagada ? 'line-through font-normal' : ''}`}>{total}</td>
      </tr>
      {desplegada && (
        <tr className="border-t border-neutral-100 bg-neutral-50/60">
          <td colSpan={7} className="px-4 py-3">
            <DetalleVenta v={v} fmtCongelado={fmtCongelado} />
          </td>
        </tr>
      )}
    </>
  )
}

function Dato({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide font-semibold text-neutral-400">{titulo}</div>
      <div className="text-sm">{children}</div>
    </div>
  )
}

function DetalleVenta({
  v,
  fmtCongelado,
}: {
  v: VentaFila
  fmtCongelado: (usd: number | null | undefined, tasa: number | null | undefined) => string
}) {
  const dinero = (x: number) => fmtCongelado(x, v.tasa_bcv)
  return (
    <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-4 text-neutral-800">
      <div>
        <div className="text-[11px] uppercase tracking-wide font-semibold text-neutral-400 mb-1">Renglones</div>
        <ul className="divide-y divide-neutral-100">
          {v.items.map((i) => (
            <li key={i.id} className="flex justify-between py-1 text-sm">
              <span>
                <span className="tabular-nums text-neutral-500">{i.cantidad}×</span> {i.nombre}
                {i.nota && <span className="text-xs text-neutral-400"> · {i.nota}</span>}
              </span>
              <span className="tabular-nums">{dinero(i.precio_unitario * i.cantidad)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 pt-2 border-t border-neutral-200 text-sm space-y-0.5">
          {v.descuento > 0 && (
            <div className="flex justify-between text-neutral-600">
              <span>Precio de lista</span>
              <span className="tabular-nums">{dinero(v.subtotal)}</span>
            </div>
          )}
          {v.descuento > 0 && (
            <div className="flex justify-between text-aviso-700">
              <span>Descuento</span>
              <span className="tabular-nums">−{dinero(v.descuento)}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{dinero(v.total)}</span>
          </div>
          {v.propina > 0 && (
            <div className="flex justify-between text-neutral-600">
              <span>Propina (del empleado, no es venta)</span>
              <span className="tabular-nums">{dinero(v.propina)}</span>
            </div>
          )}
          {v.total_bs != null && v.tasa_bcv && (
            <div className="flex justify-between text-neutral-500 text-xs">
              <span>A la tasa de ese día ({v.tasa_bcv.toFixed(2)} Bs/$)</span>
              <span className="tabular-nums">{fmtBs(v.total_bs)}</span>
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 content-start">
        <Dato titulo="Qué pasó">
          <PastillaEstado estado={v.estado} />
        </Dato>
        <Dato titulo="Cómo se pagó">{etiquetaMetodo(v.pago) || '—'}</Dato>
        <Dato titulo="Quién cobró">{v.operador || '—'}</Dato>
        <Dato titulo="Caja">{v.punto_venta || '—'}</Dato>
        {v.cliente && <Dato titulo="Cliente">{v.cliente}</Dato>}
        {v.estado === 'fiada' && <Dato titulo="Debe todavía">{dinero(v.fiado_pendiente)}</Dato>}
        {v.fiado_saldado && <Dato titulo="A crédito">Ya saldado</Dato>}
        {v.facturado && <Dato titulo="Factura">{v.numero_factura || 'sí'}</Dato>}
        {v.estado === 'anulada' && <Dato titulo="Anulada por">{v.anulado_por || '—'}</Dato>}
        {v.estado === 'anulada' && (
          <Dato titulo="Comida">
            {/* La senal que de verdad importa para auditar: anular ANTES de
                cocinar es que el cliente cambio de opinion, algo normal.
                Anular DESPUES es comida que se hizo y no se cobro -una
                perdida real, y si se repite mucho con el mismo operador, la
                pregunta que hay que hacerse. */}
            {v.items.some((i) => i.preparado) ? (
              <span className="text-peligro-700 font-medium">Se preparó (pérdida real)</span>
            ) : (
              <span className="text-neutral-500">No se llegó a preparar</span>
            )}
          </Dato>
        )}
        {v.estado === 'devuelta' && (
          <Dato titulo="Devolución">
            {v.motivo_devolucion || 'sin motivo'}
            {v.nota_credito && <span className="block text-xs text-neutral-500">nota de crédito {v.nota_credito}</span>}
          </Dato>
        )}
        {v.nota && <Dato titulo="Nota">{v.nota}</Dato>}
      </div>
    </div>
  )
}

// ── Resumen ──────────────────────────────────────────────────────────────────

function Resumen({ r, nombre }: { r: ResumenVentas; nombre: string }) {
  const { fmtCongelado, sufijo } = useMoneda()
  // La tasa MEDIA del periodo, sacada de los bolivares que de verdad entraron
  // (cada venta a la suya). Con la de hoy, el resumen de un mes viejo se
  // movería solo al moverse el dolar, y no cuadraría con la línea de arriba.
  const tasaPeriodo = r.ventas > 0 ? r.ventas_bs / r.ventas || null : null
  const fmt = (x: number | null | undefined, d?: number) => fmtCongelado(x, tasaPeriodo, d)
  const cambio = r.cambio_pct
  const incompleto = r.hasta >= new Date().toISOString().slice(0, 10)
  return (
    <>
      <div className="vp-escalonado grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Cifra
          titulo="Ventas"
          ayuda="kpi.ventas"
          valor={fmt(r.ventas)}
          detalle={r.ventas_bs > 0 ? `${fmtBs(r.ventas_bs)} cobrados, cada venta a su tasa` : `${r.etiqueta}`}
        />
        <Cifra
          titulo="Ventas por día"
          ayuda="kpi.promedio_diario"
          valor={fmt(r.promedio_diario)}
          detalle={`Sobre ${r.dias} día(s) ${incompleto ? 'transcurridos' : ''}`}
        />
        <Cifra titulo="Pedidos" ayuda="kpi.pedidos" valor={String(r.pedidos)} detalle={`${r.unidades} unidades`} />
        <Cifra titulo="Pedidos por día" ayuda="kpi.pedidos_por_dia" valor={r.pedidos_por_dia.toFixed(1)} />
        <Cifra
          titulo="Ticket promedio"
          ayuda="kpi.ticket_promedio"
          valor={fmt(r.ticket_promedio)}
          detalle={
            Math.abs(r.ticket_mediano - r.ticket_promedio) > 0.01 ? `El cliente típico gastó ${fmt(r.ticket_mediano)}` : undefined
          }
        />
        <Cifra
          titulo="Contra el período anterior"
          ayuda="kpi.vs_anterior"
          valor={cambio == null ? '—' : `${cambio > 0 ? '+' : ''}${cambio.toFixed(0)}%`}
          detalle={`Antes: ${fmt(r.anterior.ventas)} en ${r.anterior.pedidos} pedidos${incompleto ? ' · este período aún no termina' : ''}`}
          tono={cambio == null ? 'normal' : cambio >= 0 ? 'bien' : 'alerta'}
        />
        <Cifra
          titulo="Facturadas"
          ayuda="kpi.facturadas"
          valor={String(r.facturadas)}
          detalle={r.pedidos ? `${((r.facturadas / r.pedidos) * 100).toFixed(0)}% de las ventas · ${fmt(r.valor_facturado)}` : undefined}
        />
        <Cifra
          titulo="Dinero perdido"
          ayuda="kpi.perdidas"
          valor={fmt(r.perdidas.total)}
          detalle={`${r.perdidas.pct_sobre_ventas.toFixed(1)}% de lo vendido`}
          tono={r.perdidas.pct_sobre_ventas > 3 ? 'alerta' : 'normal'}
        />
      </div>

      {r.serie.length > 0 && (
        <Seccion
          titulo={`Ventas por ${r.granularidad} · ${sufijo}`}
          ayuda={
            r.mejor
              ? `${nombre}. El mejor tramo fue ${r.mejor.etiqueta}: ${fmt(r.mejor.ventas)} en ${r.mejor.pedidos} pedidos.`
              : nombre
          }
        >
          <Barras serie={r.serie} fmt={fmt} />
        </Seccion>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Seccion titulo="Cómo te pagaron">
          <Reparto filas={Object.entries(r.por_metodo_pago).map(([nombre, ventas]) => ({ nombre, ventas }))} total={r.ventas} fmt={fmt} />
        </Seccion>
        {(r.por_operador.length > 1 || r.por_punto_venta.length > 1) && (
          <Seccion titulo={r.por_operador.length > 1 ? 'Quién cobró' : 'Por caja'}>
            <Reparto
              filas={(r.por_operador.length > 1 ? r.por_operador : r.por_punto_venta).map((g) => ({
                nombre: g.nombre,
                ventas: g.ventas,
                detalle: `${g.pedidos} pedidos`,
              }))}
              total={r.ventas}
              fmt={fmt}
            />
          </Seccion>
        )}
      </div>
    </>
  )
}

function Reparto({
  filas,
  total,
  fmt,
}: {
  filas: { nombre: string; ventas: number; detalle?: string }[]
  total: number
  fmt: (v: number) => string
}) {
  if (filas.length === 0) return <p className="text-neutral-400 text-sm">Sin cobros en el período.</p>
  return (
    <div className="space-y-2">
      {filas.map((f) => {
        const pct = total > 0 ? (f.ventas / total) * 100 : 0
        return (
          <div key={f.nombre}>
            <div className="flex justify-between text-sm">
              <span className="text-neutral-700">
                {f.nombre}
                {f.detalle && <span className="text-xs text-neutral-400"> · {f.detalle}</span>}
              </span>
              <span className="tabular-nums font-medium">
                {fmt(f.ventas)} <span className="text-xs text-neutral-400">{pct.toFixed(0)}%</span>
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-neutral-100 mt-1 overflow-hidden">
              <div
                className="vp-barra-h h-full bg-neutral-900 rounded-full"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Barras({ serie, fmt }: { serie: PuntoSerie[]; fmt: (v: number, d?: number) => string }) {
  const max = Math.max(...serie.map((s) => s.ventas), 0)
  // Con muchos tramos (un año por semanas) no caben todas las etiquetas: se
  // muestra una de cada tantas y el resto queda en el title.
  const salto = Math.ceil(serie.length / 16)
  return (
    <div className="flex items-end gap-1 h-44 overflow-x-auto">
      {serie.map((p, i) => {
        const alto = max > 0 ? (p.ventas / max) * 100 : 0
        return (
          <div
            key={p.etiqueta + i}
            className="group flex-1 min-w-[18px] flex flex-col items-center justify-end h-full gap-1 cursor-default"
            title={`${p.etiqueta}: ${fmt(p.ventas)} en ${p.pedidos} pedido(s)`}
          >
            <span className="text-[10px] text-neutral-500 tabular-nums">
              {/* Sin simbolo: no cabe uno por barra y ya lo dice el titulo. */}
              {p.ventas > 0 && serie.length <= 16 ? fmtNum(p.ventas, 0) : ''}
            </span>
            <div
              className="vp-barra w-full bg-neutral-900 rounded-t-md min-h-[2px] transition-colors group-hover:bg-acento-500"
              style={{ height: `${alto}%`, animationDelay: `${Math.min(i * 18, 400)}ms` }}
            />
            <span className="text-[10px] text-neutral-500 whitespace-nowrap h-3">{i % salto === 0 ? p.etiqueta : ''}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Perdidas ─────────────────────────────────────────────────────────────────

type FilaPerdida = {
  id: string
  numero: number
  fecha: string
  tipo: 'Devuelta' | 'Descuento' | 'Anulada' | 'A crédito por cobrar'
  detalle: string
  quien: string
  monto: number
  /** La tasa a la que se cobro esa venta: en bolivares manda esa, no la de hoy. */
  tasa: number | null
  nota: string
}

function Perdidas({ r, lista }: { r: ResumenVentas; lista: ListaVentas }) {
  const { fmt } = useMoneda()
  const p = r.perdidas
  const orden = useOrden<FilaPerdida>(
    {
      numero: (f) => f.numero,
      fecha: (f) => new Date(f.fecha),
      tipo: (f) => f.tipo,
      detalle: (f) => f.detalle,
      quien: (f) => f.quien,
      monto: (f) => f.monto,
    },
    '-fecha',
  )
  const { fmtCongelado } = useMoneda()

  const filas = useMemo<FilaPerdida[]>(() => {
    const salida: FilaPerdida[] = []
    for (const v of lista.filas) {
      if (v.estado === 'devuelta')
        salida.push({ id: `d${v.id}`, numero: v.numero, fecha: v.fecha, tipo: 'Devuelta', detalle: v.detalle, quien: v.operador, tasa: v.tasa_bcv, monto: v.total, nota: v.motivo_devolucion })
      if (v.estado === 'anulada')
        salida.push({ id: `a${v.id}`, numero: v.numero, fecha: v.fecha, tipo: 'Anulada', detalle: v.detalle, quien: v.anulado_por || v.operador, tasa: v.tasa_bcv, monto: v.total, nota: '' })
      if (v.descuento > 0 && v.estado !== 'anulada' && v.estado !== 'devuelta')
        salida.push({ id: `r${v.id}`, numero: v.numero, fecha: v.fecha, tipo: 'Descuento', detalle: v.detalle, quien: v.operador, tasa: v.tasa_bcv, monto: v.descuento, nota: '' })
      if (v.estado === 'fiada')
        salida.push({ id: `f${v.id}`, numero: v.numero, fecha: v.fecha, tipo: 'A crédito por cobrar', detalle: v.detalle, quien: v.operador, tasa: v.tasa_bcv, monto: v.fiado_pendiente, nota: v.cliente })
    }
    return salida
  }, [lista])

  const TONO: Record<FilaPerdida['tipo'], 'mal' | 'ojo' | 'neutro'> = {
    Devuelta: 'mal',
    Descuento: 'ojo',
    Anulada: 'neutro',
    'A crédito por cobrar': 'ojo',
  }

  return (
    <>
      <div className="vp-escalonado grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Cifra
          titulo="Dinero perdido"
          ayuda="kpi.perdidas"
          valor={fmt(p.total)}
          detalle={`${p.pct_sobre_ventas.toFixed(1)}% de lo vendido · devuelto + descuentos + merma`}
          tono={p.pct_sobre_ventas > 3 ? 'alerta' : 'normal'}
        />
        <Cifra titulo="Devueltas" ayuda="kpi.devueltas" valor={fmt(p.valor_devuelto)} detalle={`${p.devueltas} venta(s) que el cliente devolvió`} tono={p.devueltas ? 'alerta' : 'normal'} />
        <Cifra titulo="Descuentos" ayuda="kpi.descuentos" valor={fmt(p.valor_descuentos)} detalle={`En ${p.con_descuento} venta(s)`} />
        <Cifra titulo="Merma de inventario" ayuda="kpi.merma_inventario" valor={fmt(p.merma_inventario)} detalle="Lo que se botó o se dañó, según el libro" tono={p.merma_inventario > 0 ? 'alerta' : 'normal'} />
        <Cifra titulo="Anuladas" ayuda="kpi.anuladas" valor={fmt(p.valor_anulado)} detalle={`${p.anuladas} pedido(s). No entró: no se suma arriba`} />
        <Cifra titulo="A crédito por cobrar" ayuda="kpi.fiado_pendiente" valor={fmt(p.valor_fiado_pendiente)} detalle={`${p.fiado_pendiente} venta(s) de este período aún sin pagar`} tono={p.valor_fiado_pendiente > 0 ? 'alerta' : 'normal'} />
      </div>

      <Seccion titulo="Una por una" ayuda="Cada venta que se devolvió, se rebajó, se anuló o quedó a crédito en el período." plano>
        {filas.length === 0 ? (
          <Vacio icono="ok" titulo="Nada que lamentar" detalle="En este período no hubo devoluciones, descuentos, anulaciones ni ventas a crédito pendientes." />
        ) : (
          <Tabla orden={orden} glosario="ventas_perdidas">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
                <tr>
                  <Th clave="numero">#</Th>
                  <Th clave="fecha">Fecha</Th>
                  <Th clave="tipo">Qué pasó</Th>
                  <Th clave="detalle">Venta</Th>
                  <Th clave="quien" className="hidden md:table-cell">Quién</Th>
                  <Th clave="monto" alinear="derecha">Monto</Th>
                </tr>
              </thead>
              <tbody>
                {orden.ordenar(filas).map((f) => (
                  <tr key={f.id} className="border-t border-neutral-100">
                    <td className="p-3 tabular-nums font-medium">{f.numero}</td>
                    <td className="p-3 tabular-nums whitespace-nowrap">{fechaCorta(f.fecha)}</td>
                    <td className="p-3">
                      <Pastilla tono={TONO[f.tipo]}>{f.tipo}</Pastilla>
                      {f.nota && <span className="block text-xs text-neutral-400 mt-0.5">{f.nota}</span>}
                    </td>
                    <td className="p-3">{f.detalle || '—'}</td>
                    <td className="p-3 hidden md:table-cell">{f.quien || '—'}</td>
                    <td className="p-3 text-right tabular-nums font-semibold">
                      {fmtCongelado(f.monto, f.tasa)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Tabla>
        )}
      </Seccion>
    </>
  )
}
