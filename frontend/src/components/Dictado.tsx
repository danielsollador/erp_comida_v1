import { useEffect, useRef, useState } from 'react'
import Icono from './Icono'

/**
 * El micrófono para dictar (23-oct): se toca, se habla, y lo dicho va
 * apareciendo en el cuadro de texto. Usa el reconocimiento de voz del
 * navegador (Chrome, Edge, Safari): no manda audio al servidor.
 *
 * El navegador solo presta el micrófono en una página segura (https o
 * localhost). Entrando por la dirección de la red local (http://10.…) no
 * aparece, y queda el micrófono del teclado del teléfono, que hace lo mismo.
 */

type Reconocedor = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}

function crearReconocedor(): Reconocedor | null {
  if (typeof window === 'undefined' || !window.isSecureContext) return null
  const w = window as unknown as { SpeechRecognition?: new () => Reconocedor; webkitSpeechRecognition?: new () => Reconocedor }
  const Clase = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return Clase ? new Clase() : null
}

export function dictadoDisponible(): boolean {
  if (typeof window === 'undefined' || !window.isSecureContext) return false
  const w = window as unknown as Record<string, unknown>
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition)
}

export default function Dictado({ onTexto, compacto = false }: { onTexto: (trozo: string) => void; compacto?: boolean }) {
  const [escuchando, setEscuchando] = useState(false)
  const [aviso, setAviso] = useState('')
  const rec = useRef<Reconocedor | null>(null)

  useEffect(() => () => rec.current?.stop(), [])

  if (!dictadoDisponible()) return null

  const alternar = () => {
    if (escuchando) {
      rec.current?.stop()
      return
    }
    const r = crearReconocedor()
    if (!r) return
    r.lang = 'es-VE'
    r.continuous = true
    r.interimResults = false
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        if (res.isFinal) onTexto(res[0].transcript.trim())
      }
    }
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setAviso('Dale permiso al micrófono en el navegador.')
      else if (e.error !== 'no-speech' && e.error !== 'aborted') setAviso('No pude escuchar. Prueba otra vez.')
    }
    r.onend = () => setEscuchando(false)
    rec.current = r
    setAviso('')
    setEscuchando(true)
    r.start()
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={alternar}
        aria-pressed={escuchando}
        aria-label={compacto ? (escuchando ? 'Parar de dictar' : 'Dictar') : undefined}
        title={compacto ? (escuchando ? 'Escuchando… toca para parar' : 'Dictar') : undefined}
        className={`inline-flex items-center justify-center gap-1.5 rounded-lg border text-sm font-medium ${compacto ? 'w-11 h-11 rounded-xl' : 'px-3 py-2'} ${
          escuchando ? 'border-peligro-400 bg-peligro-50 text-peligro-700' : 'vp-control'
        }`}
      >
        <Icono nombre="microfono" size={16} className={escuchando ? 'animate-pulse' : ''} />
        {!compacto && (escuchando ? 'Escuchando… toca para parar' : 'Dictar')}
      </button>
      {aviso && <span className="text-xs text-peligro-600">{aviso}</span>}
    </span>
  )
}
