import { useCallback, useEffect, useRef, useState } from 'react'
import { useAcceso } from '../lib/acceso'
import { api, connectWs } from '../lib/api'
import { useMoneda } from '../lib/moneda'
import type { SolicitudAutorizacion } from '../lib/types'
import Icono from './Icono'

/**
 * Los avisos que le llegan a quien autoriza: "María pide permiso para editar
 * la venta #12 (−$5)". Aprobar o rechazar aquí mismo, sin PIN --ya entró con
 * su clave-- y sin ir a ninguna pantalla.
 *
 * Se monta una sola vez, en el marco, y solo para roles que autorizan: al
 * resto ni se les dibuja. Llega por WebSocket; al abrir la aplicación se
 * piden las pendientes, para que lo que se pidió mientras el dueño no tenía
 * la app abierta lo esté esperando. Si el navegador lo permite, además suena
 * el aviso del sistema (la pestaña puede estar detrás de otra).
 */
export default function Solicitudes() {
  const { estado } = useAcceso()
  const { fmt } = useMoneda()
  const [pendientes, setPendientes] = useState<SolicitudAutorizacion[]>([])
  const [ocupada, setOcupada] = useState<number | null>(null)
  const [permiso, setPermiso] = useState<NotificationPermission | 'no'>(() =>
    typeof Notification === 'undefined' ? 'no' : Notification.permission,
  )
  const vistas = useRef<Set<number>>(new Set())

  const cargar = useCallback(() => {
    api.solicitudesPendientes().then(setPendientes).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!estado.puede.autoriza) return
    cargar()
    const desconectar = connectWs((evt) => {
      if (evt.event === 'autorizacion_pendiente') {
        const s = evt.data as SolicitudAutorizacion
        setPendientes((prev) => (prev.some((x) => x.id === s.id) ? prev : [...prev, s]))
        avisar(s)
      } else if (evt.event === 'autorizacion_resuelta') {
        const s = evt.data as SolicitudAutorizacion
        setPendientes((prev) => prev.filter((x) => x.id !== s.id))
      }
    })
    // Cada minuto se vuelven a pedir: las vencidas se caen solas.
    const timer = window.setInterval(cargar, 60000)
    return () => {
      desconectar()
      window.clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado.puede.autoriza])

  function avisar(s: SolicitudAutorizacion) {
    if (vistas.current.has(s.id)) return
    vistas.current.add(s.id)
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    try {
      const n = new Notification(`${s.solicitante_nombre || s.solicitante} pide autorización`, {
        body: `${texto(s)}${s.monto ? ` · ${fmt(s.monto)}` : ''}`,
        tag: `autorizacion-${s.id}`,
      })
      n.onclick = () => {
        window.focus()
        n.close()
      }
    } catch {
      // algunos navegadores moviles no dejan crear la notificacion desde la pagina
    }
  }

  async function pedirPermisoNavegador() {
    if (typeof Notification === 'undefined') return
    const p = await Notification.requestPermission()
    setPermiso(p)
  }

  async function resolver(s: SolicitudAutorizacion, aprobar: boolean) {
    setOcupada(s.id)
    try {
      if (aprobar) await api.aprobarSolicitud(s.id)
      else await api.rechazarSolicitud(s.id)
      setPendientes((prev) => prev.filter((x) => x.id !== s.id))
    } catch {
      cargar()
    } finally {
      setOcupada(null)
    }
  }

  if (!estado.puede.autoriza || pendientes.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 left-4 sm:left-auto sm:w-[22rem] z-40 space-y-2">
      {pendientes.map((s) => (
        <div
          key={s.id}
          role="alertdialog"
          aria-label="Solicitud de autorización"
          className="bg-white border border-neutral-200 shadow-lg rounded-2xl p-4"
          style={{ animation: 'vp-entrar .22s cubic-bezier(.2,.7,.2,1) backwards' }}
        >
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-full bg-aviso-50 text-aviso-700 grid place-items-center shrink-0">
              <Icono nombre="campana" size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">
                {s.solicitante_nombre || s.solicitante} pide autorización
              </p>
              <p className="text-sm text-neutral-700 mt-1">{texto(s)}</p>
              {s.detalle && <p className="text-xs text-neutral-500 mt-0.5">{s.detalle}</p>}
              {s.monto > 0 && <p className="text-sm font-semibold tabular-nums mt-1">{fmt(s.monto)}</p>}
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              disabled={ocupada === s.id}
              onClick={() => void resolver(s, true)}
              className="flex-1 py-2 rounded-lg bg-neutral-900 text-white text-sm font-semibold disabled:opacity-50"
            >
              Aprobar
            </button>
            <button
              type="button"
              disabled={ocupada === s.id}
              onClick={() => void resolver(s, false)}
              className="flex-1 py-2 rounded-lg border border-neutral-200 text-peligro-700 text-sm font-semibold disabled:opacity-50"
            >
              Rechazar
            </button>
          </div>
          {permiso === 'default' && (
            <button
              type="button"
              onClick={() => void pedirPermisoNavegador()}
              className="mt-2 text-xs text-neutral-500 underline"
            >
              Avisarme también cuando la aplicación esté detrás de otra ventana
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function texto(s: SolicitudAutorizacion): string {
  const base = s.accion === 'editar_venta' ? 'Editar una venta ya cobrada' : s.accion
  return s.pedido_numero ? `${base} (pedido #${s.pedido_numero})` : base
}
