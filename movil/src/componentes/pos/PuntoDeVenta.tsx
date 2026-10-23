import * as Clipboard from 'expo-clipboard'
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, Pressable, Share, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { porQueNoSeEdita } from '../../../../frontend/src/lib/comandas'
import { METODOS_PAGO } from '../../../../frontend/src/lib/pagos'
import * as almacen from '../../lib/almacen'
import { apiPos, type ArranquePos } from '../../lib/api-pos'
import { guardarCache, leerCache } from '../../lib/cache'
import { avisar, confirmar } from '../../lib/dialogo'
import { useMoneda } from '../../lib/moneda'
import {
  cocinaActualDe,
  agregadoDe,
  cocinaLoTermino,
  comandaDelPedido,
  escucharEnVivo,
  esEnvios,
  huellaDeLaComanda,
  huellaDelPedido,
  nombreDe,
  redondear,
  renglonesDeLaComanda,
  textoDelTicket,
  tinteCategoria,
  tocarListo,
  tocarSuave,
  uuid,
  vendiblesDe,
  type Carrito,
  type Cocina,
  type IdSeccionPos,
  type Libre,
  type Tinte,
} from '../../lib/pos'
import { useSesion } from '../../lib/sesion'
import { LETRA, useModo, useTema } from '../../lib/tema'
import type {
  Autorizacion,
  Categoria,
  EstadoApertura,
  EstadoPabilo,
  Pedido,
  Producto,
  PuntoVenta,
  Variante,
} from '../../lib/tipos'
import Fondo from '../Fondo'
import { Hoja, OpcionHoja } from '../Hoja'
import Icono from '../Icono'
import { useDisposicion } from '../kit'
import { Aviso, Boton, Cargando, Pestanas, Problema } from '../ui'
import { AbrirCaja } from './AbrirCaja'
import { Catalogo } from './Catalogo'
import { Cobro } from './Cobro'
import { Comanda, type AccionesComanda } from './Comanda'
import { Diferencia } from './Diferencia'
import { EditarPedido } from './EditarPedido'
import { ElegirCocina, type FilaCocina } from './ElegirCocina'
import { Pedidos, type AccionesPedidos } from './Pedidos'
import { usePregunta } from './Pregunta'
import { VentasDeHoy } from './VentasDeHoy'

/*
 * EL PUNTO DE VENTA (pages/POS.tsx de la web): la pantalla mas usada. La
 * cajera en la tablet del mostrador y el mesonero en su telefono.
 *
 * Dos secciones, como la web: TOMAR PEDIDO (el menu y la comanda) y PEDIDOS
 * (lo que esta vivo en el piso: cobrar, editar, anular, entregar). En la
 * tablet el menu va a la izquierda y la comanda a la derecha; en el telefono
 * el menu ocupa la pantalla y la comanda vive abajo, en una barra con el
 * total que se abre.
 *
 * La seccion va en la ruta (/pos y /pos/pedidos) y cambiarla NO remonta la
 * pantalla: la comanda a medio tomar sigue ahi al volver.
 */

const CLAVE_PUNTO = 'erp-punto-venta'
// Que pedido se estaba editando, para retomarlo si la app se cierra a mitad.
const CLAVE_EDICION = 'erp-pos-editando'

function recordarEdicion(id: number | null) {
  const hecho = id === null ? almacen.borrar(CLAVE_EDICION) : almacen.guardar(CLAVE_EDICION, String(id))
  hecho.catch(() => undefined)
}

const SECCIONES: { id: IdSeccionPos; texto: string }[] = [
  { id: 'tomar', texto: 'Tomar pedido' },
  { id: 'pedidos', texto: 'Pedidos' },
]

/** El piso en una lista: en cocina, listos y por entregar, sin repetir, el mas nuevo primero. */
function pedidosDelArranque(d: ArranquePos): Pedido[] {
  const porId = new Map<number, Pedido>()
  for (const p of [...d.en_cocina, ...d.listos, ...d.por_entregar]) porId.set(p.id, p)
  return [...porId.values()].sort((a, b) => b.numero - a.numero)
}

export default function PuntoDeVenta() {
  const t = useTema()
  const { modo } = useModo()
  const borde = useSafeAreaInsets()
  const { ancho, tablet } = useDisposicion()
  const { fmt } = useMoneda()
  const { acceso } = useSesion()
  const yo = acceso?.nombre_visible || acceso?.usuario || ''
  const autorizoYo = acceso?.puede.autoriza ?? false
  const pregunta = usePregunta()

  const { seccion } = useLocalSearchParams<{ seccion?: string }>()
  const vista: IdSeccionPos = seccion === 'pedidos' ? 'pedidos' : 'tomar'

  // ── Lo que se carga ──
  // Arranca con lo ultimo que se vio en este servidor (lib/cache.ts): el
  // mostrador aparece al instante y se corrige cuando llega lo nuevo.
  const [guardado] = useState(() => leerCache<ArranquePos>('pos'))
  const [categorias, setCategorias] = useState<Categoria[] | null>(guardado ? guardado.categorias.filter((c) => c.activo) : null)
  const [errorMenu, setErrorMenu] = useState('')
  const [refrescandoMenu, setRefrescandoMenu] = useState(false)
  const [puntos, setPuntos] = useState<PuntoVenta[]>(guardado?.puntos_venta ?? [])
  const [puntoId, setPuntoId] = useState<number | null>(null)
  // Si el local tiene Pabilo, un pago movil se comprueba contra el banco.
  const [pabilo, setPabilo] = useState<EstadoPabilo | null>(guardado?.pabilo ?? null)
  const [tasaIva, setTasaIva] = useState(guardado?.fiscal.tasa_iva ?? 16)
  const [apertura, setApertura] = useState<EstadoApertura | null>(guardado?.apertura ?? null)
  const [pedidosActivos, setPedidosActivos] = useState<Pedido[]>(() => (guardado ? pedidosDelArranque(guardado) : []))
  const [cargandoPedidos, setCargandoPedidos] = useState(!guardado)
  const [refrescandoPedidos, setRefrescandoPedidos] = useState(false)
  // Lo ultimo que se pinto, para no repintar cuando el servidor manda lo mismo.
  const firmaPedidos = useRef('')

  // ── La comanda ──
  const [carrito, setCarrito] = useState<Carrito>({})
  const [libres, setLibres] = useState<Libre[]>([])
  const [clienteComanda, setClienteComanda] = useState('')
  const [faltaNombre, setFaltaNombre] = useState(false)
  // El renglon recien tocado se tiñe un instante: la confirmacion de que si se agrego.
  const [recien, setRecien] = useState<Set<number>>(() => new Set())
  const [comandaEnviada, setComandaEnviada] = useState<{ numero: number; cliente: string } | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [hojaComanda, setHojaComanda] = useState(false)
  // Clave de ESTE intento de comanda: si la respuesta se pierde, reintentar
  // con la misma devuelve el pedido que ya entro. Muere con cualquier cambio
  // de la comanda (si no, el reintento devolveria el pedido viejo sin lo nuevo).
  const claveComanda = useRef<string | null>(null)
  useEffect(() => {
    claveComanda.current = null
  }, [carrito, libres])

  // ── Editar un pedido ya tomado ──
  // En la comanda, como si se tomara de cero (el cliente, 23-sep).
  const [enEdicion, setEnEdicion] = useState<Pedido | null>(null)
  // El cuadro de siempre, para lo que la comanda no sabe mostrar.
  const [editando, setEditando] = useState<Pedido | null>(null)
  const [destinos, setDestinos] = useState<Record<number, boolean> | null>(null)
  // Editando: a donde va LO AGREGADO a algo que ya estaba (ver `agregadoDe`).
  const [nuevos, setNuevos] = useState<Record<number, boolean>>({})
  const [diferencia, setDiferencia] = useState<{ destinoDe: Record<number, boolean>; monto: number } | null>(null)
  const [firma, setFirma] = useState<Autorizacion | null>(null)
  const [metodoDif, setMetodoDif] = useState(METODOS_PAGO[0])
  const [referenciaDif, setReferenciaDif] = useState('')

  // ── Pedidos ──
  const [cobrando, setCobrando] = useState<Pedido | null>(null)
  const [ultimaVenta, setUltimaVenta] = useState<Pedido | null>(null)
  const [ventasHoy, setVentasHoy] = useState<Pedido[] | null>(null)
  const [cargandoVentas, setCargandoVentas] = useState(false)
  const [cocinaDe, setCocinaDe] = useState<{ pedido: Pedido; destino: Record<number, boolean> } | null>(null)
  const [guardandoCocina, setGuardandoCocina] = useState(false)
  const [anulando, setAnulando] = useState<Pedido | null>(null)
  const [abriendoCaja, setAbriendoCaja] = useState(false)

  // ── Cargar ──

  /**
   * Lo que esta vivo en el piso y nada mas: lo que esta en cocina (el MISMO
   * listado de la pantalla de cocina), lo que falta cobrar y lo cobrado y
   * cocinado que espera al cliente. La ultima que llego, primero.
   */
  const refrescarPedidos = useCallback(
    () =>
      Promise.all([apiPos.enCocina(), apiPos.listos(), apiPos.porEntregar()])
        .then(([enCocina, listos, porEntregar]) => {
          const porId = new Map<number, Pedido>()
          for (const p of [...enCocina, ...listos, ...porEntregar]) porId.set(p.id, p)
          const lista = [...porId.values()].sort((a, b) => b.numero - a.numero)
          // Con un candado de edicion puesto se repinta cada minuto: vence por
          // reloj sin que el servidor cambie nada.
          const firma =
            JSON.stringify(lista) + (lista.some((p) => p.editando_desde) ? `@${Math.floor(Date.now() / 60000)}` : '')
          if (firma !== firmaPedidos.current) {
            firmaPedidos.current = firma
            setPedidosActivos(lista)
          }
        })
        .catch(() => {
          firmaPedidos.current = ''
          setPedidosActivos([])
        })
        .finally(() => {
          setCargandoPedidos(false)
          setRefrescandoPedidos(false)
        }),
    [],
  )

  const cargarMenu = useCallback(
    () =>
      apiPos
        .categorias()
        // Solo lo que esta en el menu hoy: una categoria retirada no se vende.
        .then((todas) => {
          setCategorias(todas.filter((c) => c.activo))
          setErrorMenu('')
        })
        .catch((e: unknown) => setErrorMenu(e instanceof Error ? e.message : 'No se pudo cargar el menú.'))
        .finally(() => setRefrescandoMenu(false)),
    [],
  )

  /** Lo que trae el arranque en una llamada (o la cache), repartido en su sitio. */
  const recibirArranque = useCallback(
    (d: ArranquePos) => {
      setCategorias(d.categorias.filter((c) => c.activo))
      setErrorMenu('')
      setRefrescandoMenu(false)
      setApertura(d.apertura)
      setPuntos(d.puntos_venta)
      setPabilo(d.pabilo)
      setTasaIva(d.fiscal.tasa_iva)
      const lista = pedidosDelArranque(d)
      firmaPedidos.current = JSON.stringify(lista)
      setPedidosActivos(lista)
      setCargandoPedidos(false)
    },
    [],
  )

  const recargarApertura = useCallback(() => {
    apiPos
      .estadoApertura()
      .then(setApertura)
      .catch(() => setApertura(null))
  }, [])

  useEffect(() => {
    // UNA llamada con todo (routers/app_movil.py). Si el servidor es viejo y
    // no la tiene (404), las de siempre, una por una.
    apiPos
      .arranque()
      .then((d) => {
        recibirArranque(d)
        guardarCache('pos', d)
      })
      .catch(() => {
        void cargarMenu()
        void refrescarPedidos()
        recargarApertura()
        apiPos.puntosVenta().then(setPuntos).catch(() => undefined)
        apiPos.estadoPabilo().then(setPabilo).catch(() => setPabilo(null))
        apiPos
          .configFiscal()
          .then((c) => setTasaIva(c.tasa_iva))
          .catch(() => undefined)
      })
    almacen
      .leer(CLAVE_PUNTO)
      .then((v) => setPuntoId(v ? Number(v) || null : null))
      .catch(() => undefined)
    // Varios avisos seguidos (se cobra, cocina marca listo) se juntan en una
    // sola tanda un cuarto de segundo despues del ultimo.
    let tanda: ReturnType<typeof setTimeout> | null = null
    const desuscribir = escucharEnVivo((evt) => {
      if (!evt.event.startsWith('pedido_')) return
      if (tanda) clearTimeout(tanda)
      tanda = setTimeout(() => {
        tanda = null
        void refrescarPedidos()
      }, 250)
    })
    // Respaldo del canal: si se cayo sin avisar, cada minuto con la app a la vista.
    const respaldo = setInterval(() => {
      if (AppState.currentState === 'active') void refrescarPedidos()
    }, 60000)
    const vigia = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') void refrescarPedidos()
    })
    return () => {
      desuscribir()
      if (tanda) clearTimeout(tanda)
      clearInterval(respaldo)
      vigia.remove()
    }
  }, [cargarMenu, refrescarPedidos, recargarApertura, recibirArranque])

  // Al volver a la pantalla (de la tasa, de otro modulo): lo del piso al dia.
  useFocusEffect(
    useCallback(() => {
      void refrescarPedidos()
    }, [refrescarPedidos]),
  )

  // "Comanda #12 enviada": un momento y se va sola.
  useEffect(() => {
    if (!comandaEnviada) return
    const r = setTimeout(() => setComandaEnviada(null), 4000)
    return () => clearTimeout(r)
  }, [comandaEnviada])

  // El aviso de "Cobrado" se retira solo: cerrarlo a mano en cada venta eran veinte toques por turno.
  useEffect(() => {
    if (!ultimaVenta) return
    const r = setTimeout(() => setUltimaVenta(null), 20000)
    return () => clearTimeout(r)
  }, [ultimaVenta])

  // ── Lo que sale del menu ──
  const lista = useMemo(() => categorias ?? [], [categorias])
  const grupos = useMemo(() => vendiblesDe(lista), [lista])
  const categoriaEnvios = useMemo(() => lista.find(esEnvios) ?? null, [lista])
  const envioId = categoriaEnvios?.id ?? null
  const categoriaPorId = useMemo(() => new Map(lista.map((c) => [c.id, c])), [lista])
  const categoriaDeVariante = useMemo(() => {
    const m = new Map<number, number>()
    for (const c of lista) for (const p of c.productos) for (const v of p.variantes) m.set(v.id, c.id)
    return m
  }, [lista])
  const tintes = useMemo(() => new Map(lista.map((c) => [c.id, tinteCategoria(t, c.id, c.color)])), [lista, t])
  const tinteDe = useCallback((id: number): Tinte => tintes.get(id) ?? tinteCategoria(t, id, null), [tintes, t])
  const tinteDeVariante = useCallback(
    (varianteId: number | null): Tinte | null => {
      const cat = varianteId === null ? undefined : categoriaDeVariante.get(varianteId)
      return cat === undefined ? null : (tintes.get(cat) ?? null)
    },
    [categoriaDeVariante, tintes],
  )

  const cantidades = useMemo(() => {
    const m: Record<number, number> = {}
    for (const c of Object.values(carrito)) m[c.variante.id] = c.cantidad
    return m
  }, [carrito])
  const unidades = useMemo(() => Object.values(carrito).reduce((n, c) => n + c.cantidad, 0), [carrito])
  const totalCarrito = useMemo(
    () =>
      Object.values(carrito).reduce((s, c) => s + (c.cortesia ? 0 : (c.precio ?? c.variante.precio) * c.cantidad), 0) +
      libres.reduce((s, l) => s + l.precio, 0),
    [carrito, libres],
  )

  /** A cocina o no: lo que ya tenia el renglon si se esta editando, si no lo que sugiere su categoria. */
  const cocina: Cocina = useMemo(
    () => ({
      actualDe: (id) => cocinaActualDe(enEdicion, id),
      porDefecto: (id) => categoriaPorId.get(categoriaDeVariante.get(id) ?? -1)?.va_a_cocina ?? true,
    }),
    [enEdicion, categoriaPorId, categoriaDeVariante],
  )

  // ── La comanda: agregar y quitar ──

  async function agregarEnvio(producto?: Producto, variante?: Variante) {
    // Cada envio cobra distinto segun la distancia: se escribe el monto.
    const cuanto = await pregunta.pedirNumero({
      titulo: producto && variante ? nombreDe(producto, variante) : 'Delivery',
      etiqueta: 'Cuánto cobra este envío',
      sufijo: '$',
      min: 0.01,
    })
    if (cuanto === null) return
    setLibres((l) => [
      ...l,
      producto && variante
        ? { id: uuid(), nombre: nombreDe(producto, variante), precio: cuanto, variante_id: variante.id }
        : { id: uuid(), nombre: 'Delivery', precio: cuanto },
    ])
  }

  /** El boton de delivery: el primer envio del menu, o venta libre si no hay. */
  function agregarDelivery() {
    const envio = grupos.find((g) => g.categoria.id === envioId)?.filas[0]
    void agregarEnvio(envio?.producto, envio?.variante)
  }

  function agregar(producto: Producto, variante: Variante) {
    if (envioId !== null && producto.categoria_id === envioId) {
      void agregarEnvio(producto, variante)
      return
    }
    tocarSuave()
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
    setRecien((prev) => new Set(prev).add(variante.id))
    setTimeout(() => {
      setRecien((prev) => {
        const sig = new Set(prev)
        sig.delete(variante.id)
        return sig
      })
    }, 300)
  }

  function quitar(varianteId: number) {
    setCarrito((c) => {
      const actual = c[varianteId]
      if (!actual) return c
      const sig = { ...c }
      if (actual.cantidad <= 1) delete sig[varianteId]
      else sig[varianteId] = { ...actual, cantidad: actual.cantidad - 1 }
      return sig
    })
  }

  /** El renglon entero, todas sus unidades de una vez (Leider, 2-oct). */
  function quitarTodo(varianteId: number) {
    setCarrito((c) => {
      if (!c[varianteId]) return c
      const sig = { ...c }
      delete sig[varianteId]
      return sig
    })
  }

  function alternarCortesia(varianteId: number) {
    setCarrito((c) => (c[varianteId] ? { ...c, [varianteId]: { ...c[varianteId], cortesia: !c[varianteId].cortesia } } : c))
  }

  // ── Mandar la comanda ──

  function enviarComanda() {
    setError('')
    if (Object.keys(carrito).length === 0 && libres.length === 0) return
    // Sin nombre no se comanda: cuatro comandas sin dueño se entregan
    // preguntando en voz alta, y una fiada no tendria a quien cobrarle.
    if (!clienteComanda.trim()) {
      setFaltaNombre(true)
      setError('Sin nombre no se puede comandar: escribe a nombre de quién va el pedido.')
      return
    }
    setFaltaNombre(false)
    if (Object.keys(carrito).length === 0) {
      void mandarComanda({})
      return
    }
    // A cocina o de la vitrina, renglon por renglon: cada uno nace con lo que
    // ya tenia (editando) o con lo que dice su categoria.
    setDestinos(
      Object.fromEntries(
        Object.values(carrito).map((c) => [c.variante.id, cocina.actualDe(c.variante.id) ?? cocina.porDefecto(c.variante.id)]),
      ),
    )
    // Lo agregado nace con lo que sugiere su categoria: que lo de antes fuera
    // de vitrina no dice nada de lo nuevo.
    setNuevos(
      Object.fromEntries(
        Object.values(carrito)
          .filter((c) => agregadoDe(enEdicion, c.variante.id, c.cantidad, c.cortesia) > 0)
          .map((c) => [c.variante.id, cocina.porDefecto(c.variante.id)]),
      ),
    )
  }

  function vaciarComanda() {
    setCarrito({})
    setLibres([])
    setClienteComanda('')
  }

  async function mandarComanda(destinoDe: Record<number, boolean>) {
    if (enEdicion) {
      await guardarEdicion(destinoDe)
      return
    }
    setError('')
    const nombre = clienteComanda.trim()
    const items = renglonesDeLaComanda(carrito, libres, destinoDe, cocina).map(({ variante_id, ...r }) =>
      variante_id === null ? r : { ...r, variante_id },
    )
    if (items.length === 0) return
    if (!claveComanda.current) claveComanda.current = uuid()
    const clave = claveComanda.current
    const listo = (creado: Pedido) => {
      setDestinos(null)
      vaciarComanda()
      setComandaEnviada({ numero: creado.numero, cliente: nombre })
      setHojaComanda(false)
      tocarListo()
      void refrescarPedidos()
    }
    setEnviando(true)
    try {
      listo(await apiPos.crearPedido(items, false, clave, nombre))
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : 'Error al enviar la comanda'
      setDestinos(null)
      // El conteo del sistema puede estar atrasado y hay un cliente enfrente:
      // se muestra que falta y la cajera decide. Nunca se vende a ciegas.
      if (mensaje.startsWith('No alcanza el inventario')) {
        const seguir = await confirmar({
          titulo: 'No alcanza el inventario',
          texto: `${mensaje}.\n\nPuedes vender igual y revisar el inventario después.`,
          aceptar: 'Vender igual',
        })
        if (seguir) {
          try {
            listo(await apiPos.crearPedido(items, true, clave, nombre))
          } catch (e2) {
            setError(e2 instanceof Error ? e2.message : 'Error al enviar la comanda')
          }
        }
      } else {
        setError(mensaje)
      }
    } finally {
      setEnviando(false)
    }
  }

  // ── Editar ──

  /** Cambiar de seccion. Editando, solo se puede estar en la comanda. */
  function irA(destino: IdSeccionPos) {
    if (enEdicion && destino !== 'tomar') {
      void avisar(`Estás editando el pedido #${enEdicion.numero}`, 'Termina con "Guardar cambios" o "Cancelar" antes de salir de la comanda.')
      return
    }
    router.setParams({ seccion: destino })
  }

  function terminarEdicion() {
    setNuevos({})
    recordarEdicion(null)
    setEnEdicion(null)
    setDiferencia(null)
    setFirma(null)
    setReferenciaDif('')
    vaciarComanda()
  }

  function cerrarSinCambios(id: number) {
    apiPos.soltarEdicion(id).catch(() => undefined)
    terminarEdicion()
    setHojaComanda(false)
    router.setParams({ seccion: 'pedidos' })
    void refrescarPedidos()
  }

  /**
   * Guardar los cambios de un pedido editado en la comanda. Mismo endpoint
   * que el cuadro: si la venta ya estaba cobrada y el monto cambia, hace
   * falta la firma y decir por donde entra o sale la diferencia.
   */
  async function guardarEdicion(destinoDe: Record<number, boolean>, pago?: { metodo: string; referencia: string; firma: Autorizacion | null }) {
    if (!enEdicion) return
    setError('')
    setDestinos(null)
    // Se abrio para mirar y quedo igual: no hay nada que guardar, y no es un error.
    if (huellaDeLaComanda(carrito, libres, destinoDe, cocina) === huellaDelPedido(enEdicion, envioId, categoriaDeVariante)) {
      cerrarSinCambios(enEdicion.id)
      return
    }
    const nuevoTotal = Math.max(redondear(totalCarrito - (enEdicion.descuento || 0)), 0)
    const dif = redondear(nuevoTotal - enEdicion.total)
    const mueveDinero = enEdicion.estado === 'pagado' && dif !== 0
    if (mueveDinero && !pago) {
      setDiferencia({ destinoDe, monto: dif })
      return
    }
    setEnviando(true)
    try {
      await apiPos.editarPedido(enEdicion.id, renglonesDeLaComanda(carrito, libres, destinoDe, cocina, nuevos, enEdicion), {
        autorizacion: mueveDinero && pago?.firma && !autorizoYo ? pago.firma : undefined,
        pagos: mueveDinero && pago ? [{ metodo: pago.metodo, monto: Math.abs(dif), referencia: pago.referencia }] : undefined,
      })
      terminarEdicion()
      setHojaComanda(false)
      tocarListo()
      router.setParams({ seccion: 'pedidos' })
      void refrescarPedidos()
    } catch (e) {
      setDiferencia(null)
      const mensaje = e instanceof Error ? e.message : 'No se pudieron guardar los cambios'
      if (mensaje.includes('ningún cambio')) {
        cerrarSinCambios(enEdicion.id)
        return
      }
      setError(mensaje)
    } finally {
      setEnviando(false)
    }
  }

  /** Pone los renglones del pedido en la comanda. false = no se pudo. */
  function cargarEnLaComanda(pedido: Pedido): boolean {
    const r = comandaDelPedido(pedido, lista, envioId)
    if (!r) return false
    setCarrito(r.carrito)
    setLibres(r.libres)
    setClienteComanda(pedido.cliente || '')
    setFaltaNombre(false)
    setEnEdicion(pedido)
    recordarEdicion(pedido.id)
    router.setParams({ seccion: 'tomar' })
    return true
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
      const seguir = await confirmar({
        titulo: 'Hay una comanda a medio tomar',
        texto: 'Si editas este pedido, lo que tienes en la comanda actual se descarta.',
        aceptar: 'Descartar y editar',
        peligro: true,
      })
      if (!seguir) return
    }
    if (enEdicion && enEdicion.id !== pedido.id) apiPos.soltarEdicion(enEdicion.id).catch(() => undefined)
    try {
      // El candado se toma ANTES de tocar renglones: avisarle a la cocina
      // cuando ya se guardo no sirve de nada. Si otra caja lo tiene (o quedo
      // colgado de una tablet que se reinicio), se pregunta y se toma.
      let abierto: Pedido
      try {
        abierto = await apiPos.abrirEdicion(pedido.id)
      } catch (e) {
        const mensaje = e instanceof Error ? e.message : ''
        if (!mensaje.includes('está editando')) throw e
        const tomar = await confirmar({
          titulo: mensaje.replace(/ en este momento\.?$/, ''),
          texto: 'Si la tomas, lo que esa caja no haya guardado se pierde. Úsalo si quedó abierta por error o se recargó la pantalla.',
          aceptar: 'Tomarla y editar',
        })
        if (!tomar) return
        abierto = await apiPos.abrirEdicion(pedido.id, true)
      }
      if (!cargarEnLaComanda(abierto)) {
        terminarEdicion()
        setEditando(abierto)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir la edición')
    }
    void refrescarPedidos()
  }

  function cancelarEdicion() {
    if (enEdicion) apiPos.soltarEdicion(enEdicion.id).catch(() => undefined)
    terminarEdicion()
    setHojaComanda(false)
    router.setParams({ seccion: 'pedidos' })
    void refrescarPedidos()
  }

  // Si la app se cerro a mitad de una edicion, al volver se abre otra vez en
  // la comanda tal como esta guardada (el pedido seguia en el servidor).
  const restaurada = useRef(false)
  const cargarEnLaComandaRef = useRef(cargarEnLaComanda)
  useEffect(() => {
    cargarEnLaComandaRef.current = cargarEnLaComanda
  })
  useEffect(() => {
    if (restaurada.current || !categorias || categorias.length === 0) return
    restaurada.current = true
    almacen
      .leer(CLAVE_EDICION)
      .then((v) => {
        const id = v ? Number(v) || null : null
        if (id === null) return
        return apiPos.abrirEdicion(id).then((p) => {
          if (!cargarEnLaComandaRef.current(p)) {
            apiPos.soltarEdicion(id).catch(() => undefined)
            recordarEdicion(null)
          }
        })
      })
      .catch(() => recordarEdicion(null))
  }, [categorias])

  // El candado vence a los cinco minutos: se renueva mientras la edicion siga abierta.
  const idEnEdicion = enEdicion?.id ?? null
  useEffect(() => {
    if (idEnEdicion === null) return
    const r = setInterval(() => {
      apiPos.abrirEdicion(idEnEdicion).catch(() => undefined)
    }, 2 * 60 * 1000)
    return () => clearInterval(r)
  }, [idEnEdicion])

  // ── Pedidos: anular, entregar, cocina, ventas, ticket ──

  async function anular(pedido: Pedido, perdida: boolean) {
    setAnulando(null)
    setError('')
    try {
      await apiPos.anularPedido(pedido.id, perdida)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo anular')
    }
    void refrescarPedidos()
  }

  async function entregarPedido(pedido: Pedido) {
    try {
      await apiPos.marcarEntregado(pedido.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo marcar como entregado')
    }
    void refrescarPedidos()
  }

  async function guardarCocina() {
    if (!cocinaDe) return
    const cambios = cocinaDe.pedido.items
      .filter((i) => (i.a_cocina !== false) !== cocinaDe.destino[i.id])
      .map((i) => ({ id: i.id, a_cocina: cocinaDe.destino[i.id] }))
    setGuardandoCocina(true)
    setError('')
    try {
      await apiPos.cambiarCocina(cocinaDe.pedido.id, cambios)
      setCocinaDe(null)
      void refrescarPedidos()
    } catch (e) {
      setCocinaDe(null)
      setError(e instanceof Error ? e.message : 'No se pudo cambiar')
    } finally {
      setGuardandoCocina(false)
    }
  }

  async function verVentasDelDia() {
    setCargandoVentas(true)
    setVentasHoy([])
    try {
      setVentasHoy(await apiPos.ventasDelDia())
    } catch {
      setVentasHoy([])
    } finally {
      setCargandoVentas(false)
    }
  }

  /**
   * El ticket del cliente. En el telefono no hay impresora: se comparte como
   * texto (WhatsApp, correo) y, si el sistema no deja compartir, se copia.
   */
  async function compartirTicket(id: number) {
    let texto: string
    try {
      texto = textoDelTicket(await apiPos.ticket(id), acceso?.local.nombre ?? '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar el ticket')
      return
    }
    try {
      await Share.share({ message: texto })
    } catch {
      await Clipboard.setStringAsync(texto).catch(() => undefined)
      void avisar('Ticket copiado', 'Pégalo donde lo quieras mandar.')
    }
  }

  function elegirPunto(id: number | null) {
    setPuntoId(id)
    const hecho = id ? almacen.guardar(CLAVE_PUNTO, String(id)) : almacen.borrar(CLAVE_PUNTO)
    hecho.catch(() => undefined)
  }

  // ── Acciones estables para las listas memorizadas ──
  // Los toques pasan por una referencia: las listas reciben siempre la misma
  // funcion y no se repintan enteras en cada vuelta.
  const actual = useRef({ agregar, quitar, quitarTodo, alternarCortesia, editar, entregarPedido })
  useEffect(() => {
    actual.current = { agregar, quitar, quitarTodo, alternarCortesia, editar, entregarPedido }
  })
  const agregarEstable = useCallback((p: Producto, v: Variante) => actual.current.agregar(p, v), [])
  const quitarEstable = useCallback((id: number) => actual.current.quitar(id), [])
  const quitarTodoEstable = useCallback((id: number) => actual.current.quitarTodo(id), [])
  const cortesiaEstable = useCallback((id: number) => actual.current.alternarCortesia(id), [])
  const accionesPedidos: AccionesPedidos = useMemo(
    () => ({
      // El sistema adivina si la cocina ya lo hizo, pero solo es una
      // sugerencia: se pregunta (ver la hoja de anular).
      anular: (p) => setAnulando(p),
      cocina: (p) => setCocinaDe({ pedido: p, destino: Object.fromEntries(p.items.map((i) => [i.id, i.a_cocina !== false])) }),
      editar: (p) => void actual.current.editar(p),
      cobrar: (p) => setCobrando(p),
      entregar: (p) => void actual.current.entregarPedido(p),
    }),
    [],
  )

  const accionesComanda: AccionesComanda = {
    sumar: agregarEstable,
    restar: quitarEstable,
    quitarTodo: quitarTodoEstable,
    cortesia: cortesiaEstable,
    quitarLibre: (id) => setLibres((l) => l.filter((x) => x.id !== id)),
    vaciar: () => {
      setCarrito({})
      setLibres([])
    },
    delivery: agregarDelivery,
    cambiarCliente: (v) => {
      setClienteComanda(v)
      if (faltaNombre) setFaltaNombre(false)
    },
    enviar: enviarComanda,
    cancelarEdicion,
  }

  // ── Lo que se dibuja ──

  const anchoComanda = ancho >= 1000 ? 380 : 340
  const anchoCatalogo = tablet ? ancho - anchoComanda : ancho
  const columnasCatalogo: 1 | 2 = anchoCatalogo - 32 >= 512 ? 2 : 1
  const columnasPedidos: 1 | 2 = ancho >= 700 ? 2 : 1
  // En el telefono la comanda es una hoja: lo que se abre desde ella va dentro.
  const enHoja = !tablet && hojaComanda

  const destinosCuadro =
    destinos !== null ? (
      <ElegirCocina
        visible
        titulo={enEdicion ? `¿Qué va a cocina? · pedido #${enEdicion.numero}` : `¿Qué va a cocina? · ${clienteComanda.trim()}`}
        ayuda={
          enEdicion
            ? 'Cada renglón viene como se mandó. Toca para cambiarlo: lo que faltó mandar a cocina sale ahora. Lo que la cocina ya terminó no se cambia.'
            : 'Cada renglón viene con lo que dice su categoría. Toca para cambiarlo: lo que ya está hecho en la vitrina no pasa por cocina.'
        }
        filas={Object.values(carrito)
          .filter((c) => c.variante.id in destinos)
          .flatMap((c): FilaCocina[] => {
            const va = destinos[c.variante.id] ?? true
            const hecho = cocinaLoTermino(enEdicion, c.variante.id)
            const nombre = nombreDe(c.producto, c.variante)
            const agregado = agregadoDe(enEdicion, c.variante.id, c.cantidad, c.cortesia)
            const base = {
              clave: c.variante.id,
              texto: `${c.cantidad - agregado}x ${nombre}`,
              cocina: va,
              fijo: hecho ? ('hecho' as const) : undefined,
              fueraDeLoNormal: !va && !hecho && cocina.porDefecto(c.variante.id),
            }
            if (agregado === 0) return [base]
            // Crecio: lo que ya estaba y lo agregado, cada uno con su destino.
            // La clave negativa es la de lo agregado.
            const vaNuevo = nuevos[c.variante.id] ?? cocina.porDefecto(c.variante.id)
            return [
              { ...base, detalle: 'Lo que ya estaba en el pedido' },
              {
                clave: -c.variante.id,
                texto: `+${agregado} ${nombre}`,
                detalle: 'Lo que se agregó ahora',
                cocina: vaNuevo,
                fueraDeLoNormal: !vaNuevo && cocina.porDefecto(c.variante.id),
              },
            ]
          })}
        nota={libres.length > 0 ? `${libres.length} envío(s) aparte: no pasan por cocina.` : undefined}
        alAlternar={(id) => {
          if (id < 0) setNuevos((n) => ({ ...n, [-id]: !(n[-id] ?? true) }))
          else if (!cocinaLoTermino(enEdicion, id)) setDestinos((d) => (d ? { ...d, [id]: !(d[id] ?? true) } : d))
        }}
        alTodoACocina={() => {
          setDestinos((d) =>
            d ? Object.fromEntries(Object.keys(d).map((k) => [k, cocinaLoTermino(enEdicion, Number(k)) ? d[Number(k)] : true])) : d,
          )
          setNuevos((n) => Object.fromEntries(Object.keys(n).map((k) => [k, true])))
        }}
        textoAceptar={(() => {
          // La cuenta en el boton: la decision se ve antes de enviar.
          const n = [...Object.values(destinos), ...Object.values(nuevos)]
          const aCocina = n.filter(Boolean).length
          const vitrina = n.length - aCocina
          const verbo = enEdicion ? 'Guardar' : 'Enviar'
          if (vitrina === 0) return `${verbo} · todo a cocina`
          if (aCocina === 0) return `${verbo} · ${vitrina} de vitrina, nada a cocina`
          return `${verbo} · ${aCocina} a cocina, ${vitrina} de vitrina`
        })()}
        alAceptar={() => void mandarComanda(destinos)}
        alCerrar={() => setDestinos(null)}
        ocupado={enviando}
      />
    ) : null

  const diferenciaCuadro =
    diferencia !== null && enEdicion ? (
      <Diferencia
        numero={enEdicion.numero}
        pedidoId={enEdicion.id}
        monto={diferencia.monto}
        autorizoYo={autorizoYo}
        quien={yo}
        metodo={metodoDif}
        referencia={referenciaDif}
        firma={firma}
        alCambiarMetodo={setMetodoDif}
        alCambiarReferencia={setReferenciaDif}
        alFirmar={setFirma}
        alGuardar={() => void guardarEdicion(diferencia.destinoDe, { metodo: metodoDif, referencia: referenciaDif, firma })}
        alCerrar={() => setDiferencia(null)}
        guardando={enviando}
      />
    ) : null

  const comandaProps = {
    carrito,
    libres,
    total: totalCarrito,
    enEdicion,
    cliente: clienteComanda,
    faltaNombre,
    enviada: comandaEnviada,
    error,
    tinteDe,
    fmt,
    acciones: accionesComanda,
    extra: (
      <>
        {destinosCuadro}
        {diferenciaCuadro}
        {tablet || enHoja ? pregunta.elemento : null}
      </>
    ),
  }

  let catalogo
  if (categorias === null && errorMenu) catalogo = <Problema mensaje={errorMenu} alReintentar={() => void cargarMenu()} />
  else if (categorias === null) catalogo = <Cargando />
  else
    catalogo = (
      <Catalogo
        categorias={lista}
        grupos={grupos}
        envioId={envioId}
        cantidades={cantidades}
        recien={recien}
        unidades={unidades}
        columnas={columnasCatalogo}
        fmt={fmt}
        alAgregar={agregarEstable}
        alQuitar={quitarEstable}
        alQuitarTodo={quitarTodoEstable}
        refrescando={refrescandoMenu}
        alRefrescar={() => {
          setRefrescandoMenu(true)
          void cargarMenu()
        }}
      />
    )

  const lineaDeBorde = modo === 'oscuro' ? 'rgba(255,255,255,0.06)' : t.gris200

  return (
    <View style={{ flex: 1, backgroundColor: t.papel }}>
      <Fondo />
      <Stack.Screen options={{ title: 'Punto de venta' }} />
      {/* Sin borde de arriba: el encabezado nativo del Stack ya lo ocupa. */}
      <SafeAreaView edges={['left', 'right']} style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
          <Pestanas
            opciones={SECCIONES.map((s) => ({
              ...s,
              texto: s.id === 'pedidos' && pedidosActivos.length > 0 ? `${s.texto} · ${pedidosActivos.length}` : s.texto,
            }))}
            valor={vista}
            alCambiar={irA}
          />
        </View>

        {/* NO bloquea la venta: un local no deja de cobrar porque falte un
            formulario. Esta donde no se puede no verlo, y dice que se pierde. */}
        {apertura && !apertura.abierta && apertura.puede_abrir ? (
          <View style={[e.caja, { backgroundColor: t.avisoSuave, borderColor: t.avisoLinea }]}>
            <Text style={[e.cajaTexto, { color: t.avisoFuerte }]}>
              <Text style={{ fontFamily: LETRA.textoFuerte }}>La caja no se ha abierto.</Text> Cuenta el fondo con el que arrancas.
            </Text>
            <Pressable
              onPress={() => setAbriendoCaja(true)}
              accessibilityRole="button"
              accessibilityLabel="Abrir caja"
              style={({ pressed }) => [e.cajaBoton, { backgroundColor: t.tinta, opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={[e.cajaBotonTexto, { color: t.papel }]}>Abrir caja</Text>
            </Pressable>
          </View>
        ) : null}

        {vista === 'tomar' ? (
          <View style={{ flex: 1, flexDirection: 'row', marginTop: 6 }}>
            <View style={{ flex: 1 }}>{catalogo}</View>
            {tablet ? (
              <View style={{ width: anchoComanda }}>
                <Comanda forma="columna" {...comandaProps} />
              </View>
            ) : null}
          </View>
        ) : (
          <View style={{ flex: 1, marginTop: 6 }}>
            <Pedidos
              pedidos={pedidosActivos}
              cargando={cargandoPedidos}
              columnas={columnasPedidos}
              yo={yo}
              puntos={puntos}
              puntoId={puntoId}
              alElegirPunto={elegirPunto}
              tinteDeVariante={tinteDeVariante}
              fmt={fmt}
              acciones={accionesPedidos}
              alVerVentas={() => void verVentasDelDia()}
              aviso={error ? <Aviso texto={error} tono="peligro" /> : null}
              refrescando={refrescandoPedidos}
              alRefrescar={() => {
                setRefrescandoPedidos(true)
                void refrescarPedidos()
              }}
            />
          </View>
        )}

        {/* El telefono: la comanda abajo, con su total, y se abre. */}
        {vista === 'tomar' && !tablet ? (
          <View style={[e.barra, { backgroundColor: t.superficie, borderTopColor: lineaDeBorde, paddingBottom: 12 + borde.bottom }]}>
            {enEdicion ? (
              <Text style={[e.barraNota, { color: t.aviso }]}>Editando el pedido #{enEdicion.numero}</Text>
            ) : comandaEnviada ? (
              <Text style={[e.barraNota, { color: t.exito }]} numberOfLines={1}>
                ✓ Comanda #{comandaEnviada.numero} enviada{comandaEnviada.cliente ? ` · ${comandaEnviada.cliente}` : ''}
              </Text>
            ) : error && !hojaComanda ? (
              <Text style={[e.barraNota, { color: t.peligro }]} numberOfLines={2}>
                {error}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[e.barraRotulo, { color: t.tenue }]}>
                  TOTAL{unidades > 0 ? ` · ${unidades} en la comanda` : ''}
                </Text>
                <Text style={[e.barraCifra, { color: t.tinta }]} numberOfLines={1} adjustsFontSizeToFit>
                  {fmt(totalCarrito)}
                </Text>
              </View>
              <View style={{ minWidth: 160 }}>
                <Boton texto="Ver comanda" alTocar={() => setHojaComanda(true)} />
              </View>
            </View>
          </View>
        ) : null}
      </SafeAreaView>

      {!tablet ? <Comanda forma="hoja" visible={hojaComanda} alCerrar={() => setHojaComanda(false)} {...comandaProps} /> : null}

      {/* "Cobrado", dicho: se va solo a los 20 s. Lleva el ticket para compartir. */}
      {ultimaVenta ? (
        <View
          pointerEvents="box-none"
          style={[e.cobradoCapa, { bottom: borde.bottom + (vista === 'tomar' && !tablet ? 104 : 20) }]}
        >
          <View style={[e.cobrado, { backgroundColor: t.exito }]} accessibilityLiveRegion="polite">
            <Icono nombre="ok" size={15} color={t.exitoSuave} grosor={2.6} />
            <Text style={[e.cobradoTexto, { color: t.exitoSuave }]} numberOfLines={1}>
              Cobrado #{ultimaVenta.numero} · {fmt(ultimaVenta.a_cobrar ?? ultimaVenta.total)}
            </Text>
            <Pressable
              onPress={() => void compartirTicket(ultimaVenta.id)}
              accessibilityRole="button"
              accessibilityLabel="Ticket"
              style={({ pressed }) => [e.cobradoBoton, { backgroundColor: pressed ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.18)' }]}
            >
              <Text style={[e.cobradoBotonTexto, { color: t.exitoSuave }]}>Ticket</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {!tablet && !enHoja ? pregunta.elemento : null}

      {cobrando ? (
        <Cobro
          pedido={cobrando}
          pabilo={pabilo}
          puntoId={puntoId}
          tasaIva={tasaIva}
          alCobrado={(p) => {
            setCobrando(null)
            setUltimaVenta(p)
            tocarListo()
            void refrescarPedidos()
          }}
          alFallar={(mensaje) => {
            setCobrando(null)
            setError(mensaje)
            void refrescarPedidos()
          }}
          alCerrar={() => setCobrando(null)}
        />
      ) : null}

      {editando ? (
        <EditarPedido
          pedido={editando}
          categorias={lista}
          alGuardado={() => {
            setEditando(null)
            void refrescarPedidos()
          }}
          alCerrar={() => {
            // Suelta el candado sin esperar: si falla, vence solo a los cinco minutos.
            apiPos.soltarEdicion(editando.id).catch(() => undefined)
            setEditando(null)
            void refrescarPedidos()
          }}
        />
      ) : null}

      {cocinaDe ? (
        <ElegirCocina
          visible
          titulo={`Cocina · pedido #${cocinaDe.pedido.numero}`}
          ayuda="Renglón por renglón: toca para cambiar lo que va a cocina y lo que sale de la vitrina. Lo que la cocina ya hizo o está haciendo no se cambia."
          filas={cocinaDe.pedido.items.map((i) => {
            const hecho = i.a_cocina !== false && i.preparado
            const preparando = i.a_cocina !== false && !i.preparado && Boolean(cocinaDe.pedido.cocinando_desde)
            return {
              clave: i.id,
              texto: `${i.cantidad}x ${i.nombre}`,
              cocina: cocinaDe.destino[i.id],
              fijo: hecho ? ('hecho' as const) : preparando ? ('preparando' as const) : undefined,
            }
          })}
          alAlternar={(id) => setCocinaDe((c) => (c ? { ...c, destino: { ...c.destino, [id]: !c.destino[id] } } : c))}
          textoAceptar="Guardar"
          alAceptar={() => void guardarCocina()}
          alCerrar={() => setCocinaDe(null)}
          ocupado={guardandoCocina}
          deshabilitado={!cocinaDe.pedido.items.some((i) => (i.a_cocina !== false) !== cocinaDe.destino[i.id])}
        />
      ) : null}

      <HojaAnular pedido={anulando} alElegir={(p, perdida) => void anular(p, perdida)} alCerrar={() => setAnulando(null)} />

      {ventasHoy !== null ? (
        <VentasDeHoy
          ventas={ventasHoy}
          cargando={cargandoVentas}
          alTicket={(id) => void compartirTicket(id)}
          alCerrar={() => setVentasHoy(null)}
        />
      ) : null}

      {abriendoCaja && apertura ? (
        <AbrirCaja
          estado={apertura}
          alCerrar={() => setAbriendoCaja(false)}
          alAbrir={() => {
            setAbriendoCaja(false)
            recargarApertura()
          }}
        />
      ) : null}
    </View>
  )
}

/**
 * Anular, preguntando si la comida se hizo. El sistema adivina segun lo que
 * marco la cocina, pero es solo una sugerencia: si alguien marco por error,
 * la adivinanza queda mal. Solo cuenta lo que hizo la cocina (lo de vitrina
 * nace "listo" sin que nadie lo cocinara, y al anular vuelve a la vitrina).
 */
function HojaAnular({
  pedido,
  alElegir,
  alCerrar,
}: {
  pedido: Pedido | null
  alElegir: (p: Pedido, perdida: boolean) => void
  alCerrar: () => void
}) {
  const t = useTema()
  const yaHecha = pedido ? pedido.items.some((i) => i.preparado && i.a_cocina !== false) : false
  return (
    <Hoja visible={pedido !== null} alCerrar={alCerrar} titulo={pedido ? `¿Anular el pedido #${pedido.numero}?` : undefined}>
      <Text style={[e.anularTexto, { color: t.suave }]}>
        El sistema cree que {yaHecha ? 'la cocina ya lo preparó' : 'todavía no se preparó'}. Confirma o corrige:
      </Text>
      {/* La opcion que el sistema NO esperaba se resalta: es la inusual. */}
      <OpcionHoja
        texto="Se preparó: es pérdida"
        detalle="La comida se botó. Queda como merma y no vuelve al inventario."
        peligro={!yaHecha}
        alTocar={() => pedido && alElegir(pedido, true)}
      />
      <OpcionHoja
        texto="No se preparó: vuelve al inventario"
        detalle="La mercancía que se iba a usar vuelve al stock."
        peligro={yaHecha}
        alTocar={() => pedido && alElegir(pedido, false)}
      />
      <View style={{ paddingTop: 8, paddingHorizontal: 4 }}>
        <Boton texto="Cancelar" tono="neutro" alTocar={alCerrar} />
      </View>
    </Hoja>
  )
}

const e = StyleSheet.create({
  caja: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 6,
    borderRadius: 16, borderCurve: 'continuous',
    borderWidth: 1,
    paddingLeft: 14,
    paddingRight: 8,
    paddingVertical: 8,
  },
  cajaTexto: { flex: 1, fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
  cajaBoton: { minHeight: 44, borderRadius: 12, borderCurve: 'continuous', paddingHorizontal: 14, justifyContent: 'center' },
  cajaBotonTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14 },
  barra: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 10, gap: 6 },
  barraNota: { fontFamily: LETRA.textoFuerte, fontSize: 13.5 },
  barraRotulo: { fontFamily: LETRA.textoFuerte, fontSize: 11, letterSpacing: 1.2 },
  barraCifra: { fontFamily: LETRA.tituloFuerte, fontSize: 24, letterSpacing: -0.5 },
  cobradoCapa: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  cobrado: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 999,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
    maxWidth: '100%',
    boxShadow: '0 8px 18px rgba(0,0,0,0.22)',
  },
  cobradoTexto: { flexShrink: 1, fontFamily: LETRA.textoFuerte, fontSize: 14.5 },
  cobradoBoton: { minHeight: 36, borderRadius: 999, paddingHorizontal: 14, justifyContent: 'center' },
  cobradoBotonTexto: { fontFamily: LETRA.textoFuerte, fontSize: 13.5 },
  anularTexto: { fontFamily: LETRA.texto, fontSize: 14.5, lineHeight: 20, paddingHorizontal: 12, paddingBottom: 6 },
})
