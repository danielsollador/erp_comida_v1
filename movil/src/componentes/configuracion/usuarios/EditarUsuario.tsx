import { useState } from 'react'
import { Alert, View } from 'react-native'
import { apiUsuarios } from '../../../lib/api-usuarios'
import type { Usuario } from '../../../lib/tipos'
import { Aviso, Boton, Campo, Ficha, Nota } from '../../ui'
import { Encabezado, Enlace, Volver } from './piezas'

/**
 * La ficha de una persona: su nombre, su contraseña y su PIN. En la web es
 * una ventana flotante; en el telefono es una vista en su lugar, con su
 * "Volver", porque una ventana con teclado abierto no deja ver que se escribe.
 */
export default function EditarUsuario({
  u,
  autoriza,
  error,
  alVolver,
  alCambio,
  alError,
}: {
  u: Usuario
  /** Si su rol autoriza: solo entonces se le ofrece PIN. */
  autoriza: boolean
  error: string
  alVolver: () => void
  alCambio: (texto: string) => void
  alError: (texto: string) => void
}) {
  const [nombre, setNombre] = useState(u.nombre)
  const [apellido, setApellido] = useState(u.apellido)
  const [clave, setClave] = useState('')
  const [pin, setPin] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    setGuardando(true)
    const hecho: string[] = []
    try {
      if (nombre !== u.nombre || apellido !== u.apellido) {
        await apiUsuarios.cambiarNombre(u.usuario, nombre, apellido)
        hecho.push('nombre')
      }
      if (clave) {
        await apiUsuarios.reiniciarClave(u.usuario, clave)
        hecho.push('contraseña (tendrá que entrar de nuevo)')
      }
      if (pin) {
        await apiUsuarios.ponerPin(u.usuario, pin)
        hecho.push('PIN')
      }
      alCambio(hecho.length ? `${nombre || u.usuario}: ${hecho.join(', ')} actualizado.` : 'Sin cambios.')
    } catch (err) {
      alError((err as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  function quitarPin() {
    Alert.alert(
      `¿Quitarle el PIN a ${nombre || u.usuario}?`,
      'Deja de poder autorizar con PIN en el mostrador; desde su aplicación sigue pudiendo.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Quitar PIN',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiUsuarios.quitarPin(u.usuario)
              alCambio(`PIN de ${nombre || u.usuario} quitado.`)
            } catch (err) {
              alError((err as Error).message)
            }
          },
        },
      ],
    )
  }

  return (
    <>
      <Volver texto="Volver a la lista" alTocar={alVolver} />
      <Ficha style={{ gap: 16 }}>
        <Encabezado titulo={`Editar a ${u.nombre || u.usuario}`} ayuda={`@${u.usuario} · ${u.rol_nombre || u.rol}`} />
        <Campo rotulo="Nombre" value={nombre} onChangeText={setNombre} autoCapitalize="words" />
        <Campo rotulo="Apellido" value={apellido} onChangeText={setApellido} autoCapitalize="words" />
        <Campo
          rotulo="Nueva contraseña"
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Déjalo vacío para no cambiarla"
          value={clave}
          onChangeText={setClave}
          ayuda="8 caracteres como mínimo. Cambiarla cierra sus sesiones abiertas."
        />
        {autoriza ? (
          <View>
            <Campo
              rotulo={u.tiene_pin ? 'Nuevo PIN' : 'PIN'}
              secureTextEntry
              keyboardType="number-pad"
              maxLength={6}
              autoComplete="off"
              placeholder={u.tiene_pin ? 'Déjalo vacío para no cambiarlo' : '4 a 6 números'}
              value={pin}
              onChangeText={(v) => setPin(v.replace(/\D/g, ''))}
              ayuda="Con el PIN autoriza en el mostrador sin escribir usuario ni contraseña. No puede repetirse entre personas."
            />
            {u.tiene_pin && (
              <View style={{ alignSelf: 'flex-start' }}>
                <Enlace texto="Quitarle el PIN" tono="peligro" alTocar={quitarPin} />
              </View>
            )}
          </View>
        ) : (
          <Nota>Su rol no autoriza operaciones, así que no lleva PIN. Si debe autorizar, márcalo en la pestaña Roles.</Nota>
        )}

        {/* El error va junto al boton: arriba, con el teclado abierto, no se ve. */}
        {error ? <Aviso texto={error} tono="peligro" /> : null}
        <View style={{ gap: 10 }}>
          <Boton texto={guardando ? 'Guardando…' : 'Guardar'} alTocar={() => void guardar()} deshabilitado={guardando} />
          <Boton texto="Cancelar" tono="neutro" alTocar={alVolver} />
        </View>
      </Ficha>
    </>
  )
}
