import { Alert } from 'react-native'
import { router, type Href } from 'expo-router'
import type { NombreIcono } from '../componentes/Icono'

/**
 * Los modulos del ERP con el nombre, el icono y la pregunta que responden,
 * como en la barra de la web (frontend/src/components/Rail.tsx). La app
 * todavia no tiene todos: los que no estan avisan en vez de abrir una
 * pantalla vacia.
 */
export type Modulo = { to: string; modulo: string | string[]; icono: NombreIcono; titulo: string; pregunta: string }

export const MODULOS: Modulo[] = [
  { to: '/pos', modulo: 'pos', icono: 'pos', titulo: 'Punto de venta', pregunta: 'Tomar la comanda y cobrar' },
  { to: '/cocina', modulo: 'cocina', icono: 'cocina', titulo: 'Cocina', pregunta: 'Las comandas que llegan' },
  { to: '/compras', modulo: 'compras', icono: 'compras', titulo: 'Compras', pregunta: '¿Qué entró y cuánto costó?' },
  { to: '/inventario', modulo: 'inventario', icono: 'inventario', titulo: 'Inventario', pregunta: '¿Qué tengo y qué me falta?' },
  { to: '/menu', modulo: ['menu', 'recetas'], icono: 'menu', titulo: 'Menú', pregunta: '¿Qué vendo, a cuánto y cuánto me deja?' },
  { to: '/caja', modulo: 'caja', icono: 'caja', titulo: 'Cierre de caja', pregunta: '¿Cuadran las ventas del día?' },
  { to: '/ventas', modulo: 'ventas', icono: 'ventas', titulo: 'Ventas', pregunta: '¿Qué se vendió y cómo se pagó?' },
  { to: '/reportes', modulo: 'reportes', icono: 'reportes', titulo: 'Reportes', pregunta: '¿Cómo va el negocio?' },
  { to: '/contabilidad', modulo: 'contabilidad', icono: 'contabilidad', titulo: 'Contabilidad', pregunta: 'Libros y balances' },
  { to: '/impuestos', modulo: 'impuestos', icono: 'impuestos', titulo: 'Impuestos', pregunta: 'IVA y libros fiscales' },
  { to: '/tasa', modulo: 'tasa', icono: 'tasa', titulo: 'Tasa de cambio', pregunta: 'Bolívares por dólar de cada día' },
]

export const moduloDe = (to: string) => MODULOS.find((m) => m.to === to)

/** Si este rol entra al modulo (`puede.modulos` del servidor, como en la web). */
export function entraA(modulos: string[] | undefined, m: Modulo): boolean {
  const ids = Array.isArray(m.modulo) ? m.modulo : [m.modulo]
  return ids.some((id) => modulos?.includes(id))
}

/** Lo que la app ya tiene; lo demas sigue en la web por ahora. */
const EN_LA_APP = new Set(['/reportes', '/contabilidad', '/impuestos', '/tasa', '/notificaciones', '/configuracion'])

/**
 * Abrir un modulo desde el inicio. Si la app aun no lo tiene, se dice en
 * palabras, en vez de abrir una pantalla vacia o una web dentro de la app.
 */
export function abrir(ruta: string) {
  const base = '/' + (ruta.split('?')[0].split('/')[1] ?? '')
  if (EN_LA_APP.has(base)) {
    router.push(ruta as Href)
    return
  }
  const m = moduloDe(base)
  Alert.alert(
    m ? m.titulo : 'Todavía en la web',
    `${m ? `${m.titulo} todavía se usa en la tablet o en la web.` : 'Esto todavía se usa en la tablet o en la web.'} Llega a la app en las próximas fases.`,
  )
}
