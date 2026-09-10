import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import { api } from '../lib/api'
import type { Ingrediente, SugerenciaCompra } from '../lib/types'

export default function Inventario() {
  const [ingredientes, setIngredientes] = useState<Ingrediente[]>([])
  const [sugerencias, setSugerencias] = useState<SugerenciaCompra[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    cargar()
  }, [])

  function cargar() {
    api.listarIngredientes().then(setIngredientes)
    api.sugerenciasCompra().then(setSugerencias)
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
    accion(() =>
      api.registrarCompra(
        ing.id,
        cantidad,
        Number.isFinite(costoTotal as number) ? costoTotal : undefined,
      ),
    )
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
        </p>
      </div>
    </div>
  )
}
