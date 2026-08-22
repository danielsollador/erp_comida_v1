import { useEffect, useMemo, useState } from 'react'
import { api, connectWs } from '../lib/api'
import type { Pedido, Producto } from '../lib/types'

type Carrito = Record<number, { producto: Producto; cantidad: number }>

export default function POS() {
  const [productos, setProductos] = useState<Producto[]>([])
  const [carrito, setCarrito] = useState<Carrito>({})
  const [pedidosActivos, setPedidosActivos] = useState<Pedido[]>([])
  const [cobrando, setCobrando] = useState<Pedido | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.listarProductos().then((ps) => setProductos(ps.filter((p) => p.activo)))
    refrescarPedidos()
    const disconnect = connectWs(() => refrescarPedidos())
    return disconnect
  }, [])

  function refrescarPedidos() {
    Promise.all([api.listarPedidos('pendiente'), api.listarPedidos('listo')]).then(
      ([pendientes, listos]) =>
        setPedidosActivos([...listos, ...pendientes].sort((a, b) => a.numero - b.numero)),
    )
  }

  const categorias = useMemo(() => [...new Set(productos.map((p) => p.categoria))], [productos])
  const totalCarrito = useMemo(
    () => Object.values(carrito).reduce((sum, c) => sum + c.producto.precio * c.cantidad, 0),
    [carrito],
  )

  function agregar(producto: Producto) {
    setCarrito((c) => ({
      ...c,
      [producto.id]: { producto, cantidad: (c[producto.id]?.cantidad ?? 0) + 1 },
    }))
  }

  function quitar(productoId: number) {
    setCarrito((c) => {
      const next = { ...c }
      const actual = next[productoId]
      if (!actual) return c
      if (actual.cantidad <= 1) delete next[productoId]
      else next[productoId] = { ...actual, cantidad: actual.cantidad - 1 }
      return next
    })
  }

  async function enviarComanda() {
    setError('')
    const items = Object.values(carrito).map((c) => ({
      producto_id: c.producto.id,
      cantidad: c.cantidad,
    }))
    if (items.length === 0) return
    try {
      await api.crearPedido(items)
      setCarrito({})
      refrescarPedidos()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al enviar la comanda')
    }
  }

  async function confirmarCobro(metodo: string) {
    if (!cobrando) return
    await api.cobrarPedido(cobrando.id, metodo)
    setCobrando(null)
    refrescarPedidos()
  }

  return (
    <div className="min-h-screen bg-neutral-100 grid grid-cols-1 lg:grid-cols-[1fr_360px]">
      <div className="p-4 overflow-y-auto">
        <h1 className="text-2xl font-semibold mb-4">Punto de venta</h1>
        {categorias.map((cat) => (
          <div key={cat} className="mb-6">
            <h2 className="text-sm font-medium uppercase text-neutral-500 mb-2">{cat}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {productos
                .filter((p) => p.categoria === cat)
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => agregar(p)}
                    className="bg-white rounded-xl shadow p-4 text-left active:scale-95 transition"
                  >
                    <div className="font-medium">{p.nombre}</div>
                    <div className="text-neutral-500">${p.precio.toFixed(2)}</div>
                  </button>
                ))}
            </div>
          </div>
        ))}

        <h2 className="text-sm font-medium uppercase text-neutral-500 mt-8 mb-2">
          Pedidos en curso
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {pedidosActivos.map((pedido) => (
            <div key={pedido.id} className="bg-white rounded-xl shadow p-4">
              <div className="flex justify-between items-center mb-2">
                <span className="font-semibold">#{pedido.numero}</span>
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    pedido.estado === 'listo'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {pedido.estado === 'listo' ? 'Listo para cobrar' : 'En cocina'}
                </span>
              </div>
              <ul className="text-sm text-neutral-600 mb-3">
                {pedido.items.map((i) => (
                  <li key={i.id}>
                    {i.cantidad}x {i.nombre}
                  </li>
                ))}
              </ul>
              <div className="flex justify-between items-center">
                <span className="font-medium">${pedido.total.toFixed(2)}</span>
                <button
                  onClick={() => setCobrando(pedido)}
                  className="bg-blue-600 text-white text-sm px-3 py-1.5 rounded-lg"
                >
                  Cobrar
                </button>
              </div>
            </div>
          ))}
          {pedidosActivos.length === 0 && (
            <p className="text-neutral-400 text-sm">No hay pedidos activos.</p>
          )}
        </div>
      </div>

      <div className="bg-white border-l border-neutral-200 p-4 flex flex-col">
        <h2 className="font-semibold mb-3">Comanda actual</h2>
        {error && <p className="text-red-600 text-sm mb-2">{error}</p>}
        <div className="flex-1 overflow-y-auto space-y-2">
          {Object.values(carrito).map(({ producto, cantidad }) => (
            <div key={producto.id} className="flex justify-between items-center">
              <div>
                <div className="text-sm font-medium">{producto.nombre}</div>
                <div className="text-xs text-neutral-500">${producto.precio.toFixed(2)} c/u</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => quitar(producto.id)}
                  className="w-7 h-7 rounded-full bg-neutral-200"
                >
                  -
                </button>
                <span className="w-5 text-center">{cantidad}</span>
                <button
                  onClick={() => agregar(producto)}
                  className="w-7 h-7 rounded-full bg-neutral-200"
                >
                  +
                </button>
              </div>
            </div>
          ))}
          {Object.keys(carrito).length === 0 && (
            <p className="text-neutral-400 text-sm">Toca un producto para agregarlo.</p>
          )}
        </div>
        <div className="border-t border-neutral-200 pt-3 mt-3">
          <div className="flex justify-between font-semibold mb-3">
            <span>Total</span>
            <span>${totalCarrito.toFixed(2)}</span>
          </div>
          <button
            onClick={enviarComanda}
            disabled={Object.keys(carrito).length === 0}
            className="w-full bg-neutral-900 text-white rounded-xl py-3 font-medium disabled:opacity-30"
          >
            Enviar comanda a cocina
          </button>
        </div>
      </div>

      {cobrando && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="bg-white rounded-2xl p-6 w-80">
            <h3 className="font-semibold mb-1">Cobrar pedido #{cobrando.numero}</h3>
            <p className="text-2xl font-bold mb-4">${cobrando.total.toFixed(2)}</p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {['Efectivo', 'Tarjeta', 'Pago movil', 'Transferencia'].map((m) => (
                <button
                  key={m}
                  onClick={() => confirmarCobro(m)}
                  className="bg-neutral-100 hover:bg-neutral-200 rounded-lg py-2 text-sm"
                >
                  {m}
                </button>
              ))}
            </div>
            <button onClick={() => setCobrando(null)} className="text-sm text-neutral-500">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
