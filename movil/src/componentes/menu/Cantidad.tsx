import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { LETRA, useTema } from '../../lib/tema'

/**
 * La casilla de una cantidad con su unidad ADENTRO, pegada a la derecha:
 * "50 ............ g ⇄" (`CasillaConUnidad` de components/Cantidad.tsx).
 * Un toque en "g ⇄" y se escribe en kilos; otro y vuelve a gramos. Lo que no
 * tiene otra cara (unidad, paquete) lleva solo su rotulo en el mismo sitio.
 *
 * Toda la altura de la pastilla se toca (44 px): con el pulgar no se apunta.
 */
export function CasillaConUnidad({
  valor,
  alCambiar,
  vista,
  otra,
  rotulo,
  entero = false,
  autoFocus = false,
  etiqueta,
  alCambiarVista,
}: {
  valor: string
  alCambiar: (texto: string) => void
  /** La unidad en la que se esta escribiendo ahora. */
  vista: string
  /** La unidad a la que se pasa al tocar (la otra cara de `vista`), o null si no tiene. */
  otra: string | null
  /** Lo que se lee cuando la unidad no tiene otra cara ("unidades"). */
  rotulo: string
  entero?: boolean
  autoFocus?: boolean
  etiqueta: string
  alCambiarVista: () => void
}) {
  const t = useTema()
  return (
    <View style={[estilos.caja, { backgroundColor: t.superficie, borderColor: t.gris200 }]}>
      <TextInput
        value={valor}
        onChangeText={(v) => alCambiar(entero ? v.replace(/[^\d]/g, '') : v.replace(/[^\d.,]/g, ''))}
        keyboardType={entero ? 'number-pad' : 'decimal-pad'}
        placeholder="0"
        placeholderTextColor={t.tenue}
        autoFocus={autoFocus}
        selectTextOnFocus
        accessibilityLabel={etiqueta}
        style={[estilos.texto, { color: t.tinta }]}
      />
      {otra ? (
        <Pressable
          onPress={alCambiarVista}
          accessibilityRole="button"
          accessibilityLabel={`Cambiar a ${otra}`}
          style={({ pressed }) => [estilos.unidad, { backgroundColor: pressed ? t.gris200 : t.gris100 }]}
        >
          <Text style={[estilos.unidadTexto, { color: t.fuerte }]}>{vista} ⇄</Text>
        </Pressable>
      ) : (
        <Text style={[estilos.rotulo, { color: t.suave }]}>{rotulo}</Text>
      )}
    </View>
  )
}

const estilos = StyleSheet.create({
  caja: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, minHeight: 46, paddingLeft: 12, paddingRight: 4 },
  texto: { flex: 1, fontFamily: LETRA.cifra, fontSize: 16, paddingVertical: 9, textAlign: 'right', minWidth: 40 },
  unidad: { minHeight: 38, minWidth: 54, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, marginLeft: 6 },
  unidadTexto: { fontFamily: LETRA.cifraFuerte, fontSize: 13 },
  rotulo: { fontFamily: LETRA.textoFuerte, fontSize: 13, paddingHorizontal: 8, marginLeft: 4 },
})
