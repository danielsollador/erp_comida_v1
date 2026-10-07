import { useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { BotonTema } from '../componentes/Encabezado'
import Fondo from '../componentes/Fondo'
import { Boton } from '../componentes/ui'
import { API_BASE, ErrorApi } from '../lib/api'
import { useSesion } from '../lib/sesion'
import { LETRA, useTema } from '../lib/tema'

/**
 * La puerta. Los mismos usuarios y claves de la web: es el mismo backend.
 * Abajo, en letra chica, a que servidor se esta entrando: mientras la app se
 * arma es el de PRUEBA, y eso tiene que verse.
 */
export default function Entrar() {
  const t = useTema()
  const { entrar } = useSesion()
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const campoClave = useRef<TextInput>(null)
  const borde = useSafeAreaInsets()

  async function enviar() {
    if (!usuario.trim() || !clave) {
      setError('Escribe tu usuario y tu contraseña.')
      return
    }
    setError('')
    setOcupado(true)
    try {
      await entrar(usuario, clave)
    } catch (e) {
      const mensaje = e instanceof ErrorApi ? e.message : 'No se pudo entrar.'
      setError(mensaje)
      setClave('')
    } finally {
      setOcupado(false)
    }
  }

  const servidor = API_BASE.replace(/^https?:\/\//, '')
  const esPrueba = servidor.startsWith('prueba.')

  const campo = [estilos.campo, { backgroundColor: t.superficie, borderColor: t.linea, color: t.tinta }]

  return (
    <View style={{ flex: 1, backgroundColor: t.papel }}>
    <Fondo />
    <SafeAreaView style={{ flex: 1 }}>
      {/* El tema, arriba a la derecha, como en el login de la web. */}
      <View style={[estilos.esquina, { top: borde.top + 8 }]}>
        <BotonTema />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
          <View style={estilos.marca}>
            <View style={[estilos.rombo, { backgroundColor: t.acento }]} />
            <Text style={[estilos.marcaTexto, { color: t.suave }]}>VERTIGO PRO</Text>
          </View>

          <Text style={[estilos.titulo, { color: t.tinta }]}>Entrar</Text>
          <Text style={[estilos.sub, { color: t.suave }]}>Con el mismo usuario y clave del sistema.</Text>

          {!!error && (
            <View style={[estilos.error, { backgroundColor: t.peligroSuave }]}>
              <Text style={[estilos.errorTexto, { color: t.peligro }]}>{error}</Text>
            </View>
          )}

          <Text style={[estilos.rotulo, { color: t.suave }]}>Usuario</Text>
          <TextInput
            value={usuario}
            onChangeText={setUsuario}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
            onSubmitEditing={() => campoClave.current?.focus()}
            style={campo}
            placeholderTextColor={t.tenue}
          />

          <Text style={[estilos.rotulo, { color: t.suave }]}>Contraseña</Text>
          <TextInput
            ref={campoClave}
            value={clave}
            onChangeText={setClave}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={enviar}
            style={campo}
            placeholderTextColor={t.tenue}
          />

          <View style={{ marginTop: 8 }}>
            <Boton texto="Entrar" alTocar={enviar} ocupado={ocupado} />
          </View>

          <Text style={[estilos.pie, { color: esPrueba ? t.aviso : t.tenue }]}>
            {esPrueba ? `Servidor de prueba · ${servidor} · nada aquí toca las ventas reales` : servidor}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </View>
  )
}

const estilos = StyleSheet.create({
  esquina: { position: 'absolute', right: 16, zIndex: 2 },
  contenido: { flexGrow: 1, justifyContent: 'center', padding: 28, maxWidth: 460, width: '100%', alignSelf: 'center' },
  marca: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 28 },
  rombo: { width: 10, height: 10, borderRadius: 3, transform: [{ rotate: '45deg' }] },
  marcaTexto: { fontFamily: LETRA.textoFuerte, fontSize: 12, letterSpacing: 1.6 },
  titulo: { fontFamily: LETRA.tituloFuerte, fontSize: 32, letterSpacing: -0.8 },
  sub: { fontFamily: LETRA.texto, fontSize: 15, marginTop: 6, marginBottom: 26 },
  error: { borderRadius: 14, padding: 12, marginBottom: 18 },
  errorTexto: { fontFamily: LETRA.texto, fontSize: 14, lineHeight: 20 },
  rotulo: { fontFamily: LETRA.textoFuerte, fontSize: 13.5, marginBottom: 7 },
  campo: {
    fontFamily: LETRA.texto,
    fontSize: 16,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 15,
    paddingVertical: 13,
    marginBottom: 16,
  },
  pie: { fontFamily: LETRA.texto, fontSize: 12.5, textAlign: 'center', marginTop: 22, lineHeight: 18 },
})
