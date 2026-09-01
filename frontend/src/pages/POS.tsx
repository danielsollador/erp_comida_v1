import { useEffect, useMemo, useState } from 'react'
import NavBar from '../components/NavBar'
import { api, connectWs } from '../lib/api'
import { fmtBs, useMoneda } from '../lib/moneda'
import { colorCategoria } from '../lib/theme'
import type { Categoria, Pedido, Producto, Sugerencia, Variante } from '../lib/types'

type CarritoEntry = { producto: Producto; variante: Variante; cantidad: number }
type Carrito = Record<number, CarritoEntry>

export default function POS() {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [categoriaActiva, setCategoriaActiva] = useState<number | null>(null)
  const [carrito, setCarrito] = useState<Carrito>({})
  const [pedidosActivos, setPedidosActivos] = useState<Pedido[]>([])
  const [cobrando, setCobrando] = useState<Pedido | null>(null)
  const [sugerencias, setSugerencias] = useState<Sugerencia[]>([])
  const [error, setError] = useState('')
  const { tasa, fmt } = useMoneda()
  const tasaBcv = tasa?.bcv ?? 0

  useEffect(() => {
    api.listarCategorias().then((cats) => {
      setCategorias(cats)
      if (cats.length > 0) setCategoriaActiva(cats[0].id)
    })
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

  // Que ofrecerle al cliente segun lo que ya lleva. Se recalcula en cada
  // cambio del carrito, que es justo cuando el cajero esta mirando la pantalla.
  const idsCarrito = Object.keys(carrito).join(',')
  useEffect(() => {
    const ids = Object.values(carrito).map((c) => c.variante.id)
    if (ids.length === 0) {
      setSugerencias([])
      return
    }
    let vigente = true
    api
      .sugerencias(ids)
      .then((s) => vigente && setSugerencias(s))
      .catch(() => vigente && setSugerencias([]))
    return () => {
      vigente = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsCarrito])

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

  function agregarSugerencia(sug: Sugerencia) {
    for (const cat of categorias) {
      for (const producto of cat.productos) {
        const variante = producto.variantes.find((v) => v.id === sug.variante_id)
        if (variante) {
          agregar(producto, variante)
          return
        }
      }
    }
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
    setError('')
    try {
      await api.cobrarPedido(cobrando.id, metodo)
      setCobrando(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cobrar')
      setCobrando(null)
    }
    refrescarPedidos()
  }

  async function anular(pedidoId: number) {
    if (!window.confirm('Anular este pedido?')) return
    setError('')
    try {
      await api.anularPedido(pedidoId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo anular')
    }
    refrescarPedidos()
  }

  const categoria = categorias.find((c) => c.id === categoriaActiva)

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Punto de venta" />

      {categorias.length > 0 && (
        <div className="sticky top-[57px] z-10 bg-neutral-50/95 backdrop-blur border-b border-neutral-200 px-4 py-2 flex gap-2 overflow-x-auto">
          {categorias.map((cat) => {
            const color = colorCategoria(cat.id)
            const activa = cat.id === categoriaActiva
            return (
              <button
                key={cat.id}
                onClick={() => setCategoriaActiva(cat.id)}
                className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold border transition ${
                  activa
                    ? `${color.bg} ${color.border} ${color.text}`
                    : 'bg-white border-neutral-200 text-neutral-500'
                }`}
              >
                {cat.nombre}
              </button>
            )
          })}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px]">
        <div className="p-4 overflow-y-auto">
          {categoria && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
              {categoria.productos
                .filter((p) => p.activo)
                .flatMap((p) =>
                  p.variantes
                    .filter((v) => v.activo)
                    .map((v) => {
                      const color = colorCategoria(categoria.id)
                      return (
                        <button
                          key={v.id}
                          onClick={() => agregar(p, v)}
                          className={`rounded-2xl border-2 p-4 text-left active:scale-95 transition shadow-sm ${color.bg} ${color.border}`}
                        >
                          <div className={`font-semibold ${color.text}`}>
                            {v.nombre === 'Regular' ? p.nombre : `${p.nombre} - ${v.nombre}`}
                          </div>
                          <div className="text-neutral-700 font-medium mt-1">
                            {fmt(v.precio)}
                          </div>
                        </button>
                      )
                    }),
                )}
            </div>
          )}

          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 mb-2">
            Pedidos en curso
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {pedidosActivos.map((pedido) => (
              <div key={pedido.id} className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-bold text-lg">#{pedido.numero}</span>
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full font-medium ${
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
                  <span className="font-semibold">{fmt(pedido.total)}</span>
                  <div className="flex gap-2">
                    <button onClick={() => anular(pedido.id)} className="text-red-500 text-xs font-medium">
                      Anular
                    </button>
                    <button
                      onClick={() => setCobrando(pedido)}
                      className="bg-neutral-900 text-white text-sm px-4 py-2 rounded-xl font-medium"
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

        <div className="bg-white border-l border-neutral-200 p-4 flex flex-col lg:sticky lg:top-[105px] lg:h-[calc(100vh-105px)]">
          <h2 className="font-semibold mb-3 text-lg">Comanda actual</h2>
          {error && <p className="text-red-600 text-sm mb-2">{error}</p>}
          <div className="flex-1 overflow-y-auto space-y-3">
            {Object.values(carrito).map(({ producto, variante, cantidad }) => (
              <div key={variante.id} className="flex justify-between items-center">
                <div>
                  <div className="text-sm font-semibold">
                    {variante.nombre === 'Regular' ? producto.nombre : `${producto.nombre} - ${variante.nombre}`}
                  </div>
                  <div className="text-xs text-neutral-500">{fmt(variante.precio)} c/u</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => quitar(variante.id)}
                    className="w-8 h-8 rounded-full bg-neutral-100 hover:bg-neutral-200 font-semibold"
                  >
                    -
                  </button>
                  <span className="w-6 text-center font-medium">{cantidad}</span>
                  <button
                    onClick={() => agregar(producto, variante)}
                    className="w-8 h-8 rounded-full bg-neutral-100 hover:bg-neutral-200 font-semibold"
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
          {sugerencias.length > 0 && (
            <div className="border-t border-neutral-200 pt-3 mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-2">
                {sugerencias.some((s) => s.es_bebida) ? 'Ofrecele algo de tomar' : 'Suele ir con'}
              </p>
              <div className="flex flex-wrap gap-2">
                {sugerencias.map((sug) => (
                  <button
                    key={sug.variante_id}
                    onClick={() => agregarSugerencia(sug)}
                    className="flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 active:scale-95 transition"
                  >
                    <span aria-hidden>+</span>
                    <span>{sug.etiqueta}</span>
                    <span className="tabular-nums text-emerald-600">{fmt(sug.precio)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-neutral-200 pt-3 mt-3">
            <div className="flex justify-between items-baseline font-bold text-xl mb-3">
              <span className="text-sm font-medium text-neutral-500">Total</span>
              <span>{fmt(totalCarrito)}</span>
            </div>
            <button
              onClick={enviarComanda}
              disabled={Object.keys(carrito).length === 0}
              className="w-full bg-neutral-900 text-white rounded-2xl py-4 font-semibold text-base disabled:opacity-30"
            >
              Enviar comanda a cocina
            </button>
          </div>
        </div>
      </div>

      {cobrando && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-30">
          <div className="bg-white rounded-3xl p-6 w-80 shadow-xl">
            <h3 className="font-semibold mb-1">Cobrar pedido #{cobrando.numero}</h3>
            <p className="text-3xl font-bold">${cobrando.total.toFixed(2)}</p>
            {tasaBcv > 0 && (
              <p className="text-neutral-500 mb-3">
                {fmtBs(cobrando.total * tasaBcv)}{' '}
                <span className="text-xs">
                  (tasa {tasaBcv}
                  {tasa?.origen === 'manual' ? ', manual' : ''})
                </span>
              </p>
            )}
            {tasaBcv === 0 && (
              <p className="text-amber-600 text-xs mb-3">
                Sin tasa de cambio cargada -{' '}
                <a href="/tasa" className="underline font-medium">
                  configurala aqui
                </a>
                .
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 mb-3 mt-2">
              {['Efectivo', 'Tarjeta', 'Pago movil', 'Transferencia'].map((m) => (
                <button
                  key={m}
                  onClick={() => confirmarCobro(m)}
                  className="bg-neutral-100 hover:bg-neutral-200 rounded-xl py-3 text-sm font-medium"
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
