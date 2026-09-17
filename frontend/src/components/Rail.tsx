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
/**
 * Los modulos del ERP. `modulo` es el mismo identificador que usa el backend
 * (`acceso/permisos.py`): la barra muestra exactamente aquello a lo que el rol
 * entra, sea uno de fabrica o uno a medida, sin deducirlo del nombre del rol.
 */
export const MODULOS: { to: string; modulo: string; icono: NombreIcono; titulo: string; grupo: 'operacion' | 'administracion' }[] = [
  { to: '/pos', modulo: 'pos', icono: 'pos', titulo: 'Punto de venta', grupo: 'operacion' },
  { to: '/cocina', modulo: 'cocina', icono: 'cocina', titulo: 'Cocina', grupo: 'operacion' },
  { to: '/reportes', modulo: 'reportes', icono: 'reportes', titulo: 'Reportes', grupo: 'operacion' },
  { to: '/ventas', modulo: 'ventas', icono: 'ventas', titulo: 'Ventas', grupo: 'administracion' },
  { to: '/menu', modulo: 'menu', icono: 'menu', titulo: 'Menú', grupo: 'administracion' },
  { to: '/recetas', modulo: 'recetas', icono: 'recetas', titulo: 'Recetas', grupo: 'administracion' },
  { to: '/inventario', modulo: 'inventario', icono: 'inventario', titulo: 'Inventario', grupo: 'administracion' },
  { to: '/compras', modulo: 'compras', icono: 'compras', titulo: 'Compras', grupo: 'administracion' },
  { to: '/caja', modulo: 'caja', icono: 'caja', titulo: 'Cierre de caja', grupo: 'administracion' },
  { to: '/tasa', modulo: 'tasa', icono: 'tasa', titulo: 'Tasa de cambio', grupo: 'administracion' },
  { to: '/contabilidad', modulo: 'contabilidad', icono: 'contabilidad', titulo: 'Contabilidad', grupo: 'administracion' },
  { to: '/impuestos', modulo: 'impuestos', icono: 'impuestos', titulo: 'Impuestos', grupo: 'administracion' },
  { to: '/usuarios', modulo: 'usuarios', icono: 'usuarios', titulo: 'Usuarios', grupo: 'administracion' },
]

/** Si este usuario entra a ese modulo. Lo dice el servidor. */
export function entraA(puede: { modulos?: string[] }, modulo: string): boolean {
  return (puede.modulos ?? []).includes(modulo)
}

export default function Rail() {
  const { estado } = useAcceso()
  const { pathname } = useLocation()
  if (pathname.startsWith('/cocina')) return null

  const visibles = MODULOS.filter((m) => entraA(estado.puede, m.modulo))
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
        <Link to="/mi-usuario" className="vp-rail-item" aria-current={pathname === '/mi-usuario' ? 'page' : undefined} aria-label="Mi usuario">
          <span className="w-8 h-8 rounded-full bg-neutral-900 text-white grid place-items-center text-xs font-bold font-display">
            {inicial}
          </span>
          <span className="vp-tip">{estado.usuario}</span>
        </Link>
      </div>
    </aside>
  )
}
