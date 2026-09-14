import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import { api } from '../lib/api'
import { fmtBs, useMoneda } from '../lib/moneda'
import type { Insight, Periodo, ReporteCombos, ReporteResumen } from '../lib/types'

const PERIODOS: { valor: Periodo; texto: string }[] = [
  { valor: 'dia', texto: 'Hoy' },
  { valor: 'semana', texto: 'Esta semana' },
  { valor: 'mes', texto: 'Este mes' },
]

const ESTILO_INSIGHT: Record<Insight['tipo'], { caja: string; icono: string }> = {
  bueno: { caja: 'bg-emerald-50 border-emerald-200 text-emerald-900', icono: '✓' },
  alerta: { caja: 'bg-amber-50 border-amber-200 text-amber-900', icono: '!' },
  info: { caja: 'bg-sky-50 border-sky-200 text-sky-900', icono: 'i' },
}

export default function Reportes() {
  const [periodo, setPeriodo] = useState<Periodo>('dia')
  const [datos, setDatos] = useState<ReporteResumen | null>(null)
  const [combos, setCombos] = useState<ReporteCombos | null>(null)
  const [cargando, setCargando] = useState(true)
  const { fmt } = useMoneda()

  useEffect(() => {
    setCargando(true)
    api.reporte(periodo).then((r) => {
      setDatos(r)
      setCargando(false)
    })
    api.reporteCombos(periodo).then(setCombos).catch(() => setCombos(null))
  }, [periodo])

  const maxVenta = datos ? Math.max(...datos.serie.map((s) => s.ventas), 0) : 0

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Reportes" />

      <div className="sticky top-[57px] z-10 bg-neutral-50/95 backdrop-blur border-b border-neutral-200 px-4 py-2 flex gap-2">
        {PERIODOS.map((p) => (
          <button
            key={p.valor}
            onClick={() => setPeriodo(p.valor)}
            className={`px-4 py-2 rounded-full text-sm font-semibold border transition ${
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
        {cargando && <p className="text-neutral-400 text-sm">Cargando...</p>}

        {datos && !cargando && (
          <>
            <p className="text-sm text-neutral-500">{datos.etiqueta}</p>

            {/* Los bolivares del periodo salen de sumar cada venta a la tasa
                de SU dia. Convertir el total en dolares a la tasa de hoy haria
                que el historico se moviera solo cada vez que sube el dolar. */}
            {datos.ventas_bs > 0 && (
              <p className="text-xs text-neutral-500 -mt-2">
                Equivalen a {fmtBs(datos.ventas_bs)} cobrados, cada venta a la tasa de su dia.
              </p>
            )}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi titulo="Ventas" valor={`$${datos.ventas.toFixed(2)}`} destacado />
              <Kpi
                titulo="Ganancia neta"
                valor={`$${datos.ganancia_neta.toFixed(2)}`}
                tono={datos.ganancia_neta >= 0 ? 'bueno' : 'malo'}
                destacado
              />
              <Kpi titulo="Pedidos" valor={String(datos.pedidos)} />
              {/* La mediana va al lado del promedio a proposito: un solo
                  pedido grande (un catering) mueve el promedio a un numero que
                  no gasta ningun cliente, y el dueno decide sobre eso. */}
              <Kpi
                titulo="Ticket promedio"
                valor={`$${datos.ticket_promedio.toFixed(2)}`}
                nota={
                  Math.abs(datos.ticket_mediano - datos.ticket_promedio) > 0.01
                    ? `el cliente tipico gasto $${datos.ticket_mediano.toFixed(2)}`
                    : undefined
                }
              />
            </div>

            {datos.insights.length > 0 && (
              <div className="space-y-2">
                <h2 className="font-semibold flex items-center gap-2">
                  🤖 Analisis del negocio
                </h2>
                {datos.insights.map((ins, idx) => {
                  const estilo = ESTILO_INSIGHT[ins.tipo]
                  return (
                    <div key={idx} className={`border rounded-xl p-3 flex gap-3 ${estilo.caja}`}>
                      <span className="font-bold shrink-0 w-5 h-5 rounded-full bg-white/70 flex items-center justify-center text-xs">
                        {estilo.icono}
                      </span>
                      <div>
                        <div className="font-semibold text-sm">{ins.titulo}</div>
                        <div className="text-sm opacity-80">{ins.detalle}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="bg-white rounded-2xl border border-neutral-200 p-4">
              <h2 className="font-semibold mb-1">De donde sale la ganancia</h2>
              <p className="text-xs text-neutral-500 mb-3">
                Los mismos numeros del Estado de Resultados en Contabilidad.
              </p>
              <Linea etiqueta="Ventas cobradas" monto={datos.ventas} />
              {datos.iva_cobrado > 0 && (
                <>
                  {/* El IVA entra por caja pero se le debe al SENIAT: contarlo
                      como ingreso inflaba la ganancia mostrada. */}
                  <Linea etiqueta="IVA cobrado (se le debe al SENIAT)" monto={-datos.iva_cobrado} />
                  <Linea etiqueta="Ingreso del negocio" monto={datos.ingresos_netos} subtotal />
                </>
              )}
              <Linea etiqueta="Costo de insumos" monto={-datos.costo_insumos} />
              <Linea
                etiqueta={`Ganancia bruta (${datos.margen_pct.toFixed(0)}% margen)`}
                monto={datos.ganancia_bruta}
                subtotal
              />
              <Linea etiqueta="Gastos, mermas y faltantes" monto={-datos.gastos} />
              <Linea etiqueta="Ganancia neta" monto={datos.ganancia_neta} total />
              {(datos.pedidos_anulados > 0 || datos.devoluciones > 0) && (
                <p className="text-xs text-amber-700 mt-3 bg-amber-50 rounded-lg px-3 py-2">
                  {datos.pedidos_anulados > 0 && (
                    <>
                      Se anularon {datos.pedidos_anulados} pedido(s) por $
                      {datos.valor_anulado.toFixed(2)} que no llegaron a venderse.
                    </>
                  )}
                  {datos.devoluciones > 0 && (
                    <>
                      {datos.pedidos_anulados > 0 && ' '}
                      {datos.devoluciones} venta(s) por ${datos.valor_devuelto.toFixed(2)} fueron
                      devueltas por el cliente y ya no cuentan arriba.
                    </>
                  )}
                </p>
              )}
            </div>

            {datos.serie.length > 0 && (
              <div className="bg-white rounded-2xl border border-neutral-200 p-4">
                <h2 className="font-semibold mb-4">
                  Ventas por {datos.periodo === 'dia' ? 'hora' : 'dia'}
                </h2>
                <div className="flex items-end gap-1.5 h-40 overflow-x-auto">
                  {datos.serie.map((punto) => {
                    const alturaPct = maxVenta > 0 ? (punto.ventas / maxVenta) * 100 : 0
                    return (
                      <div
                        key={punto.etiqueta}
                        className="flex-1 min-w-[28px] flex flex-col items-center justify-end h-full gap-1"
                        title={`${punto.etiqueta}: $${punto.ventas.toFixed(2)} en ${punto.pedidos} pedidos`}
                      >
                        <span className="text-[10px] text-neutral-500 tabular-nums">
                          {punto.ventas > 0 ? `$${punto.ventas.toFixed(0)}` : ''}
                        </span>
                        <div
                          className="w-full bg-neutral-900 rounded-t-md min-h-[2px]"
                          style={{ height: `${alturaPct}%` }}
                        />
                        <span className="text-[10px] text-neutral-500 whitespace-nowrap">
                          {punto.etiqueta}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {datos.top_productos.length > 0 && (
              <div className="bg-white rounded-2xl border border-neutral-200 p-4 overflow-x-auto">
                <h2 className="font-semibold mb-3">Que se vendio</h2>
                <table className="w-full text-sm min-w-[420px]">
                  <thead className="text-neutral-500 text-xs uppercase">
                    <tr>
                      <th className="text-left py-2">Producto</th>
                      <th className="text-right py-2">Uds</th>
                      <th className="text-right py-2">Ingresos</th>
                      <th className="text-right py-2">Ganancia</th>
                      <th className="text-right py-2">Margen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.top_productos.map((p) => (
                      <tr key={p.nombre} className="border-t border-neutral-100">
                        <td className="py-2 font-medium">
                          {p.nombre}
                          {p.sin_receta && (
                            <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 rounded px-1.5 py-0.5">
                              sin receta
                            </span>
                          )}
                        </td>
                        <td className="text-right py-2 tabular-nums">{p.unidades}</td>
                        <td className="text-right py-2 tabular-nums">${p.ingresos.toFixed(2)}</td>
                        {/* Sin receta no hay costo, asi que la ganancia seria
                            todo el ingreso y el margen 100%: mostrarlos como
                            numeros validos hacia pasar por producto estrella
                            justo al que no se sabe cuanto cuesta. */}
                        <td className="text-right py-2 tabular-nums">
                          {p.sin_receta ? (
                            <span className="text-neutral-400">—</span>
                          ) : (
                            `$${p.ganancia.toFixed(2)}`
                          )}
                        </td>
                        <td
                          className={`text-right py-2 tabular-nums font-semibold ${
                            p.sin_receta
                              ? 'text-neutral-400'
                              : p.margen_pct >= 50
                                ? 'text-emerald-600'
                                : p.margen_pct >= 30
                                  ? 'text-amber-600'
                                  : 'text-red-600'
                          }`}
                        >
                          {p.sin_receta ? '?' : `${p.margen_pct.toFixed(0)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-white rounded-2xl border border-neutral-200 p-4">
                <h2 className="font-semibold mb-2">Como te pagaron</h2>
                {Object.entries(datos.por_metodo_pago).map(([metodo, monto]) => (
                  <div key={metodo} className="flex justify-between text-sm py-1">
                    <span className="text-neutral-600">{metodo}</span>
                    <span className="font-medium tabular-nums">${monto.toFixed(2)}</span>
                  </div>
                ))}
                {Object.keys(datos.por_metodo_pago).length === 0 && (
                  <p className="text-neutral-400 text-sm">Sin cobros en el periodo.</p>
                )}
              </div>
              <div className="bg-white rounded-2xl border border-neutral-200 p-4">
                <h2 className="font-semibold mb-2">Pedidos anulados</h2>
                <p className="text-3xl font-bold tabular-nums">{datos.pedidos_anulados}</p>
                <p className="text-xs text-neutral-500 mt-1">
                  Si este numero crece, revisa que esta fallando al tomar los pedidos.
                </p>
              </div>
            </div>

            <SeccionCombos combos={combos} fmt={fmt} />
          </>
        )}
      </div>
    </div>
  )
}

function Kpi({
  titulo,
  valor,
  destacado = false,
  tono,
  nota,
}: {
  titulo: string
  valor: string
  destacado?: boolean
  tono?: 'bueno' | 'malo'
  /** Aclaracion bajo el numero, cuando el numero solo puede enganar. */
  nota?: string
}) {
  const color = tono === 'malo' ? 'text-red-600' : tono === 'bueno' ? 'text-emerald-600' : ''
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4">
      <div className="text-xs text-neutral-500">{titulo}</div>
      <div className={`font-bold tabular-nums ${destacado ? 'text-2xl' : 'text-xl'} ${color}`}>
        {valor}
      </div>
      {nota && <div className="mt-0.5 text-[11px] leading-snug text-amber-700">{nota}</div>}
    </div>
  )
}

function Linea({
  etiqueta,
  monto,
  subtotal = false,
  total = false,
}: {
  etiqueta: string
  monto: number
  subtotal?: boolean
  total?: boolean
}) {
  return (
    <div
      className={`flex justify-between py-1.5 ${
        subtotal || total ? 'border-t border-neutral-200 mt-1 pt-2' : ''
      } ${total ? 'font-bold text-base' : subtotal ? 'font-semibold' : 'text-sm'}`}
    >
      <span className={monto < 0 ? 'text-neutral-600' : ''}>{etiqueta}</span>
      <span
        className={`tabular-nums ${
          total && monto < 0 ? 'text-red-600' : monto < 0 ? 'text-neutral-600' : ''
        }`}
      >
        {monto < 0 ? '-' : ''}${Math.abs(monto).toFixed(2)}
      </span>
    </div>
  )
}


function SeccionCombos({
  combos,
  fmt,
}: {
  combos: ReporteCombos | null
  fmt: (usd: number | null | undefined, decimales?: number) => string
}) {
  if (!combos) return null

  if (!combos.suficientes_datos) {
    return (
      <div className="bg-white rounded-2xl border border-neutral-200 p-4">
        <h2 className="font-semibold mb-1">Que se vende junto</h2>
        <p className="text-sm text-neutral-500">
          Llevas {combos.pedidos_analizados} pedido(s) cobrados en este periodo. Con unos cuantos
          mas el sistema puede decirte que productos salen juntos y que ofrecer en caja.
        </p>
      </div>
    )
  }

  const acomp = combos.acompanamiento
  const oport = combos.oportunidad

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border border-neutral-200 p-4">
        <h2 className="font-semibold mb-1">Que se vende junto</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Sobre {combos.pedidos_analizados} pedidos cobrados. La confianza es: de cada 100 pedidos
          con el primer producto, cuantos llevaron tambien el segundo.
        </p>

        {combos.pares.length > 0 ? (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-sm min-w-[26rem]">
              <thead className="text-neutral-500 text-xs uppercase">
                <tr>
                  <th className="text-left pb-2">Combinacion</th>
                  <th className="text-right pb-2">Veces</th>
                  <th className="text-right pb-2">Confianza</th>
                </tr>
              </thead>
              <tbody>
                {combos.pares.map((par) => (
                  <tr key={`${par.producto}-${par.acompanante}`} className="border-t border-neutral-100">
                    <td className="py-2">
                      <span className="font-medium">{par.producto}</span>
                      <span className="text-neutral-400"> + </span>
                      <span className="font-medium">{par.acompanante}</span>
                    </td>
                    <td className="text-right py-2 tabular-nums text-neutral-500">{par.juntos}</td>
                    <td className="text-right py-2 tabular-nums font-medium">
                      {par.confianza_pct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-neutral-400 text-sm">
            Todavia no hay un par que se repita lo suficiente como para llamarlo patron.
          </p>
        )}
      </div>

      {acomp && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-4">
          <h2 className="font-semibold mb-3">Cuantos se van sin bebida</h2>
          <div className="flex h-3 rounded-full overflow-hidden bg-neutral-100 mb-2">
            <div
              className="bg-emerald-500"
              style={{ width: `${acomp.con_bebida_pct}%` }}
              title={`${acomp.con_bebida_pct}% con bebida`}
            />
            <div
              className="bg-amber-400"
              style={{ width: `${acomp.sin_bebida_pct}%` }}
              title={`${acomp.sin_bebida_pct}% sin bebida`}
            />
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-emerald-700 font-medium tabular-nums">
              {acomp.con_bebida_pct}% con bebida
            </span>
            <span className="text-amber-700 font-medium tabular-nums">
              {acomp.sin_bebida_pct}% sin bebida
            </span>
          </div>

          {oport && (
            <div className="mt-3 pt-3 border-t border-neutral-100">
              <p className="text-sm text-neutral-700">
                <span className="font-semibold">{oport.pedidos_sin_bebida} pedidos</span> salieron
                sin nada de tomar. Si el cajero lograra convencer a{' '}
                {oport.conversion_supuesta_pct} de cada 100, serian{' '}
                <span className="font-semibold text-emerald-700">
                  {fmt(oport.venta_potencial)}
                </span>{' '}
                mas de venta y {fmt(oport.ganancia_potencial)} de ganancia en este periodo.
              </p>
              <p className="text-xs text-neutral-400 mt-1">
                El punto de venta ya sugiere la bebida sola mientras se arma la comanda.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
