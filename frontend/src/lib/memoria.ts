/**
 * LO ULTIMO QUE SE MOSTRO, para volver a una pantalla sin que se arme de cero.
 *
 * Al volver del punto de venta a la portada, todo nacia vacio y se iba
 * llenando a medida que llegaba cada consulta: los avisos, las misiones, las
 * frases del recorrido. Cada llegada cambiaba el alto, y la portada --que se
 * escala para caber sin desplazar-- se encogia y se volvia a agrandar. Se veia
 * como un parpadeo (Leider, 1-oct: "no se ve nada fluido").
 *
 * Con esto cada estado arranca con lo ultimo que tuvo y se refresca por
 * detras: la pantalla vuelve tal cual estaba y solo cambia lo que cambio de
 * verdad. Vive en memoria y se pierde al recargar, que es lo que se quiere: no
 * es un cache de datos, es la continuidad de la pantalla.
 */
import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'

const memoria = new Map<string, unknown>()

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
        memoria.set(clave, siguiente)
        return siguiente
      })
    },
    [clave],
  )
  return [valor, poner]
}

/** Para leer o fijar un recuerdo fuera de un componente. */
export const recordado = {
  get: <T,>(clave: string): T | undefined => memoria.get(clave) as T | undefined,
  set: (clave: string, valor: unknown) => memoria.set(clave, valor),
}
