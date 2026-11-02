import { useSyncExternalStore } from 'react'
import type { RespuestaIA } from '../../lib/api-ia'

/**
 * LA CONVERSACION CON LA IA vive aqui, a nivel de modulo, y no en la
 * pantalla: abrir un documento que encontro ("la factura de carne") lleva a
 * otra pantalla, y lo natural es volver y seguir preguntando donde se iba.
 * Es lo que en la web hace sessionStorage (components/Asistente.tsx); en el
 * telefono basta con la memoria del proceso. Se vacia al salir de la cuenta
 * (`vaciarConversacion`), porque es de quien pregunto.
 */
export type Mensaje = {
  rol: 'yo' | 'asistente'
  texto: string
  r?: RespuestaIA
  error?: boolean
  /** La pregunta que fallo, para mandarla igual con "Reintentar". */
  reintentar?: string
}

type Estado = { mensajes: Mensaje[]; pensando: string | null }

let estado: Estado = { mensajes: [], pensando: null }
const oyentes = new Set<() => void>()

function suscribir(f: () => void) {
  oyentes.add(f)
  return () => {
    oyentes.delete(f)
  }
}

function poner(cambio: Partial<Estado>) {
  // Las ultimas 30 vueltas, como la web: mas no se leen y pesan en cada llamada.
  estado = { ...estado, ...cambio, mensajes: (cambio.mensajes ?? estado.mensajes).slice(-30) }
  oyentes.forEach((f) => f())
}

export const ponerMensajes = (mensajes: Mensaje[]) => poner({ mensajes })
export const agregarMensaje = (m: Mensaje) => poner({ mensajes: [...estado.mensajes, m] })
export const ponerPensando = (pensando: string | null) => poner({ pensando })
export const vaciarConversacion = () => poner({ mensajes: [], pensando: null })

export function useConversacion(): Estado {
  return useSyncExternalStore(
    suscribir,
    () => estado,
    () => estado,
  )
}

/** Las preguntas sugeridas, las mismas de la web. */
export const GRUPOS = [
  {
    id: 'numeros',
    titulo: 'Tus números',
    preguntas: ['¿Cuánto vendí hoy y cómo voy contra ayer?', '¿Qué se me está acabando?', '¿Qué producto me deja más ganancia?'],
  },
  { id: 'aprender', titulo: 'Cómo se hace', preguntas: ['Enséñame a cargar una factura', '¿Cómo cambio el precio de un producto?'] },
  { id: 'buscar', titulo: 'Encuentra un documento', preguntas: ['Búscame la última factura de carne'] },
] as const
