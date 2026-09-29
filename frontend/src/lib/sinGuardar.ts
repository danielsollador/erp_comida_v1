import { useEffect } from 'react'

/**
 * "Hay cambios sin guardar": una pantalla lo declara mientras dura la
 * edicion, y TODO lo que saca de ella --la flecha de volver, la miga, las
 * pestañas de seccion, la barra lateral, recargar o cerrar la pestaña--
 * pregunta antes de irse (Leider, 29-sep: "al darle aqui no me pasa nada,
 * solo se sale y ya").
 *
 * Un solo guardia a la vez: la ultima pantalla que lo registra manda, y al
 * desmontarse lo suelta. Los enlaces piden permiso con `puedoSalir()`; el
 * navegador, con `beforeunload`.
 */
type Guardia = () => Promise<boolean>

let guardia: Guardia | null = null

function alDescargar(e: BeforeUnloadEvent) {
  e.preventDefault()
}

/** Declara que hay cambios sin guardar. `preguntar` resuelve true si se puede salir. */
export function vigilarSalida(preguntar: Guardia): () => void {
  guardia = preguntar
  window.addEventListener('beforeunload', alDescargar)
  return () => {
    if (guardia === preguntar) {
      guardia = null
      window.removeEventListener('beforeunload', alDescargar)
    }
  }
}

/** Lo llama todo lo que navega. true = adelante. */
export async function puedoSalir(): Promise<boolean> {
  return guardia ? guardia() : true
}

/**
 * En la pantalla que edita: `useGuardiaDeSalida(hayCambios, preguntar)`.
 * Mientras `hayCambios` sea true, salir pregunta.
 */
export function useGuardiaDeSalida(hayCambios: boolean, preguntar: Guardia) {
  useEffect(() => {
    if (!hayCambios) return
    return vigilarSalida(preguntar)
  }, [hayCambios, preguntar])
}
