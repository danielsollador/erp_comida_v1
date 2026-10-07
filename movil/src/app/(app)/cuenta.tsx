import Constants from 'expo-constants'
import { useState } from 'react'
import { Alert, View } from 'react-native'
import { Boton, Etiqueta, Ficha, Fila, Nota, Pantalla, Titulo } from '../../componentes/ui'
import { API_BASE } from '../../lib/api'
import { useSesion } from '../../lib/sesion'
import { useTema } from '../../lib/tema'

/** Quien esta dentro, en que local y contra que servidor; y la salida. */
export default function Cuenta() {
  const t = useTema()
  const { acceso, salir } = useSesion()
  const [saliendo, setSaliendo] = useState(false)
  const servidor = API_BASE.replace(/^https?:\/\//, '')
  const nombre = [acceso?.nombre, acceso?.apellido].filter(Boolean).join(' ') || acceso?.nombre_visible || acceso?.usuario || ''

  function confirmarSalida() {
    Alert.alert('¿Salir de la cuenta?', 'Para volver a entrar te pedirá tu usuario y contraseña.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Salir',
        style: 'destructive',
        onPress: async () => {
          setSaliendo(true)
          await salir()
        },
      },
    ])
  }

  return (
    <Pantalla>
      <View style={{ marginTop: 6, marginBottom: 4 }}>
        <Etiqueta>Cuenta</Etiqueta>
        <Titulo>{nombre}</Titulo>
      </View>

      <Ficha>
        <Fila nombre="Usuario" valor={acceso?.usuario ?? '—'} texto />
        <Fila nombre="Rol" valor={acceso?.rol ?? '—'} texto />
        <Fila nombre="Local" valor={acceso?.local.nombre || '—'} ultima texto />
      </Ficha>

      <Ficha tono={servidor.startsWith('prueba.') ? 'aviso' : undefined}>
        <Etiqueta>Servidor</Etiqueta>
        <Nota style={{ marginTop: 6, color: t.tinta }}>{servidor}</Nota>
        {servidor.startsWith('prueba.') && (
          <Nota style={{ marginTop: 4, color: t.aviso }}>
            Es el servidor de PRUEBA, con una copia de los datos: nada de lo que hagas aquí toca las ventas reales.
          </Nota>
        )}
        <Nota style={{ marginTop: 10 }}>Versión de la app {Constants.expoConfig?.version ?? '—'}</Nota>
      </Ficha>

      <View style={{ marginTop: 8 }}>
        <Boton texto="Salir" icono="log-out" tono="neutro" alTocar={confirmarSalida} ocupado={saliendo} />
      </View>
    </Pantalla>
  )
}
