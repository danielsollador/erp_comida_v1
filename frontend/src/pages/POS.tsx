import { useEffect, useMemo, useState } from 'react'
import NavBar from '../components/NavBar'
import { api, connectWs } from '../lib/api'
import { fmtBs, useMoneda } from '../lib/moneda'
import { colorCategoria } from '../lib/theme'
import type {
  Categoria,
  Operador,
  Pedido,
  Producto,
  PuntoVenta,
  Sugerencia,
  Variante,
} from '../lib/types'

// Las mismas que reconoce la contabilidad; cualquier otra cosa la rechaza el
// backend en vez de mandarla a Caja por defecto. Bolivares y divisas van
// separados porque son dos gavetas fisicas distintas y se cuentan aparte.
const METODOS_PAGO = ['Efectivo Bs', 'Efectivo $', 'Pago movil', 'Tarjeta', 'Transferencia']
const METODOS_EFECTIVO = ['Efectivo Bs', 'Efectivo $']
const CLAVE_OPERADOR = 'erp-operador'
const CLAVE_PUNTO = 'erp-punto-venta'

type CarritoEntry = { producto: Producto; variante: Variante; cantidad: number }
type Carrito = Record<number, CarritoEntry>

export default function POS() {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [categoriaActiva, setCategoriaActiva] = useState<number | null>(null)
  const [carrito, setCarrito] = useState<Carrito>({})
  const [pedidosActivos, setPedidosActivos] = useState<Pedido[]>([])
  const [ventasRecientes, setVentasRecientes] = useState<Pedido[]>([])
  const [pagoMixto, setPagoMixto] = useState(false)
  const [metodoParcial, setMetodoParcial] = useState(METODOS_PAGO[0])
  const [montoParcial, setMontoParcial] = useState('')
  const [cobrando, setCobrando] = useState<Pedido | null>(null)
  const [facturar, setFacturar] = useState(false)
  const [numeroFactura, setNumeroFactura] = useState('')
  const [sugerencias, setSugerencias] = useState<Sugerencia[]>([])
  // Lo que cambia cuanta plata entra: rebaja al cliente y propina del mesonero.
  const [descuento, setDescuento] = useState('')
  const [motivoDescuento, setMotivoDescuento] = useState('')
  const [propina, setPropina] = useState('')
  const [cliente, setCliente] = useState('')
  // Con un billete grande, entra mas de lo que cuesta y sale el vuelto.
  const [recibido, setRecibido] = useState('')
  const [vueltoEn, setVueltoEn] = useState('')
  // Quien esta en la caja y en cual. Se recuerda en la tablet: se elige una vez
  // por turno, no en cada venta.
  const [operadores, setOperadores] = useState<Operador[]>([])
  const [puntos, setPuntos] = useState<PuntoVenta[]>([])
  const [operadorId, setOperadorId] = useState<number | null>(() => {
    const v = localStorage.getItem(CLAVE_OPERADOR)
    return v ? Number(v) : null
  })
  const [puntoId, setPuntoId] = useState<number | null>(() => {
    const v = localStorage.getItem(CLAVE_PUNTO)
    return v ? Number(v) : null
  })
  const [error, setError] = useState('')
  const [ultimaVenta, setUltimaVenta] = useState<Pedido | null>(null)
  const { tasa, fmt } = useMoneda()
  const tasaBcv = tasa?.bcv ?? 0

  // Lo que de verdad se recibe: la comida menos el descuento, mas la propina.
  const subtotalCobro = cobrando?.total ?? 0
  const descuentoNum = Math.min(Number(descuento) || 0, subtotalCobro)
  const aCobrar = Math.round((subtotalCobro - descuentoNum + (Number(propina) || 0)) * 100) / 100
  const vuelto = Math.max(Math.round(((Number(recibido) || 0) - aCobrar) * 100) / 100, 0)

  useEffect(() => {
    // Solo lo que esta en el menu hoy: una categoria retirada conserva sus
    // ventas historicas pero no se debe poder seguir vendiendo.
    api.listarCategorias().then((todas) => {
      const cats = todas.filter((c) => c.activo)
      setCategorias(cats)
      if (cats.length > 0) setCategoriaActiva(cats[0].id)
    })
    refrescarPedidos()
    api.listarOperadores().then(setOperadores).catch(() => {})
    api.listarPuntosVenta().then(setPuntos).catch(() => {})
    const disconnect = connectWs(() => refrescarPedidos())
    return disconnect
  }, [])

  function refrescarPedidos() {
    Promise.all([api.listarPedidos('pendiente'), api.listarPedidos('listo')]).then(
      ([pendientes, listos]) =>
        setPedidosActivos([...listos, ...pendientes].sort((a, b) => a.numero - b.numero)),
    )
    // Las ultimas ventas quedan a mano por si el cliente vuelve con la comida:
    // devolver una venta cobrada es distinto de anular una que nunca se cobro.
    api
      .listarPedidos('pagado')
      .then((ps) => setVentasRecientes(ps.slice(0, 6)))
      .catch(() => setVentasRecientes([]))
  }

  async function devolver(pedido: Pedido) {
    const motivo = window.prompt(
      `Devolver el pedido #${pedido.numero} por ${fmt(pedido.total)}?\n\n` +
        'Se le regresa la plata al cliente y la venta se revierte entera: deja de contar como ' +
        'ingreso y deja de deber IVA.\n\nQue paso?',
      'La comida estaba mala',
    )
    if (motivo === null) return

    // Define si el costo vuelve al inventario o se reconoce como merma.
    const recuperable = window.confirm(
      'La comida se puede volver a vender?\n\nAceptar = si, vuelve al inventario\nCancelar = no, se bota (se registra como merma)',
    )

    let nota_credito: string | undefined
    if (pedido.facturado) {
      // Sin la nota de credito la factura no puede salir del Libro de Ventas.
      const nc = window.prompt(
        `Esta venta se facturo (${pedido.numero_factura}).\n\nNumero de la nota de credito que emitiste:`,
      )
      if (!nc) return
      nota_credito = nc
    }

    setError('')
    try {
      await api.devolverPedido(pedido.id, { recuperable, nota_credito, motivo })
      refrescarPedidos()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo devolver')
    }
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

  function limpiarCobro() {
    setCobrando(null)
    setFacturar(false)
    setNumeroFactura('')
    setPagoMixto(false)
    setMontoParcial('')
    setDescuento('')
    setMotivoDescuento('')
    setPropina('')
    setCliente('')
    setRecibido('')
    setVueltoEn('')
  }

  async function cobrar(
    metodo: string,
    pagos?: { metodo: string; monto: number; recibido?: number; vuelto_metodo?: string }[],
  ) {
    if (!cobrando) return
    setError('')
    try {
      const cobrado = await api.cobrarPedido(cobrando.id, metodo, facturar, numeroFactura, pagos, {
        descuento: Number(descuento) || 0,
        motivo_descuento: motivoDescuento,
        propina: Number(propina) || 0,
        cliente,
        operador_id: operadorId,
        punto_venta_id: puntoId,
      })
      limpiarCobro()
      setUltimaVenta(cobrado)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cobrar')
      setCobrando(null)
    }
    refrescarPedidos()
  }

  function confirmarCobro(metodo: string) {
    // Si el cajero anoto con cuanto le pagaron, se manda: sin eso la gaveta no
    // cuadra cuando hubo vuelto, y menos si el vuelto salio en otra moneda.
    const entregado = Number(recibido) || 0
    if (entregado > aCobrar + 0.001) {
      cobrar(metodo, [
        {
          metodo,
          monto: aCobrar,
          recibido: entregado,
          vuelto_metodo: vueltoEn || metodo,
        },
      ])
      return
    }
    cobrar(metodo)
  }

  // El resto del total va al segundo metodo, calculado acá para que los dos
  // pagos sumen exacto y el backend no lo rechace por centavos.
  function confirmarCobroMixto(segundoMetodo: string) {
    if (!cobrando) return
    const primero = Number(montoParcial)
    const resto = Math.round((aCobrar - primero) * 100) / 100
    cobrar('Mixto', [
      { metodo: metodoParcial, monto: primero },
      { metodo: segundoMetodo, monto: resto },
    ])
  }

  function elegirOperador(id: number | null) {
    setOperadorId(id)
    if (id) localStorage.setItem(CLAVE_OPERADOR, String(id))
    else localStorage.removeItem(CLAVE_OPERADOR)
  }

  function elegirPunto(id: number | null) {
    setPuntoId(id)
    if (id) localStorage.setItem(CLAVE_PUNTO, String(id))
    else localStorage.removeItem(CLAVE_PUNTO)
  }

  async function imprimirTicket(pedidoId: number) {
    try {
      const t = await api.ticket(pedidoId)
      const ventana = window.open('', '_blank', 'width=320,height=600')
      if (!ventana) return
      const linea = (izq: string, der: string) =>
        `<div class="l"><span>${izq}</span><span>${der}</span></div>`
      ventana.document.write(`
        <html><head><title>Ticket ${t.numero}</title><style>
          body{font-family:ui-monospace,monospace;font-size:12px;width:280px;margin:0;padding:8px}
          h1{font-size:14px;text-align:center;margin:0 0 2px}
          .c{text-align:center}.l{display:flex;justify-content:space-between}
          hr{border:none;border-top:1px dashed #000;margin:6px 0}
          .tot{font-size:15px;font-weight:bold}
          @media print{body{width:auto}}
        </style></head><body>
        <h1>Pedido #${t.numero}</h1>
        <div class="c">${new Date(t.fecha).toLocaleString('es-VE')}</div>
        ${t.operador ? `<div class="c">Le atendio: ${t.operador}</div>` : ''}
        ${t.punto_venta ? `<div class="c">${t.punto_venta}</div>` : ''}
        <hr>
        ${t.items
          .map((i) => linea(`${i.cantidad} x ${i.nombre}`, `$${i.subtotal.toFixed(2)}`))
          .join('')}
        <hr>
        ${t.descuento ? linea('Subtotal', `$${t.subtotal.toFixed(2)}`) : ''}
        ${t.descuento ? linea('Descuento', `-$${t.descuento.toFixed(2)}`) : ''}
        ${t.propina ? linea('Propina', `$${t.propina.toFixed(2)}`) : ''}
        <div class="l tot"><span>TOTAL</span><span>$${t.a_cobrar.toFixed(2)}</span></div>
        ${t.total_bs ? linea('En bolivares', fmtBs(t.total_bs)) : ''}
        ${t.tasa_bcv ? `<div class="c" style="font-size:10px">tasa ${t.tasa_bcv}</div>` : ''}
        ${t.facturado && t.base_imponible != null ? '<hr>' : ''}
        ${t.facturado && t.base_imponible != null ? linea('Base imponible', `$${t.base_imponible.toFixed(2)}`) : ''}
        ${t.facturado && t.iva != null ? linea('IVA', `$${t.iva.toFixed(2)}`) : ''}
        ${t.numero_factura ? `<div class="c">Factura ${t.numero_factura}</div>` : ''}
        <hr>
        ${t.pagos
          .map(
            (p) =>
              linea(p.metodo, `$${p.monto.toFixed(2)}`) +
              (p.vuelto_monto ? linea('Vuelto', `$${p.vuelto_monto.toFixed(2)}`) : ''),
          )
          .join('')}
        ${t.cliente ? `<div class="c">Cliente: ${t.cliente}</div>` : ''}
        <hr><div class="c">Gracias por su compra</div>
        </body></html>`)
      ventana.document.close()
      ventana.focus()
      ventana.print()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar el ticket')
    }
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
      await api.anularPedido(pedido.id, yaHecha, operadorId)
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

          {/* A mano por si el cliente vuelve con la comida. Devolver una venta
              cobrada revierte el ingreso y el IVA; anular es solo para las que
              nunca se cobraron. */}
          {/* Quien esta en la caja y en cual. Se elige una vez por turno y la
              tablet lo recuerda: antes el sistema era completamente anonimo y
              no habia forma de saber quien anulo un pedido o conto la gaveta. */}
          {(operadores.length > 0 || puntos.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 mb-3">
              {operadores.length > 0 && (
                <label className="flex items-center gap-1">
                  Turno de
                  <select
                    value={operadorId ?? ''}
                    onChange={(e) => elegirOperador(e.target.value ? Number(e.target.value) : null)}
                    className={`rounded-lg border px-2 py-1 ${
                      operadorId
                        ? 'border-neutral-300 text-neutral-900'
                        : 'border-amber-300 bg-amber-50 text-amber-800'
                    }`}
                  >
                    <option value="">sin elegir</option>
                    {operadores.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.nombre}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {puntos.length > 0 && (
                <label className="flex items-center gap-1">
                  Caja
                  <select
                    value={puntoId ?? ''}
                    onChange={(e) => elegirPunto(e.target.value ? Number(e.target.value) : null)}
                    className="rounded-lg border border-neutral-300 px-2 py-1 text-neutral-900"
                  >
                    <option value="">principal</option>
                    {puntos.map((pv) => (
                      <option key={pv.id} value={pv.id}>
                        {pv.nombre}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          {ventasRecientes.length > 0 && (
            <div className="mt-6">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-2">
                Ultimas ventas
              </h2>
              <div className="space-y-1">
                {ventasRecientes.map((v) => (
                  <div
                    key={v.id}
                    className={`flex items-center justify-between gap-2 text-sm rounded-lg px-2.5 py-1.5 ${
                      v.devuelto ? 'bg-neutral-100 opacity-60' : 'bg-white border border-neutral-200'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="font-medium">#{v.numero}</span>
                      <span className="text-neutral-500 truncate">
                        {v.items.map((i) => `${i.cantidad}x ${i.nombre}`).join(', ')}
                      </span>
                      {v.facturado && !v.devuelto && (
                        <span className="text-[10px] text-neutral-400 shrink-0">facturada</span>
                      )}
                    </span>
                    <span className="flex items-center gap-3 shrink-0">
                      <span className="tabular-nums">{fmt(v.total)}</span>
                      {v.devuelto ? (
                        <span className="text-xs text-neutral-500">devuelta</span>
                      ) : (
                        <button
                          onClick={() => devolver(v)}
                          className="text-xs font-medium text-amber-700"
                        >
                          Devolver
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
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

      {/* El comprobante del cliente. No habia impresion de ninguna clase en
          todo el sistema. */}
      {ultimaVenta && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-2xl bg-neutral-900 px-4 py-3 text-white shadow-xl">
          <span className="text-sm">
            Cobrado #{ultimaVenta.numero} - ${ultimaVenta.a_cobrar.toFixed(2)}
          </span>
          <button
            onClick={() => imprimirTicket(ultimaVenta.id)}
            className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-medium hover:bg-white/25"
          >
            Imprimir ticket
          </button>
          <button onClick={() => setUltimaVenta(null)} className="text-white/60 text-sm">
            x
          </button>
        </div>
      )}

      {cobrando && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-30">
          <div className="bg-white rounded-3xl p-6 w-80 shadow-xl">
            <h3 className="font-semibold mb-1">Cobrar pedido #{cobrando.numero}</h3>
            <p className="text-3xl font-bold">${aCobrar.toFixed(2)}</p>
            {(descuentoNum > 0 || Number(propina) > 0) && (
              <p className="text-xs text-neutral-500">
                ${cobrando.total.toFixed(2)} de comida
                {descuentoNum > 0 && ` - $${descuentoNum.toFixed(2)} de descuento`}
                {Number(propina) > 0 && ` + $${Number(propina).toFixed(2)} de propina`}
              </p>
            )}
            {tasaBcv > 0 && (
              <p className="text-neutral-500 mb-3">
                {fmtBs(aCobrar * tasaBcv)}{' '}
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
            {/* Rebaja a ESTE cliente. Antes la unica via era bajarle el
                precio al menu, que se lo bajaba a todos y ademas declaraba IVA
                sobre un precio que no se cobro. */}
            <div className="grid grid-cols-2 gap-2 mt-3">
              <label className="text-xs text-neutral-500">
                Descuento
                <input
                  value={descuento}
                  onChange={(e) => setDescuento(e.target.value)}
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  className="w-full border border-neutral-300 rounded-lg px-2 py-1.5 text-sm text-neutral-900"
                />
              </label>
              {/* La propina no es venta: entra a la gaveta y se le debe al
                  empleado hasta que se le entrega. */}
              <label className="text-xs text-neutral-500">
                Propina
                <input
                  value={propina}
                  onChange={(e) => setPropina(e.target.value)}
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  className="w-full border border-neutral-300 rounded-lg px-2 py-1.5 text-sm text-neutral-900"
                />
              </label>
            </div>
            {descuentoNum > 0 && (
              <input
                value={motivoDescuento}
                onChange={(e) => setMotivoDescuento(e.target.value)}
                placeholder="Motivo del descuento"
                className="w-full border border-neutral-300 rounded-lg px-3 py-1.5 text-sm mt-2"
              />
            )}

            {/* Con cuanto pago: si dio un billete grande, entra mas de lo que
                cuesta y sale el vuelto. Sin anotarlo, la gaveta no cuadra -- y
                menos si el vuelto sale en la otra moneda. */}
            <div className="grid grid-cols-2 gap-2 mt-2">
              <label className="text-xs text-neutral-500">
                Con cuanto pago
                <input
                  value={recibido}
                  onChange={(e) => setRecibido(e.target.value)}
                  type="number"
                  step="0.01"
                  placeholder="opcional"
                  className="w-full border border-neutral-300 rounded-lg px-2 py-1.5 text-sm text-neutral-900"
                />
              </label>
              {vuelto > 0 && (
                <label className="text-xs text-neutral-500">
                  Vuelto en
                  <select
                    value={vueltoEn}
                    onChange={(e) => setVueltoEn(e.target.value)}
                    className="w-full border border-neutral-300 rounded-lg px-2 py-1.5 text-sm text-neutral-900"
                  >
                    <option value="">misma forma</option>
                    {METODOS_EFECTIVO.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {vuelto > 0 && (
              <p className="mt-1 text-sm font-semibold text-emerald-700 tabular-nums">
                Vuelto: ${vuelto.toFixed(2)}
                {tasaBcv > 0 && vueltoEn === 'Efectivo Bs' && ` - ${fmtBs(vuelto * tasaBcv)}`}
              </p>
            )}

            {/* Fiado: sin nombre no hay a quien cobrarle. */}
            <input
              value={cliente}
              onChange={(e) => setCliente(e.target.value)}
              placeholder="Cliente (obligatorio si es fiado)"
              className="w-full border border-neutral-300 rounded-lg px-3 py-1.5 text-sm mt-2"
            />

            {/* Pago partido: el cliente da algo en efectivo y el resto por
                otra via. Antes habia que elegir un metodo solo y la caja
                quedaba esperando plata que nunca entro a la gaveta. */}
            {!pagoMixto ? (
              <>
                <div className="grid grid-cols-2 gap-2 mb-2 mt-3">
                  {METODOS_PAGO.map((m) => (
                    <button
                      key={m}
                      onClick={() => confirmarCobro(m)}
                      className="bg-neutral-100 hover:bg-neutral-200 rounded-xl py-3 text-sm font-medium"
                    >
                      {m}
                    </button>
                  ))}
                  {/* No entra plata: nace una cuenta por cobrar. */}
                  <button
                    onClick={() => confirmarCobro('Fiado')}
                    disabled={!cliente.trim()}
                    title={cliente.trim() ? '' : 'Escribe el nombre del cliente primero'}
                    className="bg-amber-100 hover:bg-amber-200 rounded-xl py-3 text-sm font-medium disabled:opacity-40"
                  >
                    Fiado
                  </button>
                </div>
                <button
                  onClick={() => setPagoMixto(true)}
                  className="w-full text-sm font-medium text-blue-600 mb-3 py-1"
                >
                  Paga con dos formas
                </button>
              </>
            ) : (
              <div className="mt-3 mb-3 space-y-2">
                <div className="flex items-center gap-2">
                  <select
                    value={metodoParcial}
                    onChange={(e) => setMetodoParcial(e.target.value)}
                    className="flex-1 border border-neutral-300 rounded-lg px-2 py-2 text-sm"
                  >
                    {METODOS_PAGO.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <input
                    value={montoParcial}
                    onChange={(e) => setMontoParcial(e.target.value)}
                    type="number"
                    step="0.01"
                    placeholder="Monto"
                    className="w-24 border border-neutral-300 rounded-lg px-2 py-2 text-sm"
                  />
                </div>
                <p className="text-xs text-neutral-500">
                  Falta por cubrir:{' '}
                  <span className="font-semibold tabular-nums text-neutral-800">
                    ${Math.max(aCobrar - (Number(montoParcial) || 0), 0).toFixed(2)}
                  </span>{' '}
                  con:
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[...METODOS_PAGO, 'Fiado'].filter((m) => m !== metodoParcial).map((m) => (
                    <button
                      key={m}
                      onClick={() => confirmarCobroMixto(m)}
                      disabled={
                        !(Number(montoParcial) > 0 && Number(montoParcial) < aCobrar)
                      }
                      className="bg-neutral-100 hover:bg-neutral-200 rounded-xl py-2.5 text-sm font-medium disabled:opacity-30"
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setPagoMixto(false)}
                  className="w-full text-xs text-neutral-500 pt-1"
                >
                  Volver a un solo pago
                </button>
              </div>
            )}
            <button onClick={limpiarCobro} className="text-sm text-neutral-500">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
