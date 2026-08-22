import { useEffect, useState } from 'react'
import { api, connectWs } from '../lib/api'
import type { Pedido } from '../lib/types'

export default function Cocina() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])

  useEffect(() => {
    refrescar()
    const disconnect = connectWs(() => refrescar())
    return disconnect
  }, [])

  function refrescar() {
    api.listarPedidos('pendiente').then((ps) => setPedidos(ps.sort((a, b) => a.numero - b.numero)))
  }

  async function toggleItem(itemId: number) {
    await api.marcarItemPreparado(itemId)
    refrescar()
  }

  return (
    <div className="min-h-screen bg-neutral-900 text-white p-6">
      <h1 className="text-3xl font-semibold mb-6">Cocina</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {pedidos.map((pedido) => (
          <div key={pedido.id} className="bg-neutral-800 rounded-2xl p-5">
            <div className="text-xl font-bold mb-3">Pedido #{pedido.numero}</div>
            <ul className="space-y-2">
              {pedido.items.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => toggleItem(item.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg flex justify-between items-center ${
                      item.preparado ? 'bg-green-700/40 line-through text-neutral-400' : 'bg-neutral-700'
                    }`}
                  >
                    <span>
                      {item.cantidad}x {item.nombre}
                    </span>
                    <span>{item.preparado ? '✓' : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {pedidos.length === 0 && (
          <p className="text-neutral-500 col-span-full text-center py-20 text-lg">
            No hay pedidos pendientes.
          </p>
        )}
      </div>
    </div>
  )
}
