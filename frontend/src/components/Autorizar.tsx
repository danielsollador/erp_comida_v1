import { useEffect, useRef, useState } from 'react'
import { api, connectWs } from '../lib/api'
import type { Autorizacion, SolicitudAutorizacion } from '../lib/types'
import { Boton } from './ui'

/**
 * La firma de alguien autorizado, de dos formas:
 *
 *   PIN            quien autoriza esta al lado: teclea sus cuatro a seis
 *                  numeros y listo. El PIN lo identifica solo, no hay que
 *                  decir quien es.
 *   PEDIR PERMISO  quien autoriza no esta en el local: se le manda una
 *                  solicitud, le llega a su aplicacion y aprueba desde alli.
 *                  Esta pantalla se queda esperando la respuesta.
 *
 * Antes se pedia usuario y contraseña: lento con un cliente esperando, e
 * imposible si el dueño no esta. El valor que sale (`onCambio`) es lo que se
 * manda junto con la operacion; el servidor vuelve a comprobarlo.
 */
export default function Autorizar({
  accion,
  detalle,
  monto,
  pedidoId,
  onCambio,
}: {
  accion: string
  detalle: string
  monto: number
  pedidoId?: number
  onCambio: (a: Autorizacion | null) => void
}) {
  const [modo, setModo] = useState<'pin' | 'remoto'>('pin')
  const [pin, setPin] = useState('')
  const [solicitud, setSolicitud] = useState<SolicitudAutorizacion | null>(null)
  const [conectados, setConectados] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [pidiendo, setPidiendo] = useState(false)
  const solicitudRef = useRef<SolicitudAutorizacion | null>(null)
  solicitudRef.current = solicitud

  // El PIN sale hacia afuera en cuanto tiene largo de PIN.
  useEffect(() => {
    if (modo !== 'pin') return
    onCambio(/^\d{4,6}$/.test(pin) ? { pin } : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, modo])

  // Quien esta del otro lado, para no dejar a la cajera esperando a nadie.
  useEffect(() => {
    if (modo !== 'remoto') return
    api.autorizantesConectados().then((d) => setConectados(d.autorizantes)).catch(() => setConectados(null))
  }, [modo])

  // La respuesta llega por WebSocket; y por si el WebSocket se durmio, se
  // pregunta cada cuatro segundos mientras haya una solicitud pendiente.
  useEffect(() => {
    if (!solicitud || solicitud.estado !== 'pendiente') return
    const refrescar = () => {
      const s = solicitudRef.current
      if (!s) return
      api.verSolicitud(s.id).then(recibir).catch(() => undefined)
    }
    const desconectar = connectWs((evt) => {
      if (evt.event === 'autorizacion_resuelta' && (evt.data as SolicitudAutorizacion).id === solicitud.id) {
        recibir(evt.data as SolicitudAutorizacion)
      }
    })
    const timer = window.setInterval(refrescar, 4000)
    return () => {
      desconectar()
      window.clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solicitud?.id, solicitud?.estado])

  // Si se cierra el cuadro con la solicitud en el aire, se cancela: que al
  // dueño no le quede un aviso de algo que ya nadie espera.
  useEffect(() => {
    return () => {
      const s = solicitudRef.current
      if (s && s.estado === 'pendiente') api.cancelarSolicitud(s.id).catch(() => undefined)
    }
  }, [])

  function recibir(s: SolicitudAutorizacion) {
    setSolicitud(s)
    onCambio(s.estado === 'aprobada' ? { solicitud_id: s.id } : null)
  }

  async function pedir() {
    setError('')
    setPidiendo(true)
    try {
      const s = await api.solicitarAutorizacion({ accion, detalle, monto, pedido_id: pedidoId })
      setSolicitud(s)
      onCambio(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo pedir')
    } finally {
      setPidiendo(false)
    }
  }

  async function cancelar() {
    if (solicitud) await api.cancelarSolicitud(solicitud.id).catch(() => undefined)
    setSolicitud(null)
    onCambio(null)
  }

  function cambiarModo(m: 'pin' | 'remoto') {
    setModo(m)
    setError('')
    onCambio(m === 'pin' && /^\d{4,6}$/.test(pin) ? { pin } : m === 'remoto' && solicitud?.estado === 'aprobada' ? { solicitud_id: solicitud.id } : null)
  }

  const pestana = (m: 'pin' | 'remoto', texto: string) => (
    <button
      type="button"
      onClick={() => cambiarModo(m)}
      className={`flex-1 py-2 text-sm font-semibold rounded-lg ${
        modo === m ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-600 border border-neutral-200'
      }`}
    >
      {texto}
    </button>
  )

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {pestana('pin', 'Con PIN')}
        {pestana('remoto', 'Pedir permiso')}
      </div>

      {modo === 'pin' && (
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">
            PIN de quien autoriza
          </span>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="••••"
            className="w-full border border-neutral-300 rounded-lg px-3 py-2.5 text-2xl tracking-[0.5em] text-center tabular-nums"
          />
          <span className="block text-xs text-neutral-500 mt-1">
            Solo quien tiene un rol que autoriza tiene PIN. Si no está en el local, usa «Pedir permiso».
          </span>
        </label>
      )}

      {modo === 'remoto' && !solicitud && (
        <div className="space-y-2">
          <p className="text-sm text-neutral-600">
            Se le avisa a quien puede autorizar y aprueba desde su aplicación, esté donde esté.
          </p>
          {conectados !== null && (
            <p className={`text-xs ${conectados > 0 ? 'text-exito-700' : 'text-aviso-700'}`}>
              {conectados > 0
                ? `${conectados} persona(s) que autorizan tienen la aplicación abierta ahora.`
                : 'Nadie que autorice tiene la aplicación abierta ahora: lo verá cuando la abra.'}
            </p>
          )}
          <Boton onClick={() => void pedir()} disabled={pidiendo}>
            {pidiendo ? 'Enviando…' : 'Enviar solicitud'}
          </Boton>
        </div>
      )}

      {modo === 'remoto' && solicitud && (
        <div
          className={`rounded-xl p-3 text-sm ${
            solicitud.estado === 'aprobada'
              ? 'bg-exito-50 text-exito-800'
              : solicitud.estado === 'pendiente'
                ? 'bg-neutral-100 text-neutral-700'
                : 'bg-peligro-50 text-peligro-700'
          }`}
        >
          {solicitud.estado === 'pendiente' && (
            <div className="flex items-center gap-3">
              <span className="w-4 h-4 rounded-full border-2 border-neutral-400 border-t-transparent animate-spin shrink-0" />
              <span className="flex-1">Solicitud #{solicitud.id} enviada. Esperando respuesta…</span>
              <button type="button" onClick={() => void cancelar()} className="text-xs font-semibold underline">
                Cancelar
              </button>
            </div>
          )}
          {solicitud.estado === 'aprobada' && (
            <span>
              Aprobado por <strong>{solicitud.resuelta_por}</strong>. Ya puedes guardar.
            </span>
          )}
          {solicitud.estado === 'rechazada' && (
            <span>
              <strong>{solicitud.resuelta_por}</strong> no lo autorizó.{' '}
              <button type="button" onClick={() => setSolicitud(null)} className="underline font-semibold">
                Pedir de nuevo
              </button>
            </span>
          )}
          {(solicitud.estado === 'vencida' || solicitud.estado === 'cancelada' || solicitud.estado === 'usada') && (
            <span>
              La solicitud ya no sirve ({solicitud.estado}).{' '}
              <button type="button" onClick={() => setSolicitud(null)} className="underline font-semibold">
                Pedir otra
              </button>
            </span>
          )}
        </div>
      )}

      {error && <p className="text-sm text-peligro-700">{error}</p>}
    </div>
  )
}
