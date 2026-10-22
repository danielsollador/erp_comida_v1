import { BottomSheet, RNHostView } from '@expo/ui'
import { useEffect, useState, type ReactNode } from 'react'
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LETRA, useTema } from '../lib/tema'
import Icono, { type NombreIcono } from './Icono'

/**
 * El menu que en la web se abre colgando de un boton, en el telefono sube
 * desde abajo: queda al alcance del pulgar y no lo tapa el dedo. Se cierra
 * tocando afuera, arrastrando hacia abajo o con el gesto de atras.
 *
 * En el telefono es la hoja nativa de @expo/ui (SwiftUI en iOS, Material 3
 * en Android): trae el velo, el agarre, la altura a medida del contenido, el
 * modo oscuro y el gesto de atras sin que los dibujemos nosotros. Lo de
 * adentro sigue siendo React Native (las opciones, el buscador, la lista),
 * y va dentro de `RNHostView`: una hoja se presenta en su propia ventana,
 * donde nada de arriba reparte los toques, y es ese host el que los toma y
 * el que le da a las filas el ancho de la hoja.
 *
 * En la web se conserva la hoja dibujada a mano de siempre.
 */
type PropsHoja = {
  visible: boolean
  alCerrar: () => void
  titulo?: string
  children: ReactNode
}

export function Hoja(props: PropsHoja) {
  // En iOS la hoja de SwiftUI (BottomSheet + RNHostView) salio a pantalla
  // completa y con el contenido apagado en el iPhone de Leider (22-oct); hasta
  // verla bien ahi, iOS y web usan la hoja propia. Android si la nativa.
  if (process.env.EXPO_OS !== 'android') return <HojaWeb {...props} />
  return <HojaNativa {...props} />
}

function HojaNativa({ visible, alCerrar, titulo, children }: PropsHoja) {
  const t = useTema()
  return (
    <BottomSheet
      isPresented={visible}
      onDismiss={alCerrar}
      containerColor={t.superficie}
      contentPadding={{ top: 6, bottom: 16, left: 12, right: 12 }}
    >
      {/* Solo el alto sale del contenido; el ancho lo pone la hoja, asi los textos se parten. */}
      <RNHostView matchContents={{ vertical: true }}>
        <View>
          {titulo ? <Text style={[estilos.titulo, { color: t.tenue }]}>{titulo}</Text> : null}
          {children}
        </View>
      </RNHostView>
    </BottomSheet>
  )
}

/**
 * La hoja de la web. El fondo oscuro aparece en su sitio (fundido) y solo la
 * hoja sube; con `animationType="slide"` del Modal subia todo junto, el velo
 * incluido, y se veia raro. Al cerrar, la hoja baja y el velo se apaga antes
 * de desmontar.
 */
const ENTRAR_MS = 280
const SALIR_MS = 200
const CURVA = Easing.bezier(0.2, 0.7, 0.2, 1)

function HojaWeb({ visible, alCerrar, titulo, children }: PropsHoja) {
  const t = useTema()
  const borde = useSafeAreaInsets()
  const { height: altoPantalla } = useWindowDimensions()
  const [montada, setMontada] = useState(visible)
  const avance = useSharedValue(0)
  // Se monta en cuanto se pide abrir (en el render, no en un efecto); se
  // desmonta solo cuando termino de bajar.
  if (visible && !montada) setMontada(true)

  useEffect(() => {
    if (visible) {
      avance.set(withTiming(1, { duration: ENTRAR_MS, easing: CURVA }))
    } else {
      avance.set(withTiming(0, { duration: SALIR_MS, easing: CURVA }, (fin) => {
        if (fin) scheduleOnRN(setMontada, false)
      }))
    }
  }, [visible, avance])

  const estiloVelo = useAnimatedStyle(() => ({ opacity: avance.value }))
  const estiloHoja = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - avance.value) * altoPantalla }] }))

  return (
    <Modal visible={montada} transparent animationType="none" onRequestClose={alCerrar} statusBarTranslucent>
      <View style={estilos.marco}>
        <Animated.View style={[StyleSheet.absoluteFill, estilos.fondo, estiloVelo]}>
          <Pressable style={{ flex: 1 }} onPress={alCerrar} accessibilityLabel="Cerrar" />
        </Animated.View>
        <Animated.View style={[estilos.hoja, { backgroundColor: t.superficie, paddingBottom: 16 + borde.bottom }, estiloHoja]}>
          <View style={[estilos.agarre, { backgroundColor: t.gris200 }]} />
          {titulo ? <Text style={[estilos.titulo, { color: t.tenue }]}>{titulo}</Text> : null}
          {children}
        </Animated.View>
      </View>
    </Modal>
  )
}

/**
 * Una opcion de la hoja: icono, texto, detalle chico y la marca si esta
 * elegida. Es una fila de React Native y no un `ListItem` de @expo/ui a
 * proposito: quien arma la hoja la mezcla con un buscador, una lista que se
 * desplaza y un boton "Listo", y la `List` nativa pide su propio `Host` y un
 * alto fijo, cosa que no cuadra con ese contenido mezclado.
 */
export function OpcionHoja({
  texto,
  detalle,
  icono,
  marcada = false,
  peligro = false,
  alTocar,
}: {
  texto: string
  detalle?: string
  icono?: NombreIcono
  marcada?: boolean
  peligro?: boolean
  alTocar: () => void
}) {
  const t = useTema()
  const color = peligro ? t.peligro : t.tinta
  return (
    <Pressable
      onPress={alTocar}
      style={({ pressed }) => [estilos.opcion, { backgroundColor: pressed ? t.gris100 : 'transparent' }]}
    >
      {icono && <Icono nombre={icono} size={19} color={peligro ? t.peligro : t.tenue} />}
      <View style={{ flex: 1 }}>
        <Text style={[estilos.opcionTexto, { color }]}>{texto}</Text>
        {detalle ? <Text style={[estilos.opcionDetalle, { color: t.tenue }]}>{detalle}</Text> : null}
      </View>
      {marcada && <Icono nombre="ok" size={18} color={t.acento} grosor={2.2} />}
    </Pressable>
  )
}

const estilos = StyleSheet.create({
  marco: { flex: 1, justifyContent: 'flex-end' },
  fondo: { backgroundColor: 'rgba(14,16,20,0.42)' },
  hoja: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderCurve: 'continuous',
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  agarre: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, marginBottom: 10 },
  titulo: {
    fontFamily: LETRA.textoFuerte,
    fontSize: 11,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  opcion: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 12, paddingVertical: 13, borderRadius: 14, borderCurve: 'continuous' },
  opcionTexto: { fontFamily: LETRA.textoFuerte, fontSize: 16 },
  opcionDetalle: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 2 },
})
