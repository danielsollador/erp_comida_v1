import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import { api } from '../lib/api'
import type { ConfiguracionFiscal, LibroCompras, LibroVentas, Periodo, ResumenIva } from '../lib/types'

const PERIODOS: { valor: Periodo; texto: string }[] = [
  { valor: 'dia', texto: 'Hoy' },
  { valor: 'semana', texto: 'Esta semana' },
  { valor: 'mes', texto: 'Este mes' },
]

const TABS = [
  { id: 'ventas', texto: 'Libro de ventas' },
  { id: 'compras', texto: 'Libro de compras' },
] as const

export default function Impuestos() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('ventas')
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [ventas, setVentas] = useState<LibroVentas | null>(null)
  const [compras, setCompras] = useState<LibroCompras | null>(null)
  const [resumen, setResumen] = useState<ResumenIva | null>(null)
  const [fiscal, setFiscal] = useState<ConfiguracionFiscal>({ tasa_iva: 16 })
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
