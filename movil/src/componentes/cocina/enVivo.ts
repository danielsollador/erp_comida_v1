import { useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { abrirCanalEnVivo } from '../../lib/api'

/**
 * EL CANAL EN VIVO (/ws) mientras una pantalla lo necesita: la cocina para
 * enterarse de una comanda sin preguntar, y el cuadro de autorizar para saber
 * cuando el dueño aprobo.
 *
 * Igual que `connectWs` de la web (frontend/src/lib/api.ts): si se cae, la
 * espera para reconectar se dobla hasta 30 s en vez de insistir cada segundo
 * --con la wifi caida eso calienta la tablet sin recibir nada--, y con la app
 * en segundo plano el socket se cierra y se vuelve a abrir al regresar (el
 * telefono lo mataria igual, y sin avisar).
 *
 * `conectado` dice si el canal esta vivo: con el caido, quien lo usa pregunta
 * cada pocos segundos por su cuenta.
 */
export type EventoEnVivo = { event: string; data: unknown }

export function useEnVivo(alEvento: (e: EventoEnVivo) => void, activo: boolean): { conectado: boolean } {
  const [conectado, setConectado] = useState(false)
  // La ultima version del oyente, sin reabrir el socket en cada render.
  const oyente = useRef(alEvento)
  useEffect(() => {
    oyente.current = alEvento
  })

  useEffect(() => {
    if (!activo) return
    let canal: WebSocket | null = null
    let reintento: ReturnType<typeof setTimeout> | null = null
    let espera = 1500
    let vivo = true

    const programar = () => {
      if (!vivo || reintento || AppState.currentState !== 'active') return
      reintento = setTimeout(() => {
        reintento = null
        abrir()
      }, espera)
      espera = Math.min(espera * 2, 30000)
    }

    const abrir = () => {
      if (!vivo || canal) return
      let ws: WebSocket
      try {
        ws = abrirCanalEnVivo()
      } catch {
        programar()
        return
      }
      canal = ws
      ws.onopen = () => {
        espera = 1500
        setConectado(true)
      }
      ws.onmessage = (msg) => {
        let evt: EventoEnVivo
        try {
          evt = JSON.parse(String(msg.data))
        } catch {
          return
        }
        try {
          oyente.current(evt)
        } catch {
          // un oyente que falla no apaga el canal
        }
      }
      ws.onclose = () => {
        // Un socket que se cerro a proposito ya no es el canal: no se reconecta.
        if (canal !== ws) return
        canal = null
        setConectado(false)
        programar()
      }
      // En Android un error no siempre trae su `close`: se cierra a mano.
      ws.onerror = () => ws.close()
    }

    const cerrar = () => {
      if (reintento) {
        clearTimeout(reintento)
        reintento = null
      }
      const ws = canal
      canal = null
      ws?.close()
      setConectado(false)
    }

    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') {
        espera = 1500
        abrir()
      } else if (estado === 'background') {
        cerrar()
      }
    })
    abrir()

    return () => {
      vivo = false
      sub.remove()
      cerrar()
    }
  }, [activo])

  return { conectado }
}
