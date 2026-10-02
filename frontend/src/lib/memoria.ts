/**
 * LO ULTIMO QUE SE MOSTRO, para volver a una pantalla sin que se arme de cero.
 *
 * Al volver del punto de venta a la portada, o al recargar, todo nacia vacio y
 * se iba llenando a medida que llegaba cada consulta: los avisos, las
 * misiones, las frases del recorrido. Cada llegada cambiaba el alto, y la
 * portada --que se escala para caber sin desplazar-- se encogia y se volvia a
 * agrandar (Leider, 1-oct: "no se ve nada fluido").
 *
 * Con esto cada estado arranca con lo ultimo que tuvo y se refresca por
 * detras: la pantalla vuelve tal cual estaba y solo cambia lo que cambio de
 * verdad. Vive en memoria y en `sessionStorage` (esta pestaña, mientras este
 * abierta), asi que tambien sobrevive a recargar. Al cerrar la pestaña se
 * borra: no es un cache de datos, es la continuidad de la pantalla.
 */
import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'

const CLAVE_SESION = 'vp-memoria'
const memoria = new Map<string, unknown>()

try {
  const guardado = sessionStorage.getItem(CLAVE_SESION)
  if (guardado) for (const [k, v] of Object.entries(JSON.parse(guardado) as Record<string, unknown>)) memoria.set(k, v)
} catch {
  /* sin almacenamiento o dañado: se empieza de cero */
}

let pendiente = 0
function guardarEnSesion() {
  // Un solo guardado por vuelta, aunque cambien cinco estados seguidos.
  if (pendiente) return
  pendiente = window.setTimeout(() => {
    pendiente = 0
    try {
      sessionStorage.setItem(CLAVE_SESION, JSON.stringify(Object.fromEntries(memoria)))
    } catch {
      /* lleno o sin permiso: queda solo en memoria */
    }
  }, 0)
}

function fijar(clave: string, valor: unknown) {
  memoria.set(clave, valor)
  guardarEnSesion()
}

/** Como `useState`, pero recuerda el ultimo valor bajo `clave` entre visitas. */
export function useRecordado<T>(clave: string, inicial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [valor, setValor] = useState<T>(() => {
    if (memoria.has(clave)) return memoria.get(clave) as T
    return typeof inicial === 'function' ? (inicial as () => T)() : inicial
  })
  const poner = useCallback<Dispatch<SetStateAction<T>>>(
    (nuevo) => {
      setValor((viejo) => {
        const siguiente = typeof nuevo === 'function' ? (nuevo as (v: T) => T)(viejo) : nuevo
        fijar(clave, siguiente)
        return siguiente
      })
    },
    [clave],
  )
  return [valor, poner]
}

/** Para leer o fijar un recuerdo fuera de un componente. */
export const recordado = {
  tiene: (clave: string): boolean => memoria.has(clave),
  get: <T,>(clave: string): T | undefined => memoria.get(clave) as T | undefined,
  set: (clave: string, valor: unknown) => fijar(clave, valor),
}
