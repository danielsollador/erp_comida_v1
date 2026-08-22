import type { Pedido, PedidoItem, Producto } from './types'

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(detail || `Error ${res.status}`)
  }
  return res.json()
}

export const api = {
  listarProductos: () => req<Producto[]>('/productos'),
  crearProducto: (p: Omit<Producto, 'id'>) =>
    req<Producto>('/productos', { method: 'POST', body: JSON.stringify(p) }),
  actualizarProducto: (id: number, p: Omit<Producto, 'id'>) =>
    req<Producto>(`/productos/${id}`, { method: 'PUT', body: JSON.stringify(p) }),
  eliminarProducto: (id: number) => req(`/productos/${id}`, { method: 'DELETE' }),

  listarPedidos: (estado?: string) =>
    req<Pedido[]>(`/pedidos${estado ? `?estado=${estado}` : ''}`),
  crearPedido: (items: { producto_id: number; cantidad: number; nota?: string }[], nota = '') =>
    req<Pedido>('/pedidos', { method: 'POST', body: JSON.stringify({ items, nota }) }),
  marcarItemPreparado: (itemId: number) =>
    req<Pedido>(`/pedidos/items/${itemId}/preparado`, { method: 'POST' }),
  cobrarPedido: (pedidoId: number, metodo_pago: string) =>
    req<Pedido>(`/pedidos/${pedidoId}/cobrar`, {
      method: 'POST',
      body: JSON.stringify({ metodo_pago }),
    }),
  anularPedido: (pedidoId: number) => req<Pedido>(`/pedidos/${pedidoId}/anular`, { method: 'POST' }),
}

export type WsEvent = { event: 'pedido_nuevo' | 'pedido_actualizado' | 'pedido_pagado'; data: Pedido }

export function connectWs(onEvent: (evt: WsEvent) => void): () => void {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  let ws: WebSocket
  let closed = false

  function connect() {
    ws = new WebSocket(`${proto}://${window.location.host}/ws`)
    ws.onmessage = (msg) => {
      try {
        onEvent(JSON.parse(msg.data))
      } catch {
        // ignore malformed message
      }
    }
    ws.onclose = () => {
      if (!closed) setTimeout(connect, 1500)
    }
  }
  connect()

  return () => {
    closed = true
    ws.close()
  }
}

export type { Pedido, PedidoItem, Producto }
