import { useEffect, useMemo, useRef, useState } from 'react'
import NavBar from '../components/NavBar'
import { useDialogo } from '../components/dialogo'
import { Boton, Campo, Modal, Selector } from '../components/ui'
import { api, connectWs } from '../lib/api'
import { enPreparacion, porQueNoSeEdita } from '../lib/comandas'
import { fmtBs, useMoneda } from '../lib/moneda'
import { colorCategoria } from '../lib/theme'
import { METODOS_CON_REFERENCIA, METODOS_PAGO, etiquetaMetodo, pedirReferencia } from '../lib/pagos'
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

/**
 * Un renglon dentro del cuadro de edicion.
 *
 * `precio` viaja en la linea en vez de leerse del menu cada vez, y es lo que
 * hace que el total que ve el cajero sea el mismo que va a calcular el
 * servidor: un renglon que ya estaba conserva el precio al que se le dijo al
 * cliente, aunque el menu haya subido mientras el pedido estaba abierto.
 */
type LineaEdicion = {
  clave: string
  variante_id: number | null
  nombre: string
  precio: number
  cantidad: number
}

function lineasDePedido(pedido: Pedido): LineaEdicion[] {
  return pedido.items.map((i) => ({
    clave: i.variante_id !== null ? `v${i.variante_id}` : `libre:${i.nombre}:${i.precio_unitario}`,
    variante_id: i.variante_id,
    nombre: i.nombre,
    precio: i.precio_unitario,
    cantidad: i.cantidad,
  }))
}

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
  const [lineas, setLineas] = useState<LineaEdicion[]>([])
  const [motivoEdicion, setMotivoEdicion] = useState('')
  const [buscarEnMenu, setBuscarEnMenu] = useState('')
  const [usuarioAutoriza, setUsuarioAutoriza] = useState('')
  const [claveAutoriza, setClaveAutoriza] = useState('')
  const [metodoDiferencia, setMetodoDiferencia] = useState(METODOS_PAGO[0])
  const [referenciaDiferencia, setReferenciaDiferencia] = useState('')
  const [errorEdicion, setErrorEdicion] = useState('')
  const [guardandoEdicion, setGuardandoEdicion] = useState(false)
  const dialogo = useDialogo()
  const [ultimaVenta, setUltimaVenta] = useState<Pedido | null>(null)
  const { tasa, fmt } = useMoneda()
  const tasaBcv = tasa?.bcv ?? 0

  // Lo que de verdad se recibe: la comida menos el descuento, mas la propina.
  const subtotalCobro = cobrando?.total ?? 0
  const descuentoNum = Math.min(Number(descuento) || 0, subtotalCobro)
  const aCobrar = Math.round((subtotalCobro - descuentoNum + (Number(propina) || 0)) * 100) / 100
  const vuelto = Math.max(Math.round(((Number(recibido) || 0) - aCobrar) * 100) / 100, 0)

  // Lo que va a costar el pedido despues de la edicion. Se calcula igual que
  // en el servidor -- el descuento ya concedido se respeta -- para que el
  // numero que el cajero le dice al cliente sea el que se va a cobrar.
  const subtotalEditado =
    Math.round(lineas.reduce((t, l) => t + l.precio * l.cantidad, 0) * 100) / 100
  const totalEditado = editando
    ? Math.max(Math.round((subtotalEditado - (editando.descuento || 0)) * 100) / 100, 0)
    : 0
  const diferencia = editando ? Math.round((totalEditado - editando.total) * 100) / 100 : 0
  // Solo una venta YA COBRADA tiene plata que cuadrar. Si todavia no se ha
  // cobrado, cambiar renglones es simplemente tomar bien el pedido.
  const pideAutorizacion = Boolean(editando && editando.estado === 'pagado' && diferencia !== 0)

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
    const r = await dialogo.pedir({
      titulo: `Devolver el pedido #${pedido.numero}`,
      texto:
        `Se le regresan ${fmt(pedido.total)} al cliente y la venta se revierte entera: deja de contar como ` +
        'ingreso y deja de deber IVA.',
      campos: [
        { nombre: 'motivo', etiqueta: 'Qué pasó', valor: 'La comida estaba mala' },
        // Define si el costo vuelve al inventario o se reconoce como merma.
        {
          nombre: 'recuperable',
          etiqueta: 'La comida se puede volver a vender',
          tipo: 'opciones',
          opciones: [
            { valor: 'no', texto: 'No, se bota (se registra como merma)' },
            { valor: 'si', texto: 'Sí, vuelve al inventario' },
          ],
        },
        // Sin la nota de credito la factura no puede salir del Libro de Ventas.
        ...(pedido.facturado
          ? [{ nombre: 'nc', etiqueta: `Número de la nota de crédito (factura ${pedido.numero_factura})` }]
          : []),
      ],
      aceptar: 'Devolver',
      peligro: true,
    })
    if (!r) return
    const motivo = r.motivo
    const recuperable = r.recuperable === 'si'
    const nota_credito = pedido.facturado ? r.nc : undefined

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
    try {
      await api.crearPedido(items, false, '', clave)
      setCarrito({})
      setLibres([])
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
            await api.crearPedido(items, true, '', clave)
            setCarrito({})
            setLibres([])
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
  ) {
    if (!cobrando) return
    setError('')
    try {
      const cobrado = await api.cobrarPedido(cobrando.id, metodo, facturar, numeroFactura, pagos, {
        descuento: Number(descuento) || 0,
        motivo_descuento: motivoDescuento,
        propina: Number(propina) || 0,
        cliente,
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
        ${t.operador ? `<div class="c">Le atendió: ${t.operador}</div>` : ''}
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
        ${t.total_bs ? linea('En bolívares', fmtBs(t.total_bs)) : ''}
        ${t.tasa_bcv ? `<div class="c" style="font-size:10px">tasa ${t.tasa_bcv}</div>` : ''}
        ${t.facturado && t.base_imponible != null ? '<hr>' : ''}
        ${t.facturado && t.base_imponible != null ? linea('Base imponible', `$${t.base_imponible.toFixed(2)}`) : ''}
        ${t.facturado && t.iva != null ? linea('IVA', `$${t.iva.toFixed(2)}`) : ''}
        ${t.numero_factura ? `<div class="c">Factura ${t.numero_factura}</div>` : ''}
        <hr>
        ${t.pagos
          .map(
            (p) =>
              linea(etiquetaMetodo(p.metodo), `$${p.monto.toFixed(2)}`) +
              (p.referencia ? `<div class="c" style="font-size:10px">ref. ${p.referencia}</div>` : '') +
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
      const fresco = await api.abrirEdicion(pedido.id)
      setEditando(fresco)
      setLineas(lineasDePedido(fresco))
      setMotivoEdicion('')
      setBuscarEnMenu('')
      setUsuarioAutoriza('')
      setClaveAutoriza('')
      setReferenciaDiferencia('')
      setErrorEdicion('')
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
    setLineas([])
    setClaveAutoriza('')
    refrescarPedidos()
  }

  function cambiarLinea(clave: string, delta: number) {
    setLineas((prev) =>
      prev
        .map((l) => (l.clave === clave ? { ...l, cantidad: l.cantidad + delta } : l))
        .filter((l) => l.cantidad > 0),
    )
  }

  function agregarAlEditado(producto: Producto, variante: Variante) {
    const clave = `v${variante.id}`
    setLineas((prev) => {
      const ya = prev.find((l) => l.clave === clave)
      if (ya) return prev.map((l) => (l.clave === clave ? { ...l, cantidad: l.cantidad + 1 } : l))
      const nombre =
        variante.nombre && variante.nombre.toLowerCase() !== 'regular'
          ? `${producto.nombre} - ${variante.nombre}`
          : producto.nombre
      return [...prev, { clave, variante_id: variante.id, nombre, precio: variante.precio, cantidad: 1 }]
    })
  }

  async function guardarEdicion() {
    if (!editando) return
    setErrorEdicion('')
    if (lineas.length === 0) {
      setErrorEdicion('Un pedido no puede quedar vacío. Si ya no va, anúlalo.')
      return
    }
    if (pideAutorizacion && (!usuarioAutoriza.trim() || !claveAutoriza)) {
      setErrorEdicion('La diferencia de dinero necesita usuario y clave de quien la autoriza.')
      return
    }
    setGuardandoEdicion(true)
    try {
      await api.editarPedido(
        editando.id,
        lineas.map((l) =>
          l.variante_id !== null
            ? { variante_id: l.variante_id, cantidad: l.cantidad }
            : { variante_id: null, cantidad: l.cantidad, nombre_libre: l.nombre, precio_libre: l.precio },
        ),
        {
          motivo: motivoEdicion,
          autorizacion: pideAutorizacion
            ? { usuario: usuarioAutoriza.trim(), clave: claveAutoriza }
            : undefined,
          // El monto va en positivo: el signo lo pone la diferencia. Pedirle al
          // cajero que escriba -3.00 para una devolucion es pedirle que se
          // equivoque.
          pagos: pideAutorizacion
            ? [
                {
                  metodo: metodoDiferencia,
                  monto: Math.abs(diferencia),
                  referencia: referenciaDiferencia,
                },
              ]
            : undefined,
        },
      )
      setEditando(null)
      setLineas([])
      setClaveAutoriza('')
      refrescarPedidos()
    } catch (e) {
      setErrorEdicion(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setGuardandoEdicion(false)
    }
  }

  const categoria = categorias.find((c) => c.id === categoriaActiva)

  // Todo el menu en una lista, para el buscador del cuadro de edicion: ahi no
  // hay espacio para las pestañas de categoria y lo que se necesita es teclear
  // tres letras y tocar.
  const platosDelMenu = useMemo(
    () =>
      categorias
        .filter((c) => c.activo)
        .flatMap((c) =>
          c.productos
            .filter((pr) => pr.activo)
            .flatMap((pr) => pr.variantes.filter((v) => v.activo).map((v) => ({ producto: pr, variante: v }))),
        ),
    [categorias],
  )

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
                .flatMap((p) =>
                  p.variantes
                    .filter((v) => v.activo)
                    .map((v) => {
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
                <div className="flex justify-between items-center mb-2 gap-2">
                  <span className="font-bold text-lg">#{pedido.numero}</span>
                  <span className="flex items-center gap-1.5 flex-wrap justify-end">
                    {pedido.editado && (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-aviso-500/20 text-aviso-800">
                        Editado
                      </span>
                    )}
                    {/* Que la cocina ya la tenga no es un detalle de color: es
                        el motivo por el que el boton de editar esta apagado. */}
                    {enPreparacion(pedido) && (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-acento-500/15 text-acento-800">
                        {pedido.cocinando_por ? `${pedido.cocinando_por} la prepara` : 'En preparación'}
                      </span>
                    )}
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                        pedido.estado === 'listo'
                          ? 'bg-exito-100 text-exito-700'
                          : 'bg-aviso-100 text-aviso-700'
                      }`}
                    >
                      {pedido.estado === 'listo' ? 'Listo para cobrar' : 'En cocina'}
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
                    <button
                      onClick={() => anular(pedido)}
                      className="text-peligro-500 text-xs font-medium"
                    >
                      Anular
                    </button>
                    <button
                      onClick={() => editar(pedido)}
                      disabled={Boolean(porQueNoSeEdita(pedido))}
                      title={porQueNoSeEdita(pedido) ?? 'Cambiar los renglones del pedido'}
                      className="text-neutral-600 text-xs font-medium disabled:opacity-30"
                    >
                      Editar
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
                      {v.editado && (
                        <span
                          className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-aviso-500/20 text-aviso-800 shrink-0"
                          title={v.ediciones.map((e) => e.detalle).join(' | ')}
                        >
                          Editada
                        </span>
                      )}
                      {v.operador && (
                        <span className="text-[10px] text-neutral-400 shrink-0" title="Quien cobro">
                          · {v.operador}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-3 shrink-0">
                      <span className="tabular-nums">{fmt(v.total)}</span>
                      {v.devuelto ? (
                        <span className="text-xs text-neutral-500">devuelta</span>
                      ) : (
                        <>
                          <button
                            onClick={() => editar(v)}
                            disabled={Boolean(porQueNoSeEdita(v))}
                            title={porQueNoSeEdita(v) ?? 'Corregir lo que se cobró'}
                            className="text-xs font-medium text-neutral-600 disabled:opacity-30"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => devolver(v)}
                            className="text-xs font-medium text-aviso-700"
                          >
                            Devolver
                          </button>
                        </>
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

      {editando && (
        <Modal
          titulo={`Editar pedido #${editando.numero}`}
          ayuda={
            editando.estado === 'pagado'
              ? 'Esta venta ya está cobrada: si el monto cambia hará falta una clave y decir por dónde entra o sale la diferencia.'
              : 'La cocina tiene esta comanda bloqueada mientras el cuadro esté abierto.'
          }
          onCerrar={cerrarEdicion}
          ancho="lg"
          pie={
            <div className="flex items-center justify-between w-full gap-3">
              <Boton tono="fantasma" onClick={cerrarEdicion}>
                Cancelar
              </Boton>
              <Boton onClick={guardarEdicion} disabled={guardandoEdicion || lineas.length === 0}>
                {guardandoEdicion ? 'Guardando…' : 'Guardar cambios'}
              </Boton>
            </div>
          }
        >
          {errorEdicion && <p className="text-peligro-600 text-sm mb-3">{errorEdicion}</p>}

          <div className="space-y-2 mb-4">
            {lineas.map((l) => (
              <div key={l.clave} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{l.nombre}</div>
                  <div className="text-xs text-neutral-500">
                    {l.cantidad} x {fmt(l.precio)} ={' '}
                    <span className="font-semibold text-neutral-700">{fmt(l.precio * l.cantidad)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => cambiarLinea(l.clave, -1)}
                    className="w-9 h-9 rounded-full bg-neutral-100 hover:bg-neutral-200 font-semibold text-lg"
                  >
                    -
                  </button>
                  <span className="w-6 text-center font-semibold tabular-nums">{l.cantidad}</span>
                  <button
                    onClick={() => cambiarLinea(l.clave, 1)}
                    className="w-9 h-9 rounded-full bg-neutral-100 hover:bg-neutral-200 font-semibold text-lg"
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
            {lineas.length === 0 && (
              <p className="text-sm text-peligro-600">
                No queda ningún renglón. Un pedido vacío se anula, no se guarda.
              </p>
            )}
          </div>

          <input
            value={buscarEnMenu}
            onChange={(e) => setBuscarEnMenu(e.target.value)}
            placeholder="Agregar del menú: escribe para buscar"
            className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mb-2"
          />
          {buscarEnMenu.trim().length > 0 && (
            <div className="grid grid-cols-2 gap-2 mb-4 max-h-44 overflow-y-auto">
              {platosDelMenu
                .filter(({ producto, variante }) =>
                  `${producto.nombre} ${variante.nombre}`
                    .toLowerCase()
                    .includes(buscarEnMenu.trim().toLowerCase()),
                )
                .slice(0, 12)
                .map(({ producto, variante }) => (
                  <button
                    key={variante.id}
                    onClick={() => agregarAlEditado(producto, variante)}
                    className="text-left bg-neutral-100 hover:bg-neutral-200 rounded-xl px-3 py-2 text-sm"
                  >
                    <span className="font-medium">
                      {variante.nombre && variante.nombre.toLowerCase() !== 'regular'
                        ? `${producto.nombre} - ${variante.nombre}`
                        : producto.nombre}
                    </span>
                    <span className="block text-xs text-neutral-500">{fmt(variante.precio)}</span>
                  </button>
                ))}
            </div>
          )}

          <div className="border-t border-neutral-200 pt-3 text-sm space-y-1">
            <div className="flex justify-between text-neutral-500">
              <span>Antes</span>
              <span className="tabular-nums">{fmt(editando.total)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Queda en</span>
              <span className="tabular-nums">{fmt(totalEditado)}</span>
            </div>
            {diferencia !== 0 && (
              <div
                className={`flex justify-between font-semibold ${
                  diferencia > 0 ? 'text-exito-700' : 'text-aviso-700'
                }`}
              >
                <span>{diferencia > 0 ? 'El cliente paga de más' : 'Se le devuelve al cliente'}</span>
                <span className="tabular-nums">{fmt(Math.abs(diferencia))}</span>
              </div>
            )}
          </div>

          {/* La clave no se pide por cambiar renglones: se pide por mover plata
              de una venta ya cobrada. Un pedido sin cobrar no pide nada, y una
              edicion que da exacta tampoco -- pedir clave siempre entrena a la
              gente para que la clave no signifique nada. */}
          {pideAutorizacion && (
            <div className="mt-4 rounded-xl bg-aviso-500/10 ring-1 ring-aviso-500/30 p-3 space-y-3">
              <p className="text-sm font-semibold text-aviso-900">
                Esta venta ya está cobrada y el monto cambia en {fmt(Math.abs(diferencia))}.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Campo
                  etiqueta="Autoriza (usuario)"
                  value={usuarioAutoriza}
                  onChange={(e) => setUsuarioAutoriza(e.target.value)}
                  autoComplete="off"
                />
                <Campo
                  etiqueta="Clave"
                  type="password"
                  value={claveAutoriza}
                  onChange={(e) => setClaveAutoriza(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <Selector
                etiqueta={diferencia > 0 ? 'Cómo se cobra la diferencia' : 'Cómo se devuelve'}
                value={metodoDiferencia}
                onChange={(e) => setMetodoDiferencia(e.target.value)}
              >
                {METODOS_PAGO.map((m) => (
                  <option key={m} value={m}>
                    {etiquetaMetodo(m)}
                  </option>
                ))}
              </Selector>
              {METODOS_CON_REFERENCIA.has(metodoDiferencia) && (
                <Campo
                  etiqueta="Referencia"
                  value={referenciaDiferencia}
                  onChange={(e) => setReferenciaDiferencia(e.target.value)}
                  ayuda="El número del pago móvil, el ticket del punto o el comprobante."
                />
              )}
            </div>
          )}

          <Campo
            etiqueta="Por qué se edita"
            className="mt-4"
            value={motivoEdicion}
            onChange={(e) => setMotivoEdicion(e.target.value)}
            placeholder="El cliente cambió de idea"
          />

          {editando.ediciones.length > 0 && (
            <div className="mt-4 text-xs text-neutral-500 space-y-1">
              <p className="font-semibold uppercase tracking-wide">Ya se editó antes</p>
              {editando.ediciones.map((e) => (
                <p key={e.id}>
                  {e.detalle}
                  {e.diferencia !== 0 && ` · ${fmt(e.diferencia)}`}
                  {e.autorizado_por && ` · autorizó ${e.autorizado_por}`}
                </p>
              ))}
            </div>
          )}
        </Modal>
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
              Con cuánto pagó
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
            <p className="mt-1 text-sm font-semibold text-exito-700 tabular-nums">
              Vuelto: ${vuelto.toFixed(2)}
              {tasaBcv > 0 && vueltoEn === 'Efectivo Bs' && ` - ${fmtBs(vuelto * tasaBcv)}`}
            </p>
          )}

          {/* A credito: sin nombre no hay a quien cobrarle. */}
          <input
            value={cliente}
            onChange={(e) => setCliente(e.target.value)}
            placeholder="Cliente (obligatorio si es a crédito)"
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
                  className="bg-aviso-100 hover:bg-aviso-200 rounded-xl py-3 text-sm font-medium disabled:opacity-40"
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
