import { useEffect, useMemo, useState } from 'react'
import NavBar from '../components/NavBar'
import { api, connectWs } from '../lib/api'
import type { Categoria, Pedido, Producto, Variante } from '../lib/types'

type CarritoEntry = { producto: Producto; variante: Variante; cantidad: number }
type Carrito = Record<number, CarritoEntry>

export default function POS() {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [carrito, setCarrito] = useState<Carrito>({})
  const [pedidosActivos, setPedidosActivos] = useState<Pedido[]>([])
  const [cobrando, setCobrando] = useState<Pedido | null>(null)
  const [tasaBcv, setTasaBcv] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    api.listarCategorias().then(setCategorias)
    api.obtenerConfig().then((c) => setTasaBcv(c.tasa_bcv))
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

  const totalCarrito = useMemo(
    () => Object.values(carrito).reduce((sum, c) => sum + c.variante.precio * c.cantidad, 0),
    [carrito],
  )

  function agregar(producto: Producto, variante: Variante) {
    setCarrito((c) => ({
      ...c,
      [variante.id]: { producto, variante, cantidad: (c[variante.id]?.cantidad ?? 0) + 1 },
    }))
  }

  function quitar(varianteId: number) {
    setCarrito((c) => {
      const next = { ...c }
      const actual = next[varianteId]
      if (!actual) return c
      if (actual.cantidad <= 1) delete next[varianteId]
      else next[varianteId] = { ...actual, cantidad: actual.cantidad - 1 }
      return next
    })
  }

  async function enviarComanda() {
    setError('')
    const items = Object.values(carrito).map((c) => ({
      variante_id: c.variante.id,
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

  async function anular(pedidoId: number) {
    if (!window.confirm('Anular este pedido?')) return
    await api.anularPedido(pedidoId)
    refrescarPedidos()
  }

  return (
    <div className="min-h-screen bg-neutral-100">
      <NavBar titulo="Punto de venta" />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px]">
        <div className="p-4 overflow-y-auto">
          {categorias.map((cat) => (
            <div key={cat.id} className="mb-6">
              <h2 className="text-sm font-medium uppercase text-neutral-500 mb-2">{cat.nombre}</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {cat.productos
                  .filter((p) => p.activo)
                  .flatMap((p) =>
                    p.variantes
                      .filter((v) => v.activo)
                      .map((v) => (
                        <button
                          key={v.id}
                          onClick={() => agregar(p, v)}
                          className="bg-white rounded-xl shadow p-4 text-left active:scale-95 transition"
                        >
                          <div className="font-medium">
                            {v.nombre === 'Regular' ? p.nombre : `${p.nombre} - ${v.nombre}`}
                          </div>
                          <div className="text-neutral-500">${v.precio.toFixed(2)}</div>
                        </button>
                      )),
                  )}
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
                  <div className="flex gap-2">
                    <button onClick={() => anular(pedido.id)} className="text-red-500 text-xs">
                      Anular
                    </button>
                    <button
                      onClick={() => setCobrando(pedido)}
                      className="bg-blue-600 text-white text-sm px-3 py-1.5 rounded-lg"
                    >
                      Cobrar
                    </button>
                  </div>
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
            {Object.values(carrito).map(({ producto, variante, cantidad }) => (
              <div key={variante.id} className="flex justify-between items-center">
                <div>
                  <div className="text-sm font-medium">
                    {variante.nombre === 'Regular' ? producto.nombre : `${producto.nombre} - ${variante.nombre}`}
                  </div>
                  <div className="text-xs text-neutral-500">${variante.precio.toFixed(2)} c/u</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => quitar(variante.id)}
                    className="w-7 h-7 rounded-full bg-neutral-200"
                  >
                    -
                  </button>
                  <span className="w-5 text-center">{cantidad}</span>
                  <button
                    onClick={() => agregar(producto, variante)}
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
      </div>

      {cobrando && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="bg-white rounded-2xl p-6 w-80">
            <h3 className="font-semibold mb-1">Cobrar pedido #{cobrando.numero}</h3>
            <p className="text-2xl font-bold">${cobrando.total.toFixed(2)}</p>
            {tasaBcv > 0 && (
              <p className="text-neutral-500 mb-3">
                Bs {(cobrando.total * tasaBcv).toLocaleString('es-VE', { maximumFractionDigits: 2 })}{' '}
                <span className="text-xs">(tasa {tasaBcv})</span>
              </p>
            )}
            {tasaBcv === 0 && (
              <p className="text-amber-600 text-xs mb-3">
                Tasa BCV sin configurar - ve a Cierre de caja para fijarla.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 mb-3 mt-2">
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
