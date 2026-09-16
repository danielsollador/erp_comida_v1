import { Link, useLocation } from 'react-router-dom'
import { useAcceso } from '../lib/acceso'
import Icono, { type NombreIcono } from './Icono'

/**
 * La barra lateral: un solo sitio para cambiar de modulo sin volver al inicio.
 *
 * Solo iconos, con la etiqueta al pasar el cursor: en la tablet del mostrador
 * el ancho es oro y quien la usa aprende los seis iconos el primer dia. Lo que
 * el rol no puede abrir, no aparece; la cerradura de verdad sigue en el
 * backend. En la cocina no se muestra: esa pantalla es una sola cosa a
 * pantalla completa. En movil tampoco: ahi manda el boton de volver del
 * encabezado y la pantalla de inicio.
 */
export type Permiso = 'operar' | 'administrar' | null

export const MODULOS: { to: string; icono: NombreIcono; titulo: string; necesita: Permiso; grupo: 'operacion' | 'administracion' }[] = [
  { to: '/pos', icono: 'pos', titulo: 'Punto de venta', necesita: 'operar', grupo: 'operacion' },
  { to: '/cocina', icono: 'cocina', titulo: 'Cocina', necesita: null, grupo: 'operacion' },
  { to: '/reportes', icono: 'reportes', titulo: 'Reportes', necesita: 'operar', grupo: 'operacion' },
  { to: '/menu', icono: 'menu', titulo: 'Menú', necesita: 'operar', grupo: 'administracion' },
  { to: '/recetas', icono: 'recetas', titulo: 'Recetas', necesita: 'operar', grupo: 'administracion' },
  { to: '/inventario', icono: 'inventario', titulo: 'Inventario', necesita: 'operar', grupo: 'administracion' },
  { to: '/compras', icono: 'compras', titulo: 'Compras', necesita: 'operar', grupo: 'administracion' },
  { to: '/caja', icono: 'caja', titulo: 'Cierre de caja', necesita: 'operar', grupo: 'administracion' },
  { to: '/tasa', icono: 'tasa', titulo: 'Tasa de cambio', necesita: 'operar', grupo: 'administracion' },
  { to: '/contabilidad', icono: 'contabilidad', titulo: 'Contabilidad', necesita: 'administrar', grupo: 'administracion' },
  { to: '/impuestos', icono: 'impuestos', titulo: 'Impuestos', necesita: 'administrar', grupo: 'administracion' },
  { to: '/usuarios', icono: 'usuarios', titulo: 'Usuarios', necesita: 'administrar', grupo: 'administracion' },
  { to: '/sistema', icono: 'sistema', titulo: 'Sistema', necesita: 'administrar', grupo: 'administracion' },
]

export default function Rail() {
  const { estado } = useAcceso()
  const { pathname } = useLocation()
  if (pathname.startsWith('/cocina')) return null

  const puede = (p: Permiso) => p === null || estado.puede[p]
  const visibles = MODULOS.filter((m) => puede(m.necesita))
  const operacion = visibles.filter((m) => m.grupo === 'operacion')
  const administracion = visibles.filter((m) => m.grupo === 'administracion')
  const inicial = (estado.usuario ?? '?').slice(0, 1).toUpperCase()

  const item = (m: (typeof MODULOS)[number]) => {
    const activo = pathname === m.to || pathname.startsWith(m.to + '/')
    return (
      <Link key={m.to} to={m.to} className="vp-rail-item" aria-current={activo ? 'page' : undefined} aria-label={m.titulo}>
        <Icono nombre={m.icono} size={20} />
        <span className="vp-tip">{m.titulo}</span>
      </Link>
    )
  }

  return (
    <aside className="vp-rail hidden md:flex fixed left-0 top-0 bottom-0 w-[68px] z-30 flex-col items-center py-3 gap-1">
      <Link to="/" className="vp-rail-item mb-2" aria-current={pathname === '/' ? 'page' : undefined} aria-label="Inicio">
        <span className="vp-rombo" />
        <span className="vp-tip">{estado.local.nombre}</span>
      </Link>

      {operacion.map(item)}
      {administracion.length > 0 && <div className="w-8 h-px bg-neutral-200 my-2" />}
      {administracion.map(item)}

      <div className="mt-auto flex flex-col items-center gap-1">
        <Link to="/mi-cuenta" className="vp-rail-item" aria-current={pathname === '/mi-cuenta' ? 'page' : undefined} aria-label="Mi cuenta">
          <span className="w-8 h-8 rounded-full bg-neutral-900 text-white grid place-items-center text-xs font-bold font-display">
            {inicial}
          </span>
          <span className="vp-tip">{estado.usuario}</span>
        </Link>
      </div>
    </aside>
  )
}
