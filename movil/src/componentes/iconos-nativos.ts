import type { ComponentProps } from 'react'
import type MaterialIcons from '@expo/vector-icons/MaterialIcons'
import type { SFSymbol } from 'expo-symbols'
import type { NombreIcono } from '../../../frontend/src/lib/iconos'

/**
 * Equivalente nativo de cada icono del ERP: SF Symbol en iOS (expo-symbols) y
 * Material Icon en Android (@expo/vector-icons). Los nombres son los del ERP
 * (`caja` es el cierre de caja), asi que se eligio el simbolo por lo que
 * SIGNIFICA, no por el trazo de la web. En web se siguen dibujando los trazos
 * de frontend/src/lib/iconos.ts.
 *
 * Los SF Symbols pasan por el tipo `SFSymbol`: si un nombre no existe, tsc se
 * queja. Igual con los Material: el tipo sale del glifo de MaterialIcons.
 */
export type NombreMaterial = ComponentProps<typeof MaterialIcons>['name']

export type IconoNativo = { sf: SFSymbol; md: NombreMaterial }

export const ICONOS_NATIVOS: Record<NombreIcono, IconoNativo> = {
  inicio: { sf: 'house', md: 'home' },
  pos: { sf: 'storefront', md: 'point-of-sale' },
  cocina: { sf: 'flame', md: 'local-fire-department' },
  reportes: { sf: 'chart.bar', md: 'bar-chart' },
  ventas: { sf: 'cart', md: 'shopping-cart' },
  calendario: { sf: 'calendar', md: 'calendar-today' },
  menu: { sf: 'menucard', md: 'restaurant-menu' },
  recetas: { sf: 'fork.knife', md: 'restaurant' },
  inventario: { sf: 'shippingbox', md: 'inventory-2' },
  compras: { sf: 'bag', md: 'shopping-bag' },
  caja: { sf: 'banknote', md: 'payments' },
  tasa: { sf: 'dollarsign.arrow.circlepath', md: 'currency-exchange' },
  contabilidad: { sf: 'list.bullet.rectangle.portrait', md: 'calculate' },
  impuestos: { sf: 'building.columns', md: 'account-balance' },
  usuarios: { sf: 'person.2', md: 'group' },
  configuracion: { sf: 'gearshape', md: 'settings' },
  sistema: { sf: 'checkmark.shield', md: 'verified-user' },
  atras: { sf: 'arrow.left', md: 'arrow-back' },
  salir: { sf: 'rectangle.portrait.and.arrow.right', md: 'logout' },
  cuenta: { sf: 'person.crop.circle', md: 'person' },
  // Apunta a la derecha; las pantallas lo giran con transform.
  chevron: { sf: 'chevron.right', md: 'chevron-right' },
  alerta: { sf: 'exclamationmark.triangle', md: 'warning-amber' },
  ok: { sf: 'checkmark', md: 'check' },
  expandir: { sf: 'arrow.up.left.and.arrow.down.right', md: 'open-in-full' },
  contraer: { sf: 'arrow.down.right.and.arrow.up.left', md: 'close-fullscreen' },
  campana: { sf: 'bell', md: 'notifications-none' },
  'campana-muda': { sf: 'bell.slash', md: 'notifications-off' },
  chispa: { sf: 'sparkles', md: 'auto-awesome' },
  camara: { sf: 'camera', md: 'photo-camera' },
  imagen: { sf: 'photo', md: 'image' },
  // Los cuatro almacenes de Compras y la caja en que llega la mercancia.
  olla: { sf: 'frying.pan', md: 'soup-kitchen' },
  botella: { sf: 'waterbottle', md: 'liquor' },
  vaso: { sf: 'cup.and.saucer', md: 'local-cafe' },
  servilleta: { sf: 'square.split.diagonal', md: 'cleaning-services' },
  paquete: { sf: 'cube.box', md: 'inventory' },
  factura: { sf: 'doc.text', md: 'receipt-long' },
  mas: { sf: 'plus', md: 'add' },
  quitar: { sf: 'xmark', md: 'close' },
  buscar: { sf: 'magnifyingglass', md: 'search' },
}
