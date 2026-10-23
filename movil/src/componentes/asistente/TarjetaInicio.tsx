import { Pressable, StyleSheet, Text, View } from 'react-native'
import { abrir } from '../../lib/modulos'
import { LETRA, useTema } from '../../lib/tema'
import { SelloIA } from '../ia'
import Icono from '../Icono'
import { Ficha } from '../ui'

/**
 * La puerta al chat desde el inicio, debajo del saludo: la misma losa que
 * las demas fichas, con el sello de la IA. En la web es el boton flotante;
 * en el telefono flotaria sobre lo ultimo de la lista, asi que es una ficha.
 */
export default function TarjetaInicio() {
  const t = useTema()
  return (
    <Pressable
      onPress={() => abrir('/asistente')}
      accessibilityRole="button"
      accessibilityLabel="Pregúntale a Vertigo. ¿Cuánto vendí hoy? ¿Qué se está acabando? Búscame una factura…"
      style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.985 : 1 }] }]}
    >
      <Ficha style={e.ficha}>
        <SelloIA tam={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[e.titulo, { color: t.tinta }]}>Pregúntale a Vertigo</Text>
          <Text style={[e.desc, { color: t.suave }]} numberOfLines={2}>
            ¿Cuánto vendí hoy? ¿Qué se está acabando? Búscame una factura…
          </Text>
        </View>
        <View style={[e.flecha, { backgroundColor: t.gris100 }]}>
          <Icono nombre="chevron" size={14} color={t.suave} />
        </View>
      </Ficha>
    </Pressable>
  )
}

const e = StyleSheet.create({
  ficha: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, marginTop: 6 },
  titulo: { fontFamily: LETRA.titulo, fontSize: 16, letterSpacing: -0.2 },
  desc: { fontFamily: LETRA.texto, fontSize: 13, lineHeight: 18, marginTop: 3 },
  flecha: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
})
