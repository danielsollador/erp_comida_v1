import { useLocation } from 'react-router-dom'
import LinkVigilado from './LinkVigilado'
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
 *
 * TRES PUERTAS, NO DOCE MODULOS (Leider, 30-sep: "esta organizado por
 * departamentos, no por preguntas"). El dueño de una arepera no piensa en
 * Compras, Inventario y Contabilidad; piensa en vender, en su negocio y en
 * lo que el contador le pide una vez al mes:
 *
 *   vender     lo que se toca cien veces al dia: mostrador, cocina, como voy
 *   negocio    lo que se arma y se revisa: menu, mercancia, compras, ventas, caja
 *   contador   lo que se arma SOLO con lo de arriba y solo se abre cuando el
 *              contador lo pide: contabilidad, impuestos, tasa. No va en la
 *              barra: vive detras de una sola puerta ("Para el contador").
 */
export type Grupo = 'vender' | 'negocio' | 'contador'

export const MODULOS: { to: string; modulo: string | string[]; icono: NombreIcono; titulo: string; grupo: Grupo }[] = [
  { to: '/pos', modulo: 'pos', icono: 'pos', titulo: 'Punto de venta', grupo: 'vender' },
  { to: '/cocina', modulo: 'cocina', icono: 'cocina', titulo: 'Cocina', grupo: 'vender' },
  { to: '/reportes', modulo: 'reportes', icono: 'reportes', titulo: 'Reportes', grupo: 'vender' },
  // Dos permisos detras de un solo icono: quien tenga cualquiera de los dos
  // entra, aunque dentro solo vea su propia pestaña.
  { to: '/menu', modulo: ['menu', 'recetas'], icono: 'menu', titulo: 'Menú', grupo: 'negocio' },
  { to: '/inventario', modulo: 'inventario', icono: 'inventario', titulo: 'Inventario', grupo: 'negocio' },
  { to: '/compras', modulo: 'compras', icono: 'compras', titulo: 'Compras', grupo: 'negocio' },
  { to: '/ventas', modulo: 'ventas', icono: 'ventas', titulo: 'Ventas', grupo: 'negocio' },
  { to: '/caja', modulo: 'caja', icono: 'caja', titulo: 'Cierre de caja', grupo: 'negocio' },
  { to: '/contabilidad', modulo: 'contabilidad', icono: 'contabilidad', titulo: 'Contabilidad', grupo: 'contador' },
  { to: '/impuestos', modulo: 'impuestos', icono: 'impuestos', titulo: 'Impuestos', grupo: 'contador' },
  { to: '/tasa', modulo: 'tasa', icono: 'tasa', titulo: 'Tasa de cambio', grupo: 'contador' },
]

/** La puerta unica a lo del contador. En la barra es un solo icono. */
export const CONTADOR = { to: '/contador', icono: 'contabilidad' as NombreIcono, titulo: 'Para el contador' }

/** Si este usuario entra a ese modulo. Lo dice el servidor. */
export function entraA(puede: { modulos?: string[] }, modulo: string): boolean {
  return (puede.modulos ?? []).includes(modulo)
}

/** Igual que `entraA`, pero acepta un módulo o una lista: con lista, basta con
 * cualquiera de ellos (una pantalla que junta dos módulos, como Menú y
 * recetas). */
export function entraAModulo(puede: { modulos?: string[] }, modulo: string | string[]): boolean {
  // '*' = una pantalla de todos (Configuracion): no depende de ningun modulo.
  if (modulo === '*') return true
  return Array.isArray(modulo) ? modulo.some((m) => entraA(puede, m)) : entraA(puede, modulo)
}

/** Los modulos de un grupo a los que este usuario entra. */
export function modulosDe(puede: { modulos?: string[] }, grupo: Grupo) {
  return MODULOS.filter((m) => m.grupo === grupo && entraAModulo(puede, m.modulo))
}

/**
 * Las pantallas que van a pantalla completa, sin barra lateral.
 *
 * Cocina y el mostrador se quedan abiertas el turno entero en una tablet y no
 * se navega desde ellas: se entra, se trabaja y se sale. Los 68 px de la barra
 * son ancho que le hace falta a la lista de productos, que es lo que el cajero
 * de verdad mira. Para salir esta la flecha del encabezado, que siempre esta.
 */
export function sinBarraLateral(pathname: string): boolean {
  return pathname.startsWith('/cocina') || pathname.startsWith('/pos')
}

export default function Rail() {
  const { estado } = useAcceso()
  const { pathname } = useLocation()
  if (sinBarraLateral(pathname)) return null

  const vender = modulosDe(estado.puede, 'vender')
  const negocio = modulosDe(estado.puede, 'negocio')
  const contador = modulosDe(estado.puede, 'contador')
  const inicial = (estado.nombre_visible || estado.usuario || '?').slice(0, 1).toUpperCase()

  const item = (m: { to: string; icono: NombreIcono; titulo: string }, className = '') => {
    // La puerta del contador se enciende con cualquiera de sus tres pantallas.
    const activo =
      pathname === m.to ||
      pathname.startsWith(m.to + '/') ||
      (m.to === CONTADOR.to && contador.some((c) => pathname.startsWith(c.to)))
    return (
      <LinkVigilado key={m.to} to={m.to} className={`vp-rail-item ${className}`} aria-current={activo ? 'page' : undefined} aria-label={m.titulo}>
        <Icono nombre={m.icono} size={20} />
        <span className="vp-tip">{m.titulo}</span>
      </LinkVigilado>
    )
  }

  return (
    <aside className="vp-rail hidden md:flex fixed left-0 top-0 bottom-0 w-[68px] z-30 flex-col items-center py-3 gap-1">
      <LinkVigilado to="/" className="vp-rail-item mb-2" aria-current={pathname === '/' ? 'page' : undefined} aria-label="Inicio">
        <span className="vp-rombo" />
        <span className="vp-tip">{estado.local.nombre}</span>
      </LinkVigilado>

      {vender.map((m) => item(m))}
      {negocio.length > 0 && <div className="w-8 h-px bg-neutral-200 my-2" />}
      {negocio.map((m) => item(m))}

      <div className="mt-auto flex flex-col items-center gap-1">
        {/* Lo del contador, atenuado: esta, pero no compite con lo de todos
            los dias. */}
        {contador.length > 0 && item(CONTADOR, 'opacity-60 hover:opacity-100')}
        <LinkVigilado to="/configuracion?s=cuenta" className="vp-rail-item" aria-label="Mi cuenta">
          <span className="w-8 h-8 rounded-full bg-neutral-900 text-white grid place-items-center text-xs font-bold font-display">
            {inicial}
          </span>
          <span className="vp-tip">{estado.usuario}</span>
        </LinkVigilado>
      </div>
    </aside>
  )
}
