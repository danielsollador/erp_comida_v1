import { useCallback, useEffect, useRef, useState } from 'react'
import { useAcceso } from '../lib/acceso'
import { api, connectWs } from '../lib/api'
import { useMoneda } from '../lib/moneda'
import type { SolicitudAutorizacion } from '../lib/types'
import Icono from './Icono'
import { useAnchoDeTelefono } from '../lib/desplegable'

/**
 * La campana: el buzon de notificaciones, arriba junto a la moneda.
 *
 * Las tarjetas flotantes (`Solicitudes.tsx`) avisan de lo que llega AHORA;
 * esto es lo que queda: si el dueño no tenia la aplicacion abierta cuando
 * la caja pidio permiso, aqui lo encuentra al abrirla, con su punto rojo, y
 * lo aprueba o rechaza desde el mismo panel. Y lo ya resuelto se queda como
 * historial: quien pidio que, cuando, y quien respondio.
 *
 * Quien autoriza ve todo el local; el resto ve solo lo que pidio.
 */
export default function Notificaciones({ dark = false }: { dark?: boolean }) {
  const { estado } = useAcceso()
  const { fmt } = useMoneda()
  const [abierto, setAbierto] = useState(false)
  const [lista, setLista] = useState<SolicitudAutorizacion[]>([])
  const [ocupada, setOcupada] = useState<number | null>(null)
  const caja = useRef<HTMLDivElement>(null)
  const enTelefono = useAnchoDeTelefono(caja, abierto)

  const cargar = useCallback(() => {
    api.historialAutorizaciones().then(setLista).catch(() => undefined)
  }, [])

  useEffect(() => {
    cargar()
    // Cada solicitud nueva o resuelta llega por WebSocket: se vuelve a pedir
    // la lista, que es corta.
    const desconectar = connectWs((evt) => {
      if (evt.event === 'autorizacion_pendiente' || evt.event === 'autorizacion_resuelta') cargar()
    })
    return desconectar
  }, [cargar])

  useEffect(() => {
    if (!abierto) return
    cargar()
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', escape)
    }
  }, [abierto, cargar])

  async function resolver(s: SolicitudAutorizacion, aprobar: boolean) {
    setOcupada(s.id)
    try {
      if (aprobar) await api.aprobarSolicitud(s.id)
      else await api.rechazarSolicitud(s.id)
    } catch {
      // la lista se recarga igual y muestra el estado real
    } finally {
      setOcupada(null)
      cargar()
    }
  }

  const pendientes = lista.filter((s) => s.estado === 'pendiente')
  const puedeResolver = estado.puede.autoriza

  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-label={pendientes.length ? `${pendientes.length} notificaciones pendientes` : 'Notificaciones'}
        title="Notificaciones"
        className={`relative w-9 h-9 rounded-full border grid place-items-center shrink-0 ${
          dark
            ? 'border-neutral-700 text-neutral-400 hover:text-white hover:border-neutral-500'
            : 'border-neutral-200 text-neutral-500 hover:text-neutral-900 hover:border-neutral-400 bg-white'
        }`}
      >
        <Icono nombre="campana" size={16} />
        {pendientes.length > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-peligro-600 text-white text-[10px] font-bold grid place-items-center">
            {pendientes.length}
          </span>
        )}
      </button>

      {abierto && (
        <div
          role="menu"
          className={`absolute right-0 mt-2 w-[22rem] rounded-2xl border shadow-lg z-30 overflow-hidden ${
            dark ? 'bg-neutral-900 border-neutral-700 text-white' : 'bg-white border-neutral-200'
          }`}
          style={{ animation: 'vp-entrar .18s cubic-bezier(.2,.7,.2,1) both', ...enTelefono }}
        >
          <div className={`px-4 py-3 border-b flex items-baseline justify-between ${dark ? 'border-neutral-800' : 'border-neutral-100'}`}>
            <span className="font-semibold font-display">Notificaciones</span>
            <span className={`text-xs ${dark ? 'text-neutral-400' : 'text-neutral-500'}`}>
              {pendientes.length ? `${pendientes.length} por resolver` : 'Nada pendiente'}
            </span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {lista.length === 0 && (
              <p className={`px-4 py-6 text-sm text-center ${dark ? 'text-neutral-400' : 'text-neutral-500'}`}>
                Aquí aparecerán las solicitudes de autorización.
              </p>
            )}
            {lista.map((s) => (
              <Fila
                key={s.id}
                s={s}
                dark={dark}
                fmt={fmt}
                puedeResolver={puedeResolver && s.solicitante !== estado.usuario}
                ocupada={ocupada === s.id}
                onResolver={(aprobar) => void resolver(s, aprobar)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const ESTADO: Record<string, { texto: string; clase: string }> = {
  pendiente: { texto: 'Pendiente', clase: 'bg-aviso-50 text-aviso-700' },
  aprobada: { texto: 'Aprobada', clase: 'bg-exito-50 text-exito-700' },
  usada: { texto: 'Aprobada y usada', clase: 'bg-exito-50 text-exito-700' },
  rechazada: { texto: 'Rechazada', clase: 'bg-peligro-50 text-peligro-700' },
  cancelada: { texto: 'Cancelada', clase: 'bg-neutral-100 text-neutral-600' },
  vencida: { texto: 'Vencida', clase: 'bg-neutral-100 text-neutral-600' },
}

function cuando(iso: string): string {
  const f = new Date(iso)
  const hoy = new Date()
  const mismoDia = f.toDateString() === hoy.toDateString()
  return f.toLocaleString('es-VE', {
    ...(mismoDia ? {} : { day: '2-digit', month: 'short' }),
    hour: '2-digit',
    minute: '2-digit',
  })
}

function Fila({
  s,
  dark,
  fmt,
  puedeResolver,
  ocupada,
  onResolver,
}: {
  s: SolicitudAutorizacion
  dark: boolean
  fmt: (n: number) => string
  puedeResolver: boolean
  ocupada: boolean
  onResolver: (aprobar: boolean) => void
}) {
  const e = ESTADO[s.estado] ?? { texto: s.estado, clase: 'bg-neutral-100 text-neutral-600' }
  const accion = s.accion === 'editar_venta'
      ? 'Editar una venta ya cobrada'
      : s.accion === 'corregir_pago'
        ? 'Corregir la forma de pago de una venta'
        : s.accion
  return (
    <div className={`px-4 py-3 border-b last:border-b-0 ${dark ? 'border-neutral-800' : 'border-neutral-100'}`}>
      <div className="flex items-start gap-2">
        <span
          className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${s.estado === 'pendiente' ? 'bg-peligro-600' : 'bg-transparent'}`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-tight">
            <span className="font-semibold">{s.solicitante_nombre || s.solicitante}</span> pidió autorización
          </p>
          <p className={`text-xs mt-0.5 ${dark ? 'text-neutral-300' : 'text-neutral-700'}`}>
            {accion}
            {s.pedido_numero ? ` · pedido #${s.pedido_numero}` : ''}
            {s.monto > 0 ? ` · ${fmt(s.monto)}` : ''}
          </p>
          {s.detalle && <p className={`text-xs mt-0.5 ${dark ? 'text-neutral-400' : 'text-neutral-500'}`}>{s.detalle}</p>}
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${e.clase}`}>{e.texto}</span>
            <span className={`text-[11px] ${dark ? 'text-neutral-400' : 'text-neutral-500'}`}>
              {cuando(s.creada)}
              {s.resuelta_por && s.estado !== 'cancelada' ? ` · ${s.resuelta_por}` : ''}
            </span>
          </div>
          {s.estado === 'pendiente' && puedeResolver && (
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                disabled={ocupada}
                onClick={() => onResolver(true)}
                className="flex-1 py-1.5 rounded-lg bg-neutral-900 text-white text-xs font-semibold disabled:opacity-50"
              >
                Aprobar
              </button>
              <button
                type="button"
                disabled={ocupada}
                onClick={() => onResolver(false)}
                className={`flex-1 py-1.5 rounded-lg border text-xs font-semibold text-peligro-700 disabled:opacity-50 ${
                  dark ? 'border-neutral-700' : 'border-neutral-200'
                }`}
              >
                Rechazar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
