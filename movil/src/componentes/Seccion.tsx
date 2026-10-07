import type { ReactNode } from 'react'
import { StyleSheet } from 'react-native'
import type { Parte } from '../lib/carga'
import { Ficha, Nota } from './ui'

/** Un bloque que llego, o el motivo de que no (un 403 se dice en palabras). */
export function Seccion<T>({
  parte: p,
  compacta = false,
  children,
}: {
  parte: Parte<T>
  compacta?: boolean
  children: (valor: T) => ReactNode
}) {
  if (p.ok) return <>{children(p.valor)}</>
  const mensaje = p.estado === 403 ? 'Tu rol no ve esta parte.' : p.error
  return (
    <Ficha style={compacta ? estilos.mitad : undefined}>
      <Nota>{mensaje}</Nota>
    </Ficha>
  )
}

const estilos = StyleSheet.create({
  mitad: { flex: 1, padding: 16 },
})
