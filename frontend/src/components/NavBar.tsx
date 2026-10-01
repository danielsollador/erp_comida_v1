import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import LinkVigilado from './LinkVigilado'
import { puedoSalir } from '../lib/sinGuardar'
import { useAcceso } from '../lib/acceso'
import { MonedaToggle } from '../lib/moneda'
import { PantallaCompletaToggle } from '../lib/pantallaCompleta'
import { TemaToggle } from '../lib/tema'
import Icono from './Icono'
import Marca from './Marca'
import { Secciones, type Seccion } from './Secciones'
import UsuarioMenu from './UsuarioMenu'
import Notificaciones from './Notificaciones'

/**
 * El encabezado de cada modulo. En escritorio la barra lateral ya dice donde
 * estas, asi que aqui va la miga (local / modulo); en movil, donde no hay
 * barra, el boton de volver.
 *
 * Debajo, centradas, las secciones del modulo: lo que se puede hacer aqui, a
 * la vista y siempre en el mismo sitio (ver `Secciones.tsx`).
 */
export default function NavBar({
  titulo,
  dark = false,
  moneda = true,
  acciones,
  secciones,
  seccion,
  alCambiarSeccion,
}: {
  titulo: string
  dark?: boolean
  /** El selector de moneda solo tiene sentido donde se ven precios. */
  moneda?: boolean
  acciones?: ReactNode
  /** Lo que se puede hacer en este modulo. Con una sola, no se muestra nada. */
  secciones?: Seccion[]
  seccion?: string
  alCambiarSeccion?: (id: string) => void
}) {
  const { estado } = useAcceso()
  const navegar = useNavigate()
  // LA FLECHA VUELVE ATRAS, NO AL INICIO. Desde la receta de una empanada
  // mandaba a la portada, cuando lo que se queria era volver a la lista de
  // recetas (Leider, 1-oct). Vuelve un paso en el historial; si no hay
  // (se entro por un enlace directo), al inicio. A la casita se va por el
  // logo, y en el telefono --donde el logo no cabe-- por el icono de al lado.
  const volver = () =>
    void puedoSalir().then((ok) => {
      if (!ok) return
      const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
      if (idx > 0) navegar(-1)
      else navegar('/')
    })
  return (
    <header
      className={`sticky top-0 z-20 border-b ${
        dark ? 'bg-neutral-900/90 backdrop-blur-md text-white border-neutral-800' : 'vp-glass border-neutral-200'
      }`}
    >
      {/* En el telefono la barra va en DOS filas: arriba la flecha y el nombre
          del modulo entero, abajo los botones a la derecha. Con todo en una
          fila el nombre salia cortado ("Punt..."), y quitar botones no era
          opcion: Leider (20-sep) quiere el tema y la pantalla completa
          tambien en el telefono. Es el mismo DOM en los dos casos, asi que las
          notificaciones y su WebSocket se montan una sola vez. */}
      <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1.5 px-4 py-2 sm:py-0 sm:h-14">
        {/* Volver, SIEMPRE visible: quien entra a un modulo busca la flecha
            arriba a la izquierda, que es donde esta en todo lo demas. */}
        <button
          type="button"
          onClick={volver}
          aria-label="Volver"
          title="Volver"
          className={`grid place-items-center w-9 h-9 rounded-xl border shrink-0 ${
            dark ? 'border-neutral-700 hover:bg-neutral-800' : 'vp-control'
          }`}
        >
          <Icono nombre="atras" size={18} />
        </button>
        <LinkVigilado
          to="/"
          aria-label="Ir al inicio"
          title="Ir al inicio"
          className={`md:hidden grid place-items-center w-9 h-9 rounded-xl border shrink-0 ${
            dark ? 'border-neutral-700 hover:bg-neutral-800' : 'vp-control'
          }`}
        >
          <Icono nombre="inicio" size={18} />
        </LinkVigilado>

        {/* La miga tambien lleva al inicio: es la otra mitad del mismo gesto.
            Va con el logo del local, no con su nombre escrito. */}
        <div className="flex items-center gap-2.5 min-w-0 flex-1 sm:flex-none">
          <LinkVigilado to="/" className="hidden md:inline-flex items-center shrink-0 hover:opacity-80" title={estado.local.nombre}>
            <Marca className="h-[22px]" sobreOscuro={dark} />
          </LinkVigilado>
          <span className={`hidden md:inline ${dark ? 'text-neutral-700' : 'text-neutral-300'}`}>/</span>
          <h1 className="font-display font-semibold text-[17px] leading-none truncate">{titulo}</h1>
        </div>

        {/* Sin el filtro de fechas: un filtro cambia LO QUE se ve y vive con
            los demas filtros, en la fila de arriba del contenido
            (`BarraFiltros`). Aqui quedan solo los ajustes de COMO se ve. */}
        <div className="ml-auto flex items-center gap-2 max-sm:basis-full max-sm:justify-end">
          {acciones}
          {moneda && <MonedaToggle dark={dark} />}
          <Notificaciones dark={dark} />
          {/* Pantalla completa en TODOS los modulos, no solo en el mostrador
              y la cocina. Nacio ahi porque son las pantallas que se dejan
              montadas en una tablet, pero el dueno revisa caja, compras y
              reportes en esa misma tablet y la barra del navegador le comia
              una franja igual. Al vivir en la barra y no en cada pagina,
              cualquier modulo nuevo lo hereda sin acordarse de ponerlo. */}
          <PantallaCompletaToggle dark={dark} />
          <TemaToggle dark={dark} />
          <UsuarioMenu dark={dark} />
        </div>
      </div>

      {secciones && seccion && alCambiarSeccion && (
        <Secciones
          secciones={secciones}
          activa={seccion}
          alCambiar={(id) => void puedoSalir().then((ok) => ok && alCambiarSeccion(id))}
          dark={dark}
        />
      )}
    </header>
  )
}
