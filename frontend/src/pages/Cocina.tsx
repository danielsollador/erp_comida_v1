import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icono from '../components/Icono'
import NavBar from '../components/NavBar'
import { useDialogo } from '../components/dialogo'
import { api, connectWs } from '../lib/api'
import { editandoAhora } from '../lib/comandas'
import type { Categoria, Pedido } from '../lib/types'
import { useModoLigero } from '../lib/ligero'
import { colorCategoria, type TinteCategoria } from '../lib/theme'

const CLAVE_SONIDO = 'cocina.sonido'
// Cuanto se resalta un pedido recien llegado antes de verse como los demas.
const MS_RESALTADO = 25000

function minutosDesde(iso: string): number {
  // El backend guarda hora local del local comercial, sin zona horaria.
  // Un string ISO sin offset se parsea como hora local, que es justo lo que
  // queremos; solo hay que recortar los microsegundos que JS no entiende.
  const limpio = iso.replace(/(\.\d{3})\d+$/, '$1')
  const fecha = new Date(limpio)
  if (Number.isNaN(fecha.getTime())) return 0
  return Math.max(0, Math.floor((Date.now() - fecha.getTime()) / 60000))
}

function estiloAntiguedad(minutos: number) {
  if (minutos >= 12)
    return { badge: 'bg-peligro-500/15 text-peligro-700 ring-1 ring-peligro-500/40', card: 'ring-2 ring-peligro-500/50' }
  if (minutos >= 6)
    return { badge: 'bg-aviso-500/15 text-aviso-700 ring-1 ring-aviso-500/40', card: 'ring-1 ring-aviso-500/30' }
  return { badge: 'bg-exito-500/15 text-exito-700 ring-1 ring-exito-500/30', card: '' }
}

export default function Cocina() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const dialogo = useDialogo()
  // Horas abierta en una tablet: sin desenfoques ni animaciones (lib/ligero).
  useModoLigero()
  // El color de la categoria en cada renglon, igual que en el mostrador
  // (Leider, 21-sep: "los colores tienen que estar para cocina tambien").
  // Los renglones traen solo la variante, asi que el menu se carga una vez
  // para saber a que categoria pertenece cada una.
  const [categorias, setCategorias] = useState<Categoria[]>([])
  useEffect(() => {
    api.listarCategorias().then(setCategorias).catch(() => setCategorias([]))
  }, [])
  const tinteDeVariante = useMemo(() => {
    const m = new Map<number, TinteCategoria>()
    for (const c of categorias)
      for (const p of c.productos)
        for (const v of p.variantes) m.set(v.id, colorCategoria(c.id, c.color))
    return m
  }, [categorias])
  const [, setTick] = useState(0)
  const [nuevos, setNuevos] = useState<Set<number>>(new Set())
  // El navegador no deja sonar nada hasta que alguien toca la pantalla, asi que
  // el sonido arranca apagado y la cocina lo activa con un toque al abrir turno.
  const [sonido, setSonido] = useState(false)
  const audioRef = useRef<AudioContext | null>(null)
  const idsConocidos = useRef<Set<number> | null>(null)

  const sonar = useCallback(() => {
    const ctx = audioRef.current
    if (!ctx) return
    // Dos tonos, repetidos dos veces: mas volumen y mas largo que antes -la
    // version corta se perdia entre licuadoras y freidoras- pero sigue siendo
    // un timbre, no una sirena.
    const ahora = ctx.currentTime
    for (const [i, freq] of [880, 1175, 880, 1175].entries()) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      osc.type = 'sine'
      const t = ahora + i * 0.26
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.7, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.24)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.26)
    }
  }, [])

  const refrescar = useCallback(() => {
    api.listarPedidosEnCocina().then((ps) => {
      const ordenados = ps.sort((a, b) => a.numero - b.numero)
      setPedidos(ordenados)

      const ids = new Set(ordenados.map((p) => p.id))
      const previos = idsConocidos.current
      idsConocidos.current = ids

      // En la primera carga no se avisa: son los pedidos que ya estaban.
      if (previos === null) return

      const recien = ordenados.filter((p) => !previos.has(p.id)).map((p) => p.id)
      if (recien.length === 0) return

      sonar()
      setNuevos((prev) => new Set([...prev, ...recien]))
      setTimeout(() => {
        setNuevos((prev) => {
          const next = new Set(prev)
          for (const id of recien) next.delete(id)
          return next
        })
      }, MS_RESALTADO)
    })
  }, [sonar])

  useEffect(() => {
    refrescar()
    const disconnect = connectWs(() => refrescar())
    // Cada 30 s se repintan los minutos Y se vuelve a pedir la cola: si el
    // websocket murio sin avisar (la tablet se durmio), la pantalla no se
    // queda con comandas que la caja ya cobro o anulo. Una peticion cada
    // medio minuto por pantalla abierta.
    const interval = setInterval(() => {
      setTick((t) => t + 1)
      if (document.visibilityState === 'visible') refrescar()
    }, 30000)
    return () => {
      disconnect()
      clearInterval(interval)
    }
  }, [refrescar])

  function alternarSonido() {
    if (sonido) {
      setSonido(false)
      localStorage.setItem(CLAVE_SONIDO, 'off')
      return
    }
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!audioRef.current) audioRef.current = new Ctor()
      audioRef.current.resume()
      setSonido(true)
      localStorage.setItem(CLAVE_SONIDO, 'on')
      sonar() // confirmacion audible de que quedo activo
    } catch {
      // Sin audio disponible el resto de la pantalla sigue funcionando igual.
    }
  }

  /**
   * Las acciones de cocina ya pueden ser rechazadas: si la caja abrio la
   * comanda para editarla, el servidor dice que no. Sin atrapar el error, el
   * toque se perdia en silencio y el cocinero volvia a tocar.
   */
  async function intentar(accion: () => Promise<unknown>) {
    try {
      await accion()
    } catch (e) {
      await dialogo.avisar({ titulo: 'No se pudo', texto: (e as Error).message, tono: 'ojo' })
    }
    refrescar()
  }

  /**
   * "Esta es mia": el resto de la cocina lo ve, y la caja deja de poder
   * cambiarle los renglones a algo que ya esta en el sarten.
   */
  async function alternarCocinando(pedidoId: number) {
    await intentar(() => api.marcarCocinando(pedidoId))
  }

  async function toggleItem(itemId: number) {
    await intentar(() => api.marcarItemPreparado(itemId))
  }

  async function marcarTodoListo(pedidoId: number) {
    await intentar(() => api.marcarPedidoListo(pedidoId))
  }

  // La cocina es quien sabe de verdad si la comida alcanzo a hacerse - el
  // sistema solo adivina por si algun item quedo marcado "preparado", y esa
  // marca se puede escapar (se hizo la comida y nadie toco la casilla). Se
  // pregunta en vez de imponer la adivinanza.
  async function anular(pedido: Pedido) {
    const yaHecha = pedido.items.some((i) => i.preparado)
    const eleccion = await dialogo.elegir({
      titulo: `¿Anular la comanda #${pedido.numero}?`,
      texto: `El sistema cree que ${yaHecha ? 'ya se preparó algo' : 'todavía no se preparó nada'}. Confirma o corrige:`,
      opciones: [
        {
          valor: 'perdida',
          texto: 'Se preparó: es pérdida',
          detalle: 'La comida se botó. Queda como merma y no vuelve al inventario.',
          peligro: !yaHecha,
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
    // Por `intentar`, que dice el motivo en vez de tragarselo. Pasa de verdad:
    // si caja ya cobro el pedido mientras cocina lo tenia abierto (en_cocina
    // muestra lo pagado que aun no esta preparado), el backend rechaza la
    // anulacion, y antes el dialogo se cerraba sin decir nada.
    await intentar(() => api.anularPedido(pedido.id, eleccion === 'perdida'))
  }

  return (
    // Sigue el interruptor de tema como todas las demas pantallas. Iba
    // oscura siempre --menos brillo detras del fogon-- pero era la unica que
    // no obedecia al interruptor y de dia se veia de otro aplicativo. Quien
    // la quiera oscura pone el modo oscuro, que ademas se recuerda.
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <NavBar
        titulo="Cocina"
        moneda={false}
        acciones={
          <>
            {/* La pantalla completa ya la pone <NavBar> para todos los
                modulos; aqui solo queda lo propio de cocina. */}
            <button
              onClick={alternarSonido}
              className={`text-sm px-3 py-2 rounded-lg font-medium flex items-center gap-2 ${
                sonido
                  ? 'bg-exito-600 hover:bg-exito-500 text-neutral-50'
                  : 'bg-aviso-500 hover:bg-aviso-400 text-neutral-50'
              }`}
            >
              <Icono nombre={sonido ? 'campana' : 'campana-muda'} size={16} />
              {/* En el telefono solo la campana: con el texto, el titulo de la
                  pantalla se quedaba en "Coci...". El aviso de abajo ya explica
                  para que sirve mientras esta apagado. */}
              <span className="hidden sm:inline">{sonido ? 'Aviso activo' : 'Activar aviso'}</span>
            </button>
          </>
        }
      />

      {!sonido && (
        <div className="bg-aviso-500/15 border-b border-aviso-500/30 text-aviso-800 px-5 py-2.5 text-sm">
          Toca <strong>Activar aviso</strong> para que suene cuando entre una comanda. Hazlo al
          abrir el turno.
        </div>
      )}

      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {pedidos.map((pedido) => {
          const minutos = minutosDesde(pedido.creado_en)
          const estilo = estiloAntiguedad(minutos)
          const esNuevo = nuevos.has(pedido.id)
          // La caja la tiene abierta: no se toca hasta que termine, porque los
          // renglones que se ven pueden dejar de ser los del pedido.
          const bloqueada = editandoAhora(pedido)
          const mia = Boolean(pedido.cocinando_desde)
          return (
            <div
              key={pedido.id}
              className={`rounded-2xl p-5 border transition ${
                bloqueada
                  ? 'bg-aviso-500/10 border-aviso-500 ring-2 ring-aviso-500/50'
                  : esNuevo
                    ? 'bg-acento-50 border-acento-400 ring-4 ring-acento-500/40 animate-pulse'
                    : `bg-white border-neutral-200 ${estilo.card}`
              }`}
            >
              <div className="flex justify-between items-center mb-4">
                {/* El nombre debajo del numero y no al lado: el numero se lee
                    de lejos --es lo que se canta cuando la comida sale-- y
                    ponerle el nombre en la misma linea lo encogeria. */}
                <span className="min-w-0">
                  <span className="block text-3xl font-black tracking-tight tabular-nums">
                    #{pedido.numero}
                  </span>
                  {pedido.cliente && (
                    <span className="block text-base font-semibold text-neutral-600 truncate">
                      {pedido.cliente}
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {/* Un pedido que cambio despues de tomado no es igual a uno
                      que salio bien a la primera: lo primero que hace el
                      cocinero al verlo es releer los renglones. */}
                  {pedido.editado && (
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-aviso-500/20 text-aviso-800 ring-1 ring-aviso-500/40 uppercase tracking-wide">
                      Editado
                    </span>
                  )}
                  {esNuevo && (
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-acento-400 text-neutral-50 uppercase tracking-wide">
                      Nuevo
                    </span>
                  )}
                  <span
                    className={`text-sm font-semibold px-2.5 py-1 rounded-full tabular-nums ${estilo.badge}`}
                  >
                    {minutos} min
                  </span>
                </div>
              </div>

              {bloqueada && (
                <div className="mb-4 px-4 py-3 rounded-xl bg-aviso-500/20 text-aviso-900 text-sm font-semibold flex items-center gap-2">
                  <Icono nombre="alerta" size={16} />
                  {pedido.editando_por || 'El punto de venta'} está editando esta comanda.
                  Espera: los renglones pueden cambiar.
                </div>
              )}

              {/* Agarrarla es lo que le cierra la edicion a la caja. Marcar un
                  renglon tambien la agarra, asi que el boton es para decirlo
                  antes de empezar -- que es cuando sirve. */}
              <button
                onClick={() => alternarCocinando(pedido.id)}
                disabled={bloqueada}
                className={`w-full mb-4 py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-40 ${
                  mia
                    ? 'bg-acento-500/15 text-acento-800 ring-1 ring-acento-500/40'
                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                }`}
              >
                <Icono nombre="cocina" size={16} />
                {mia
                  ? `En preparación${pedido.cocinando_por ? ` · ${pedido.cocinando_por}` : ''}`
                  : 'Empezar a preparar'}
              </button>

              <ul className="space-y-2 mb-4">
                {pedido.items.map((item) => {
                  const tinte = item.variante_id != null ? tinteDeVariante.get(item.variante_id) : undefined
                  return (
                  <li key={item.id}>
                    <button
                      onClick={() => toggleItem(item.id)}
                      disabled={bloqueada}
                      className={`w-full text-left px-4 py-3 rounded-xl flex justify-between items-center gap-3 border disabled:opacity-50 ${
                        item.preparado
                          ? 'bg-exito-500/10 border-exito-500/30 text-neutral-500 line-through'
                          : tinte
                            ? `${tinte.bg} ${tinte.border}`
                            : 'bg-neutral-100 border-neutral-200'
                      }`}
                    >
                      <span className="text-lg font-semibold leading-snug">
                        <span className="tabular-nums">{item.cantidad}x</span> {item.nombre}
                      </span>
                      <span
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0 ${
                          item.preparado ? 'bg-exito-500 text-neutral-50' : 'bg-neutral-200'
                        }`}
                      >
                        {item.preparado ? '✓' : ''}
                      </span>
                    </button>
                  </li>
                  )
                })}
              </ul>
              <button
                onClick={() => marcarTodoListo(pedido.id)}
                disabled={bloqueada}
                className="w-full bg-exito-600 hover:bg-exito-500 disabled:opacity-40 disabled:hover:bg-exito-600 text-neutral-50 py-3.5 rounded-xl font-bold text-base"
              >
                Marcar todo listo
              </button>
              <button
                onClick={() => anular(pedido)}
                disabled={bloqueada}
                className="w-full mt-2 text-neutral-500 hover:text-peligro-400 disabled:opacity-40 py-1.5 text-sm font-medium"
              >
                Anular comanda
              </button>
            </div>
          )
        })}
        {pedidos.length === 0 && (
          <p className="text-neutral-400 col-span-full text-center py-24 text-xl font-medium">
            No hay pedidos pendientes.
          </p>
        )}
      </div>
    </div>
  )
}
