import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import { api, connectWs } from '../lib/api'
import type { Pedido } from '../lib/types'

function minutosDesde(iso: string): number {
  // El backend guarda hora local del local comercial, sin zona horaria.
  // Un string ISO sin offset se parsea como hora local, que es justo lo que
  // queremos; solo hay que recortar los microsegundos que JS no entiende.
  const limpio = iso.replace(/(\.\d{3})\d+$/, '$1')
  const fecha = new Date(limpio)
  if (Number.isNaN(fecha.getTime())) return 0
  return Math.max(0, Math.floor((Date.now() - fecha.getTime()) / 60000))
}

function estiloAntiguedad(minutos: number) {
  if (minutos >= 12) return { badge: 'bg-red-500/20 text-red-300 ring-1 ring-red-500/40', card: 'ring-2 ring-red-500/50' }
  if (minutos >= 6) return { badge: 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40', card: 'ring-1 ring-amber-500/30' }
  return { badge: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30', card: '' }
}

export default function Cocina() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [, setTick] = useState(0)

  useEffect(() => {
    refrescar()
    const disconnect = connectWs(() => refrescar())
    const interval = setInterval(() => setTick((t) => t + 1), 30000)
    return () => {
      disconnect()
      clearInterval(interval)
    }
  }, [])

  function refrescar() {
    api.listarPedidos('pendiente').then((ps) => setPedidos(ps.sort((a, b) => a.numero - b.numero)))
  }

  async function toggleItem(itemId: number) {
    await api.marcarItemPreparado(itemId)
    refrescar()
  }

  async function marcarTodoListo(pedidoId: number) {
    await api.marcarPedidoListo(pedidoId)
    refrescar()
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <NavBar titulo="Cocina" dark />
      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {pedidos.map((pedido) => {
          const minutos = minutosDesde(pedido.creado_en)
          const estilo = estiloAntiguedad(minutos)
          return (
            <div
              key={pedido.id}
              className={`bg-neutral-900 rounded-2xl p-5 border border-neutral-800 ${estilo.card}`}
            >
              <div className="flex justify-between items-center mb-4">
                <span className="text-2xl font-black tracking-tight tabular-nums">
                  #{pedido.numero}
                </span>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full tabular-nums ${estilo.badge}`}>
                  {minutos} min
                </span>
              </div>
              <ul className="space-y-2 mb-4">
                {pedido.items.map((item) => (
                  <li key={item.id}>
                    <button
                      onClick={() => toggleItem(item.id)}
                      className={`w-full text-left px-3 py-2.5 rounded-xl flex justify-between items-center border ${
                        item.preparado
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-neutral-500 line-through'
                          : 'bg-neutral-800 border-neutral-700'
                      }`}
                    >
                      <span className="font-medium">
                        <span className="tabular-nums">{item.cantidad}x</span> {item.nombre}
                      </span>
                      <span
                        className={`w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0 ${
                          item.preparado ? 'bg-emerald-500 text-neutral-950' : 'bg-neutral-700'
                        }`}
                      >
                        {item.preparado ? '✓' : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => marcarTodoListo(pedido.id)}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-xl font-semibold text-sm"
              >
                Marcar todo listo
              </button>
            </div>
          )
        })}
        {pedidos.length === 0 && (
          <p className="text-neutral-600 col-span-full text-center py-24 text-lg font-medium">
            No hay pedidos pendientes.
          </p>
        )}
      </div>
    </div>
  )
}
