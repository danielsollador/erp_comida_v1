import { useLocalSearchParams } from 'expo-router'
import { PantallaNueva } from '../../../../componentes/inventario/ficha/FichaMercancia'
import type { TipoArticulo } from '../../../../lib/tipos'

const TIPOS: TipoArticulo[] = ['insumo', 'reventa', 'consumible', 'desechable']

/** /inventario/mercancia/nueva?tipo=reventa: crear una, con el almacen desde el que se abrio. */
export default function NuevaMercancia() {
  const { tipo } = useLocalSearchParams<{ tipo?: string }>()
  return <PantallaNueva tipo={TIPOS.includes(tipo as TipoArticulo) ? (tipo as TipoArticulo) : undefined} />
}
