import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSesion } from '../../lib/sesion'
import { LETRA, useTema } from '../../lib/tema'
import Icono from '../Icono'
import { Etiqueta } from '../ui'
import { GRUPOS } from './conversacion'

/**
 * La pantalla vacia del chat: un saludo corto y las preguntas sugeridas como
 * pastillas; tocar una es mandarla. Quien no ve cifras (`ve_kpis`) no ve las
 * preguntas de numeros: el servidor igual no se las contestaria.
 */
export default function Sugerencias({ alElegir }: { alElegir: (pregunta: string) => void }) {
  const t = useTema()
  const { acceso } = useSesion()
  const veCifras = acceso?.puede.ve_kpis ?? false
  const grupos = GRUPOS.filter((g) => g.id !== 'numeros' || veCifras)
  return (
    <View style={{ gap: 20, paddingTop: 4 }}>
      <View style={{ gap: 4 }}>
        <Text style={[e.saludo, { color: t.tinta }]}>¿Qué quieres saber hoy?</Text>
        <Text style={[e.nota, { color: t.suave }]}>Tus números, un documento, o cómo se hace algo.</Text>
      </View>
      {grupos.map((g) => (
        <View key={g.id} style={{ gap: 8 }}>
          <Etiqueta>{g.titulo}</Etiqueta>
          {g.preguntas.map((p) => (
            <Pressable
              key={p}
              onPress={() => alElegir(p)}
              accessibilityRole="button"
              accessibilityLabel={`Preguntar: ${p}`}
              style={({ pressed }) => [
                e.pastilla,
                { backgroundColor: pressed ? t.gris100 : t.superficie, borderColor: t.linea, transform: [{ scale: pressed ? 0.985 : 1 }] },
              ]}
            >
              <Text style={[e.pregunta, { color: t.tinta }]}>{p}</Text>
              <Icono nombre="chevron" size={14} color={t.tenue} grosor={2.2} />
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  )
}

const e = StyleSheet.create({
  saludo: { fontFamily: LETRA.titulo, fontSize: 22, letterSpacing: -0.4, lineHeight: 28 },
  nota: { fontFamily: LETRA.texto, fontSize: 14, lineHeight: 20 },
  pastilla: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 50,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  pregunta: { flex: 1, fontFamily: LETRA.texto, fontSize: 15, lineHeight: 21 },
})
