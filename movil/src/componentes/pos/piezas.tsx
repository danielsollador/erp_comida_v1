import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { LETRA, useTema } from '../../lib/tema'

/*
 * Las piezas chicas que se repiten en el punto de venta y que la app todavia
 * no tiene en ui.tsx: el boton de solo texto que se toca con el pulgar, la
 * caja de color de un aviso dentro de un cuadro y el renglon de dos cifras.
 * Si otro modulo las necesita, conviene subirlas a ui.tsx o kit.tsx.
 */

/** Un boton de solo texto ("Cancelar", "Vaciar"): se ve chico, se toca en 44 px. */
export function BotonChico({
  texto,
  color,
  alTocar,
  deshabilitado = false,
}: {
  texto: string
  color: string
  alTocar: () => void
  deshabilitado?: boolean
}) {
  return (
    <Pressable
      onPress={alTocar}
      disabled={deshabilitado}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityState={{ disabled: deshabilitado }}
      style={({ pressed }) => [e.chico, { opacity: deshabilitado ? 0.35 : pressed ? 0.55 : 1 }]}
    >
      <Text style={[e.chicoTexto, { color }]}>{texto}</Text>
    </Pressable>
  )
}

/** Un aviso de color dentro de un cuadro: verde, ambar, rojo o gris. */
export function Caja({ tono, children }: { tono: 'bien' | 'ojo' | 'mal' | 'neutro'; children: ReactNode }) {
  const t = useTema()
  const fondo = tono === 'bien' ? t.exitoSuave : tono === 'ojo' ? t.avisoSuave : tono === 'mal' ? t.peligroSuave : t.gris100
  return <View style={[e.caja, { backgroundColor: fondo }]}>{children}</View>
}

/** El color de la letra que va con cada `Caja`. */
export function useColorDeCaja() {
  const t = useTema()
  return (tono: 'bien' | 'ojo' | 'mal' | 'neutro') =>
    tono === 'bien' ? t.exito : tono === 'ojo' ? t.avisoFuerte : tono === 'mal' ? t.peligro : t.fuerte
}

/** Un renglon nombre ... cifra, chico (los "Antes", "Queda en" de los cuadros). */
export function Renglon({ nombre, cifra, color, fuerte = false }: { nombre: string; cifra: string; color?: string; fuerte?: boolean }) {
  const t = useTema()
  return (
    <View style={e.renglon}>
      <Text style={[fuerte ? e.renglonNombreFuerte : e.renglonNombre, { color: color ?? (fuerte ? t.tinta : t.suave) }]}>{nombre}</Text>
      <Text style={[fuerte ? e.renglonCifraFuerte : e.renglonCifra, { color: color ?? (fuerte ? t.tinta : t.suave) }]}>{cifra}</Text>
    </View>
  )
}

const e = StyleSheet.create({
  chico: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 },
  chicoTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14 },
  caja: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, gap: 4 },
  renglon: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, paddingVertical: 3 },
  renglonNombre: { fontFamily: LETRA.texto, fontSize: 14.5, flexShrink: 1 },
  renglonNombreFuerte: { fontFamily: LETRA.textoFuerte, fontSize: 15, flexShrink: 1 },
  renglonCifra: { fontFamily: LETRA.cifra, fontSize: 14.5 },
  renglonCifraFuerte: { fontFamily: LETRA.cifraFuerte, fontSize: 15.5 },
})
