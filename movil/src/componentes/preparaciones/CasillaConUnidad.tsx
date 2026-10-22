import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native'
import { otraUnidad } from '../../../../frontend/src/lib/unidades'
import { LETRA, useTema } from '../../lib/tema'

/**
 * La casilla de una cantidad con su unidad ADENTRO, pegada a la derecha
 * (`CasillaConUnidad` de la web, components/Cantidad.tsx): "1 ...... kg ⇄".
 * Un toque en "kg ⇄" y se escribe en gramos; otro y vuelve a kilos. Lo que no
 * tiene otra cara (unidad, paquete) lleva solo el rotulo, en el mismo sitio.
 *
 * Lo que se guarda va siempre en la unidad de la ficha: la conversion la
 * hace quien la usa (la olla, el conteo), no quien escribe (Leider, 2-oct).
 * Tocar el cambio no cierra el teclado: la pantalla tiene
 * `keyboardShouldPersistTaps`, y se sigue escribiendo ya en la otra unidad.
 */
export default function CasillaConUnidad({
  unidad,
  vista,
  alCambiarVista,
  valor,
  alCambiar,
  placeholder = '0',
  etiqueta,
  autoFocus = false,
  error = false,
  rotulo,
  estilo,
}: {
  /** La unidad en que se guarda la mercancia. */
  unidad: string
  /** En la que se esta escribiendo ahora. */
  vista: string
  alCambiarVista: (vista: string) => void
  valor: string
  alCambiar: (texto: string) => void
  placeholder?: string
  /** Lo que dice el lector de pantalla. */
  etiqueta: string
  autoFocus?: boolean
  error?: boolean
  /** Lo que se lee cuando la unidad no tiene otra cara. Por defecto, la unidad. */
  rotulo?: string
  estilo?: StyleProp<ViewStyle>
}) {
  const t = useTema()
  const otra = otraUnidad(unidad)
  const siguiente = vista === unidad ? otra : unidad
  return (
    <View style={[e.casilla, { backgroundColor: t.superficie, borderColor: error ? t.peligro : t.gris200 }, estilo]}>
      <TextInput
        value={valor}
        onChangeText={(v) => alCambiar(v.replace(/[^\d.,-]/g, ''))}
        keyboardType="decimal-pad"
        placeholder={placeholder}
        placeholderTextColor={t.tenue}
        autoFocus={autoFocus}
        selectTextOnFocus
        accessibilityLabel={etiqueta}
        style={[e.texto, { color: t.tinta }]}
      />
      {otra && siguiente ? (
        <Pressable
          onPress={() => alCambiarVista(siguiente)}
          accessibilityRole="button"
          accessibilityLabel={`Cambiar a ${siguiente}`}
          hitSlop={{ top: 6, bottom: 6, right: 6 }}
          style={({ pressed }) => [e.cambio, { backgroundColor: pressed ? t.gris200 : t.gris100 }]}
        >
          <Text style={[e.cambioTexto, { color: t.fuerte }]}>{vista} ⇄</Text>
        </Pressable>
      ) : (
        <Text style={[e.rotulo, { color: t.tenue }]}>{rotulo ?? unidad}</Text>
      )}
    </View>
  )
}

const e = StyleSheet.create({
  casilla: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12, borderCurve: 'continuous',
    minHeight: 46,
    paddingLeft: 12,
    paddingRight: 5,
    gap: 6,
  },
  texto: { flex: 1, minWidth: 0, fontFamily: LETRA.cifra, fontSize: 16, paddingVertical: 9, textAlign: 'right' },
  cambio: { minWidth: 54, borderRadius: 8, borderCurve: 'continuous', paddingHorizontal: 8, paddingVertical: 7, alignItems: 'center' },
  cambioTexto: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
  rotulo: { fontFamily: LETRA.textoFuerte, fontSize: 13, paddingRight: 8 },
})
