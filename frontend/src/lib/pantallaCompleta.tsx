import { useCallback, useEffect, useState } from 'react'
import Icono from '../components/Icono'

/**
 * Pantalla completa, en todo el aplicativo.
 *
 * En una tablet montada en la pared o el mostrador, la barra de direcciones
 * del navegador se come una franja de la pantalla para siempre -- no hay
 * scroll que la esconda porque el usuario nunca desliza hacia abajo en un
 * POS. La Fullscreen API la quita del todo mientras dure el turno.
 *
 * Nacio solo para POS y Cocina, que son las pantallas que se dejan montadas
 * en un dispositivo fijo. Resulto que el dueno revisa caja, compras y
 * reportes en esa MISMA tablet, asi que el boton vive ahora en <NavBar> --
 * de donde lo hereda cualquier modulo, incluso uno que no existe todavia--,
 * en el encabezado propio del inicio, y en el login (public/login.html, que
 * no carga React y lleva su propia copia del mismo icono).
 */
function estaCompleta(): boolean {
  return document.fullscreenElement != null
}

export function usePantallaCompleta() {
  const [completa, setCompleta] = useState(estaCompleta)

  useEffect(() => {
    // El usuario puede salir con Esc o con el gesto del sistema operativo sin
    // pasar por el boton: sin este listener el icono se quedaria diciendo
    // "pantalla completa" cuando ya se salio de ella.
    const sync = () => setCompleta(estaCompleta())
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  const alternar = useCallback(async () => {
    try {
      if (estaCompleta()) {
        await document.exitFullscreen()
      } else {
        // El documento entero, no un contenedor: asi la barra del sistema
        // tambien se esconde en Android/iPadOS, que es el caso que importa.
        await document.documentElement.requestFullscreen()
      }
    } catch {
      // Algunos navegadores piden que el gesto venga directo de un click sin
      // ningun await de por medio, o simplemente no soportan la API (Safari
      // de escritorio con ciertas flags). Sin pantalla completa el POS sigue
      // funcionando igual; no hay nada que avisarle al cajero por esto.
    }
  }, [])

  return { completa, alternar }
}

/** El boton, chico y en una esquina: no compite con lo que de verdad importa. */
export function PantallaCompletaToggle({ dark = false }: { dark?: boolean }) {
  const { completa, alternar } = usePantallaCompleta()
  return (
    <button
      type="button"
      onClick={alternar}
      aria-label={completa ? 'Salir de pantalla completa' : 'Pantalla completa'}
      title={completa ? 'Salir de pantalla completa' : 'Pantalla completa'}
      className={`w-9 h-9 rounded-full border grid place-items-center shrink-0 ${
        dark
          ? 'border-neutral-700 text-neutral-400 hover:text-white hover:border-neutral-500'
          : 'border-neutral-200 text-neutral-500 hover:text-neutral-900 hover:border-neutral-400 bg-white'
      }`}
    >
      <Icono nombre={completa ? 'contraer' : 'expandir'} size={16} />
    </button>
  )
}
