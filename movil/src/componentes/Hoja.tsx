import type { ReactNode } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LETRA, useTema } from '../lib/tema'
import Icono, { type NombreIcono } from './Icono'

/**
 * El menu que en la web se abre colgando de un boton, en el telefono sube
 * desde abajo: queda al alcance del pulgar y no lo tapa el dedo. Se cierra
 * tocando afuera o con el gesto de atras.
 */
export function Hoja({
  visible,
  alCerrar,
  titulo,
  children,
}: {
  visible: boolean
  alCerrar: () => void
  titulo?: string
  children: ReactNode
}) {
  const t = useTema()
  const borde = useSafeAreaInsets()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={alCerrar} statusBarTranslucent>
      <Pressable style={estilos.fondo} onPress={alCerrar} accessibilityLabel="Cerrar" />
      <View style={[estilos.hoja, { backgroundColor: t.superficie, paddingBottom: 16 + borde.bottom }]}>
        <View style={[estilos.agarre, { backgroundColor: t.gris200 }]} />
        {titulo && <Text style={[estilos.titulo, { color: t.tenue }]}>{titulo}</Text>}
        {children}
      </View>
    </Modal>
  )
}

/** Una opcion de la hoja: icono, texto, detalle chico y la marca si esta elegida. */
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
  fondo: { flex: 1, backgroundColor: 'rgba(14,16,20,0.42)' },
  hoja: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
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
  opcion: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 12, paddingVertical: 13, borderRadius: 14 },
  opcionTexto: { fontFamily: LETRA.textoFuerte, fontSize: 16 },
  opcionDetalle: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 2 },
})
