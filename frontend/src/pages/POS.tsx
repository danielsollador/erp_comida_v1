import { useEffect, useMemo, useRef, useState } from 'react'
import EditarPedido from '../components/EditarPedido'
import NavBar from '../components/NavBar'
import Icono from '../components/Icono'
import { useDialogo } from '../components/dialogo'
import { Boton, Modal } from '../components/ui'
import { Numerico } from '../components/Teclado'
import { api, connectWs } from '../lib/api'
import { enPreparacion, porQueNoSeEdita } from '../lib/comandas'
import { fmtBs, useMoneda } from '../lib/moneda'
import { imprimirTicket as ticket } from '../lib/ticket'
import { colorCategoria } from '../lib/theme'
import { METODOS_PAGO, etiquetaMetodo, pedirReferencia } from '../lib/pagos'
import type {
  Categoria,
  Pedido,
  Producto,
  PuntoVenta,
  Sugerencia,
  Variante,
} from '../lib/types'

// METODOS_PAGO y METODOS_CON_REFERENCIA viven en lib/pagos porque la regla no
// es del punto de venta: Caja y Ventas tambien aplican pagos y tenian su
// propia lista, que fue justo como el cobro a credito termino aceptando un
// pago movil sin comprobante.
const METODOS_EFECTIVO = ['Efectivo Bs', 'Efectivo $']
const CLAVE_PUNTO = 'erp-punto-venta'

type CarritoEntry = { producto: Producto; variante: Variante; cantidad: number }
type Carrito = Record<number, CarritoEntry>

export default function POS() {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [categoriaActiva, setCategoriaActiva] = useState<number | null>(null)
  const [carrito, setCarrito] = useState<Carrito>({})
  // Sin esto, tocar un producto no se sentia como que hizo algo: el carrito
  // esta al lado o abajo, fuera de la vista, y la cajera termina tocando dos
  // o tres veces por duda. El numero en la esquina y el salto son la
  // confirmacion inmediata de que si se agrego.
  const [recienAgregado, setRecienAgregado] = useState<Set<number>>(new Set())
  // Delivery personalizado: cada envio cobra distinto segun la distancia, asi
  // que no encaja como producto de precio fijo (Delivery corto/largo). Va
  // aparte del carrito de variantes porque usa la "venta libre" del backend
  // (nombre_libre + precio_libre) en vez de un variante_id.
  const [libres, setLibres] = useState<{ id: string; nombre: string; precio: number }[]>([])

  // Clave de ESTE intento de comanda. Si la comanda se manda y la respuesta
  // se pierde (se cayo la wifi), volver a darle con la misma clave devuelve
  // el pedido que ya entro en vez de mandar otro igual a cocina.
  //
  // Muere en cuanto el carrito cambia, y eso no es un detalle: si la cajera
  // agrega una empanada despues de un fallo y reintentara con la clave vieja,
  // el servidor le devolveria el pedido anterior -sin la empanada nueva- y
  // nadie se enteraria.
  const claveComanda = useRef<string | null>(null)
  useEffect(() => {
    claveComanda.current = null
  }, [carrito, libres])
  const [pedidosActivos, setPedidosActivos] = useState<Pedido[]>([])
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
  // A nombre de quien va la comanda que se esta armando. Es otro estado que
  // `cliente`: aquel es el del cobro (una comanda ya tomada), este viaja con
  // el pedido cuando se manda a cocina.
  const [clienteComanda, setClienteComanda] = useState('')
  // Con un billete grande, entra mas de lo que cuesta y sale el vuelto.
  const [recibido, setRecibido] = useState('')
  const [vueltoEn, setVueltoEn] = useState('')
  // En que caja se cobra. Se recuerda en la tablet: se elige una vez por
  // turno, no en cada venta. Quien cobra es quien entro con su clave.
  const [puntos, setPuntos] = useState<PuntoVenta[]>([])
  const [puntoId, setPuntoId] = useState<number | null>(() => {
    const v = localStorage.getItem(CLAVE_PUNTO)
    return v ? Number(v) : null
  })
  const [error, setError] = useState('')
  // ── Editar un pedido ya tomado.
  //
  // Mientras este cuadro esta abierto, el servidor tiene la comanda marcada
  // como "en edicion" y la cocina no la puede tocar. Por eso cerrar el cuadro
  // avisa: un candado que solo se suelta al guardar dejaria la comanda
  // trancada cada vez que alguien se arrepiente.
  const [editando, setEditando] = useState<Pedido | null>(null)
  const dialogo = useDialogo()
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
    api.listarPuntosVenta().then(setPuntos).catch(() => {})
    const disconnect = connectWs(() => refrescarPedidos())
    // Respaldo del websocket: si se cayo sin avisar, una comanda que cocina
    // ya termino o anulo se quedaba pintada aqui como si siguiera en cocina.
    // Cada minuto y solo con la pestaña visible.
    const respaldo = setInterval(() => {
      if (document.visibilityState === 'visible') refrescarPedidos()
    }, 60000)
    const alVolver = () => {
      if (document.visibilityState === 'visible') refrescarPedidos()
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      disconnect()
      clearInterval(respaldo)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [])

  /**
   * Lo que esta vivo en el piso, y nada mas: lo que falta por cobrar y lo que
   * esta en cocina.
   *
   * La cola de cocina se pide con `en_cocina`, el MISMO listado que pinta la
   * pantalla de cocina, y no con `estado='pendiente'`. No es lo mismo: cobrar
   * deja el pedido en "pagado" aunque la comida no se haya tocado --pagar
   * antes de que salga es el flujo normal de un mostrador-- y por contar
   * estados el mostrador veia una cosa y la cocina otra.
   */
  function refrescarPedidos() {
    Promise.all([api.listarPedidosEnCocina(), api.listarPedidos('listo')])
      .then(([enCocina, listos]) => {
        const porId = new Map<number, Pedido>()
        for (const p of [...enCocina, ...listos]) porId.set(p.id, p)
        // 0 = listo para cobrar, 1 = en cocina sin cobrar, 2 = cobrado y en
        // cocina. Lo que le toca hacer a la caja va arriba; lo que solo se
        // mira, abajo.
        const peso = (p: Pedido) =>
          p.items.some((i) => !i.preparado) ? (p.estado === 'pagado' ? 2 : 1) : 0
        setPedidosActivos(
          [...porId.values()].sort((a, b) => peso(a) - peso(b) || a.numero - b.numero),
        )
      })
      .catch(() => setPedidosActivos([]))
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
    () =>
      Object.values(carrito).reduce((sum, c) => sum + c.variante.precio * c.cantidad, 0) +
      libres.reduce((sum, l) => sum + l.precio, 0),
    [carrito, libres],
  )

  async function agregarDeliveryPersonalizado() {
    const monto = await dialogo.pedirNumero({
      titulo: 'Delivery personalizado',
      etiqueta: 'Cuánto cobra este envío',
      sufijo: '$',
      min: 0.01,
    })
    if (monto === null) return
    setLibres((l) => [...l, { id: crypto.randomUUID(), nombre: 'Delivery personalizado', precio: monto }])
  }

  function quitarLibre(id: string) {
    setLibres((l) => l.filter((x) => x.id !== id))
  }

  function agregar(producto: Producto, variante: Variante) {
    setCarrito((c) => ({
      ...c,
      [variante.id]: { producto, variante, cantidad: (c[variante.id]?.cantidad ?? 0) + 1 },
    }))
    setRecienAgregado((prev) => new Set(prev).add(variante.id))
    setTimeout(() => {
      setRecienAgregado((prev) => {
        const next = new Set(prev)
        next.delete(variante.id)
        return next
      })
    }, 300)
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
    const items = [
      ...Object.values(carrito).map((c) => ({
        variante_id: c.variante.id,
        cantidad: c.cantidad,
      })),
      ...libres.map((l) => ({
        cantidad: 1,
        nombre_libre: l.nombre,
        precio_libre: l.precio,
        preparado: true,
      })),
    ]
    if (items.length === 0) return
    if (!claveComanda.current) claveComanda.current = crypto.randomUUID()
    const clave = claveComanda.current
    const nombre = clienteComanda.trim()
    try {
      await api.crearPedido(items, false, '', clave, nombre)
      setCarrito({})
      setLibres([])
      setClienteComanda('')
      refrescarPedidos()
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : 'Error al enviar la comanda'
      // El backend bloquea la venta si no hay insumos, pero el conteo del
      // sistema puede estar atrasado y el cajero tiene un cliente enfrente.
      // Se le muestra que falta y el decide; nunca se vende a ciegas.
      if (mensaje.startsWith('No alcanza el inventario')) {
        if (
          await dialogo.confirmar({
            titulo: 'No alcanza el inventario',
            texto: `${mensaje}.\n\nPuedes vender igual y revisar el inventario después.`,
            aceptar: 'Vender igual',
          })
        ) {
          try {
            await api.crearPedido(items, true, '', clave, nombre)
            setCarrito({})
            setLibres([])
            setClienteComanda('')
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
    pagos?: { metodo: string; monto: number; recibido?: number; vuelto_metodo?: string; referencia?: string }[],
    referencia?: string,
    // El nombre recien escrito en un cuadro: `setCliente` no se ha aplicado
    // todavia cuando el cobro sale, y el estado viejo iria vacio.
    clienteAhora?: string,
  ) {
    if (!cobrando) return
    setError('')
    try {
      const cobrado = await api.cobrarPedido(cobrando.id, metodo, facturar, numeroFactura, pagos, {
        descuento: Number(descuento) || 0,
        motivo_descuento: motivoDescuento,
        propina: Number(propina) || 0,
        cliente: clienteAhora ?? cliente,
        punto_venta_id: puntoId,
        referencia,
      })
      limpiarCobro()
      setUltimaVenta(cobrado)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cobrar')
      setCobrando(null)
    }
    refrescarPedidos()
  }

  /**
   * Fiar. Lo unico que hace falta y no siempre esta es el nombre: sin el no
   * hay a quien cobrarle despues, y la deuda nace huerfana.
   *
   * Se pide aqui en vez de dejar el boton apagado. El cajero que ve "A
   * crédito" en gris no deduce que le falta llenar un campo mas arriba:
   * concluye que el sistema no deja fiar.
   */
  async function cobrarACredito() {
    let nombre = cliente.trim()
    if (!nombre) {
      const escrito = await dialogo.pedirTexto({
        titulo: 'Vender a crédito',
        texto: 'Queda como cuenta por cobrar. Se salda después desde Caja.',
        etiqueta: '¿A nombre de quién queda la deuda?',
        aceptar: 'Fiar',
      })
      if (escrito === null) return
      nombre = escrito.trim()
      if (!nombre) {
        setError('Para fiar hace falta el nombre del cliente: si no, no hay a quién cobrarle.')
        return
      }
      // Al estado tambien, para que el cobro lo mande y la pantalla lo muestre.
      setCliente(nombre)
    }
    // Fiar no lleva referencia ni vuelto: no entra plata por ninguna gaveta.
    cobrar('Fiado', undefined, undefined, nombre)
  }

  async function confirmarCobro(metodo: string) {
    // Sin esto un reclamo de "pague por pago movil y no me lo cobraron" es la
    // palabra del cliente contra la del negocio: no hay con que ubicar el
    // comprobante. El backend lo exige igual; se pregunta antes para no
    // mandar el cobro y que rebote.
    const referencia = await pedirReferencia(metodo, dialogo.pedirTexto)
    if (referencia === null) return
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
          referencia,
        },
      ])
      return
    }
    cobrar(metodo, undefined, referencia)
  }

  // El resto del total va al segundo metodo, calculado acá para que los dos
  // pagos sumen exacto y el backend no lo rechace por centavos.
  async function confirmarCobroMixto(segundoMetodo: string) {
    if (!cobrando) return
    const primero = Number(montoParcial)
    const resto = Math.round((aCobrar - primero) * 100) / 100

    // Cada parte que no sea efectivo pide su propia referencia: son dos
    // pagos distintos, con dos comprobantes distintos.
    const refPrimero = await pedirReferencia(metodoParcial, dialogo.pedirTexto)
    if (refPrimero === null) return
    const refSegundo = await pedirReferencia(segundoMetodo, dialogo.pedirTexto)
    if (refSegundo === null) return

    cobrar('Mixto', [
      { metodo: metodoParcial, monto: primero, referencia: refPrimero },
      { metodo: segundoMetodo, monto: resto, referencia: refSegundo },
    ])
  }

  function elegirPunto(id: number | null) {
    setPuntoId(id)
    if (id) localStorage.setItem(CLAVE_PUNTO, String(id))
    else localStorage.removeItem(CLAVE_PUNTO)
  }

  // El ofrecimiento de imprimir se retira solo. Sin esto habia que cerrarlo a
  // mano en cada venta, veinte veces por turno.
  useEffect(() => {
    if (!ultimaVenta) return
    const t = window.setTimeout(() => setUltimaVenta(null), 20000)
    return () => window.clearTimeout(t)
  }, [ultimaVenta])

  async function imprimirTicket(pedidoId: number) {
    try {
      await ticket(pedidoId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar el ticket')
    }
  }

  async function anular(pedido: Pedido) {
    // El sistema adivina segun si algun item quedo marcado "preparado", pero
    // es solo una sugerencia: si la cajera marco el item por error, o la
    // cocina hizo la comida sin tocar la casilla, la adivinanza queda mal y
    // antes no habia forma de corregirla al anular. Ahora se pregunta.
    const yaHecha = pedido.estado === 'listo' || pedido.items.some((i) => i.preparado)
    const eleccion = await dialogo.elegir({
      titulo: `¿Anular el pedido #${pedido.numero}?`,
      texto: `El sistema cree que ${yaHecha ? 'la cocina ya lo preparó' : 'todavía no se preparó'}. Confirma o corrige:`,
      opciones: [
        {
          valor: 'perdida',
          texto: 'Se preparó: es pérdida',
          detalle: 'La comida se botó. Queda como merma y no vuelve al inventario.',
          peligro: !yaHecha, // si el sistema NO lo esperaba, resaltar que es la opcion inusual
        },
        {
          valor: 'inventario',
          texto: 'No se preparó: vuelve al inventario',
          detalle: 'Los insumos que se iban a usar se devuelven al stock.',
          peligro: yaHecha,
        },
      ],
    })
    if (!eleccion) return
    setError('')
    try {
      await api.anularPedido(pedido.id, eleccion === 'perdida')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo anular')
    }
    refrescarPedidos()
  }

  async function editar(pedido: Pedido) {
    const impedimento = porQueNoSeEdita(pedido)
    if (impedimento) {
      setError(impedimento)
      return
    }
    setError('')
    try {
      // Se toma el candado ANTES de que el cajero empiece a tocar renglones:
      // avisarle a la cocina cuando ya se guardo no sirve de nada.
      setEditando(await api.abrirEdicion(pedido.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir la edición')
    }
    refrescarPedidos()
  }

  function cerrarEdicion() {
    // Suelta el candado sin esperar: si la peticion falla, vence solo a los
    // cinco minutos y la cocina sigue igual.
    if (editando) api.soltarEdicion(editando.id).catch(() => {})
    setEditando(null)
    refrescarPedidos()
  }

  const categoria = categorias.find((c) => c.id === categoriaActiva)

  // Lo que espera a que lo cobren va primero: es lo unico de esta pantalla que
  // le toca hacer a quien esta en la caja. Lo que sigue en cocina va debajo,
  // para verlo, no para actuar.
  // Tres situaciones, tres colores. "En cocina" se parte en dos: la comanda
  // que falta cobrar (la caja todavia tiene algo que hacer con ella) y la que
  // ya se cobro y solo espera a que salga la comida (no hay nada que hacer,
  // salvo mirar). Con un solo color para las dos, la cajera tenia que leer
  // cada tarjeta para saber a cual le debia plata el cliente.
  const faltaCocina = (p: Pedido) => p.items.some((i) => !i.preparado)
  const cuantosPorCobrar = pedidosActivos.filter((p) => !faltaCocina(p)).length
  const cuantosEnCocina = pedidosActivos.filter((p) => faltaCocina(p) && p.estado !== 'pagado').length
  const cuantosCobradosEnCocina = pedidosActivos.filter((p) => faltaCocina(p) && p.estado === 'pagado').length

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
            <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3 mb-8">
              {categoria.productos
                .filter((p) => p.activo)
                .flatMap((p) => {
                  const activas = p.variantes.filter((v) => v.activo)
                  // "Regular" nace sola al crear el producto (precio $0) para
                  // que siempre haya algo que vender. Si despues se le agregan
                  // subsecciones de verdad, esa "Regular" queda huerfana y se
                  // mostraba como si fuera el producto: un tile de "Pastelito"
                  // a $0 al lado de "Pastelito - Pollo".
                  const visibles =
                    activas.length > 1 ? activas.filter((v) => v.nombre !== 'Regular') : activas
                  return visibles.map((v) => {
                      const color = colorCategoria(categoria.id)
                      const enCarrito = carrito[v.id]?.cantidad ?? 0
                      const pulsando = recienAgregado.has(v.id)
                      return (
                        <button
                          key={v.id}
                          onClick={() => agregar(p, v)}
                          className={`relative rounded-2xl border-2 p-5 min-h-[104px] flex flex-col justify-between text-left transition shadow-sm ${color.bg} ${color.border} ${
                            pulsando ? 'scale-105' : 'active:scale-95'
                          }`}
                        >
                          {enCarrito > 0 && (
                            <span
                              className={`absolute -top-2 -right-2 min-w-[26px] h-[26px] px-1.5 rounded-full bg-acento-500 text-neutral-50 text-sm font-bold flex items-center justify-center shadow ring-2 ring-white transition ${
                                pulsando ? 'scale-125' : ''
                              }`}
                            >
                              {enCarrito}
                            </span>
                          )}
                          <div className={`font-semibold text-lg leading-tight ${color.text}`}>
                            {v.nombre === 'Regular' ? p.nombre : `${p.nombre} - ${v.nombre}`}
                          </div>
                          <div className="text-neutral-700 font-bold text-lg mt-2">
                            {fmt(v.precio)}
                          </div>
                        </button>
                      )
                    })
                })}
            </div>
          )}

          <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Pedidos en curso
            </h2>
            {/* El color de cada tarjeta dice donde esta el pedido; esto es la
                leyenda, para no tener que aprendersela. */}
            <span className="text-xs text-neutral-400 flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-exito-500" /> {cuantosPorCobrar} listos, falta cobrar
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-aviso-500" /> {cuantosEnCocina} en cocina sin cobrar
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-neutral-400" /> {cuantosCobradosEnCocina} cobrados, en cocina
              </span>
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {pedidosActivos.map((pedido) => {
              // Falta comida por hacer: la misma pregunta que responde la
              // pantalla de cocina, no el estado del pedido. Cobrar deja el
              // pedido en "pagado" aunque no se haya tocado la comida.
              const falta = pedido.items.some((i) => !i.preparado)
              const preparando = enPreparacion(pedido)
              const yaPagado = pedido.estado === 'pagado'
              // Verde: hay que cobrarlo. Ambar: en cocina y todavia sin
              // cobrar. Gris: ya se cobro, solo espera la comida. Que alguien
              // la este preparando se dice con un anillo cobre ENCIMA del
              // color, no en vez de el: si lo reemplazara, un pedido cobrado y
              // uno sin cobrar volverian a verse iguales mientras se cocinan.
              const marco = yaPagado
                ? 'border-neutral-300 bg-neutral-100/70'
                : falta
                  ? 'border-aviso-400 bg-aviso-500/5'
                  : 'border-exito-400 bg-exito-500/5'
              const anillo = preparando ? 'ring-2 ring-acento-500/50' : ''
              return (
              <div key={pedido.id} className={`rounded-2xl shadow-sm border-2 p-4 ${marco} ${anillo}`}>
                <div className="flex justify-between items-start mb-2 gap-2">
                  {/* El numero y, debajo, de quien es. Entre ocho comandas
                      vivas el nombre es lo que las distingue; el numero solo
                      sirve para cantarlo.

                      Debajo y no al lado: en la misma linea competia con la
                      pastilla de estado ("Cobrado · en cocina") y un nombre
                      normal se cortaba en "Sra. Ca...". */}
                  <span className="min-w-0">
                    <span className="block font-bold text-lg leading-tight">#{pedido.numero}</span>
                    {pedido.cliente && (
                      <span className="block text-sm font-semibold text-neutral-600 truncate">
                        {pedido.cliente}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 flex-wrap justify-end">
                    {pedido.editado && (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-aviso-500/20 text-aviso-800">
                        Editado
                      </span>
                    )}
                    {/* Que la cocina ya la tenga no es un detalle de color: es
                        el motivo por el que el boton de editar esta apagado. */}
                    {preparando && (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-acento-500/15 text-acento-800">
                        {pedido.cocinando_por ? `${pedido.cocinando_por} la prepara` : 'En preparación'}
                      </span>
                    )}
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                        yaPagado
                          ? 'bg-neutral-200 text-neutral-700'
                          : falta
                            ? 'bg-aviso-100 text-aviso-700'
                            : 'bg-exito-100 text-exito-700'
                      }`}
                    >
                      {yaPagado ? 'Cobrado · en cocina' : falta ? 'En cocina' : 'Cocina terminó · falta cobrar'}
                    </span>
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
                    {!yaPagado && (
                      <button
                        onClick={() => anular(pedido)}
                        className="text-peligro-500 text-xs font-medium"
                      >
                        Anular
                      </button>
                    )}
                    <button
                      onClick={() => editar(pedido)}
                      disabled={Boolean(porQueNoSeEdita(pedido))}
                      title={porQueNoSeEdita(pedido) ?? 'Cambiar los renglones del pedido'}
                      className="text-neutral-600 text-xs font-medium disabled:opacity-30"
                    >
                      Editar
                    </button>
                    {/* Un pedido cobrado que sigue en cocina se queda a la
                        vista hasta que la comida salga -- pero no se vuelve a
                        cobrar ni se anula: para eso esta Devolver, en Ventas. */}
                    {!yaPagado && (
                      <button
                        onClick={() => {
                          setCobrando(pedido)
                          // Si se anoto al tomar la comanda, el cobro arranca
                          // con el nombre puesto: fiar deja de pedir que se
                          // escriba otra vez lo que ya se escribio.
                          setCliente(pedido.cliente || '')
                        }}
                        className="bg-neutral-900 text-white text-sm px-4 py-2 rounded-xl font-medium"
                      >
                        Cobrar
                      </button>
                    )}
                  </div>
                </div>
              </div>
              )
            })}
            {pedidosActivos.length === 0 && (
              <p className="text-neutral-400 text-sm">
                Nada en curso: ni pedidos por cobrar ni comida en cocina.
              </p>
            )}
          </div>

          {/* A mano por si el cliente vuelve con la comida. Devolver una venta
              cobrada revierte el ingreso y el IVA; anular es solo para las que
              nunca se cobraron. */}
          {/* En que caja se cobra. Quien cobra ya no se elige en un desplegable:
              es quien entro con su clave, y el backend lo anota en cada pedido,
              anulacion y cierre. */}
          {puntos.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 mb-3">
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

        </div>

        <div className="bg-white border-l border-neutral-200 p-4 flex flex-col md:sticky md:top-[105px] md:h-[calc(100vh-105px)]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-lg">Comanda actual</h2>
            {(Object.keys(carrito).length > 0 || libres.length > 0) && (
              <button
                onClick={() => {
                  setCarrito({})
                  setLibres([])
                }}
                className="text-xs font-medium text-neutral-400 hover:text-peligro-500"
              >
                Vaciar
              </button>
            )}
          </div>
          <button
            onClick={agregarDeliveryPersonalizado}
            className="w-full mb-3 text-sm font-medium text-acento-600 hover:text-acento-700 border border-dashed border-acento-300 rounded-xl py-2"
          >
            + Delivery personalizado
          </button>
          {error && <p className="text-peligro-600 text-sm mb-2">{error}</p>}
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
            {libres.map((l) => (
              <div key={l.id} className="flex justify-between items-center gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{l.nombre}</div>
                  <div className="text-xs text-neutral-500">{fmt(l.precio)}</div>
                </div>
                <button
                  onClick={() => quitarLibre(l.id)}
                  className="w-9 h-9 rounded-full bg-neutral-100 hover:bg-neutral-200 font-semibold text-lg shrink-0"
                >
                  ×
                </button>
              </div>
            ))}
            {Object.keys(carrito).length === 0 && libres.length === 0 && (
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
                    className="flex items-center gap-2 rounded-xl border border-exito-300 bg-exito-50 px-3 py-2 text-sm font-medium text-exito-800 active:scale-95 transition"
                  >
                    <span aria-hidden>+</span>
                    <span>{sug.etiqueta}</span>
                    <span className="tabular-nums text-exito-600">{fmt(sug.precio)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-neutral-200 pt-3 mt-3">
            {/* A nombre de quien va. Con ocho comandas vivas, "#14" no le dice
                a nadie de quien es: el cajero termina cantando numeros por el
                mostrador. El nombre viaja al pedido y sale al lado del numero
                aqui, en cocina y en el ticket.

                Opcional a proposito: en un mostrador con cola, obligar a
                escribir un nombre por cada refresco seria un freno. Lo unico
                que SI lo exige es fiar, y por eso se pide aqui -- antes solo
                aparecia en el cobro y el boton de credito se veia trancado
                sin decir por que. */}
            <input
              value={clienteComanda}
              onChange={(e) => setClienteComanda(e.target.value)}
              placeholder="¿A nombre de quién? (opcional)"
              className="w-full border border-neutral-300 rounded-xl px-3 py-2.5 text-sm mb-3"
            />
            <div className="flex justify-between items-baseline font-bold text-xl mb-3">
              <span className="text-sm font-medium text-neutral-500">Total</span>
              <span>{fmt(totalCarrito)}</span>
            </div>
            <button
              onClick={enviarComanda}
              disabled={Object.keys(carrito).length === 0 && libres.length === 0}
              className="w-full bg-neutral-900 text-white rounded-2xl py-4 font-semibold text-base disabled:opacity-30"
            >
              Enviar comanda a cocina
            </button>
          </div>
        </div>
      </div>

      {/* El comprobante del cliente, ofrecido SIN estorbar.
          Era una barra negra en el centro de la pantalla que se quedaba hasta
          que alguien la cerraba: tapaba la comanda siguiente y parecia un
          aviso urgente cuando solo es una comodidad -- casi nadie pide
          ticket. Ahora es una pastilla chica en la esquina, del color de la
          pantalla, y se va sola a los 20 s. Si se fue, el ticket se imprime
          igual desde Ventas. */}
      {ultimaVenta && (
        <button
          type="button"
          onClick={() => imprimirTicket(ultimaVenta.id)}
          title={`Imprimir el ticket del pedido #${ultimaVenta.numero}`}
          className="fixed bottom-3 left-3 z-30 flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white/90 backdrop-blur px-3 py-1.5 text-xs font-medium text-neutral-500 shadow-sm hover:text-neutral-900 hover:border-neutral-400"
          style={{ animation: 'vp-entrar .18s cubic-bezier(.2,.7,.2,1) both' }}
        >
          <Icono nombre="ventas" size={14} />
          Imprimir #{ultimaVenta.numero}
        </button>
      )}

      {/* Vive en su propio componente porque Ventas abre exactamente el mismo
          cuadro: dos copias serian dos reglas distintas para la misma clave. */}
      {editando && (
        <EditarPedido
          pedido={editando}
          onGuardado={() => {
            setEditando(null)
            refrescarPedidos()
          }}
          onCerrar={cerrarEdicion}
        />
      )}

      {cobrando && (
        <Modal
          titulo={`Cobrar pedido #${cobrando.numero}`}
          onCerrar={limpiarCobro}
          ancho="sm"
          pie={
            <Boton tono="fantasma" onClick={limpiarCobro}>
              Cancelar
            </Boton>
          }
        >
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
            <p className="text-aviso-600 text-xs mb-3">
              Sin tasa de cambio cargada -{' '}
              <a href="/tasa" className="underline font-medium">
                configúrala aquí
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
              <Numerico
                value={descuento}
                onChange={(e) => setDescuento(e.target.value)}
                placeholder="0.00"
                className="w-full border border-neutral-300 rounded-lg px-2 py-1.5 text-sm text-neutral-900"
              />
            </label>
            {/* La propina no es venta: entra a la gaveta y se le debe al
                empleado hasta que se le entrega. */}
            <label className="text-xs text-neutral-500">
              Propina
              <Numerico
                value={propina}
                onChange={(e) => setPropina(e.target.value)}
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
              Con cuánto pagó
              <Numerico
                value={recibido}
                onChange={(e) => setRecibido(e.target.value)}
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
            <p className="mt-1 text-sm font-semibold text-exito-700 tabular-nums">
              Vuelto: ${vuelto.toFixed(2)}
              {tasaBcv > 0 && vueltoEn === 'Efectivo Bs' && ` - ${fmtBs(vuelto * tasaBcv)}`}
            </p>
          )}

          {/* Viene puesto si se anoto al tomar la comanda; aqui se corrige o
              se agrega. Solo fiar lo exige, y ese boton lo pide si falta. */}
          <input
            value={cliente}
            onChange={(e) => setCliente(e.target.value)}
            placeholder="Cliente (opcional, salvo a crédito)"
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
                {/* No entra plata: nace una cuenta por cobrar.

                    El boton ya NO se apaga cuando falta el nombre. Apagado
                    con un `title` de explicacion era invisible en la tablet
                    --no hay raton que se pose encima-- y se leia como que
                    vender a credito estaba deshabilitado en el sistema. Ahora
                    se pulsa siempre y, si falta el nombre, se pide: el
                    requisito se explica en el momento en que estorba. */}
                <button
                  onClick={cobrarACredito}
                  className="bg-aviso-100 hover:bg-aviso-200 rounded-xl py-3 text-sm font-medium"
                >
                  A crédito
                </button>
              </div>
              <button
                onClick={() => setPagoMixto(true)}
                className="w-full text-sm font-medium text-acento-600 mb-3 py-1"
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
                <Numerico
                  value={montoParcial}
                  onChange={(e) => setMontoParcial(e.target.value)}
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
                    {etiquetaMetodo(m)}
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
        </Modal>
      )}
    </div>
  )
}
