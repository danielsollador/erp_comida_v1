import { useCallback, useEffect, useState } from 'react'
import Icono from '../components/Icono'

/**
 * Pantalla completa, para el mostrador y la cocina.
 *
 * En una tablet montada en la pared o el mostrador, la barra de direcciones
 * del navegador se come una franja de la pantalla para siempre -- no hay
 * scroll que la esconda porque el usuario nunca desliza hacia abajo en un
 * POS. La Fullscreen API la quita del todo mientras dure el turno.
 *
 * Solo en POS y Cocina: son las dos pantallas que de verdad se dejan
 * montadas en un dispositivo fijo. El resto se abre y se cierra en un
 * escritorio, donde la barra del navegador no estorba.
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

/**
 * El boton, chico y en una esquina: no compite con lo que de verdad importa.
 * En el telefono no sale: el iPhone no tiene pantalla completa para paginas
 * web, y en la barra angosta le quitaba el sitio al nombre del modulo.
 */
export function PantallaCompletaToggle({ dark = false }: { dark?: boolean }) {
  const { completa, alternar } = usePantallaCompleta()
  return (
    <button
      type="button"
      onClick={alternar}
      aria-label={completa ? 'Salir de pantalla completa' : 'Pantalla completa'}
      title={completa ? 'Salir de pantalla completa' : 'Pantalla completa'}
      className={`w-9 h-9 rounded-full border max-sm:hidden grid place-items-center shrink-0 ${
        dark
          ? 'border-neutral-700 text-neutral-400 hover:text-white hover:border-neutral-500'
          : 'border-neutral-200 text-neutral-500 hover:text-neutral-900 hover:border-neutral-400 bg-white'
      }`}
    >
      <Icono nombre={completa ? 'contraer' : 'expandir'} size={16} />
    </button>
  )
}
