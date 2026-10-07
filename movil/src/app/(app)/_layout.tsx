import { Stack } from 'expo-router'
import { useTema } from '../../lib/tema'

/**
 * Como la web: el inicio es la puerta y desde ahi se entra a cada parte
 * (contabilidad, impuestos, tasa, reportes, notificaciones, configuracion).
 * Sin pestañas abajo: la web no las tiene, y el inicio ya las lleva todas.
 */
export default function Interior() {
  const t = useTema()
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.papel }, animation: 'slide_from_right' }} />
}
