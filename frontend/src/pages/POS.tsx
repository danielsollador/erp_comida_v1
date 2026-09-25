import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import EditarPedido from '../components/EditarPedido'
import Autorizar from '../components/Autorizar'
import { useSeccion } from '../components/Secciones'
import NavBar from '../components/NavBar'
import Icono from '../components/Icono'
import { useDialogo } from '../components/dialogo'
import { Boton, Campo, Modal, Selector } from '../components/ui'
import { Numerico } from '../components/Teclado'
import { AbrirCaja, useApertura } from '../components/abrirCaja'
import { api, connectWs } from '../lib/api'
import { enPreparacion, estadoCocina, porQueNoSeEdita } from '../lib/comandas'
import { fmtBs, useMoneda } from '../lib/moneda'
import { imprimirTicket as ticket } from '../lib/ticket'
import { uuid } from '../lib/uuid'
import { colorCategoria } from '../lib/theme'
import { useModoLigero } from '../lib/ligero'
import { etiquetaVariante, variantesParaVender } from '../lib/menu'
import { METODOS_CON_REFERENCIA, METODOS_PAGO, etiquetaMetodo, pedirReferencia } from '../lib/pagos'
import { useAcceso } from '../lib/acceso'
import type {
  Autorizacion,
  Categoria,
  Pedido,
  Producto,
  PuntoVenta,
  Variante,
} from '../lib/types'

// METODOS_PAGO y METODOS_CON_REFERENCIA viven en lib/pagos porque la regla no
// es del punto de venta: Caja y Ventas tambien aplican pagos y tenian su
// propia lista, que fue justo como el cobro a credito termino aceptando un
// pago movil sin comprobante.
// Las dos gavetas fisicas. Un cobro en efectivo no se resuelve de un toque:
// hay que saber si el cliente paga exacto o hay vuelto (ver el panel de
// cobro), porque de eso depende cuanta plata queda en la gaveta.
const METODOS_EFECTIVO = ['Efectivo Bs', 'Efectivo $']

// Por donde puede SALIR el vuelto. No estan tarjeta ni punto de venta: un
// terminal no devuelve plata. El pago movil si: es lo que se hace cuando en
// la gaveta no hay sencillo.
const METODOS_VUELTO = ['Efectivo $', 'Efectivo Bs', 'Pago movil', 'Transferencia', 'Zelle']

// Los billetes que de verdad andan en la calle, para tocar en vez de teclear.
const BILLETES_USD = [1, 5, 10, 20, 50, 100]

/** Un monto tecleado, con coma o con punto. El teclado del ERP escribe punto,
 *  pero el del telefono en español escribe coma: sin esto "20,50" era cero y
 *  el cobro se quedaba trancado diciendo que el billete no alcanza. */
function monto(v: string): number {
  return Number(String(v).replace(',', '.')) || 0
}
const CLAVE_PUNTO = 'erp-punto-venta'

// `cortesia`: el renglon entero se regala (Leider, 22-sep: "le quiero regalar
// un cafe"). No se cobra, si descuenta inventario, y su costo va a gasto de
// cortesias y no a costo de ventas, para que la caja cierre y el margen del
// producto no mienta.
//
// `precio`: el que ya se le dijo al cliente, cuando se esta editando un pedido
// ya tomado. El servidor conserva ese precio aunque el menu haya cambiado, y
// la pantalla tiene que sumar lo mismo que el.
type CarritoEntry = {
  producto: Producto
  variante: Variante
  cantidad: number
  cortesia: boolean
  precio?: number
}
type Carrito = Record<number, CarritoEntry>

// Un renglon suelto de la comanda: el envio (del menu, con el monto que se le
// dice en cada pedido) o la venta libre.
type Libre = { id: string; nombre: string; precio: number; variante_id?: number }

// Dos pantallas y no una: tomar el pedido ocupa la tablet entera, y lo ya
// tomado se mira aparte (el cliente, 23-sep: las dimensiones de la tablet no
// terminaban de encajar con las dos cosas juntas).
const SECCIONES_POS = [
  { id: 'tomar', texto: 'Tomar pedido' },
  { id: 'pedidos', texto: 'Pedidos' },
]

/** El nombre sin tildes ni mayusculas: "Envíos" y "envios" son la misma. */
function sinTildes(texto: string) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

// Que pedido se estaba editando en ESTA pestaña, para retomarlo si se recarga.
const CLAVE_EDICION = 'erp-pos-editando'

function recordarEdicion(id: number | null) {
  try {
    if (id === null) sessionStorage.removeItem(CLAVE_EDICION)
    else sessionStorage.setItem(CLAVE_EDICION, String(id))
  } catch {
    // sin almacenamiento: al recargar simplemente no se retoma
  }
}

function edicionRecordada(): number | null {
  try {
    const v = sessionStorage.getItem(CLAVE_EDICION)
    return v ? Number(v) || null : null
  } catch {
    return null
  }
}

export default function POS() {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  // Que categoria se ve en la lista: una, o todas con su seccion cada una.
  // Arranca en "todas": la cajera ve el menu entero de una pasada y las
  // secciones le dicen donde esta cada cosa (Leider, 22-sep: "haz mas facil
  // ver todas las categorias").
  const [categoriaActiva, setCategoriaActiva] = useState<number | 'todas'>('todas')
  // La lista de productos es UNA lista, siempre: renglones agrupados por
  // categoria, que se quedan a la vista mientras se tocan varios. Antes eran
  // fichas grandes (decenas de nodos con sombra y borde) y luego un <select>
  // que se cerraba en cada eleccion: dos toques por producto. Se pliega con
  // el encabezado cuando lo que hace falta es ver las comandas.
  const [listaAbierta, setListaAbierta] = useState(true)
  // Pantalla que vive horas abierta en la tablet: sin desenfoques ni
  // animaciones (lib/ligero).
  useModoLigero()
  const [carrito, setCarrito] = useState<Carrito>({})
  // Sin esto, tocar un producto no se sentia como que hizo algo: el carrito
  // esta al lado o abajo, fuera de la vista, y la cajera termina tocando dos
  // o tres veces por duda. El numero en la esquina y el salto son la
  // confirmacion inmediata de que si se agrego.
  const [recienAgregado, setRecienAgregado] = useState<Set<number>>(new Set())
  // Abrir la caja es lo primero del turno y lo hace quien atiende, no quien
  // administra. Por eso el botón vive aquí y no solo en Cierre de caja: en el
  // otro módulo simplemente no se haría.
  const { estado: apertura, recargar: recargarApertura } = useApertura()
  const [abriendoCaja, setAbriendoCaja] = useState(false)
  // Se enciende al intentar comandar sin nombre y se apaga al escribir: el
  // campo en rojo dice DÓNDE está el problema, que un mensaje al pie solo no
  // consigue cuando la pantalla es larga.
  const [faltaNombre, setFaltaNombre] = useState(false)
  // Delivery personalizado: cada envio cobra distinto segun la distancia, asi
  // que no encaja como producto de precio fijo (Delivery corto/largo). Va
  // aparte del carrito de variantes porque usa la "venta libre" del backend
  // (nombre_libre + precio_libre) en vez de un variante_id.
  const [libres, setLibres] = useState<Libre[]>([])

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
  // Lo ultimo que se pinto, para no repintar cuando el servidor manda lo mismo.
  const firmaPedidos = useRef('')
  const [vista, irAVista] = useSeccion(SECCIONES_POS)
  // Pago mixto: las partes que ya se anotaron. Antes era un desplegable con
  // UNA forma y un monto, y el resto se lo llevaba entera la segunda: no se
  // podia partir en tres, y para saber cuanto faltaba habia que restar de
  // cabeza (Leider, 22-sep). Ahora cada parte se agrega con su monto y lo que
  // falta se calcula solo.
  const [pagoMixto, setPagoMixto] = useState(false)
  const [partes, setPartes] = useState<{ metodo: string; monto: number; referencia: string }[]>([])
  const [cobrando, setCobrando] = useState<Pedido | null>(null)
  const [facturar, setFacturar] = useState(false)
  const [numeroFactura, setNumeroFactura] = useState('')
  // Lo que cambia cuanta plata entra: rebaja al cliente y propina del mesonero.
  const [descuento, setDescuento] = useState('')
  const [motivoDescuento, setMotivoDescuento] = useState('')
  const [propina, setPropina] = useState('')
  const [cliente, setCliente] = useState('')
  // A nombre de quien va la comanda que se esta armando. Es otro estado que
  // `cliente`: aquel es el del cobro (una comanda ya tomada), este viaja con
  // el pedido cuando se manda a cocina.
  const [clienteComanda, setClienteComanda] = useState('')
  // El cobro en efectivo va por pasos: primero si paga exacto o con un
  // billete mas grande, y si hay vuelto, con cuanto paga y por donde se le
  // devuelve. Antes era un campo opcional --"Con cuanto pago"-- que casi
  // nadie llenaba con un cliente esperando: la gaveta cerraba con un
  // sobrante que nadie sabia explicar, y el vuelto dado en bolivares por una
  // venta en dolares no aparecia en ninguna parte.
  const [efectivo, setEfectivo] = useState<{ metodo: string; conVuelto: boolean } | null>(null)
  const [billete, setBillete] = useState('')
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
  // El pedido que se esta editando EN la pantalla de tomar pedido: sus
  // renglones se cargan en la comanda y se cambian como si se tomara de
  // cero (el cliente, 23-sep: nada de ventana flotante). `editando`, el
  // cuadro, queda solo para lo que la comanda no sabe mostrar.
  const [enEdicion, setEnEdicion] = useState<Pedido | null>(null)
  // Guardar una edicion que mueve plata de una venta cobrada: falta la
  // firma y por donde entra o sale la diferencia.
  const [diferencia, setDiferencia] = useState<{
    destinoDe: Record<number, boolean>
    monto: number
  } | null>(null)
  const [firma, setFirma] = useState<Autorizacion | null>(null)
  const [metodoDif, setMetodoDif] = useState(METODOS_PAGO[0])
  const [referenciaDif, setReferenciaDif] = useState('')
  const { estado: acceso } = useAcceso()
  const yo = acceso.nombre_visible || acceso.usuario
  const dialogo = useDialogo()
  const [ultimaVenta, setUltimaVenta] = useState<Pedido | null>(null)
  // Las ventas de hoy, para consultarlas sin salir del mostrador. `null` es
  // cerrado; se piden al abrir, no al cargar la pantalla: se miran de vez en
  // cuando y el punto de venta tiene que arrancar rapido.
  const [ventasHoy, setVentasHoy] = useState<Pedido[] | null>(null)
  const [cargandoVentas, setCargandoVentas] = useState(false)
  const { tasa, fmt } = useMoneda()
  const tasaBcv = tasa?.bcv ?? 0

  // Lo que de verdad se recibe: la comida menos el descuento, mas la propina.
  const subtotalCobro = cobrando?.total ?? 0
  const descuentoNum = Math.min(Number(descuento) || 0, subtotalCobro)
  const aCobrar = Math.round((subtotalCobro - descuentoNum + (Number(propina) || 0)) * 100) / 100
  // Lo que entrego el cliente, SIEMPRE en dolares: en la gaveta de bolivares
  // el cajero teclea bolivares --que es lo que tiene en la mano-- y se
  // convierte a la tasa del dia, que es como se guarda la venta.
  const enBs = efectivo?.metodo === 'Efectivo Bs'
  const billeteNum = monto(billete)
  const entregado = enBs
    ? tasaBcv > 0
      ? Math.round((billeteNum / tasaBcv) * 100) / 100
      : 0
    : billeteNum
  const vuelto = Math.max(Math.round((entregado - aCobrar) * 100) / 100, 0)
  // Lo que queda por cubrir en un pago mixto.
  const faltaMixto = Math.max(
    Math.round((aCobrar - partes.reduce((t, p) => t + p.monto, 0)) * 100) / 100,
    0,
  )


  useEffect(() => {
    // Solo lo que esta en el menu hoy: una categoria retirada conserva sus
    // ventas historicas pero no se debe poder seguir vendiendo.
    api.listarCategorias().then((todas) => {
      setCategorias(todas.filter((c) => c.activo))
    })
    refrescarPedidos()
    api.listarPuntosVenta().then(setPuntos).catch(() => {})
    // Varios eventos seguidos (se cobra, cocina marca listo, se entrega)
    // llegaban en el mismo segundo y cada uno pedia tres listados. Se juntan
    // en una sola tanda un cuarto de segundo despues del ultimo.
    let tanda: ReturnType<typeof setTimeout> | null = null
    const disconnect = connectWs((evt) => {
      // Solo lo que mueve comandas. Las solicitudes de autorizacion viajan
      // por el mismo canal y pedian los tres listados sin que nada cambiara.
      if (!evt.event.startsWith('pedido_')) return
      if (tanda) clearTimeout(tanda)
      tanda = setTimeout(() => {
        tanda = null
        refrescarPedidos()
      }, 250)
    })
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
      if (tanda) clearTimeout(tanda)
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
    Promise.all([
      api.listarPedidosEnCocina(),
      api.listarPedidos('listo'),
      // Cobradas y ya cocinadas: la comida esta en la barra y el cliente no ha
      // venido. Antes desaparecian de la pantalla en el mismo momento en que
      // la cocina terminaba, justo cuando hacia falta saber de quien era.
      api.listarPedidosPorEntregar(),
    ])
      .then(([enCocina, listos, porEntregar]) => {
        const porId = new Map<number, Pedido>()
        for (const p of [...enCocina, ...listos, ...porEntregar]) porId.set(p.id, p)
        // 0 = listo para cobrar, 1 = para entregar, 2 = en cocina sin cobrar,
        // 3 = cobrado y en cocina. Lo que le toca hacer a la caja va arriba;
        // lo que solo se mira, abajo. Y dentro de cada grupo, la ULTIMA que
        // llego primero: la comanda que se acaba de tomar es la que se esta
        // mirando, y quedaba al final de la lista (Leider, 22-sep).
        const peso = (p: Pedido) =>
          p.items.some((i) => !i.preparado) ? (p.estado === 'pagado' ? 3 : 2) : p.estado === 'pagado' ? 1 : 0
        const lista = [...porId.values()].sort((a, b) => peso(a) - peso(b) || b.numero - a.numero)
        // Si llego exactamente lo mismo, no se toca el estado: repintar el
        // mostrador entero por nada es lo que traba a una tablet de 3 GB, y
        // el respaldo de cada minuto casi siempre trae lo mismo.
        // Con un candado de edicion puesto se repinta igual cada minuto: vence
        // por reloj (MINUTOS_EDITANDO) sin que el servidor cambie nada, y el
        // boton de editar tiene que volver a encenderse.
        const firma =
          JSON.stringify(lista) +
          (lista.some((p) => p.editando_desde) ? `@${Math.floor(Date.now() / 60000)}` : '')
        if (firma === firmaPedidos.current) return
        firmaPedidos.current = firma
        setPedidosActivos(lista)
      })
      .catch(() => {
        firmaPedidos.current = ''
        setPedidosActivos([])
      })
  }

  // El color que el dueño le puso a cada categoria, y de que categoria es
  // cada subseccion: los renglones de un pedido solo traen la variante.
  const colorDe = useCallback(
    (categoriaId: number) => categorias.find((c) => c.id === categoriaId)?.color ?? '',
    [categorias],
  )
  const categoriaDeVariante = useMemo(() => {
    const m = new Map<number, number>()
    for (const c of categorias) {
      for (const p of c.productos) for (const v of p.variantes) m.set(v.id, c.id)
    }
    return m
  }, [categorias])

  // Lo que se puede vender hoy, por categoria, para el desplegable. Se
  // calcula una vez por menu y no en cada toque.
  const vendibles = useMemo(
    () =>
      categorias.map((c) => ({
        categoria: c,
        filas: c.productos
          .filter((p) => p.activo)
          .flatMap((p) => variantesParaVender(p).map((v) => ({ producto: p, variante: v }))),
      })),
    [categorias],
  )
  const unidadesEnCarrito = useMemo(
    () => Object.values(carrito).reduce((n, c) => n + c.cantidad, 0),
    [carrito],
  )

  const totalCarrito = useMemo(
    () =>
      Object.values(carrito).reduce(
        (sum, c) => sum + (c.cortesia ? 0 : (c.precio ?? c.variante.precio) * c.cantidad),
        0,
      ) + libres.reduce((sum, l) => sum + l.precio, 0),
    [carrito, libres],
  )

  // La categoria de los envios: lo que hay ahi no tiene monto fijo, cobra lo
  // que se le diga en cada pedido (el cliente, 23-sep: "que sea
  // customizable, nada de monto fijo"). Sigue siendo un producto del menu
  // para que cuente como envio en los reportes.
  const categoriaEnvios = useMemo(
    () => categorias.find((c) => sinTildes(c.nombre) === 'envios') ?? null,
    [categorias],
  )

  async function agregarEnvio(producto?: Producto, variante?: Variante) {
    const monto = await dialogo.pedirNumero({
      titulo: producto && variante ? etiquetaVariante(producto, variante) : 'Delivery',
      etiqueta: 'Cuánto cobra este envío',
      sufijo: '$',
      min: 0.01,
    })
    if (monto === null) return
    setLibres((l) => [
      ...l,
      producto && variante
        ? { id: uuid(), nombre: etiquetaVariante(producto, variante), precio: monto, variante_id: variante.id }
        : { id: uuid(), nombre: 'Delivery', precio: monto },
    ])
  }

  /** El boton de delivery: el primer envio del menu, o venta libre si no hay. */
  function agregarDeliveryPersonalizado() {
    const envio = categoriaEnvios?.productos
      .filter((p) => p.activo)
      .flatMap((p) => variantesParaVender(p).map((v) => ({ producto: p, variante: v })))[0]
    void agregarEnvio(envio?.producto, envio?.variante)
  }

  // Lo que ya va en la comanda, por subseccion: es lo unico del carrito que
  // la lista de productos necesita para pintar sus contadores.
  const cantidades = useMemo(() => {
    const m: Record<number, number> = {}
    for (const c of Object.values(carrito)) m[c.variante.id] = c.cantidad
    return m
  }, [carrito])

  // Los toques de la lista pasan por una referencia: asi la funcion que recibe
  // la lista es siempre la misma y no la obliga a repintarse en cada vuelta.
  const acciones = useRef({ agregar: (_p: Producto, _v: Variante) => {}, quitar: (_id: number) => {} })
  const agregarEstable = useCallback((p: Producto, v: Variante) => acciones.current.agregar(p, v), [])
  const quitarEstable = useCallback((id: number) => acciones.current.quitar(id), [])

  function quitarLibre(id: string) {
    setLibres((l) => l.filter((x) => x.id !== id))
  }

  function agregar(producto: Producto, variante: Variante) {
    if (categoriaEnvios && producto.categoria_id === categoriaEnvios.id) {
      void agregarEnvio(producto, variante)
      return
    }
    setCarrito((c) => ({
      ...c,
      [variante.id]: {
        producto,
        variante,
        cantidad: (c[variante.id]?.cantidad ?? 0) + 1,
        cortesia: c[variante.id]?.cortesia ?? false,
        precio: c[variante.id]?.precio,
      },
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

  function alternarCortesia(varianteId: number) {
    setCarrito((c) => {
      const actual = c[varianteId]
      if (!actual) return c
      return { ...c, [varianteId]: { ...actual, cortesia: !actual.cortesia } }
    })
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
  useEffect(() => {
    acciones.current = { agregar, quitar }
  })

  // Lo que va a cocina, renglón por renglón, mientras se confirma la comanda.
  // `null` = no se está confirmando. Antes era UNA pregunta para toda la
  // comanda, y un pedido con un refresco de la nevera y una empanada por
  // hacer no tenía respuesta correcta.
  const [destinos, setDestinos] = useState<Record<number, boolean> | null>(null)
  const categoriaPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias])

  /** Lo que sugiere la categoría: se prepara en cocina o no. */
  function vaACocinaPorDefecto(varianteId: number): boolean {
    const cat = categoriaPorId.get(categoriaDeVariante.get(varianteId) ?? -1)
    return cat?.va_a_cocina ?? true
  }

  function enviarComanda() {
    setError('')
    if (Object.keys(carrito).length === 0 && libres.length === 0) return

    // Sin nombre no se comanda. Un pedido anónimo no se nota al escribirlo:
    // se nota media hora después, cuando hay cuatro comandas sin dueño y la
    // comida se entrega preguntando en voz alta. Y si esa venta termina
    // fiada, ya no hay a quién cobrarle.
    if (!clienteComanda.trim()) {
      setFaltaNombre(true)
      setError('Sin nombre no se puede comandar: escribe a nombre de quién va el pedido.')
      return
    }
    setFaltaNombre(false)

    // A cocina o de la vitrina, renglón por renglón. Leider (22-sep): "la
    // tienda va a tener ya comida de muestra... al darle al boton tiene que
    // generarte la opcion de si quieres mandarlo a cocina o no". Cada renglón
    // nace con lo que diga su categoría (el refresco no, la empanada sí) y la
    // cajera cambia lo que haga falta: la empanada que ya está en la vitrina
    // no se vuelve a hacer.
    //
    // Editando, solo se pregunta por lo NUEVO: lo que ya estaba conserva lo
    // que se decidio al tomarlo.
    const yaEstaban = new Set(enEdicion?.items.map((i) => i.variante_id) ?? [])
    const renglones = Object.values(carrito).filter((c) => !yaEstaban.has(c.variante.id))
    if (renglones.length === 0) {
      void mandarComanda({})
      return
    }
    setDestinos(Object.fromEntries(renglones.map((c) => [c.variante.id, vaACocinaPorDefecto(c.variante.id)])))
  }

  /** Los renglones de la comanda tal como los pide el servidor. */
  function renglonesDeLaComanda(destinoDe: Record<number, boolean>) {
    return [
      ...Object.values(carrito).map((c) => ({
        variante_id: c.variante.id as number | null,
        cantidad: c.cantidad,
        cortesia: c.cortesia,
        a_cocina: destinoDe[c.variante.id] ?? vaACocinaPorDefecto(c.variante.id),
      })),
      ...libres.map((l) =>
        l.variante_id !== undefined
          ? // El envio es del menu, con el monto de este pedido.
            { variante_id: l.variante_id as number | null, cantidad: 1, precio_libre: l.precio, a_cocina: false }
          : { variante_id: null, cantidad: 1, nombre_libre: l.nombre, precio_libre: l.precio, preparado: true },
      ),
    ]
  }

  /**
   * Cambiar de pestaña. Con un pedido en edicion solo se puede ir a la comanda:
   * salir a "Pedidos" con el candado tomado dejaba el pedido bloqueado para
   * todos hasta que venciera (Leider, 25-sep). Se termina con Guardar cambios o
   * con Cancelar; las funciones internas que ya soltaron el candado usan
   * `irAVista` directo.
   */
  function irA(destino: string) {
    if (enEdicion && destino !== 'tomar') {
      dialogo.avisar({
        titulo: `Estás editando el pedido #${enEdicion.numero}`,
        texto: 'Termina con "Guardar cambios" o "Cancelar" antes de salir de la comanda.',
      })
      return
    }
    irAVista(destino)
  }

  function terminarEdicion() {
    recordarEdicion(null)
    setEnEdicion(null)
    setDiferencia(null)
    setFirma(null)
    setReferenciaDif('')
    setCarrito({})
    setLibres([])
    setClienteComanda('')
  }

  /**
   * Guardar los cambios de un pedido que se edito en la comanda. Mismas
   * reglas que el cuadro de edicion (`EditarPedido`), porque es el mismo
   * endpoint: si la venta ya estaba cobrada y el monto cambia, hace falta la
   * firma y decir por donde entra o sale la diferencia.
   */
  async function guardarEdicion(
    destinoDe: Record<number, boolean>,
    pago?: { metodo: string; referencia: string; firma: Autorizacion | null },
  ) {
    if (!enEdicion) return
    setError('')
    setDestinos(null)
    // Se abrio para mirar y quedo igual: no hay nada que guardar, y eso no es
    // un error. Se cierra la edicion y se vuelve a los pedidos. Antes el
    // servidor contestaba "no hay ningun cambio" y la pantalla se quedaba
    // trancada en la comanda con el pedido adentro.
    if (quedoIgual(enEdicion)) {
      cerrarSinCambios()
      return
    }
    const nuevoTotal = Math.max(
      Math.round((totalCarrito - (enEdicion.descuento || 0)) * 100) / 100,
      0,
    )
    const dif = Math.round((nuevoTotal - enEdicion.total) * 100) / 100
    const mueveDinero = enEdicion.estado === 'pagado' && dif !== 0
    if (mueveDinero && !pago) {
      setDiferencia({ destinoDe, monto: dif })
      return
    }
    try {
      await api.editarPedido(enEdicion.id, renglonesDeLaComanda(destinoDe), {
        autorizacion: mueveDinero && pago?.firma && !acceso.puede.autoriza ? pago.firma : undefined,
        pagos:
          mueveDinero && pago
            ? [{ metodo: pago.metodo, monto: Math.abs(dif), referencia: pago.referencia }]
            : undefined,
      })
      terminarEdicion()
      irAVista('pedidos')
      refrescarPedidos()
    } catch (e) {
      setDiferencia(null)
      const mensaje = e instanceof Error ? e.message : 'No se pudieron guardar los cambios'
      // Por si el servidor ve igual algo que aqui parecia distinto.
      if (mensaje.includes('ningún cambio')) {
        cerrarSinCambios()
        return
      }
      setError(mensaje)
    }
  }

  /** Lo que tiene la comanda, contado igual que los renglones del pedido. */
  function huellaDeLaComanda(): string {
    const partes: string[] = []
    for (const c of Object.values(carrito)) partes.push(`v${c.variante.id}:${c.cortesia ? 1 : 0}:${c.cantidad}`)
    const sueltos = new Map<string, number>()
    for (const l of libres) {
      const k = l.variante_id !== undefined ? `e${l.variante_id}:${l.precio.toFixed(2)}` : `l${l.nombre}:${l.precio.toFixed(2)}`
      sueltos.set(k, (sueltos.get(k) ?? 0) + 1)
    }
    for (const [k, n] of sueltos) partes.push(`${k}:${n}`)
    return partes.sort().join('|')
  }

  function huellaDelPedido(pedido: Pedido): string {
    const partes: string[] = []
    const sueltos = new Map<string, number>()
    const sumar = (k: string, n: number) => sueltos.set(k, (sueltos.get(k) ?? 0) + n)
    for (const i of pedido.items) {
      if (i.variante_id === null) sumar(`l${i.nombre}:${i.precio_unitario.toFixed(2)}`, i.cantidad)
      else if (categoriaEnvios && categoriaDeVariante.get(i.variante_id) === categoriaEnvios.id)
        sumar(`e${i.variante_id}:${i.precio_unitario.toFixed(2)}`, i.cantidad)
      else partes.push(`v${i.variante_id}:${i.cortesia ? 1 : 0}:${i.cantidad}`)
    }
    for (const [k, n] of sueltos) partes.push(`${k}:${n}`)
    return partes.sort().join('|')
  }

  function quedoIgual(pedido: Pedido): boolean {
    return huellaDeLaComanda() === huellaDelPedido(pedido)
  }

  function cerrarSinCambios() {
    if (enEdicion) api.soltarEdicion(enEdicion.id).catch(() => {})
    terminarEdicion()
    irAVista('pedidos')
    refrescarPedidos()
  }

  async function mandarComanda(destinoDe: Record<number, boolean>) {
    if (enEdicion) {
      await guardarEdicion(destinoDe)
      return
    }
    setError('')
    setDestinos(null)
    const nombre = clienteComanda.trim()
    const items = renglonesDeLaComanda(destinoDe).map(({ variante_id, ...r }) =>
      variante_id === null ? r : { ...r, variante_id },
    )
    if (items.length === 0) return

    if (!claveComanda.current) claveComanda.current = uuid()
    const clave = claveComanda.current
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
    setPartes([])
    setDescuento('')
    setMotivoDescuento('')
    setPropina('')
    setCliente('')
    setEfectivo(null)
    setBillete('')
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
    // El efectivo no se cobra de un toque: antes hay que saber si paga
    // exacto o hay vuelto, y por donde sale. El resto de las formas entran
    // completas por su cuenta, asi que se cobran de una.
    if (METODOS_EFECTIVO.includes(metodo)) {
      setEfectivo({ metodo, conVuelto: false })
      setBillete('')
      return
    }
    // Sin esto un reclamo de "pague por pago movil y no me lo cobraron" es la
    // palabra del cliente contra la del negocio: no hay con que ubicar el
    // comprobante. El backend lo exige igual; se pregunta antes para no
    // mandar el cobro y que rebote.
    const referencia = await pedirReferencia(metodo, dialogo.pedirTexto)
    if (referencia === null) return
    cobrar(metodo, undefined, referencia)
  }

  /**
   * El cobro en efectivo cuando hay vuelto.
   *
   * Entra el billete completo a la gaveta del metodo con que pagaron y sale
   * la diferencia por donde diga el cajero, que muchas veces NO es la misma:
   * se paga con veinte dolares y el vuelto se da en bolivares, o por pago
   * movil cuando no hay sencillo. Sin anotar por donde salio, la gaveta de
   * dolares cierra con un sobrante y la de bolivares con un faltante.
   */
  function cobrarConVuelto(vueltoMetodo: string) {
    if (!efectivo) return
    cobrar(efectivo.metodo, [
      { metodo: efectivo.metodo, monto: aCobrar, recibido: entregado, vuelto_metodo: vueltoMetodo },
    ])
  }

  /**
   * Agregar una forma de pago al cobro mixto.
   *
   * El monto viene propuesto con lo que falta, que es el caso normal --la
   * ultima parte cierra la cuenta-- pero se puede bajar para partirlo en
   * tres. Nunca se acepta mas de lo que falta: el servidor rechaza el cobro
   * entero si los pagos no suman, y ese error llega cuando ya se guardo todo
   * lo demas.
   */
  async function agregarParte(metodo: string) {
    if (faltaMixto <= 0) return
    const monto = await dialogo.pedirNumero({
      titulo: `¿Cuánto paga con ${etiquetaMetodo(metodo)}?`,
      texto: `Faltan ${fmt(faltaMixto)} de ${fmt(aCobrar)}.`,
      etiqueta: 'Monto',
      sufijo: '$',
      valor: faltaMixto,
      min: 0.01,
    })
    if (monto === null) return
    if (monto > faltaMixto + 0.001) {
      setError(`Esa parte (${fmt(monto)}) pasa de lo que falta (${fmt(faltaMixto)}).`)
      return
    }
    // Cada parte lleva su propio comprobante: son pagos distintos.
    const referencia = await pedirReferencia(metodo, dialogo.pedirTexto)
    if (referencia === null) return
    setError('')
    setPartes((p) => [...p, { metodo, monto: Math.round(monto * 100) / 100, referencia }])
  }

  function cobrarMixto() {
    if (!cobrando || faltaMixto > 0.001 || partes.length === 0) return
    // El nombre recien escrito: si alguna parte es a credito, hace falta.
    cobrar('Mixto', partes, undefined, cliente.trim())
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

  async function verVentasDelDia() {
    setCargandoVentas(true)
    setVentasHoy([])
    try {
      setVentasHoy(await api.ventasDelDia())
    } catch {
      setVentasHoy([])
    } finally {
      setCargandoVentas(false)
    }
  }

  async function imprimirTicket(pedidoId: number) {
    try {
      await ticket(pedidoId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar el ticket')
    }
  }

  /** Se le dio al cliente: la tarjeta sale del mostrador. */
  async function entregarPedido(pedido: Pedido) {
    try {
      await api.marcarEntregado(pedido.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo marcar como entregado')
    }
    refrescarPedidos()
  }

  async function anular(pedido: Pedido) {
    // El sistema adivina segun si algun item quedo marcado "preparado", pero
    // es solo una sugerencia: si la cajera marco el item por error, o la
    // cocina hizo la comida sin tocar la casilla, la adivinanza queda mal y
    // antes no habia forma de corregirla al anular. Ahora se pregunta.
    // Solo cuenta lo que hizo la cocina: lo de vitrina nace "preparado" y
    // "listo" sin que nadie lo cocinara, y al anular vuelve a la vitrina.
    const yaHecha = pedido.items.some((i) => i.preparado && i.a_cocina !== false)
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
          detalle: 'La mercancía que se iba a usar vuelve al stock.',
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
    const impedimento = porQueNoSeEdita(pedido, yo)
    if (impedimento) {
      setError(impedimento)
      return
    }
    setError('')
    // Lo que se estaba tomando se perderia: se pregunta antes.
    if (!enEdicion && (Object.keys(carrito).length > 0 || libres.length > 0)) {
      const seguir = await dialogo.confirmar({
        titulo: 'Hay una comanda a medio tomar',
        texto: 'Si editas este pedido, lo que tienes en la comanda actual se descarta.',
        aceptar: 'Descartar y editar',
        peligro: true,
      })
      if (!seguir) return
    }
    if (enEdicion && enEdicion.id !== pedido.id) {
      api.soltarEdicion(enEdicion.id).catch(() => {})
    }
    try {
      // Se toma el candado ANTES de que el cajero empiece a tocar renglones:
      // avisarle a la cocina cuando ya se guardo no sirve de nada.
      const abierto = await api.abrirEdicion(pedido.id)
      // En la pantalla de tomar pedido, como si se pidiera de cero (el
      // cliente, 23-sep). Lo que la comanda no sabe mostrar --un producto
      // que ya salio del menu, el mismo producto cobrado y regalado a la
      // vez-- se edita en el cuadro de siempre.
      if (!cargarEnLaComanda(abierto)) {
        terminarEdicion()
        setEditando(abierto)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir la edición')
    }
    refrescarPedidos()
  }

  /** Pone los renglones del pedido en la comanda. false = no se pudo. */
  function cargarEnLaComanda(pedido: Pedido): boolean {
    const delMenu = new Map<number, { producto: Producto; variante: Variante }>()
    for (const c of categorias)
      for (const p of c.productos) for (const v of p.variantes) delMenu.set(v.id, { producto: p, variante: v })
    const nuevo: Carrito = {}
    const sueltos: Libre[] = []
    for (const i of pedido.items) {
      if (i.variante_id === null) {
        if (i.cortesia) return false
        for (let n = 0; n < i.cantidad; n++)
          sueltos.push({ id: uuid(), nombre: i.nombre, precio: i.precio_unitario })
        continue
      }
      const menu = delMenu.get(i.variante_id)
      if (!menu) return false
      if (categoriaEnvios && menu.producto.categoria_id === categoriaEnvios.id) {
        if (i.cortesia) return false
        for (let n = 0; n < i.cantidad; n++)
          sueltos.push({ id: uuid(), nombre: i.nombre, precio: i.precio_unitario, variante_id: i.variante_id })
        continue
      }
      if (nuevo[i.variante_id]) return false
      nuevo[i.variante_id] = {
        ...menu,
        cantidad: i.cantidad,
        cortesia: i.cortesia,
        precio: i.cortesia ? i.precio_lista : i.precio_unitario,
      }
    }
    setCarrito(nuevo)
    setLibres(sueltos)
    setClienteComanda(pedido.cliente || '')
    setFaltaNombre(false)
    setEnEdicion(pedido)
    recordarEdicion(pedido.id)
    irA('tomar')
    return true
  }

  // Si se recarga la pagina a mitad de una edicion, la comanda volvia vacia
  // y el pedido parecia borrado (seguia en el servidor, sin tocar). Se
  // recuerda en esta pestaña cual se estaba editando y, al volver, se abre
  // otra vez en la comanda tal como esta guardado.
  const restaurada = useRef(false)
  useEffect(() => {
    if (restaurada.current || categorias.length === 0) return
    restaurada.current = true
    const id = edicionRecordada()
    if (id === null) return
    api
      .abrirEdicion(id)
      .then((p) => {
        if (!cargarEnLaComanda(p)) {
          api.soltarEdicion(id).catch(() => {})
          recordarEdicion(null)
        }
      })
      .catch(() => recordarEdicion(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categorias])

  function cancelarEdicion() {
    if (enEdicion) api.soltarEdicion(enEdicion.id).catch(() => {})
    terminarEdicion()
    irAVista('pedidos')
    refrescarPedidos()
  }

  // El candado de edicion vence a los cinco minutos (MINUTOS_EDITANDO). Una
  // edicion en la comanda puede tardar mas --el cliente duda, se agrega
  // algo--: se renueva mientras siga abierta.
  useEffect(() => {
    if (!enEdicion) return
    const id = enEdicion.id
    const t = setInterval(() => {
      api.abrirEdicion(id).catch(() => {})
    }, 2 * 60 * 1000)
    return () => clearInterval(t)
  }, [enEdicion])

  function cerrarEdicion() {
    // Suelta el candado sin esperar: si la peticion falla, vence solo a los
    // cinco minutos y la cocina sigue igual.
    if (editando) api.soltarEdicion(editando.id).catch(() => {})
    setEditando(null)
    refrescarPedidos()
  }


  // Lo que espera a que lo cobren va primero: es lo unico de esta pantalla que
  // le toca hacer a quien esta en la caja. Lo que sigue en cocina va debajo,
  // para verlo, no para actuar.
  // Tres situaciones, tres colores. "En cocina" se parte en dos: la comanda
  // que falta cobrar (la caja todavia tiene algo que hacer con ella) y la que
  // ya se cobro y solo espera a que salga la comida (no hay nada que hacer,
  // salvo mirar). Con un solo color para las dos, la cajera tenia que leer
  // cada tarjeta para saber a cual le debia plata el cliente.
  const faltaCocina = (p: Pedido) => p.items.some((i) => !i.preparado)
  // Ya se cobro y ya se cocino: solo falta darsela a su dueño.
  const porEntregar = (p: Pedido) => p.estado === 'pagado' && !faltaCocina(p)
  const cuantosPorCobrar = pedidosActivos.filter((p) => !faltaCocina(p) && p.estado !== 'pagado').length
  const cuantosPorEntregar = pedidosActivos.filter(porEntregar).length
  const cuantosEnCocina = pedidosActivos.filter((p) => faltaCocina(p) && p.estado !== 'pagado').length
  const cuantosCobradosEnCocina = pedidosActivos.filter((p) => faltaCocina(p) && p.estado === 'pagado').length

  return (
    // De `md` para arriba el mostrador es una pantalla de APLICACION, no una
    // pagina: mide lo que mide la ventana y lo que se desplaza es el panel de
    // productos, no la pagina entera. Antes la barra de categorias (53 px) y
    // la de arriba (57 px) sumaban mas que los 105 px que el carrito
    // descontaba, y el aviso de "abrir caja" sumaba otros 48: con cero
    // comandas habia que bajar para ver el final (Leider, 21-sep: "no
    // deberia necesitar ningun tipo de scroll si no tengo ninguna comanda").
    <div className="min-h-screen bg-neutral-50 md:min-h-0 md:h-[100dvh] md:flex md:flex-col md:overflow-hidden">
      <NavBar
        titulo="Punto de venta"
        secciones={[
          SECCIONES_POS[0],
          { id: 'pedidos', texto: pedidosActivos.length ? `Pedidos · ${pedidosActivos.length}` : 'Pedidos' },
        ]}
        seccion={vista}
        alCambiarSeccion={irA}
      />

      {/* NO bloquea la venta. Un local no deja de cobrar porque falte un
          formulario, y un sistema que se pone en el medio se termina
          saltando. Lo que hace es estar donde no se puede no verlo, y decir
          qué se pierde: sin fondo contado, el cierre de esta noche parte del
          saldo contable en vez de un conteo de esta mañana. */}
      {apertura && !apertura.abierta && apertura.puede_abrir && (
        <div className="bg-aviso-50 border-b border-aviso-300 px-4 py-2.5 flex items-center justify-between gap-3">
          <p className="text-sm text-aviso-900 min-w-0">
            <span className="font-semibold">La caja no se ha abierto.</span>{' '}
            <span className="text-aviso-800">Cuenta el fondo con el que arrancas.</span>
          </p>
          <button
            onClick={() => setAbriendoCaja(true)}
            className="shrink-0 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Abrir caja
          </button>
        </div>
      )}

      {/* md (768px) y no lg: una tablet en vertical ya muestra el carrito al
          lado, sin obligar al cajero a bajar para ver el total y cobrar. */}
      <div
        className={`grid grid-cols-1 md:flex-1 md:min-h-0 ${
          vista === 'tomar' ? 'md:grid-cols-[1fr_330px] lg:grid-cols-[1fr_380px]' : ''
        }`}
      >
        <div className="p-4 overflow-y-auto md:h-full">
          {vista === 'tomar' && categorias.length > 0 && (
            <section className="mb-5 rounded-2xl border border-neutral-200 bg-white overflow-hidden">
              <button
                type="button"
                onClick={() => setListaAbierta((v) => !v)}
                aria-expanded={listaAbierta}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
                  Productos
                  {unidadesEnCarrito > 0 && (
                    <span className="ml-2 normal-case tracking-normal text-neutral-400 font-medium">
                      · {unidadesEnCarrito} en la comanda
                    </span>
                  )}
                </span>
                <span className="text-xs font-medium text-neutral-500">
                  {listaAbierta ? 'Plegar ▴' : 'Desplegar ▾'}
                </span>
              </button>

              {listaAbierta && (
                <ListaProductos
                  categorias={categorias}
                  vendibles={vendibles}
                  categoriaActiva={categoriaActiva}
                  alElegirCategoria={setCategoriaActiva}
                  cantidades={cantidades}
                  recienAgregado={recienAgregado}
                  onAgregar={agregarEstable}
                  onQuitar={quitarEstable}
                  fmt={fmt}
                  envioId={categoriaEnvios?.id ?? null}
                />
              )}
            </section>
          )}

          {vista === 'pedidos' && (
          <>
          <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
                Pedidos en curso
              </h2>
              {/* Aqui y no flotando en una esquina: una pastilla suelta sobre
                  la pagina parecia de otra aplicacion (Leider, 21-sep). */}
              <button
                type="button"
                onClick={verVentasDelDia}
                className="flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-600 hover:text-neutral-900 hover:border-neutral-400"
              >
                <Icono nombre="ventas" size={13} />
                Ventas de hoy
              </button>
            </div>
            {/* El color de cada tarjeta dice donde esta el pedido; esto es la
                leyenda, para no tener que aprendersela. */}
            <span className="text-xs text-neutral-400 flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-exito-500" /> {cuantosPorCobrar} listos, falta cobrar
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-acento-500" /> {cuantosPorEntregar} para entregar
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-aviso-500" /> {cuantosEnCocina} en cocina sin cobrar
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-neutral-400" /> {cuantosCobradosEnCocina} cobrados, en cocina
              </span>
            </span>
          </div>
          {/* Tres o cuatro comandas por fila en una laptop: con dos, cada
              fila era una pantalla. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
            {pedidosActivos.map((pedido) => {
              // Falta comida por hacer: la misma pregunta que responde la
              // pantalla de cocina, no el estado del pedido. Cobrar deja el
              // pedido en "pagado" aunque no se haya tocado la comida.
              const falta = pedido.items.some((i) => !i.preparado)
              const cocina = estadoCocina(pedido)
              const preparando = enPreparacion(pedido)
              const yaPagado = pedido.estado === 'pagado'
              const entregar = yaPagado && !falta
              // Verde: hay que cobrarlo. Ambar: en cocina y todavia sin
              // cobrar. Gris: ya se cobro, solo espera la comida. Que alguien
              // la este preparando se dice con un anillo cobre ENCIMA del
              // color, no en vez de el: si lo reemplazara, un pedido cobrado y
              // uno sin cobrar volverian a verse iguales mientras se cocinan.
              // Cobre y con el nombre grande: la comida esta hecha, pagada, y
              // lo unico que falta es acertar de quien es.
              const marco = entregar
                ? 'border-acento-400 bg-acento-500/10'
                : yaPagado
                  ? 'border-neutral-300 bg-neutral-100/70'
                  : falta
                    ? 'border-aviso-400 bg-aviso-500/5'
                    : 'border-exito-400 bg-exito-500/5'
              const anillo = preparando ? 'ring-2 ring-acento-500/50' : ''
              return (
              <div key={pedido.id} className={`rounded-2xl shadow-sm border-2 p-3 ${marco} ${anillo}`}>
                <div className="flex justify-between items-start mb-2 gap-2">
                  {/* El numero y, debajo, de quien es. Entre ocho comandas
                      vivas el nombre es lo que las distingue; el numero solo
                      sirve para cantarlo.

                      Debajo y no al lado: en la misma linea competia con la
                      pastilla de estado ("Cobrado · en cocina") y un nombre
                      normal se cortaba en "Sra. Ca...". */}
                  <span className="min-w-0">
                    <span className="block font-bold text-base leading-tight">#{pedido.numero}</span>
                    {pedido.cliente ? (
                      <span
                        className={`block truncate ${
                          entregar ? 'text-sm font-bold text-acento-800' : 'text-[13px] font-semibold text-neutral-600'
                        }`}
                      >
                        {pedido.cliente}
                      </span>
                    ) : (
                      entregar && (
                        <span className="block text-sm text-neutral-500">sin nombre</span>
                      )
                    )}
                  </span>
                  {/* Las pastillas no se comen el nombre: con dos o tres, un
                      "Ana" se cortaba en "A...", que es justo el dato por el
                      que se mira la tarjeta. */}
                  <span className="flex items-center gap-1.5 flex-wrap justify-end max-w-[62%] shrink-0">
                    {pedido.editado && (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-aviso-500/20 text-aviso-800">
                        Editado
                      </span>
                    )}
                    {/* La comida ya estaba hecha: no la espera nadie en la
                        cocina, y quien mire la tarjeta tiene que saberlo. */}
                    {!pedido.a_cocina && (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-neutral-800 text-white">
                        Sin cocina
                      </span>
                    )}
                    {/* Ya se le dio al cliente: fuera de la barra sin esperar
                        la hora. No borra la venta --la venta es la venta--,
                        solo saca la tarjeta del mostrador. */}
                    {entregar && (
                      <button
                        onClick={() => entregarPedido(pedido)}
                        title={`Ya le entregaste el pedido #${pedido.numero}${pedido.cliente ? ` a ${pedido.cliente}` : ''}`}
                        aria-label={`Marcar el pedido #${pedido.numero} como entregado`}
                        className="w-7 h-7 grid place-items-center rounded-full text-acento-800/60 hover:bg-acento-500/20 hover:text-acento-900 text-lg leading-none"
                      >
                        ×
                      </button>
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
                        entregar
                          ? 'bg-acento-500 text-white'
                          : yaPagado
                            ? 'bg-neutral-200 text-neutral-700'
                            : falta
                              ? 'bg-aviso-100 text-aviso-700'
                              : 'bg-exito-100 text-exito-700'
                      }`}
                    >
                      {/* Dos cosas a la vez: si ya se cobró, y dónde está la
                          comida. "Cuenta abierta" sola (22-sep) se había
                          comido el "cocina terminó": la cajera no sabía si
                          ya podía entregar. */}
                      {entregar
                        ? 'Para entregar'
                        : yaPagado
                          ? 'Cobrado · falta cocina'
                          : falta
                            ? 'Cuenta abierta · falta cocina'
                            : cocina === 'lista'
                              ? 'Cuenta abierta · cocina lista'
                              : 'Cuenta abierta · falta cobrar'}
                    </span>
                  </span>
                </div>
                <ul className="text-[13px] leading-snug text-neutral-600 mb-2 space-y-0">
                  {pedido.items.map((i) => {
                    const cat = categoriaDeVariante.get(i.variante_id ?? -1)
                    return (
                      <li key={i.id} className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            cat == null ? 'bg-neutral-300' : colorCategoria(cat, colorDe(cat)).dot
                          }`}
                        />
                        {i.cantidad}x {i.nombre}
                        {/* Renglón por renglón, solo si la comanda pasó por
                            cocina: en una mixta es lo que dice qué falta. */}
                        {cocina !== 'sin_cocina' &&
                          (i.a_cocina === false ? (
                            <span className="text-[10px] font-medium text-neutral-500 bg-neutral-100 rounded px-1.5 py-0.5">
                              vitrina
                            </span>
                          ) : i.preparado ? (
                            <span className="text-[10px] font-medium text-exito-700 bg-exito-50 rounded px-1.5 py-0.5">
                              listo
                            </span>
                          ) : (
                            <span className="text-[10px] font-medium text-aviso-700 bg-aviso-50 rounded px-1.5 py-0.5">
                              en cocina
                            </span>
                          ))}
                        {i.cortesia && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-exito-700 bg-exito-50 rounded px-1.5 py-0.5">
                            cortesía
                          </span>
                        )}
                      </li>
                    )
                  })}
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
                      disabled={Boolean(porQueNoSeEdita(pedido, yo))}
                      title={porQueNoSeEdita(pedido, yo) ?? 'Cambiar los renglones del pedido'}
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
            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 mb-3 mt-4">
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
          </>
          )}
        </div>

        {vista === 'tomar' && (
        <div className="bg-white border-l border-neutral-200 p-3 flex flex-col md:h-full md:min-h-0">
          {enEdicion && (
            <div className="mb-2 rounded-lg bg-aviso-50 border border-aviso-300 px-2.5 py-1.5 flex items-center justify-between gap-2">
              <p className="text-xs text-aviso-900 min-w-0">
                <span className="font-semibold">Editando el pedido #{enEdicion.numero}</span>
                {enEdicion.estado === 'pagado' && (
                  <span className="block text-[11px] text-aviso-800">Ya está cobrado: si cambia el total, se cuadra la diferencia.</span>
                )}
              </p>
              <button
                onClick={cancelarEdicion}
                className="shrink-0 text-xs font-semibold text-aviso-900 underline underline-offset-2"
              >
                Cancelar
              </button>
            </div>
          )}
          <div className={`flex items-center justify-between ${enEdicion ? 'mb-0' : 'mb-2'}`}>
            {!enEdicion && <h2 className="font-semibold text-sm">Comanda actual</h2>}
            {!enEdicion && (Object.keys(carrito).length > 0 || libres.length > 0) && (
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
            className="w-full mb-2 text-xs font-medium text-acento-600 hover:text-acento-700 border border-dashed border-acento-300 rounded-xl py-1.5"
          >
            + Delivery
          </button>
          {error && <p className="text-peligro-600 text-sm mb-2">{error}</p>}
          <div className="flex-1 overflow-y-auto space-y-1.5">
            {Object.values(carrito).map(({ producto, variante, cantidad, cortesia, precio }) => (
              <div key={variante.id} className="flex justify-between items-center gap-2">
                <span
                  aria-hidden
                  className={`w-1 self-stretch min-h-[30px] rounded-full shrink-0 ${
                    colorCategoria(producto.categoria_id, colorDe(producto.categoria_id)).barra
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold leading-tight line-clamp-2">
                    {etiquetaVariante(producto, variante)}
                  </div>
                  <div className="text-[11px] text-neutral-500 flex items-center gap-1.5 flex-wrap">
                    {cortesia ? (
                      <>
                        <span className="line-through">{fmt((precio ?? variante.precio) * cantidad)}</span>
                        <span className="font-semibold text-exito-700">{fmt(0)}</span>
                      </>
                    ) : (
                      <>
                        {cantidad} x {fmt(precio ?? variante.precio)} ={' '}
                        <span className="font-semibold text-neutral-700">
                          {fmt((precio ?? variante.precio) * cantidad)}
                        </span>
                      </>
                    )}
                    {/* Regalar el renglon: un toque lo marca, otro lo
                        desmarca. Chico y a la mano, sin cuadro ni motivo. */}
                    <button
                      type="button"
                      onClick={() => alternarCortesia(variante.id)}
                      className={`rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide border ${
                        cortesia
                          ? 'bg-exito-50 border-exito-300 text-exito-700'
                          : 'border-neutral-200 text-neutral-400 hover:text-neutral-700 hover:border-neutral-400'
                      }`}
                    >
                      {cortesia ? '✓ Cortesía' : 'Cortesía'}
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => quitar(variante.id)}
                    className="w-8 h-8 rounded-full bg-neutral-100 hover:bg-neutral-200 font-semibold text-base"
                  >
                    -
                  </button>
                  <span className="w-5 text-center text-sm font-semibold tabular-nums">{cantidad}</span>
                  <button
                    onClick={() => agregar(producto, variante)}
                    className="w-8 h-8 rounded-full bg-neutral-100 hover:bg-neutral-200 font-semibold text-base"
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
            {libres.map((l) => (
              <div key={l.id} className="flex justify-between items-center gap-2">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold leading-tight line-clamp-2">{l.nombre}</div>
                  <div className="text-[11px] text-neutral-500">{fmt(l.precio)}</div>
                </div>
                <button
                  onClick={() => quitarLibre(l.id)}
                  className="w-8 h-8 rounded-full bg-neutral-100 hover:bg-neutral-200 font-semibold text-base shrink-0"
                >
                  ×
                </button>
              </div>
            ))}
            {Object.keys(carrito).length === 0 && libres.length === 0 && (
              <p className="text-neutral-400 text-sm">Toca un producto para agregarlo.</p>
            )}
          </div>
          <div className="border-t border-neutral-200 pt-2 mt-2">
            {/* A nombre de quien va. Con ocho comandas vivas, "#14" no le dice
                a nadie de quien es: el cajero termina cantando numeros por el
                mostrador. El nombre viaja al pedido y sale al lado del numero
                aqui, en cocina y en el ticket.

                OBLIGATORIO. Era opcional para no frenar la cola, pero la cola
                se frena mucho mas al entregar: cuatro comandas sin dueno se
                reparten preguntando en voz alta. Y si una termina fiada, ya
                no hay a quien cobrarle. */}
            <input
              value={clienteComanda}
              onChange={(e) => {
                setClienteComanda(e.target.value)
                if (faltaNombre) setFaltaNombre(false)
              }}
              placeholder="¿A nombre de quién?"
              className={`w-full border rounded-lg px-2.5 py-1.5 text-[13px] ${
                faltaNombre ? 'border-peligro-400 bg-peligro-50 mb-1' : 'border-neutral-300 mb-2'
              }`}
            />
            {faltaNombre && (
              <p className="text-xs text-peligro-600 mb-2">
                Sin nombre no se puede comandar.
              </p>
            )}
            <div className="flex justify-between items-baseline font-bold text-lg mb-2">
              <span className="text-xs font-medium text-neutral-500">Total</span>
              <span>{fmt(totalCarrito)}</span>
            </div>
            {enEdicion && (
              <p className="text-[11px] text-neutral-500 -mt-1.5 mb-2 flex justify-between">
                <span>Antes</span>
                <span className="tabular-nums">{fmt(enEdicion.total + (enEdicion.descuento || 0))}</span>
              </p>
            )}
            <button
              onClick={enviarComanda}
              disabled={Object.keys(carrito).length === 0 && libres.length === 0}
              className="w-full bg-neutral-900 text-white rounded-xl py-2.5 font-semibold text-sm disabled:opacity-30"
            >
              {enEdicion ? 'Guardar cambios' : 'Enviar comanda'}
            </button>
          </div>
        </div>
        )}
      </div>

      {diferencia !== null && enEdicion && (
        <Modal
          titulo={`Pedido #${enEdicion.numero}: cambia lo cobrado`}
          ayuda="Esta venta ya está cobrada. Di por dónde entra o sale la diferencia."
          onCerrar={() => setDiferencia(null)}
          ancho="sm"
          pie={
            <>
              <Boton tono="fantasma" onClick={() => setDiferencia(null)}>
                Volver
              </Boton>
              <Boton
                onClick={() =>
                  void guardarEdicion(diferencia.destinoDe, {
                    metodo: metodoDif,
                    referencia: referenciaDif,
                    firma,
                  })
                }
                disabled={!acceso.puede.autoriza && !firma}
              >
                Guardar cambios
              </Boton>
            </>
          }
        >
          <p className="text-sm font-semibold mb-3">
            {diferencia.monto > 0 ? 'El cliente paga de más' : 'Se le devuelve al cliente'}{' '}
            {fmt(Math.abs(diferencia.monto))}
          </p>
          <div className="space-y-3">
            {acceso.puede.autoriza ? (
              <p className="text-sm text-neutral-600">
                Lo autorizas tú: queda firmado a nombre de{' '}
                <span className="font-semibold">{acceso.nombre_visible || acceso.usuario}</span>.
              </p>
            ) : (
              <Autorizar
                accion="editar_venta"
                detalle={`${diferencia.monto > 0 ? 'El cliente paga de más' : 'Se le devuelve al cliente'} ${fmt(Math.abs(diferencia.monto))}`}
                monto={Math.abs(diferencia.monto)}
                pedidoId={enEdicion.id}
                onCambio={setFirma}
              />
            )}
            <Selector
              etiqueta={diferencia.monto > 0 ? 'Cómo se cobra la diferencia' : 'Cómo se devuelve'}
              value={metodoDif}
              onChange={(e) => setMetodoDif(e.target.value)}
            >
              {METODOS_PAGO.map((m) => (
                <option key={m} value={m}>
                  {etiquetaMetodo(m)}
                </option>
              ))}
            </Selector>
            {METODOS_CON_REFERENCIA.has(metodoDif) && (
              <Campo
                etiqueta="Referencia"
                value={referenciaDif}
                onChange={(e) => setReferenciaDif(e.target.value)}
              />
            )}
          </div>
        </Modal>
      )}

      {destinos !== null && (
        <Modal
          titulo={`¿Qué va a cocina? · ${clienteComanda.trim()}`}
          ayuda="Cada renglón viene con lo que dice su categoría. Toca para cambiarlo: lo que ya está hecho en la vitrina no pasa por cocina."
          onCerrar={() => setDestinos(null)}
          ancho="sm"
          pie={
            <>
              <Boton tono="fantasma" onClick={() => setDestinos(null)}>
                Volver
              </Boton>
              <Boton onClick={() => void mandarComanda(destinos)}>
                {Object.values(destinos).some(Boolean) ? 'Enviar comanda' : 'Enviar sin cocina'}
              </Boton>
            </>
          }
        >
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setDestinos(Object.fromEntries(Object.keys(destinos).map((k) => [k, true])))}
              className="flex-1 text-xs font-medium rounded-lg border border-neutral-200 py-2 hover:bg-neutral-50"
            >
              Todo a cocina
            </button>
            <button
              onClick={() => setDestinos(Object.fromEntries(Object.keys(destinos).map((k) => [k, false])))}
              className="flex-1 text-xs font-medium rounded-lg border border-neutral-200 py-2 hover:bg-neutral-50"
            >
              Todo de vitrina
            </button>
          </div>
          <ul className="space-y-2">
            {Object.values(carrito).map((c) => {
              const cocina = destinos[c.variante.id] ?? true
              return (
                <li key={c.variante.id}>
                  <button
                    onClick={() => setDestinos({ ...destinos, [c.variante.id]: !cocina })}
                    aria-pressed={cocina}
                    className={`w-full flex items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left ${
                      cocina ? 'border-aviso-300 bg-aviso-50' : 'border-neutral-200 bg-white'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block font-medium truncate">
                        {c.cantidad}x {etiquetaVariante(c.producto, c.variante)}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 text-xs font-semibold rounded-full px-2.5 py-1 ${
                        cocina ? 'bg-aviso-500 text-white' : 'bg-neutral-800 text-white'
                      }`}
                    >
                      {cocina ? 'A cocina' : 'De vitrina'}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {libres.length > 0 && (
            <p className="text-xs text-neutral-500 mt-3">
              {libres.length} envío(s) aparte: no pasan por cocina.
            </p>
          )}
        </Modal>
      )}

      {ventasHoy !== null && (
        <Modal
          titulo="Ventas de hoy"
          ayuda={
            cargandoVentas
              ? 'Buscando…'
              : `${ventasHoy.length} venta(s) · ${fmt(ventasHoy.reduce((t, v) => t + v.a_cobrar, 0))}`
          }
          onCerrar={() => setVentasHoy(null)}
          ancho="lg"
        >
          {ventasHoy.length === 0 ? (
            <p className="text-sm text-neutral-500 py-4 text-center">
              {cargandoVentas ? 'Buscando…' : 'Todavía no se ha cobrado nada hoy.'}
            </p>
          ) : (
            <div className="divide-y divide-neutral-100">
              {[...ventasHoy].reverse().map((v) => (
                <div key={v.id} className="flex items-center gap-3 py-2.5">
                  <span className="w-12 shrink-0 text-xs text-neutral-400 tabular-nums">
                    {/* En 24 h: "09:35 p. m." no cabe en la columna y se
                        partia en dos lineas. */}
                    {new Date(v.cerrado_en ?? v.creado_en).toLocaleTimeString('es-VE', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })}
                  </span>
                  <span className="min-w-0 flex-1">
                    {/* El nombre primero: es lo que se viene a buscar aqui. */}
                    <span className="block text-sm font-medium truncate">
                      {v.cliente || <span className="text-neutral-400 font-normal">sin nombre</span>}
                    </span>
                    <span className="block text-[11px] text-neutral-400 truncate">
                      #{v.numero} · {etiquetaMetodo(v.metodo_pago || '')}
                      {v.devuelto && ' · devuelta'}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 text-sm font-semibold tabular-nums ${
                      v.devuelto ? 'text-neutral-400 line-through' : ''
                    }`}
                  >
                    {fmt(v.a_cobrar)}
                  </span>
                  <button
                    onClick={() => imprimirTicket(v.id)}
                    title="Imprimir el ticket"
                    className="shrink-0 w-8 h-8 grid place-items-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                  >
                    <Icono nombre="ventas" size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

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
          className="fixed bottom-3 left-3 z-30 flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-500 shadow-sm hover:text-neutral-900 hover:border-neutral-400"
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
            efectivo ? (
              /* Efectivo, paso a paso. Leider (21-sep): "tienen que haber dos
                 opciones, si va a pagar exacto o con diferencia... si pone
                 diferencia tienes que preguntar de cuanto es el billete... y
                 que el cajero ponga como se le va a devolver esa plata del
                 fondo de caja". */
              <div className="mt-3 mb-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{efectivo.metodo}</span>
                  <button
                    onClick={() => {
                      setEfectivo(null)
                      setBillete('')
                    }}
                    className="text-sm text-neutral-500 hover:text-neutral-800"
                  >
                    Cambiar forma de pago
                  </button>
                </div>

                {!efectivo.conVuelto ? (
                  <div className="space-y-2">
                    <button
                      onClick={() => cobrar(efectivo.metodo)}
                      className="w-full rounded-xl border border-exito-300 bg-exito-50 text-exito-800 py-3.5 font-semibold active:scale-95 transition"
                    >
                      Paga exacto ·{' '}
                      <span className="tabular-nums">
                        {enBs && tasaBcv > 0 ? fmtBs(aCobrar * tasaBcv) : `$${aCobrar.toFixed(2)}`}
                      </span>
                    </button>
                    <button
                      onClick={() => setEfectivo({ ...efectivo, conVuelto: true })}
                      disabled={enBs && tasaBcv === 0}
                      title={enBs && tasaBcv === 0 ? 'Sin tasa de cambio no se puede calcular el vuelto' : ''}
                      className="w-full rounded-xl bg-neutral-100 hover:bg-neutral-200 py-3.5 font-semibold disabled:opacity-40"
                    >
                      Paga con más: hay vuelto
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="block text-xs text-neutral-500">
                      {enBs ? '¿Con cuántos bolívares paga?' : '¿De cuánto es el billete?'}
                      <Numerico
                        value={billete}
                        onChange={(e) => setBillete(e.target.value)}
                        placeholder={enBs ? '0,00' : '20.00'}
                        className="w-full border border-neutral-300 rounded-lg px-3 py-2.5 mt-1 text-lg font-semibold text-neutral-900"
                      />
                    </label>
                    {/* Los billetes de siempre: con un cliente esperando, tocar
                        "20" es mas rapido y se equivoca menos que teclearlo. */}
                    {!enBs && (
                      <div className="grid grid-cols-4 gap-2">
                        {BILLETES_USD.filter((b) => b > aCobrar).map((b) => (
                          <button
                            key={b}
                            onClick={() => setBillete(String(b))}
                            className="rounded-lg bg-neutral-100 hover:bg-neutral-200 py-2 text-sm font-semibold tabular-nums"
                          >
                            ${b}
                          </button>
                        ))}
                      </div>
                    )}
                    {vuelto > 0 ? (
                      <>
                        <p className="text-center text-lg font-bold text-exito-700 tabular-nums pt-1">
                          Vuelto: ${vuelto.toFixed(2)}
                          {tasaBcv > 0 && (
                            <span className="block text-sm font-medium text-neutral-500">
                              {fmtBs(vuelto * tasaBcv)}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-neutral-500">
                          ¿Por dónde se le devuelve? Sale del fondo de caja.
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          {METODOS_VUELTO.map((m) => (
                            <button
                              key={m}
                              onClick={() => cobrarConVuelto(m)}
                              className="bg-neutral-100 hover:bg-neutral-200 rounded-xl py-3 text-sm font-medium"
                            >
                              {m}
                              {m === 'Efectivo Bs' && tasaBcv > 0 && (
                                <span className="block text-[11px] text-neutral-500 tabular-nums">
                                  {fmtBs(vuelto * tasaBcv)}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-neutral-500">
                        Tiene que ser más de{' '}
                        {enBs && tasaBcv > 0 ? fmtBs(aCobrar * tasaBcv) : `$${aCobrar.toFixed(2)}`}.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : aCobrar <= 0 ? (
              // Todo regalado: no entra plata. Se cierra la comanda y listo;
              // el costo lo reconoce el servidor como gasto de cortesias.
              <button
                onClick={() => confirmarCobro(METODOS_PAGO[0])}
                className="w-full mt-3 bg-exito-600 hover:bg-exito-700 text-white rounded-xl py-3 text-sm font-semibold"
              >
                Cerrar como cortesía (no se cobra)
              </button>
            ) : (
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
            )
          ) : (
            <div className="mt-3 mb-3 space-y-2">
              {/* Lo que falta, GRANDE: es el numero que el cajero le canta al
                  cliente mientras arma el pago. */}
              <div
                className={`rounded-xl px-3 py-2.5 flex items-baseline justify-between ${
                  faltaMixto > 0 ? 'bg-aviso-50 text-aviso-900' : 'bg-exito-50 text-exito-800'
                }`}
              >
                <span className="text-sm font-medium">
                  {faltaMixto > 0 ? 'Falta por pagar' : 'Cubierto completo'}
                </span>
                <span className="text-xl font-bold tabular-nums">{fmt(faltaMixto)}</span>
              </div>

              {partes.map((parte, i) => (
                <div
                  key={`${parte.metodo}-${i}`}
                  className="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-2"
                >
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-medium">{etiquetaMetodo(parte.metodo)}</span>
                    {parte.referencia && (
                      <span className="block text-[11px] text-neutral-400 truncate">
                        ref. {parte.referencia}
                      </span>
                    )}
                  </span>
                  <span className="font-semibold tabular-nums">{fmt(parte.monto)}</span>
                  <button
                    onClick={() => setPartes((p) => p.filter((_, x) => x !== i))}
                    aria-label={`Quitar el pago con ${etiquetaMetodo(parte.metodo)}`}
                    className="w-7 h-7 grid place-items-center rounded-full text-neutral-400 hover:bg-peligro-50 hover:text-peligro-600"
                  >
                    ×
                  </button>
                </div>
              ))}

              {faltaMixto > 0 && (
                <>
                  <p className="text-xs text-neutral-500 pt-1">
                    {partes.length === 0 ? 'Con qué paga la primera parte:' : 'Y el resto con:'}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {[...METODOS_PAGO, 'Fiado'].map((m) => (
                      <button
                        key={m}
                        onClick={() => agregarParte(m)}
                        disabled={m === 'Fiado' && !cliente.trim()}
                        title={m === 'Fiado' && !cliente.trim() ? 'Escribe el nombre del cliente primero' : ''}
                        className="bg-neutral-100 hover:bg-neutral-200 rounded-xl py-2.5 text-sm font-medium disabled:opacity-30"
                      >
                        {etiquetaMetodo(m)}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <button
                onClick={cobrarMixto}
                disabled={faltaMixto > 0.001 || partes.length === 0}
                className="w-full rounded-xl bg-neutral-900 py-3 text-sm font-semibold text-white disabled:opacity-30"
              >
                Cobrar {fmt(aCobrar)} en {partes.length} forma(s)
              </button>
              <button
                onClick={() => {
                  setPagoMixto(false)
                  setPartes([])
                }}
                className="w-full text-xs text-neutral-500 pt-1"
              >
                Volver a un solo pago
              </button>
            </div>
          )}
        </Modal>
      )}
      {abriendoCaja && apertura && (
        <AbrirCaja
          estado={apertura}
          alCerrar={() => setAbriendoCaja(false)}
          alAbrir={() => {
            setAbriendoCaja(false)
            recargarApertura()
          }}
        />
      )}

    </div>
  )
}

/**
 * La lista de productos del mostrador, aparte y memorizada.
 *
 * POR QUE. Vivia dentro del componente del punto de venta, asi que cada letra
 * del nombre del cliente, cada comanda que llegaba por el canal en vivo y
 * cada paso del cobro volvian a pintar el menu entero --todas las categorias,
 * todos los renglones--. En una computadora no se nota; en la tablet de 3 GB
 * del mostrador es lo que la dejaba "pegada" (el cliente, 23-sep). Ahora solo
 * se repinta cuando cambia algo que ella muestra: el menu, la categoria
 * elegida o lo que ya va en la comanda. Se ve exactamente igual.
 */
const ListaProductos = memo(function ListaProductos({
  categorias,
  vendibles,
  categoriaActiva,
  alElegirCategoria,
  cantidades,
  recienAgregado,
  onAgregar,
  onQuitar,
  fmt,
  envioId,
}: {
  categorias: Categoria[]
  vendibles: { categoria: Categoria; filas: { producto: Producto; variante: Variante }[] }[]
  categoriaActiva: number | 'todas'
  alElegirCategoria: (c: number | 'todas') => void
  cantidades: Record<number, number>
  recienAgregado: Set<number>
  onAgregar: (p: Producto, v: Variante) => void
  onQuitar: (varianteId: number) => void
  fmt: (usd: number | null | undefined, decimales?: number) => string
  envioId: number | null
}) {
  return (
    <>
    {/* Las categorias, siempre a la vista: "Todas" pone el
        menu entero con una seccion por categoria. */}
    <div className="flex gap-2 overflow-x-auto px-4 pb-3 border-b border-neutral-100">
      <button
        type="button"
        onClick={() => alElegirCategoria('todas')}
        className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-semibold border ${
          categoriaActiva === 'todas'
            ? 'bg-neutral-900 border-neutral-900 text-white'
            : 'bg-white border-neutral-200 text-neutral-500'
        }`}
      >
        Todas
      </button>
      {categorias.map((cat) => {
        const color = colorCategoria(cat.id, cat.color)
        const activa = cat.id === categoriaActiva
        return (
          <button
            key={cat.id}
            type="button"
            onClick={() => alElegirCategoria(cat.id)}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-semibold border ${
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

    {/* Renglones, no fichas: un producto por linea con su precio
        y, si ya va en la comanda, cuantos y un menos. Se toca
        el renglon y suma uno; la lista no se cierra, asi que
        cinco productos son cinco toques. */}
    <div>
      {vendibles
        .filter(
          (g) =>
            g.filas.length > 0 &&
            (categoriaActiva === 'todas' || g.categoria.id === categoriaActiva),
        )
        .map((g) => {
          const color = colorCategoria(g.categoria.id, g.categoria.color)
          return (
            <div key={g.categoria.id}>
              <div className="sticky top-0 z-[1] flex items-center gap-2 px-4 py-1.5 bg-neutral-50 border-y border-neutral-100 text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-500">
                <span className={`w-2 h-2 rounded-full ${color.dot}`} />
                {g.categoria.nombre}
              </div>
              {g.filas.map(({ producto: p, variante: v }) => {
                const enCarrito = cantidades[v.id] ?? 0
                const pulsando = recienAgregado.has(v.id)
                return (
                  <div
                    key={v.id}
                    className={`flex items-stretch border-b border-neutral-100 last:border-b-0 ${
                      pulsando ? color.bg : enCarrito > 0 ? 'bg-neutral-50' : 'bg-white'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onAgregar(p, v)}
                      className={`flex-1 min-w-0 flex items-center justify-between gap-3 px-4 py-3 text-left border-l-4 ${color.border} active:bg-neutral-100`}
                    >
                      <span className="font-semibold text-[15px] leading-tight text-neutral-900 truncate">
                        {etiquetaVariante(p, v)}
                      </span>
                      <span className="shrink-0 font-bold text-neutral-700 tabular-nums">
                        {envioId !== null && p.categoria_id === envioId ? (
                          <span className="text-xs font-medium text-neutral-500">monto libre</span>
                        ) : (
                          fmt(v.precio)
                        )}
                      </span>
                    </button>
                    {enCarrito > 0 && (
                      <div className="flex items-center gap-1 pr-3 shrink-0">
                        <button
                          type="button"
                          onClick={() => onQuitar(v.id)}
                          aria-label={`Quitar uno de ${etiquetaVariante(p, v)}`}
                          className="w-9 h-9 rounded-full border border-neutral-300 text-lg leading-none text-neutral-700 active:bg-neutral-200"
                        >
                          −
                        </button>
                        <span className="min-w-[28px] h-7 px-1.5 rounded-full bg-acento-500 text-neutral-50 text-sm font-bold flex items-center justify-center tabular-nums">
                          {enCarrito}
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
    </div>
    </>
  )
})
