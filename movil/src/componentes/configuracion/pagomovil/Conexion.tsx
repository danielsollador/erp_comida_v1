import { useState } from 'react'
import { Alert, Text, View } from 'react-native'
import { apiPagos } from '../../../lib/api-pagos'
import { LETRA, useTema } from '../../../lib/tema'
import type { ConfigPabilo } from '../../../lib/tipos'
import { Boton, Campo, Ficha, Nota } from '../../ui'
import { BotonTexto, Cabecera, Dato, mensajeDe } from './comun'

/**
 * La conexion con el verificador (SOLO VERTIGO): la clave de Pabilo, la
 * cuenta de la plataforma, los creditos y el plan. El dueño del local no ve
 * esta losa; para el la verificacion "simplemente esta".
 *
 * La clave se escribe, viaja una vez y se borra del campo: la pantalla solo
 * muestra la pista que devuelve el servidor (los ultimos cuatro).
 */
export default function Conexion({
  config,
  alGuardar,
  alFallar,
}: {
  config: ConfigPabilo | null
  alGuardar: (c: ConfigPabilo, texto: string) => void
  alFallar: (t: string) => void
}) {
  const t = useTema()
  const [editando, setEditando] = useState(false)
  const [clave, setClave] = useState('')
  const [guardando, setGuardando] = useState(false)
  const configurado = Boolean(config?.configurado)
  const perfil = config?.perfil ?? null

  async function guardar() {
    const limpia = clave.trim()
    if (!limpia || guardando) return
    setGuardando(true)
    // Se borra del campo YA, salga bien o mal: el secreto no se queda en
    // pantalla esperando. Si Pabilo no la reconoce, se vuelve a pegar.
    setClave('')
    try {
      const nuevo = await apiPagos.guardarClavePabilo(limpia)
      setEditando(false)
      alGuardar(nuevo, 'Clave guardada: Pabilo la reconoció.')
    } catch (e) {
      alFallar(mensajeDe(e, 'No se pudo guardar la clave.'))
    } finally {
      setGuardando(false)
    }
  }

  async function quitar() {
    setGuardando(true)
    try {
      const nuevo = await apiPagos.guardarClavePabilo('')
      alGuardar(
        nuevo,
        nuevo.configurado ? 'Se quitó la clave guardada; vale la del servidor.' : 'Clave quitada. El mostrador cobra sin verificar.',
      )
    } catch (e) {
      alFallar(mensajeDe(e, 'No se pudo quitar la clave.'))
    } finally {
      setGuardando(false)
    }
  }

  // En la web "Quitar" va directo; en el telefono un toque errado apaga la
  // verificacion de todo el local, asi que se pregunta antes.
  function confirmarQuitar() {
    Alert.alert('¿Quitar la clave de Pabilo?', 'Si no hay otra puesta en el servidor, el mostrador cobra sin verificar.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Quitar', style: 'destructive', onPress: () => void quitar() },
    ])
  }

  function cancelar() {
    setClave('')
    setEditando(false)
  }

  return (
    <Ficha>
      <Cabecera
        titulo="Integración con Pabilo"
        ayuda="Solo Vertigo ve esto. Pabilo (pabilo.app) tiene las cuentas del banco conectadas y responde si un pago entró, cuánto fue y si ya se usó. Cada consulta nueva gasta un crédito."
      />

      {configurado && !editando ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <Dato titulo="Cuenta de Pabilo" valor={perfil?.empresa || perfil?.usuario || '—'} />
            <Dato
              titulo="Créditos"
              valor={perfil?.creditos == null ? '—' : String(perfil.creditos)}
              ojo={perfil?.creditos != null && perfil.creditos < 10}
            />
            <Dato titulo="Plan" valor={perfil ? (perfil.plan_activo ? 'Activo' : 'Vencido') : '—'} ojo={perfil ? !perfil.plan_activo : false} />
            <Dato
              titulo="Clave"
              valor={config?.clave_pista || '••••'}
              ayuda={config?.origen_clave === 'servidor' ? 'Puesta en el servidor' : 'Guardada aquí'}
            />
          </View>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
            <BotonTexto texto="Cambiar clave" alTocar={() => setEditando(true)} />
            {config?.origen_clave === 'pantalla' && (
              <BotonTexto texto="Quitar" tono="peligro" alTocar={confirmarQuitar} deshabilitado={guardando} />
            )}
          </View>
        </>
      ) : (
        <View style={{ gap: 14 }}>
          <Nota>
            Entra a{' '}
            <Text style={{ fontFamily: LETRA.textoFuerte, color: t.tinta }}>pabilo.app → Integraciones → API Keys</Text>,
            genera una clave para este local y pégala aquí. Se prueba antes de guardarse: una clave mal copiada no se queda
            puesta.
          </Nota>
          <Campo
            rotulo="Clave de Pabilo (API key)"
            value={clave}
            onChangeText={setClave}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="off"
            importantForAutofill="no"
            textContentType="none"
            autoFocus={editando}
            returnKeyType="done"
            onSubmitEditing={() => void guardar()}
          />
          <Boton
            texto={guardando ? 'Probando…' : 'Guardar y probar'}
            alTocar={() => void guardar()}
            ocupado={guardando}
            deshabilitado={!clave.trim()}
          />
          {editando && <Boton texto="Cancelar" tono="neutro" alTocar={cancelar} />}
        </View>
      )}
    </Ficha>
  )
}
