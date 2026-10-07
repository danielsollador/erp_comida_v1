import Svg, { Path } from 'react-native-svg'
import { TRAZOS, type NombreIcono } from '../../../frontend/src/lib/iconos'

export type { NombreIcono }

/**
 * Los MISMOS iconos de la web: los trazos salen de frontend/src/lib/iconos.ts,
 * el archivo que usa components/Icono.tsx. Mismo grosor (1.75 sobre 24), mismas
 * puntas redondas. Aqui se dibujan con react-native-svg en vez de <svg>.
 */
export default function Icono({
  nombre,
  size = 20,
  color = 'currentColor',
  grosor = 1.75,
}: {
  nombre: NombreIcono
  size?: number
  color?: string
  grosor?: number
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d={TRAZOS[nombre]} stroke={color} strokeWidth={grosor} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}
