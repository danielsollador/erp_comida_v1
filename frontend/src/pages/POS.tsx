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
  const [facturar, setFacturar] = useState(false)
  const [numeroFactura, setNumeroFactura] = useState('')
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
      const mensaje = e instanceof Error ? e.message : 'Error al enviar la comanda'
      // El backend bloquea la venta si no hay insumos, pero el conteo del
      // sistema puede estar atrasado y el cajero tiene un cliente enfrente.
      // Se le muestra que falta y el decide; nunca se vende a ciegas.
      if (mensaje.startsWith('No alcanza el inventario')) {
        if (window.confirm(`${mensaje}.\n\nVender igual? (revisa el inventario despues)`)) {
          try {
            await api.crearPedido(items, true)
            setCarrito({})
            refrescarPedidos()
            return
          } catch (e2) {
            setError(e2 instanceof Error ? e2.message : 'Error al enviar la comanda')
            return
          }
        }
        return
      }
      setError(mensaje)
    }
  }

  async function confirmarCobro(metodo: string) {
    if (!cobrando) return
    setError('')
    try {
      await api.cobrarPedido(cobrando.id, metodo, facturar, numeroFactura)
      setCobrando(null)
      setFacturar(false)
      setNumeroFactura('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cobrar')
      setCobrando(null)
    }
    refrescarPedidos()
  }

  async function anular(pedido: Pedido) {
    // Lo que pasa con los insumos depende de esto, asi que se pregunta en vez
    // de asumir: si la comida ya se hizo, se botó y hay que registrarla como
    // merma; si no, el stock vuelve al inventario.
    const yaHecha = pedido.estado === 'listo' || pedido.items.some((i) => i.preparado)
    const texto = yaHecha
      ? 'La cocina ya preparo este pedido. Al anularlo se registra la comida como merma. Continuar?'
      : 'Anular este pedido? Los insumos vuelven al inventario.'
    if (!window.confirm(texto)) return
    setError('')
    try {
      await api.anularPedido(pedido.id, yaHecha)
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

      {/* md (768px) y no lg: una tablet en vertical ya muestra el carrito al
          lado, sin obligar al cajero a bajar para ver el total y cobrar. */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_330px] lg:grid-cols-[1fr_380px]">
        <div className="p-4 overflow-y-auto">
          {categoria && (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
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
                          className={`rounded-2xl border-2 p-5 min-h-[104px] flex flex-col justify-between text-left active:scale-95 transition shadow-sm ${color.bg} ${color.border}`}
                        >
                          <div className={`font-semibold text-lg leading-tight ${color.text}`}>
                            {v.nombre === 'Regular' ? p.nombre : `${p.nombre} - ${v.nombre}`}
                          </div>
                          <div className="text-neutral-700 font-bold text-lg mt-2">
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
                <div className="flex justify-between items-center gap-3">
                  <span className="font-semibold whitespace-nowrap">{fmt(pedido.total)}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={() => anular(pedido)}
                      className="text-red-500 text-xs font-medium"
                    >
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

        <div className="bg-white border-l border-neutral-200 p-4 flex flex-col md:sticky md:top-[105px] md:h-[calc(100vh-105px)]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-lg">Comanda actual</h2>
            {Object.keys(carrito).length > 0 && (
              <button
                onClick={() => setCarrito({})}
                className="text-xs font-medium text-neutral-400 hover:text-red-500"
              >
                Vaciar
              </button>
            )}
          </div>
          {error && <p className="text-red-600 text-sm mb-2">{error}</p>}
          <div className="flex-1 overflow-y-auto space-y-3">
            {Object.values(carrito).map(({ producto, variante, cantidad }) => (
              <div key={variante.id} className="flex justify-between items-center gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">
                    {variante.nombre === 'Regular' ? producto.nombre : `${producto.nombre} - ${variante.nombre}`}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {cantidad} x {fmt(variante.precio)} ={' '}
                    <span className="font-semibold text-neutral-700">
                      {fmt(variante.precio * cantidad)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => quitar(variante.id)}
                    className="w-9 h-9 rounded-full bg-neutral-100 hover:bg-neutral-200 font-semibold text-lg"
                  >
                    -
                  </button>
                  <span className="w-6 text-center font-semibold tabular-nums">{cantidad}</span>
                  <button
                    onClick={() => agregar(producto, variante)}
                    className="w-9 h-9 rounded-full bg-neutral-100 hover:bg-neutral-200 font-semibold text-lg"
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
            <label className="flex items-center gap-2 mt-3 text-sm">
              <input
                type="checkbox"
                checked={facturar}
                onChange={(e) => setFacturar(e.target.checked)}
                className="w-4 h-4"
              />
              Facturar esta venta
            </label>
            {facturar && (
              <input
                value={numeroFactura}
                onChange={(e) => setNumeroFactura(e.target.value)}
                placeholder="N. de factura (opcional)"
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mt-2"
              />
            )}
            <div className="grid grid-cols-2 gap-2 mb-3 mt-3">
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
            <button
              onClick={() => {
                setCobrando(null)
                setFacturar(false)
                setNumeroFactura('')
              }}
              className="text-sm text-neutral-500"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
