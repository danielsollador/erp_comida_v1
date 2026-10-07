import { StyleSheet, View } from 'react-native'
import Svg, { Circle, Defs, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg'
import { useModo, useTema } from '../lib/tema'

/**
 * El papel de la web (index.css, `body::before`): una luz calida y ancha que
 * baja desde arriba, los bordes que se apagan hacia afuera y un punteado fino
 * cada 22 px. No es decoracion suelta: es lo que hace que el fondo se lea
 * como una superficie iluminada y no como un color plano. Quieto y detras de
 * todo; no recibe toques.
 */
export default function Fondo() {
  const t = useTema()
  const { modo } = useModo()
  const oscuro = modo === 'oscuro'
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="luz" cx="50%" cy="-20%" rx="108%" ry="64%" fx="50%" fy="-20%" gradientUnits="objectBoundingBox">
            <Stop offset="0" stopColor={t.acento} stopOpacity={oscuro ? 0.15 : 0.52} />
            <Stop offset="0.7" stopColor={t.acento} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="vineta" cx="50%" cy="36%" rx="128%" ry="118%" gradientUnits="objectBoundingBox">
            <Stop offset="0.36" stopColor={t.tinta} stopOpacity={0} />
            <Stop offset="1" stopColor={oscuro ? '#000000' : t.tinta} stopOpacity={oscuro ? 0.5 : 0.15} />
          </RadialGradient>
          <Pattern id="puntos" x="0" y="0" width="22" height="22" patternUnits="userSpaceOnUse">
            <Circle cx="11" cy="11" r="0.8" fill={oscuro ? '#ffffff' : '#17181b'} fillOpacity={oscuro ? 0.045 : 0.05} />
          </Pattern>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={t.papel} />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#luz)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#vineta)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#puntos)" />
      </Svg>
    </View>
  )
}
