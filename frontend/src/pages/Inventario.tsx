import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import { api } from '../lib/api'
import type {
  CompraDeInsumo,
  ImpactoDeCompra,
  InflacionInsumos,
  Ingrediente,
  Merma,
  SugerenciaCompra,
} from '../lib/types'

export default function Inventario() {
  const [ingredientes, setIngredientes] = useState<Ingrediente[]>([])
  const [sugerencias, setSugerencias] = useState<SugerenciaCompra[]>([])
  const [mermas, setMermas] = useState<Merma[]>([])
  const [inflacion, setInflacion] = useState<InflacionInsumos | null>(null)
  // Lo que hay que ponerle delante al dueno cuando un insumo pega un salto.
  const [impacto, setImpacto] = useState<ImpactoDeCompra | null>(null)
  const [historial, setHistorial] = useState<{ ing: Ingrediente; compras: CompraDeInsumo[] } | null>(
    null,
  )
  const [error, setError] = useState('')

  useEffect(() => {
    cargar()
  }, [])

  function cargar() {
    api.listarIngredientes().then(setIngredientes)
    api.sugerenciasCompra().then(setSugerencias)
    api.listarMermas().then(setMermas)
    api.inflacionInsumos().then(setInflacion).catch(() => setInflacion(null))
  }

  async function verHistorial(ing: Ingrediente) {
    setError('')
    try {
      setHistorial({ ing, compras: await api.historialCostos(ing.id) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ocurrio un error')
    }
  }

  async function revertirMerma(m: Merma) {
    const texto =
      `Revertir esta merma? Vuelven ${m.cantidad.toFixed(3)} ${m.unidad} de ` +
      `${m.ingrediente_nombre} al inventario.\n\n` +
      'La merma original no se borra: queda marcada como revertida con su asiento de reverso.'
    if (!window.confirm(texto)) return
    accion(() => api.revertirMerma(m.id))
  }

  async function accion(fn: () => Promise<unknown>) {
    setError('')
    try {
      await fn()
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ocurrio un error')
    }
  }

  function comprar(ing: Ingrediente) {
    const texto = window.prompt(`Cuanto vas a comprar de ${ing.nombre} (${ing.unidad})?`)
    if (!texto) return
    const cantidad = Number(texto)
    if (!Number.isFinite(cantidad) || cantidad <= 0) return

    const textoCosto = window.prompt(
      `Cuanto pagaste en total por esos ${cantidad} ${ing.unidad}, SIN IVA? ` +
        `(deja vacio si no quieres actualizar el costo - el IVA no cuenta aqui, ya que no es parte ` +
        `del costo real del insumo)`,
    )
    const costoTotal = textoCosto ? Number(textoCosto) : undefined
    accion(async () => {
      const resultado = await api.registrarCompra(
        ing.id,
        cantidad,
        Number.isFinite(costoTotal as number) ? costoTotal : undefined,
      )
      // Si el proveedor pego un salto, se dice AHORA. El costo promedio tarda
      // semanas en reflejarlo, y para entonces ya vendiste con el margen viejo
      // en pantalla y el nuevo en la realidad.
      if (resultado.revisar_precios) setImpacto(resultado)
    })
  }

  function merma(ing: Ingrediente) {
    const texto = window.prompt(`Cuanto se perdio de ${ing.nombre} (${ing.unidad})?`)
    if (!texto) return
    const cantidad = Number(texto)
    if (!Number.isFinite(cantidad) || cantidad <= 0) return
    const motivo = window.prompt('Motivo (se quemo, se daño, se cayo...)') ?? ''
    accion(() => api.registrarMerma(ing.id, cantidad, motivo))
  }

  function ajustar(ing: Ingrediente) {
    const texto = window.prompt(
      `Conteo fisico de ${ing.nombre}: cuanto hay realmente? (${ing.unidad})`,
      String(ing.stock_actual),
    )
    if (texto === null) return
    const real = Number(texto)
    if (!Number.isFinite(real) || real < 0) return
    accion(() => api.ajustarStock(ing.id, real))
  }

  function cambiarCosto(ing: Ingrediente) {
    const texto = window.prompt(
      `Cuanto te cuesta 1 ${ing.unidad} de ${ing.nombre} (sin IVA)?`,
      String(ing.costo_unitario),
    )
    if (texto === null) return
    const costo = Number(texto)
    if (!Number.isFinite(costo) || costo < 0) return
    accion(() => api.actualizarIngrediente(ing.id, { ...ing, costo_unitario: costo }))
  }

  function cambiarRendimiento(ing: Ingrediente) {
    const texto = window.prompt(
      `De cada ${ing.unidad} de ${ing.nombre} que compras, que % te queda utilizable ` +
        `despues de limpiar/cocinar? (100 = no se pierde nada)`,
      String(ing.rendimiento_pct),
    )
    if (texto === null) return
    const pct = Number(texto)
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return
    accion(() => api.actualizarIngrediente(ing.id, { ...ing, rendimiento_pct: pct }))
  }

  const sinCosto = ingredientes.filter((i) => !i.costo_unitario)

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Inventario de insumos" />
      <div className="p-4 max-w-4xl mx-auto space-y-5">
        {error && (
          <p className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
            {error}
          </p>
        )}

        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4">
          <h2 className="font-semibold text-indigo-900 mb-2">🤖 Asistente de compras</h2>
          {sugerencias.length === 0 && (
            <p className="text-sm text-indigo-700">
              Todo el inventario esta por encima del minimo. Nada que comprar por ahora.
            </p>
          )}
          <ul className="space-y-2">
            {sugerencias.map((s) => (
              <li
                key={s.ingrediente_id}
                className="bg-white rounded-xl p-3 flex justify-between items-center gap-3"
              >
                <div>
                  <div className="font-medium">{s.ingrediente_nombre}</div>
                  <div className="text-sm text-neutral-500">{s.razon}</div>
                </div>
                <div className="font-semibold whitespace-nowrap">
                  +{s.cantidad_sugerida} {s.unidad}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* El numero que dice si tus precios se estan quedando atras. El costo
            promedio no lo muestra: mezcla lo caro nuevo con lo barato viejo. */}
        {inflacion && inflacion.cambio_pct >= 15 && (
          <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4">
            <h2 className="font-semibold text-orange-900">
              Tus insumos subieron {inflacion.cambio_pct.toFixed(0)}% en {inflacion.dias} dias
            </h2>
            <ul className="mt-2 space-y-1 text-sm text-orange-900">
              {inflacion.insumos.slice(0, 5).map((i) => (
                <li key={i.ingrediente_id} className="flex justify-between gap-3">
                  <span>{i.nombre}</span>
                  <span className="tabular-nums whitespace-nowrap">
                    ${i.costo_inicial.toFixed(2)} → ${i.costo_actual.toFixed(2)}{' '}
                    <b>+{i.cambio_pct.toFixed(0)}%</b>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-orange-700 mt-2">
              Si tus precios no subieron parecido, cada venta te deja menos de lo que necesitas
              para reponer. En Menu esta el precio sugerido de cada producto.
            </p>
          </div>
        )}

        {sinCosto.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900">
            <span className="font-semibold">
              {sinCosto.length} insumo(s) sin costo cargado.
            </span>{' '}
            Sin eso los reportes no pueden calcular tu ganancia real. Toca el costo en la tabla para
            cargarlo.
          </div>
        )}

        <div className="bg-white rounded-2xl border border-neutral-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
              <tr>
                <th className="text-left p-3">Insumo</th>
                <th className="text-right p-3">Stock</th>
                <th className="text-right p-3">Minimo</th>
                <th className="text-right p-3">Costo compra</th>
                {/* El promedio ponderado no dice cuanto cuesta comprar mas: esa
                    es la cuenta que importa para poner precios. */}
                <th className="text-right p-3">Reponer</th>
                <th className="text-right p-3">Rendimiento</th>
                <th className="text-right p-3">Costo real</th>
                <th className="p-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {ingredientes.map((ing) => (
                <tr key={ing.id} className="border-t border-neutral-100">
                  <td className="p-3 font-medium">{ing.nombre}</td>
                  <td
                    className={`text-right p-3 tabular-nums ${
                      ing.stock_actual <= ing.stock_minimo ? 'text-red-600 font-semibold' : ''
                    }`}
                  >
                    {Number(ing.stock_actual.toFixed(3))} {ing.unidad}
                  </td>
                  <td className="text-right p-3 text-neutral-500 tabular-nums">
                    {ing.stock_minimo} {ing.unidad}
                  </td>
                  <td className="text-right p-3">
                    <button
                      onClick={() => cambiarCosto(ing)}
                      className={`tabular-nums ${
                        ing.costo_unitario ? 'text-neutral-700' : 'text-amber-600 font-semibold'
                      }`}
                    >
                      {ing.costo_unitario ? `$${ing.costo_unitario.toFixed(2)}` : 'cargar'}
                    </button>
                  </td>
                  <td className="text-right p-3">
                    {ing.costo_reposicion != null ? (
                      <button
                        onClick={() => verHistorial(ing)}
                        className="tabular-nums"
                        title="Ultimo precio pagado. Toca para ver como ha cambiado."
                      >
                        <span
                          className={
                            ing.variacion_pct != null && ing.variacion_pct >= 15
                              ? 'text-orange-600 font-semibold'
                              : 'text-neutral-700'
                          }
                        >
                          ${ing.costo_reposicion.toFixed(2)}
                        </span>
                        {ing.variacion_pct != null && ing.variacion_pct >= 15 && (
                          <span className="block text-[11px] text-orange-600">
                            +{ing.variacion_pct.toFixed(0)}%
                          </span>
                        )}
                      </button>
                    ) : (
                      <span className="text-neutral-300">—</span>
                    )}
                  </td>
                  <td className="text-right p-3">
                    <button
                      onClick={() => cambiarRendimiento(ing)}
                      className={`tabular-nums ${
                        ing.rendimiento_pct < 100 ? 'text-amber-600 font-medium' : 'text-neutral-400'
                      }`}
                      title="% utilizable despues de preparar (limpiar, pelar, cocinar)"
                    >
                      {ing.rendimiento_pct}%
                    </button>
                  </td>
                  <td className="text-right p-3 tabular-nums font-semibold">
                    ${ing.costo_efectivo.toFixed(2)}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-2 justify-end whitespace-nowrap">
                      <button onClick={() => comprar(ing)} className="text-blue-600 font-medium">
                        Compra
                      </button>
                      <button onClick={() => merma(ing)} className="text-red-500 font-medium">
                        Merma
                      </button>
                      <button onClick={() => ajustar(ing)} className="text-neutral-500 font-medium">
                        Contar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Sin esta lista el dueno no podia ver cuanto se perdia ni corregir
            una merma duplicada: era la unica perdida del sistema sin historial. */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-4">
          <div className="flex justify-between items-baseline mb-1">
            <h2 className="font-semibold">Perdidas registradas</h2>
            <span className="text-sm text-neutral-500">
              ultimos 30 dias:{' '}
              <span className="font-semibold text-neutral-800">
                ${mermas.filter((m) => !m.revertida).reduce((s, m) => s + m.valor, 0).toFixed(2)}
              </span>
            </span>
          </div>
          <p className="text-xs text-neutral-500 mb-3">
            Todo lo que se boto, se daño o falto en un conteo. Si registraste una por error,
            revertila: no se borra, queda el reverso asentado.
          </p>
          {mermas.length === 0 && (
            <p className="text-sm text-neutral-400">Sin perdidas registradas. Bien ahi.</p>
          )}
          <div className="space-y-1">
            {mermas.map((m) => (
              <div
                key={m.id}
                className={`flex flex-wrap items-center gap-2 text-sm rounded-lg px-2 py-1.5 ${
                  m.revertida ? 'opacity-50' : 'hover:bg-neutral-50'
                }`}
              >
                <span className="text-xs text-neutral-400 w-20 shrink-0">
                  {new Date(m.fecha).toLocaleDateString('es-VE')}
                </span>
                <span className="flex-1 min-w-[140px]">
                  {m.cantidad.toFixed(3)} {m.unidad} de {m.ingrediente_nombre}
                  {m.motivo && <span className="text-neutral-400"> · {m.motivo}</span>}
                </span>
                <span className="tabular-nums font-medium text-red-600 w-16 text-right">
                  ${m.valor.toFixed(2)}
                </span>
                {m.revertida ? (
                  <span className="text-xs text-neutral-500 w-20 text-right">revertida</span>
                ) : (
                  <button
                    onClick={() => revertirMerma(m)}
                    className="text-xs text-blue-600 font-medium w-20 text-right"
                  >
                    Revertir
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-neutral-500">
          <span className="font-semibold">Compra:</span> entra mercancia.{' '}
          <span className="font-semibold">Merma:</span> se daño o se boto.{' '}
          <span className="font-semibold">Contar:</span> ajusta el sistema a lo que hay de verdad.
          <br />
          <span className="font-semibold">Costo compra:</span> lo que pagas por 1 unidad.{' '}
          <span className="font-semibold">Rendimiento:</span> cuanto de eso queda utilizable despues
          de preparar (100% si no se pierde nada, ej. harina o queso).{' '}
          <span className="font-semibold">Costo real:</span> lo que de verdad cuesta 1 unidad
          utilizable - el numero que usan las recetas y los margenes.
          <br />
          <span className="font-semibold">Reponer:</span> lo que pagaste la ultima vez. Es lo que
          te va a costar comprar mas, y por eso es el numero para poner precios: el costo de
          compra es un promedio que todavia arrastra lo que compraste barato.
        </p>
      </div>

      {/* El aviso llega en el momento de la compra, no cuando el promedio por
          fin se mueva - para entonces ya vendiste semanas al precio viejo. */}
      {impacto && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-lg p-5 max-h-[85vh] overflow-y-auto">
            <h3 className="font-semibold text-lg">
              {impacto.ingrediente.nombre} subio {impacto.salto_pct?.toFixed(0)}%
            </h3>
            <p className="text-sm text-neutral-600 mt-1">
              Pagaste ${impacto.costo_pagado.toFixed(2)} por {impacto.ingrediente.unidad}; la
              compra anterior fue a ${impacto.costo_anterior.toFixed(2)}.
            </p>
            <p className="text-xs text-neutral-500 mt-2">
              El costo promedio quedo en ${impacto.ingrediente.costo_unitario.toFixed(2)} porque
              mezcla lo que ya tenias. Los margenes de abajo son los de verdad: los que te quedan
              si tienes que reponer a este precio.
            </p>

            {impacto.productos.length > 0 ? (
              <div className="mt-4 space-y-2">
                {impacto.productos.map((p) => (
                  <div
                    key={p.variante_id}
                    className={`rounded-xl border p-3 text-sm ${
                      p.a_perdida
                        ? 'bg-red-50 border-red-200'
                        : p.margen_flaco
                          ? 'bg-amber-50 border-amber-200'
                          : 'bg-neutral-50 border-neutral-200'
                    }`}
                  >
                    <div className="flex justify-between gap-2 font-medium">
                      <span>{p.nombre}</span>
                      <span className="tabular-nums whitespace-nowrap">
                        ${p.precio.toFixed(2)}
                      </span>
                    </div>
                    <div className="text-neutral-600 mt-1">
                      margen {p.margen_antes_pct?.toFixed(0)}% →{' '}
                      <b className={p.a_perdida ? 'text-red-700' : ''}>
                        {p.margen_despues_pct?.toFixed(0)}%
                      </b>
                      {p.a_perdida && ' · lo vendes a perdida'}
                    </div>
                    {p.precio_sugerido != null && (
                      <div className="text-neutral-700 mt-1">
                        Para mantener tu margen:{' '}
                        <b className="tabular-nums">${p.precio_sugerido.toFixed(2)}</b>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-neutral-600">
                Ningun producto del menu usa este insumo todavia.
              </p>
            )}

            <button
              onClick={() => setImpacto(null)}
              className="mt-5 w-full bg-neutral-900 text-white rounded-xl py-3 font-medium"
            >
              Entendido
            </button>
          </div>
        </div>
      )}

      {/* La curva de inflacion de cada insumo estaba en las facturas desde el
          primer dia; no habia por donde verla. */}
      {historial && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-md p-5 max-h-[85vh] overflow-y-auto">
            <h3 className="font-semibold text-lg">Costo de {historial.ing.nombre}</h3>
            <p className="text-sm text-neutral-500 mb-3">
              Lo que has pagado por {historial.ing.unidad}, compra por compra.
            </p>
            {historial.compras.length === 0 ? (
              <p className="text-sm text-neutral-500">Todavia no hay compras registradas.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {historial.compras.map((c, i) => {
                    const anterior = historial.compras[i + 1]
                    const cambio = anterior
                      ? (c.costo_unitario / anterior.costo_unitario - 1) * 100
                      : null
                    return (
                      <tr key={`${c.fecha}-${i}`} className="border-t border-neutral-100">
                        <td className="py-2">
                          {new Date(c.fecha).toLocaleDateString('es-VE')}
                          <span className="block text-[11px] text-neutral-400">{c.origen}</span>
                        </td>
                        <td className="py-2 text-right text-neutral-500 tabular-nums">
                          {Number(c.cantidad.toFixed(3))} {historial.ing.unidad}
                        </td>
                        <td className="py-2 text-right tabular-nums font-medium">
                          ${c.costo_unitario.toFixed(2)}
                        </td>
                        <td className="py-2 text-right tabular-nums w-16">
                          {cambio != null && Math.abs(cambio) >= 1 && (
                            <span className={cambio > 0 ? 'text-orange-600' : 'text-emerald-600'}>
                              {cambio > 0 ? '+' : ''}
                              {cambio.toFixed(0)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            <button
              onClick={() => setHistorial(null)}
              className="mt-5 w-full border border-neutral-300 rounded-xl py-3 font-medium"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
