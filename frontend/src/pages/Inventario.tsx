import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Ingrediente, SugerenciaCompra } from '../lib/types'

export default function Inventario() {
  const [ingredientes, setIngredientes] = useState<Ingrediente[]>([])
  const [sugerencias, setSugerencias] = useState<SugerenciaCompra[]>([])

  useEffect(() => {
    cargar()
  }, [])

  function cargar() {
    api.listarIngredientes().then(setIngredientes)
    api.sugerenciasCompra().then(setSugerencias)
  }

  async function comprar(ingrediente: Ingrediente) {
    const texto = window.prompt(
      `Cuanto vas a comprar de ${ingrediente.nombre} (${ingrediente.unidad})?`,
    )
    if (!texto) return
    const cantidad = Number(texto)
    if (!Number.isFinite(cantidad) || cantidad <= 0) return
    await api.registrarCompra(ingrediente.id, cantidad)
    cargar()
  }

  return (
    <div className="min-h-screen bg-neutral-100 p-4 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Inventario de insumos</h1>

      <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 mb-6">
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
              className="bg-white rounded-xl p-3 flex justify-between items-center"
            >
              <div>
                <div className="font-medium">{s.ingrediente_nombre}</div>
                <div className="text-sm text-neutral-500">{s.razon}</div>
              </div>
              <div className="text-right">
                <div className="font-semibold">
                  +{s.cantidad_sugerida} {s.unidad}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <h2 className="font-semibold mb-2">Stock actual</h2>
      <div className="bg-white rounded-2xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-neutral-500">
            <tr>
              <th className="text-left p-3">Insumo</th>
              <th className="text-right p-3">Stock</th>
              <th className="text-right p-3">Minimo</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {ingredientes.map((ing) => (
              <tr key={ing.id} className="border-t border-neutral-100">
                <td className="p-3">{ing.nombre}</td>
                <td
                  className={`text-right p-3 ${
                    ing.stock_actual <= ing.stock_minimo ? 'text-red-600 font-semibold' : ''
                  }`}
                >
                  {ing.stock_actual} {ing.unidad}
                </td>
                <td className="text-right p-3 text-neutral-500">
                  {ing.stock_minimo} {ing.unidad}
                </td>
                <td className="text-right p-3">
                  <button
                    onClick={() => comprar(ing)}
                    className="text-blue-600 text-sm font-medium"
                  >
                    Registrar compra
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
