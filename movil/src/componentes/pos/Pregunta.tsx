import { useCallback, useRef, useState, type ReactElement } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { aNumero, sinRuido } from '../../lib/numeros'
import { LETRA, useModo, useTema } from '../../lib/tema'
import { CampoNumero, useDisposicion } from '../kit'
import { Boton, Campo } from '../ui'

/*
 * PEDIR UN DATO SUELTO, como `pedirNumero` y `pedirTexto` del dialogo de la
 * web (components/dialogo.tsx): "Cuánto cobra este envío", la referencia de
 * un pago, a nombre de quién queda la deuda. En el telefono no hay
 * `Alert.prompt` (Android no lo tiene), asi que es un cuadro propio.
 *
 * VA ARRIBA, NO ABAJO. El teclado ocupa la mitad de abajo de la pantalla: un
 * cuadro pegado abajo quedaba tapado si el sistema no lo empujaba. Arriba,
 * el campo y los botones se ven siempre.
 *
 * SE DIBUJA DENTRO DE LA HOJA QUE LO PIDE. Un cuadro encima de otro solo se
 * ve en iPhone si va dentro del primero; por eso el hook devuelve el
 * `elemento` y cada hoja lo pone entre sus hijos.
 */

type Base = { titulo: string; texto?: string; aceptar?: string }
export type PedidoNumero = Base & { etiqueta?: string; sufijo?: string; valor?: number; min?: number }
export type PedidoTexto = Base & { etiqueta?: string; placeholder?: string; valor?: string; opcional?: boolean }

type Pendiente = { id: number; resolver: (v: string | null) => void } & (
  | { tipo: 'numero'; datos: PedidoNumero }
  | { tipo: 'texto'; datos: PedidoTexto }
)
type Nuevo = Pendiente extends infer P ? (P extends Pendiente ? Omit<P, 'id'> : never) : never

export function usePregunta(): {
  elemento: ReactElement | null
  pedirNumero: (d: PedidoNumero) => Promise<number | null>
  pedirTexto: (d: PedidoTexto) => Promise<string | null>
} {
  const [pendiente, setPendiente] = useState<Pendiente | null>(null)
  // El que espera respuesta: si llega otra pregunta, la anterior se da por
  // cancelada (en vez de quedar colgada para siempre).
  const actual = useRef<Pendiente | null>(null)
  // Cada pregunta se monta de cero: la segunda no hereda lo escrito en la primera.
  const vez = useRef(0)

  const abrir = useCallback((p: Nuevo) => {
    actual.current?.resolver(null)
    vez.current += 1
    const nuevo = { ...p, id: vez.current } as Pendiente
    actual.current = nuevo
    setPendiente(nuevo)
  }, [])

  const pedirNumero = useCallback(
    (datos: PedidoNumero) =>
      new Promise<number | null>((resolver) =>
        abrir({ tipo: 'numero', datos, resolver: (v) => resolver(v === null ? null : Number(v)) }),
      ),
    [abrir],
  )
  const pedirTexto = useCallback(
    (datos: PedidoTexto) => new Promise<string | null>((resolver) => abrir({ tipo: 'texto', datos, resolver })),
    [abrir],
  )

  const responder = useCallback((v: string | null) => {
    const p = actual.current
    actual.current = null
    setPendiente(null)
    p?.resolver(v)
  }, [])

  const elemento = pendiente ? <CuadroPregunta key={pendiente.id} pendiente={pendiente} alResponder={responder} /> : null
  return { elemento, pedirNumero, pedirTexto }
}

function CuadroPregunta({ pendiente, alResponder }: { pendiente: Pendiente; alResponder: (v: string | null) => void }) {
  const t = useTema()
  const { modo } = useModo()
  const borde = useSafeAreaInsets()
  const { ancho } = useDisposicion()
  const { datos } = pendiente
  const inicial =
    pendiente.tipo === 'numero'
      ? pendiente.datos.valor == null
        ? ''
        : sinRuido(pendiente.datos.valor)
      : (pendiente.datos.valor ?? '')
  const [valor, setValor] = useState(inicial)
  const [error, setError] = useState('')

  // Las mismas validaciones del formulario de la web, con sus palabras.
  function aceptar() {
    const crudo = valor.trim()
    if (crudo === '') {
      if (pendiente.tipo === 'texto' && pendiente.datos.opcional) {
        alResponder('')
        return
      }
      setError('Falta este dato')
      return
    }
    if (pendiente.tipo === 'numero') {
      const n = aNumero(crudo)
      if (!Number.isFinite(n)) {
        setError('Tiene que ser un número')
        return
      }
      const min = pendiente.datos.min ?? 0
      if (n < min) {
        setError(min === 0 ? 'No puede ser negativo' : `Mínimo ${sinRuido(min)}`)
        return
      }
      alResponder(sinRuido(n))
      return
    }
    alResponder(crudo)
  }

  const etiqueta = datos.etiqueta ?? (pendiente.tipo === 'numero' ? 'Cantidad' : 'Detalle')

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => alResponder(null)} statusBarTranslucent>
      <Pressable style={estilos.fondo} onPress={() => alResponder(null)} accessibilityLabel="Cancelar" />
      <View pointerEvents="box-none" style={[estilos.capa, { paddingTop: borde.top + 56 }]}>
        <View
          style={[
            estilos.cuadro,
            {
              width: Math.min(ancho - 32, 440),
              backgroundColor: t.superficie,
              borderColor: modo === 'oscuro' ? 'rgba(255,255,255,0.06)' : t.linea,
            },
          ]}
        >
          <Text style={[estilos.titulo, { color: t.tinta }]}>{datos.titulo}</Text>
          {datos.texto ? <Text style={[estilos.texto, { color: t.suave }]}>{datos.texto}</Text> : null}
          {pendiente.tipo === 'numero' ? (
            <CampoNumero
              rotulo={etiqueta}
              valor={valor}
              alCambiar={(v) => {
                setValor(v)
                if (error) setError('')
              }}
              sufijo={pendiente.datos.sufijo}
              error={error || undefined}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={aceptar}
            />
          ) : (
            <Campo
              rotulo={etiqueta}
              value={valor}
              onChangeText={(v) => {
                setValor(v)
                if (error) setError('')
              }}
              placeholder={pendiente.datos.placeholder}
              error={error || undefined}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={aceptar}
            />
          )}
          <View style={estilos.botones}>
            <View style={{ flex: 1 }}>
              <Boton texto="Cancelar" tono="neutro" alTocar={() => alResponder(null)} />
            </View>
            <View style={{ flex: 1 }}>
              <Boton texto={datos.aceptar ?? 'Aceptar'} alTocar={aceptar} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const estilos = StyleSheet.create({
  fondo: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(14,16,20,0.42)' },
  capa: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center' },
  cuadro: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
    gap: 14,
    shadowColor: '#17181b',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  titulo: { fontFamily: LETRA.tituloFuerte, fontSize: 19, letterSpacing: -0.3 },
  texto: { fontFamily: LETRA.texto, fontSize: 14, lineHeight: 20, marginTop: -6 },
  botones: { flexDirection: 'row', gap: 10, marginTop: 2 },
})
