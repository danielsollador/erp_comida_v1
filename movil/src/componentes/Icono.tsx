import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { SymbolView, type SymbolWeight } from 'expo-symbols'
import Svg, { Path } from 'react-native-svg'
import { TRAZOS, type NombreIcono } from '../../../frontend/src/lib/iconos'
import { ICONOS_NATIVOS } from './iconos-nativos'

export type { NombreIcono }

type Props = {
  nombre: NombreIcono
  size?: number
  color?: string
  grosor?: number
}

/**
 * Iconos nativos en cada plataforma, con los mismos nombres del ERP:
 * - iOS: SF Symbol (expo-symbols), con el trazo SVG de la web como fallback.
 * - Android: Material Icon (@expo/vector-icons).
 * - Web: los MISMOS trazos de la web (frontend/src/lib/iconos.ts), con
 *   react-native-svg. Grosor 1.75 sobre 24, puntas redondas.
 * La tabla nombre → simbolo vive en ./iconos-nativos.ts.
 */
export default function Icono({ nombre, size = 20, color = 'currentColor', grosor = 1.75 }: Props) {
  const nativo = ICONOS_NATIVOS[nombre]
  if (process.env.EXPO_OS === 'ios') {
    return (
      <SymbolView
        name={nativo.sf}
        size={size}
        tintColor={color}
        weight={pesoSimbolo(grosor)}
        resizeMode="scaleAspectFit"
        fallback={<Trazo nombre={nombre} size={size} color={color} grosor={grosor} />}
      />
    )
  }
  if (process.env.EXPO_OS === 'android') {
    return <MaterialIcons name={nativo.md} size={size} color={color} />
  }
  return <Trazo nombre={nombre} size={size} color={color} grosor={grosor} />
}

/** El grosor del trazo web (1.75 por defecto) llevado al peso del SF Symbol. */
function pesoSimbolo(grosor: number): SymbolWeight {
  if (grosor >= 2.2) return 'semibold'
  if (grosor >= 1.8) return 'medium'
  return 'regular'
}

function Trazo({ nombre, size, color, grosor }: Required<Props>) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d={TRAZOS[nombre]} stroke={color} strokeWidth={grosor} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}
