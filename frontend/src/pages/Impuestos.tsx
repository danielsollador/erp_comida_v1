import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import { api } from '../lib/api'
import type {
  ConfiguracionFiscal,
  DeclaracionIva,
  LibroCompras,
  LibroVentas,
  Periodo,
  PeriodoPendiente,
  ResumenIva,
} from '../lib/types'

const PERIODOS: { valor: Periodo; texto: string }[] = [
  { valor: 'dia', texto: 'Hoy' },
  { valor: 'semana', texto: 'Esta semana' },
  { valor: 'mes', texto: 'Este mes' },
]

const TABS = [
  { id: 'ventas', texto: 'Libro de ventas' },
  { id: 'compras', texto: 'Libro de compras' },
  { id: 'declaraciones', texto: 'Declaraciones' },
] as const

export default function Impuestos() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('ventas')
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [ventas, setVentas] = useState<LibroVentas | null>(null)
  const [compras, setCompras] = useState<LibroCompras | null>(null)
  const [resumen, setResumen] = useState<ResumenIva | null>(null)
  // El valor solo se usa via tasaInput; se guarda el setter para refrescarlo.
  const [, setFiscal] = useState<ConfiguracionFiscal>({ tasa_iva: 16 })
  const [tasaInput, setTasaInput] = useState('')

  useEffect(() => {
    api.libroVentas(periodo).then(setVentas)
    api.libroCompras(periodo).then(setCompras)
    api.resumenIva(periodo).then(setResumen)
  }, [periodo])

  useEffect(() => {
    api.configFiscal().then((c) => {
      setFiscal(c)
      setTasaInput(String(c.tasa_iva))
    })
  }, [])

  async function guardarTasa() {
    const valor = Number(tasaInput)
    if (!Number.isFinite(valor) || valor < 0) return
    const c = await api.actualizarConfigFiscal(valor)
    setFiscal(c)
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Impuestos" />
      <div className="sticky top-[57px] z-10 bg-neutral-50/95 backdrop-blur border-b border-neutral-200 px-4 py-2 flex gap-2 overflow-x-auto">
        {PERIODOS.map((p) => (
          <button
            key={p.valor}
            onClick={() => setPeriodo(p.valor)}
            className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold border transition ${
              periodo === p.valor
                ? 'bg-neutral-900 border-neutral-900 text-white'
                : 'bg-white border-neutral-200 text-neutral-500'
            }`}
          >
            {p.texto}
          </button>
        ))}
      </div>

      <div className="p-4 max-w-4xl mx-auto space-y-5">
        <div className="bg-white rounded-2xl border border-neutral-200 p-4">
          <h2 className="font-semibold mb-2">Alicuota de IVA</h2>
          <div className="flex gap-2">
            <input
              value={tasaInput}
              onChange={(e) => setTasaInput(e.target.value)}
              type="number"
              step="0.5"
              className="w-24 border border-neutral-300 rounded-lg px-3 py-2 text-sm"
            />
            <span className="flex items-center text-sm text-neutral-500">%</span>
            <button
              onClick={guardarTasa}
              className="bg-neutral-900 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              Guardar
            </button>
          </div>
          <p className="text-xs text-neutral-500 mt-2">
            Se congela en cada venta facturada al momento de cobrar, asi que cambiarla no altera
            los libros de meses ya cerrados.
          </p>
        </div>

        {resumen && (
          <div className="grid grid-cols-3 gap-3">
            <Kpi titulo="IVA debito (ventas)" valor={resumen.iva_debito} />
            <Kpi titulo="IVA credito (compras)" valor={resumen.iva_credito} />
            <Kpi
              titulo={resumen.iva_a_pagar >= 0 ? 'IVA a pagar' : 'IVA a favor'}
              valor={Math.abs(resumen.iva_a_pagar)}
              destacado
            />
          </div>
        )}

        <div className="flex gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-full text-sm font-semibold border ${
                tab === t.id ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white border-neutral-200'
              }`}
            >
              {t.texto}
            </button>
          ))}
        </div>

        {tab === 'ventas' && ventas && (
          <div className="space-y-3">
            {ventas.ventas_no_facturadas > 0 && (
              <p className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 text-sm">
                Ademas hubo <strong>{ventas.ventas_no_facturadas}</strong> venta(s) sin facturar por
                ${ventas.monto_no_facturado.toFixed(2)} en este periodo - no entran aqui porque el
                dueno no las declaro con factura.
              </p>
            )}
            <div className="bg-white rounded-2xl border border-neutral-200 overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
                  <tr>
                    <th className="text-left p-3">Fecha</th>
                    <th className="text-left p-3">Factura</th>
                    <th className="text-left p-3">Cliente</th>
                    <th className="text-right p-3">Base</th>
                    <th className="text-right p-3">IVA</th>
                    <th className="text-right p-3">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {ventas.filas.map((f) => (
                    <tr key={f.pedido_id} className="border-t border-neutral-100">
                      <td className="p-3 whitespace-nowrap">
                        {new Date(f.fecha).toLocaleDateString('es-VE')}
                      </td>
                      <td className="p-3 font-mono text-xs">{f.numero_factura}</td>
                      <td className="p-3">{f.cliente}</td>
                      <td className="text-right p-3 tabular-nums">{f.base_imponible.toFixed(2)}</td>
                      <td className="text-right p-3 tabular-nums">{f.iva.toFixed(2)}</td>
                      <td className="text-right p-3 tabular-nums font-semibold">{f.total.toFixed(2)}</td>
                    </tr>
                  ))}
                  {ventas.filas.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-neutral-400 py-4 text-center">
                        Sin ventas facturadas en este periodo.
                      </td>
                    </tr>
                  )}
                </tbody>
                {ventas.filas.length > 0 && (
                  <tfoot className="border-t-2 border-neutral-300 font-bold">
                    <tr>
                      <td className="p-3" colSpan={3}>
                        Total
                      </td>
                      <td className="text-right p-3 tabular-nums">{ventas.total_base.toFixed(2)}</td>
                      <td className="text-right p-3 tabular-nums">{ventas.total_iva.toFixed(2)}</td>
                      <td className="text-right p-3 tabular-nums">{ventas.total_general.toFixed(2)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )}

        {tab === 'compras' && compras && (
          <div className="bg-white rounded-2xl border border-neutral-200 overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
                <tr>
                  <th className="text-left p-3">Fecha</th>
                  <th className="text-left p-3">Factura</th>
                  <th className="text-left p-3">Proveedor</th>
                  <th className="text-left p-3">RIF</th>
                  <th className="text-right p-3">Base</th>
                  <th className="text-right p-3">IVA</th>
                  <th className="text-right p-3">Total</th>
                </tr>
              </thead>
              <tbody>
                {compras.filas.map((f) => (
                  <tr key={f.factura_id} className="border-t border-neutral-100">
                    <td className="p-3 whitespace-nowrap">{new Date(f.fecha).toLocaleDateString('es-VE')}</td>
                    <td className="p-3 font-mono text-xs">{f.numero_factura}</td>
                    <td className="p-3">{f.proveedor_nombre}</td>
                    <td className="p-3 text-neutral-500">{f.proveedor_rif || '-'}</td>
                    <td className="text-right p-3 tabular-nums">{f.base_imponible.toFixed(2)}</td>
                    <td className="text-right p-3 tabular-nums">{f.iva.toFixed(2)}</td>
                    <td className="text-right p-3 tabular-nums font-semibold">{f.total.toFixed(2)}</td>
                  </tr>
                ))}
                {compras.filas.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-neutral-400 py-4 text-center">
                      Sin facturas de compra en este periodo.
                    </td>
                  </tr>
                )}
              </tbody>
              {compras.filas.length > 0 && (
                <tfoot className="border-t-2 border-neutral-300 font-bold">
                  <tr>
                    <td className="p-3" colSpan={4}>
                      Total
                    </td>
                    <td className="text-right p-3 tabular-nums">{compras.total_base.toFixed(2)}</td>
                    <td className="text-right p-3 tabular-nums">{compras.total_iva.toFixed(2)}</td>
                    <td className="text-right p-3 tabular-nums">{compras.total_general.toFixed(2)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {tab === 'declaraciones' && <Declaraciones />}
      </div>
    </div>
  )
}

/**
 * Declaraciones mensuales de IVA.
 *
 * Antes las dos cuentas de IVA solo crecian: nunca se neteaban ni se saldaban,
 * asi que el balance mostraba como deuda todo el debito acumulado desde
 * siempre. Declarar un mes lo cierra contra el credito fiscal y deja la
 * diferencia como deuda real hasta que se paga.
 */
function Declaraciones() {
  const [declaraciones, setDeclaraciones] = useState<DeclaracionIva[]>([])
  const [pendientes, setPendientes] = useState<PeriodoPendiente[]>([])
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    cargar()
  }, [])

  function cargar() {
    api.listarDeclaraciones().then(setDeclaraciones).catch(() => setDeclaraciones([]))
    api.periodosPendientes().then(setPendientes).catch(() => setPendientes([]))
  }

  async function accion(fn: () => Promise<unknown>) {
    setError('')
    setOcupado(true)
    try {
      await fn()
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ocurrio un error')
    } finally {
      setOcupado(false)
    }
  }

  function declarar(p: PeriodoPendiente) {
    const neto = p.iva_debito - p.iva_credito
    const resumen =
      neto > 0
        ? `Quedaria por pagar hasta $${neto.toFixed(2)} (menos el credito que venga arrastrado).`
        : `El credito fiscal cubre el debito: no se paga nada y sobran $${Math.abs(neto).toFixed(2)} para el mes siguiente.`
    if (!window.confirm(`Declarar ${p.etiqueta}?\n\nIVA cobrado en ventas: $${p.iva_debito.toFixed(2)}\nIVA pagado en compras: $${p.iva_credito.toFixed(2)}\n\n${resumen}`))
      return
    accion(() => api.declararIva(p.anio, p.mes))
  }

  function pagar(d: DeclaracionIva) {
    const forma = window.confirm(
      `Pagar $${d.iva_a_pagar.toFixed(2)} de IVA de ${d.etiqueta}.\n\nAceptar = por banco · Cancelar = en efectivo`,
    )
      ? 'Banco'
      : 'Efectivo'
    accion(() => api.pagarDeclaracion(d.id, forma))
  }

  const porPagar = declaraciones.filter((d) => !d.pagada && d.iva_a_pagar > 0)
  const ultima = declaraciones[0]

  return (
    <div className="space-y-4">
      {error && <p className="text-red-600 text-sm">{error}</p>}

      {pendientes.length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-300 p-4">
          <h2 className="font-semibold mb-1">Meses cerrados sin declarar</h2>
          <p className="text-xs text-neutral-500 mb-3">
            Solo aparecen meses que ya terminaron: el mes en curso todavia puede recibir ventas.
          </p>
          <div className="space-y-2">
            {pendientes.map((p) => (
              <div
                key={`${p.anio}-${p.mes}`}
                className="flex flex-wrap items-center gap-3 bg-amber-50 rounded-lg p-2 text-sm"
              >
                <span className="font-medium flex-1 min-w-[120px]">{p.etiqueta}</span>
                <span className="text-neutral-600 tabular-nums text-xs">
                  debito ${p.iva_debito.toFixed(2)} · credito ${p.iva_credito.toFixed(2)}
                </span>
                <button
                  onClick={() => declarar(p)}
                  disabled={ocupado}
                  className="bg-neutral-900 text-white rounded-lg px-3 py-1 text-xs font-medium disabled:opacity-50"
                >
                  Declarar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {ultima && ultima.credito_excedente > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-sm text-emerald-800">
          Tienes ${ultima.credito_excedente.toFixed(2)} de credito fiscal a favor de{' '}
          {ultima.etiqueta}: se descuentan del IVA del mes siguiente.
        </div>
      )}

      <div className="bg-white rounded-2xl border border-neutral-200 p-4">
        <div className="flex flex-wrap justify-between gap-2 mb-3">
          <h2 className="font-semibold">Declaraciones presentadas</h2>
          {porPagar.length > 0 && (
            <span className="text-sm text-red-600 font-medium">
              {porPagar.length} sin pagar por $
              {porPagar.reduce((s, d) => s + d.iva_a_pagar, 0).toFixed(2)}
            </span>
          )}
        </div>

        {declaraciones.length === 0 && (
          <p className="text-sm text-neutral-400">
            Sin declaraciones todavia. Se declara cada mes una vez cerrado.
          </p>
        )}

        <div className="space-y-2">
          {declaraciones.map((d) => (
            <div key={d.id} className="border border-neutral-200 rounded-xl p-3 text-sm">
              <div className="flex flex-wrap justify-between items-baseline gap-2 mb-1">
                <span className="font-medium">{d.etiqueta}</span>
                {d.iva_a_pagar > 0 ? (
                  d.pagada ? (
                    <span className="text-xs text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5 font-medium">
                      pagada · {d.forma_pago}
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <span className="font-semibold tabular-nums text-red-600">
                        ${d.iva_a_pagar.toFixed(2)}
                      </span>
                      <button
                        onClick={() => pagar(d)}
                        disabled={ocupado}
                        className="bg-neutral-900 text-white rounded-lg px-3 py-1 text-xs font-medium disabled:opacity-50"
                      >
                        Registrar pago
                      </button>
                    </span>
                  )
                ) : (
                  <span className="text-xs text-neutral-500">sin IVA por pagar</span>
                )}
              </div>
              <div className="text-xs text-neutral-500 tabular-nums">
                debito ${d.iva_debito.toFixed(2)} · credito ${d.iva_credito.toFixed(2)}
                {d.credito_arrastrado > 0 && ` (+ $${d.credito_arrastrado.toFixed(2)} arrastrado)`}
                {d.credito_excedente > 0 && ` · sobran $${d.credito_excedente.toFixed(2)}`}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Kpi({ titulo, valor, destacado = false }: { titulo: string; valor: number; destacado?: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4">
      <div className="text-xs text-neutral-500">{titulo}</div>
      <div className={`font-bold tabular-nums ${destacado ? 'text-2xl' : 'text-xl'}`}>
        ${valor.toFixed(2)}
      </div>
    </div>
  )
}
