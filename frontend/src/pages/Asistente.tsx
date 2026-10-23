import { useEffect, useRef, useState } from 'react'
import NavBar from '../components/NavBar'
import Icono from '../components/Icono'
import Dictado from '../components/Dictado'
import { Pensando, Respuesta, TablaDelSistema } from '../components/ChatAyuda'
import { api, enVivo } from '../lib/api'
import { useAcceso } from '../lib/acceso'
import type { RespuestaNegocio } from '../lib/types'

/**
 * El asistente que hace cosas (23-oct): "regalé dos harinas, descuéntalas",
 * "móntale un pedido a Juanito", "¿cuántos pastelitos vendí ayer?".
 *
 * Lo que consulta lo hace solo. Lo que CAMBIA algo llega como una tarjeta
 * «¿Hago esto?»: solo al tocar «Confirmar» se ejecuta, por la misma API de
 * las pantallas y con los permisos de quien está aquí
 * (ver backend/app/agente.py).
 */

type Propuesta = { id: string; titulo: string; detalle: string[]; peligro: boolean }
type Turno = {
  rol: 'usuario' | 'asistente'
  texto: string
  tabla?: RespuestaNegocio
  paso?: string
  escribiendo?: boolean
  propuesta?: Propuesta
  // Que paso con la propuesta: pendiente, hecha, cancelada o fallo.
  resuelta?: 'hecha' | 'cancelada' | 'fallo'
  // Lo que la IA necesita de lo que se hizo (el pedido_id): no se muestra.
  nota?: string
}

const CLAVE = 'erp-asistente'
const EJEMPLOS = [
  'Regalé dos harinas, descuéntalas',
  'Móntale un pedido a Juanito por dos empanadas de queso',
  '¿Cuántos pastelitos vendí ayer?',
  '¿Qué me falta por llenar?',
  '¿Cómo va la contabilidad?',
]

function leer(): Turno[] {
  try {
    return JSON.parse(sessionStorage.getItem(CLAVE) || '[]') as Turno[]
  } catch {
    return []
  }
}

function guardar(t: Turno[]) {
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify(t.slice(-40)))
  } catch {
    // sin almacenamiento: dura lo que dure la pantalla
  }
}

/** Lo que se le cuenta al servidor de la conversación: solo lo dicho y lo hecho. */
function historialDe(turnos: Turno[]) {
  return turnos
    .filter((t) => t.texto || t.propuesta)
    .map((t) => ({
      rol: t.rol,
      texto: t.propuesta
        ? `${t.texto ? t.texto + ' ' : ''}[Propuse: ${t.propuesta.titulo}. ${
            t.resuelta === 'hecha' ? 'La persona confirmó y se hizo.' : t.resuelta === 'cancelada' ? 'La persona canceló.' : 'Sin confirmar.'
          }]`
        : t.texto + (t.nota ? ` [${t.nota}]` : ''),
    }))
}

export default function Asistente() {
  const { estado } = useAcceso()
  const nombre = estado.nombre_visible && estado.nombre_visible !== estado.usuario ? estado.nombre_visible.split(' ')[0] : ''
  const [turnos, setTurnos] = useState<Turno[]>(leer)
  const [texto, setTexto] = useState('')
  const [pensando, setPensando] = useState(false)
  const [ejecutando, setEjecutando] = useState('')
  const fin = useRef<HTMLDivElement>(null)
  const campo = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fin.current?.scrollIntoView({ block: 'end' })
  }, [turnos])

  const fijar = (t: Turno[]) => {
    setTurnos(t)
    guardar(t.filter((x) => !x.escribiendo))
  }

  const enviar = async (mensaje: string) => {
    mensaje = mensaje.trim()
    if (!mensaje || pensando) return
    const antes = turnos
    const base: Turno[] = [...antes, { rol: 'usuario', texto: mensaje }]
    setTexto('')
    setPensando(true)
    let r: Turno = { rol: 'asistente', texto: '', paso: 'Pensando…', escribiendo: true }
    const pintar = (c: Partial<Turno>) => {
      r = { ...r, ...c }
      setTurnos([...base, r])
    }
    pintar({})
    try {
      await enVivo('/ayuda/agente/en-vivo', { mensaje, historial: historialDe(antes) }, (e) => {
        if (typeof e.paso === 'string') pintar({ paso: e.paso })
        else if (e.tabla) pintar({ tabla: e.tabla as RespuestaNegocio })
        else if (typeof e.texto === 'string') pintar({ texto: r.texto + e.texto, paso: undefined })
        else if (e.propuesta) pintar({ propuesta: e.propuesta as Propuesta, paso: undefined })
      })
    } catch {
      if (!r.texto) pintar({ texto: 'No pude responder ahora: revisa la conexión y prueba otra vez.' })
    }
    fijar([...base, { ...r, escribiendo: false, paso: undefined }])
    setPensando(false)
    campo.current?.focus()
  }

  const resolver = async (i: number, confirmar: boolean) => {
    const t = turnos[i]
    if (!t.propuesta || t.resuelta) return
    setEjecutando(t.propuesta.id)
    let nuevo = [...turnos]
    if (!confirmar) {
      void api.cancelarAccion(t.propuesta.id).catch(() => undefined)
      nuevo[i] = { ...t, resuelta: 'cancelada' }
      nuevo = [...nuevo, { rol: 'asistente', texto: 'Listo, no hice nada.' }]
    } else {
      try {
        const r = await api.confirmarAccion(t.propuesta.id)
        nuevo[i] = { ...t, resuelta: r.ok ? 'hecha' : 'fallo' }
        nuevo = [...nuevo, { rol: 'asistente', texto: r.texto, nota: r.nota }]
      } catch {
        nuevo[i] = { ...t, resuelta: 'fallo' }
        nuevo = [...nuevo, { rol: 'asistente', texto: 'No pude hacerlo: revisa la conexión.' }]
      }
    }
    fijar(nuevo)
    setEjecutando('')
  }

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      <NavBar
        titulo="Asistente"
        moneda={false}
        acciones={
          turnos.length > 0 && (
            <button type="button" onClick={() => fijar([])} className="text-xs font-medium text-neutral-500 hover:text-neutral-900 px-2">
              Nueva conversación
            </button>
          )
        }
      />
      <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-6 flex flex-col gap-4">
        {turnos.length === 0 && (
          <div className="flex flex-col gap-4 pt-4">
            <div>
              <p className="font-display text-[28px] font-semibold leading-tight">Hola{nombre ? `, ${nombre}` : ''}.</p>
              <p className="text-neutral-500 text-[19px] mt-1">¿Qué hacemos?</p>
            </div>
            <p className="text-sm text-neutral-600 text-pretty">
              Pídeme lo que harías en el sistema: vender, descontar del inventario, cobrar, anotar un gasto, o preguntarme cómo va el
              negocio. Antes de cambiar algo te muestro qué voy a hacer y tú confirmas.
            </p>
            <div className="flex flex-col gap-2">
              {EJEMPLOS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => void enviar(e)}
                  className="text-left text-sm rounded-xl border border-neutral-200 bg-white px-3.5 py-3 hover:border-acento-300 hover:bg-acento-50"
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}

        {turnos.map((t, i) =>
          t.rol === 'usuario' ? (
            <p key={i} className="self-end max-w-[85%] rounded-2xl rounded-br-md bg-neutral-900 text-white px-4 py-2.5 text-[15px] whitespace-pre-wrap">
              {t.texto}
            </p>
          ) : (
            <div key={i} className="max-w-[94%] flex flex-col gap-2" aria-live={t.escribiendo ? 'polite' : undefined}>
              {t.texto && (
                <div className="rounded-2xl rounded-bl-md bg-white border border-neutral-200 px-4 py-3 text-[15px] leading-relaxed">
                  <Respuesta texto={t.escribiendo ? `${t.texto} ▍` : t.texto} />
                </div>
              )}
              {!t.texto && !t.propuesta && t.escribiendo && <Pensando paso={t.paso ?? 'Pensando…'} />}
              {t.texto && t.escribiendo && t.paso && <Pensando paso={t.paso} />}
              {t.tabla && <TablaDelSistema r={t.tabla} />}
              {t.propuesta && (
                <TarjetaPropuesta
                  p={t.propuesta}
                  resuelta={t.resuelta}
                  ocupada={ejecutando === t.propuesta.id}
                  onConfirmar={() => void resolver(i, true)}
                  onCancelar={() => void resolver(i, false)}
                />
              )}
            </div>
          ),
        )}
        <div ref={fin} />
      </main>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void enviar(texto)
        }}
        className="sticky bottom-0 border-t border-neutral-200 bg-white/95 backdrop-blur px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <div className="max-w-2xl mx-auto flex items-end gap-2">
          <textarea
            ref={campo}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void enviar(texto)
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder="Pídeme algo…"
            className="flex-1 resize-none rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-base max-h-36 focus:outline-none focus:border-acento-400"
          />
          <Dictado compacto onTexto={(t) => setTexto((v) => (v.trim() ? `${v.trimEnd()} ${t}` : t))} />
          <button
            type="submit"
            disabled={!texto.trim() || pensando}
            aria-label="Enviar"
            className="grid place-items-center w-11 h-11 rounded-xl bg-neutral-900 text-white disabled:opacity-40 shrink-0"
          >
            <Icono nombre="enviar" size={17} />
          </button>
        </div>
      </form>
    </div>
  )
}

function TarjetaPropuesta({
  p,
  resuelta,
  ocupada,
  onConfirmar,
  onCancelar,
}: {
  p: Propuesta
  resuelta?: Turno['resuelta']
  ocupada: boolean
  onConfirmar: () => void
  onCancelar: () => void
}) {
  const borde = p.peligro ? 'border-peligro-300' : 'border-acento-300'
  return (
    <div className={`rounded-2xl border-2 ${borde} bg-white p-4 flex flex-col gap-3`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
        {resuelta === 'hecha' ? 'Hecho' : resuelta === 'cancelada' ? 'Cancelado' : resuelta === 'fallo' ? 'No se pudo' : '¿Hago esto?'}
      </p>
      <p className="font-display font-semibold text-[17px] leading-snug">{p.titulo}</p>
      {p.detalle.length > 0 && (
        <ul className="text-sm text-neutral-600 flex flex-col gap-1">
          {p.detalle.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
      {!resuelta && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onConfirmar}
            disabled={ocupada}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${
              p.peligro ? 'bg-peligro-600' : 'bg-neutral-900'
            }`}
          >
            {ocupada ? 'Haciéndolo…' : 'Confirmar'}
          </button>
          <button type="button" onClick={onCancelar} disabled={ocupada} className="rounded-xl border border-neutral-200 px-4 py-2.5 text-sm">
            Cancelar
          </button>
        </div>
      )}
    </div>
  )
}
