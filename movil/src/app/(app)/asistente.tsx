import { Stack } from 'expo-router'
import { useRef, useState } from 'react'
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BurbujaAsistente, BurbujaMia, BurbujaPensando } from '../../componentes/asistente/Burbujas'
import {
  agregarMensaje,
  ponerMensajes,
  ponerPensando,
  useConversacion,
  vaciarConversacion,
  type Mensaje,
} from '../../componentes/asistente/conversacion'
import Sugerencias from '../../componentes/asistente/Sugerencias'
import Fondo from '../../componentes/Fondo'
import Icono from '../../componentes/Icono'
import { apiIA } from '../../lib/api-ia'
import { LETRA, useModo, useTema } from '../../lib/tema'

/**
 * PREGUNTAME: el chat con la IA del negocio, lo mismo que la hoja de la web
 * (components/Asistente.tsx) pero como pantalla propia. Se le pregunta por
 * los numeros ("¿cuanto vendi hoy?"), se le pide un documento ("la ultima
 * factura de carne", que se abre en su pantalla) o como se hace algo. La
 * guia que recorre la pantalla es de la web; aqui se avisa que existe.
 *
 * Sin estado en el servidor: cada vez se mandan las ultimas 20 vueltas. La
 * conversacion vive en memoria (componentes/asistente/conversacion.ts) para
 * que abrir un documento y volver no la borre.
 */
export default function Asistente() {
  const t = useTema()
  const { modo } = useModo()
  const borde = useSafeAreaInsets()
  const { mensajes, pensando } = useConversacion()
  const [texto, setTexto] = useState('')
  const lista = useRef<ScrollView>(null)

  async function enviar(t: string, previos: Mensaje[] = mensajes) {
    const pregunta = t.trim()
    if (!pregunta || pensando) return
    const nuevos: Mensaje[] = [...previos, { rol: 'yo', texto: pregunta }]
    ponerMensajes(nuevos)
    setTexto('')
    ponerPensando(pregunta)
    try {
      const historial = nuevos.filter((m) => !m.error).slice(-20).map(({ rol, texto }) => ({ rol, texto }))
      const r = await apiIA.preguntar(historial, '/asistente')
      agregarMensaje({ rol: 'asistente', texto: r.texto, r })
    } catch (e) {
      agregarMensaje({ rol: 'asistente', texto: e instanceof Error ? e.message : 'No se pudo preguntar.', error: true, reintentar: pregunta })
    } finally {
      ponerPensando(null)
    }
  }

  function reintentar(i: number) {
    const m = mensajes[i]
    if (!m?.reintentar) return
    // Se quita la pregunta que fallo y su error, y se vuelve a mandar igual.
    void enviar(m.reintentar, mensajes.slice(0, i - 1))
  }

  const puedeEnviar = texto.trim().length > 0 && !pensando

  return (
    <View style={{ flex: 1, backgroundColor: t.papel }}>
      <Fondo />
      <Stack.Screen options={{ title: 'Pregúntame' }} />
      {/* El campo siempre encima del teclado. En iOS hay que descontar el
          encabezado nativo (la barra de estado mas los 44 del titulo): la
          vista mide su sitio desde el borde del encabezado, no de la pantalla. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={process.env.EXPO_OS === 'ios' ? borde.top + 44 : 0}
      >
        <ScrollView
          ref={lista}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={estilos.lista}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          // Al llegar una respuesta (o al volver con la conversacion ya
          // larga), lo ultimo queda a la vista.
          onContentSizeChange={() => mensajes.length > 0 && lista.current?.scrollToEnd({ animated: true })}
        >
          {mensajes.length === 0 ? (
            <Sugerencias alElegir={(p) => void enviar(p)} />
          ) : (
            <>
              <Pressable
                onPress={vaciarConversacion}
                disabled={!!pensando}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Empezar una conversación nueva"
                style={{ alignSelf: 'flex-end', opacity: pensando ? 0.4 : 1 }}
              >
                <Text style={[estilos.nueva, { color: t.suave }]}>Conversación nueva</Text>
              </Pressable>
              {mensajes.map((m, i) =>
                m.rol === 'yo' ? (
                  <BurbujaMia key={i} texto={m.texto} />
                ) : (
                  <BurbujaAsistente key={i} m={m} ultima={i === mensajes.length - 1} alReintentar={() => reintentar(i)} />
                ),
              )}
              {pensando ? <BurbujaPensando pregunta={pensando} /> : null}
            </>
          )}
        </ScrollView>

        {/* El campo de abajo: crece hasta cinco renglones; "enviar" en el teclado manda. */}
        <View
          style={[
            estilos.barra,
            {
              paddingBottom: 8 + borde.bottom,
              backgroundColor: t.papel,
              borderTopColor: modo === 'oscuro' ? 'rgba(255,255,255,0.06)' : t.gris200,
            },
          ]}
        >
          <View style={[estilos.campo, { backgroundColor: t.superficie, borderColor: t.gris200 }]}>
            <TextInput
              value={texto}
              onChangeText={setTexto}
              placeholder={pensando ? 'Espera la respuesta…' : 'Escribe tu pregunta'}
              placeholderTextColor={t.tenue}
              multiline
              returnKeyType="send"
              submitBehavior="blurAndSubmit"
              onSubmitEditing={() => void enviar(texto)}
              accessibilityLabel="Tu pregunta"
              style={[estilos.campoTexto, { color: t.tinta }]}
            />
            <Pressable
              onPress={() => void enviar(texto)}
              disabled={!puedeEnviar}
              accessibilityRole="button"
              accessibilityLabel="Enviar"
              style={({ pressed }) => [
                estilos.enviar,
                { backgroundColor: t.acento, opacity: !puedeEnviar ? 0.3 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] },
              ]}
            >
              {/* El chevron apunta a la derecha; girado, es la flecha hacia arriba de "enviar". */}
              <View style={{ transform: [{ rotate: '-90deg' }] }}>
                <Icono nombre="chevron" size={18} color={t.acentoTinta} grosor={2.4} />
              </View>
            </Pressable>
          </View>
          <Text style={[estilos.pie, { color: t.tenue }]}>Solo lee tus datos: no cambia nada sin preguntarte.</Text>
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}

const estilos = StyleSheet.create({
  lista: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 12 },
  nueva: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
  barra: { paddingHorizontal: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  // Las esquinas "continuas" son las de iOS; en los demas no cambian nada.
  campo: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    borderWidth: 1,
    borderRadius: 24,
    borderCurve: 'continuous',
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
  },
  campoTexto: { flex: 1, fontFamily: LETRA.texto, fontSize: 16, lineHeight: 22, maxHeight: 132, paddingVertical: 8, paddingTop: 8 },
  enviar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  pie: { fontFamily: LETRA.texto, fontSize: 12, marginTop: 6, paddingHorizontal: 6 },
})
