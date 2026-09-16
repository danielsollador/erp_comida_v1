import { useCallback, useEffect, useRef, useState } from 'react'
import Icono from '../components/Icono'
import NavBar from '../components/NavBar'
import { useDialogo } from '../components/dialogo'
import { api, connectWs } from '../lib/api'
import type { Pedido } from '../lib/types'

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
    // Dos tonos cortos: se oye por encima del ruido de cocina sin ser una alarma.
    const ahora = ctx.currentTime
    for (const [i, freq] of [880, 1175].entries()) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      osc.type = 'sine'
      const t = ahora + i * 0.18
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.18)
    }
  }, [])

  const refrescar = useCallback(() => {
    api.listarPedidos('pendiente').then((ps) => {
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
    const interval = setInterval(() => setTick((t) => t + 1), 30000)
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

  async function toggleItem(itemId: number) {
    await api.marcarItemPreparado(itemId)
    refrescar()
  }

  async function marcarTodoListo(pedidoId: number) {
    await api.marcarPedidoListo(pedidoId)
    refrescar()
  }

  // La cocina es quien sabe si la comida alcanzo a hacerse, y hasta ahora solo
  // el POS podia anular. Se pregunta explicitamente porque de eso depende si el
  // insumo vuelve al inventario o se registra como merma.
  async function anular(pedido: Pedido) {
    const yaHecha = pedido.items.some((i) => i.preparado)
    const texto = yaHecha
      ? 'Ya hay items preparados: lo hecho se registra como merma.'
      : 'Los insumos vuelven al inventario.'
    if (!(await dialogo.confirmar({ titulo: `¿Anular la comanda #${pedido.numero}?`, texto, aceptar: 'Anular', peligro: true }))) return
    await api.anularPedido(pedido.id, yaHecha)
    refrescar()
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
          return (
            <div
              key={pedido.id}
              className={`rounded-2xl p-5 border transition ${
                esNuevo
                  ? 'bg-acento-50 border-acento-400 ring-4 ring-acento-500/40 animate-pulse'
                  : `bg-white border-neutral-200 ${estilo.card}`
              }`}
            >
              <div className="flex justify-between items-center mb-4">
                <span className="text-3xl font-black tracking-tight tabular-nums">
                  #{pedido.numero}
                </span>
                <div className="flex items-center gap-2">
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
              <ul className="space-y-2 mb-4">
                {pedido.items.map((item) => (
                  <li key={item.id}>
                    <button
                      onClick={() => toggleItem(item.id)}
                      className={`w-full text-left px-4 py-3 rounded-xl flex justify-between items-center gap-3 border ${
                        item.preparado
                          ? 'bg-exito-500/10 border-exito-500/30 text-neutral-500 line-through'
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
                ))}
              </ul>
              <button
                onClick={() => marcarTodoListo(pedido.id)}
                className="w-full bg-exito-600 hover:bg-exito-500 text-neutral-50 py-3.5 rounded-xl font-bold text-base"
              >
                Marcar todo listo
              </button>
              <button
                onClick={() => anular(pedido)}
                className="w-full mt-2 text-neutral-500 hover:text-peligro-400 py-1.5 text-sm font-medium"
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
