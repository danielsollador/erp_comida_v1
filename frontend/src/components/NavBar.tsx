import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAcceso } from '../lib/acceso'
import { MonedaToggle } from '../lib/moneda'
import { TemaToggle } from '../lib/tema'
import Icono from './Icono'
import Marca from './Marca'
import UsuarioMenu from './UsuarioMenu'

/**
 * El encabezado de cada modulo. En escritorio la barra lateral ya dice donde
 * estas, asi que aqui va la miga (local / modulo); en movil, donde no hay
 * barra, el boton de volver.
 */
export default function NavBar({
  titulo,
  dark = false,
  moneda = true,
  acciones,
}: {
  titulo: string
  dark?: boolean
  /** El selector de moneda solo tiene sentido donde se ven precios. */
  moneda?: boolean
  acciones?: ReactNode
}) {
  const { estado } = useAcceso()
  return (
    <header
      className={`sticky top-0 z-20 border-b ${
        dark ? 'bg-neutral-900/90 backdrop-blur-md text-white border-neutral-800' : 'vp-glass border-neutral-200'
      }`}
    >
      <div className="flex items-center gap-3 px-4 h-14">
        {/* Volver al inicio, SIEMPRE visible. Estaba solo en movil porque en
            escritorio la barra lateral ya lleva al inicio, pero el rombo de la
            barra no se lee como "volver": quien entra a un modulo busca la
            flecha arriba a la izquierda, que es donde esta en todo lo demas. */}
        <Link
          to="/"
          aria-label="Volver al inicio"
          title="Volver al inicio"
          className={`grid place-items-center w-9 h-9 rounded-xl border shrink-0 ${
            dark ? 'border-neutral-700 hover:bg-neutral-800' : 'border-neutral-200 bg-white hover:bg-neutral-100'
          }`}
        >
          <Icono nombre="atras" size={18} />
        </Link>

        {/* La miga tambien lleva al inicio: es la otra mitad del mismo gesto.
            Va con el logo del local, no con su nombre escrito. */}
        <div className="flex items-center gap-2.5 min-w-0">
          <Link to="/" className="hidden md:inline-flex items-center shrink-0 hover:opacity-80" title={estado.local.nombre}>
            <Marca className="h-[22px]" sobreOscuro={dark} />
          </Link>
          <span className={`hidden md:inline ${dark ? 'text-neutral-700' : 'text-neutral-300'}`}>/</span>
          <h1 className="font-display font-semibold text-[17px] leading-none truncate">{titulo}</h1>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {acciones}
          {moneda && <MonedaToggle dark={dark} />}
          <TemaToggle dark={dark} />
          <UsuarioMenu dark={dark} />
        </div>
      </div>
    </header>
  )
}
