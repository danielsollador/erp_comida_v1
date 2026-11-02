import { BottomSheet, RNHostView } from '@expo/ui'
import { imePadding } from '@expo/ui/jetpack-compose/modifiers'
import { useCallback, useRef, useState, type ReactElement } from 'react'
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { aNumero, sinRuido } from '../../lib/numeros'
import { LETRA, useModo, useTema } from '../../lib/tema'
import { CampoNumero, useDisposicion } from '../kit'
import { Boton, Campo, sombraLosa } from '../ui'

/*
 * PEDIR UN DATO SUELTO, como `pedirNumero` y `pedirTexto` del dialogo de la
 * web (components/dialogo.tsx): "Cuánto cobra este envío", la referencia de
 * un pago, a nombre de quién queda la deuda.
 *
 * En iOS es `Alert.prompt`: el cuadro del sistema con su campo, que el
 * propio iOS mantiene sobre el teclado y encima de cualquier hoja. Android no
 * lo tiene, asi que ahi es la hoja nativa de @expo/ui, que se aparta del
 * teclado con `imePadding`. En la web, el cuadro propio de siempre, arriba
 * de la pantalla para que el teclado no lo tape.
 *
 * SE DIBUJA DENTRO DE LA HOJA QUE LO PIDE. Un cuadro encima de otro solo se
 * ve si va dentro del primero; por eso el hook devuelve el `elemento` y cada
 * hoja lo pone entre sus hijos (en iOS el elemento es null: el aviso del
 * sistema no necesita sitio).
 */

type Base = { titulo: string; texto?: string; aceptar?: string }
export type PedidoNumero = Base & { etiqueta?: string; sufijo?: string; valor?: number; min?: number }
export type PedidoTexto = Base & { etiqueta?: string; placeholder?: string; valor?: string; opcional?: boolean }

type Pendiente = { id: number; resolver: (v: string | null) => void } & (
  | { tipo: 'numero'; datos: PedidoNumero }
  | { tipo: 'texto'; datos: PedidoTexto }
)
type Nuevo = Pendiente extends infer P ? (P extends Pendiente ? Omit<P, 'id'> : never) : never

/** Las mismas validaciones del formulario de la web, con sus palabras. */
function validar(p: Nuevo, crudo: string): { ok: true; valor: string } | { ok: false; error: string } {
  if (crudo === '') {
    if (p.tipo === 'texto' && p.datos.opcional) return { ok: true, valor: '' }
    return { ok: false, error: 'Falta este dato' }
  }
  if (p.tipo === 'numero') {
    const n = aNumero(crudo)
    if (!Number.isFinite(n)) return { ok: false, error: 'Tiene que ser un número' }
    const min = p.datos.min ?? 0
    if (n < min) return { ok: false, error: min === 0 ? 'No puede ser negativo' : `Mínimo ${sinRuido(min)}` }
    return { ok: true, valor: sinRuido(n) }
  }
  return { ok: true, valor: crudo }
}

function valorInicial(p: Nuevo): string {
  return p.tipo === 'numero' ? (p.datos.valor == null ? '' : sinRuido(p.datos.valor)) : (p.datos.valor ?? '')
}

/**
 * iOS: el aviso del sistema. Si lo escrito no vale, se vuelve a abrir con el
 * error como mensaje y lo escrito como valor, hasta que valga o se cancele.
 */
function preguntarEnAlerta(p: Nuevo, mensaje: string | undefined, valor: string) {
  Alert.prompt(
    p.datos.titulo,
    mensaje,
    [
      { text: 'Cancelar', style: 'cancel', onPress: () => p.resolver(null) },
      {
        text: p.datos.aceptar ?? 'Aceptar',
        onPress: (escrito?: string) => {
          const crudo = (escrito ?? '').trim()
          const r = validar(p, crudo)
          if (r.ok) p.resolver(r.valor)
          else preguntarEnAlerta(p, r.error, crudo)
        },
      },
    ],
    'plain-text',
    valor,
    p.tipo === 'numero' ? 'decimal-pad' : 'default',
  )
}

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
    if (process.env.EXPO_OS === 'ios') {
      preguntarEnAlerta(nuevo, nuevo.datos.texto, valorInicial(nuevo))
      return
    }
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

  const elemento = pendiente ? (
    process.env.EXPO_OS === 'web' ? (
      <CuadroWeb key={pendiente.id} pendiente={pendiente} alResponder={responder} />
    ) : (
      <HojaPregunta key={pendiente.id} pendiente={pendiente} alResponder={responder} />
    )
  ) : null
  return { elemento, pedirNumero, pedirTexto }
}

/** El campo y los dos botones, iguales en la hoja y en el cuadro. */
function Formulario({ pendiente, alResponder }: { pendiente: Pendiente; alResponder: (v: string | null) => void }) {
  const t = useTema()
  const { datos } = pendiente
  const [valor, setValor] = useState(valorInicial(pendiente))
  const [error, setError] = useState('')

  function aceptar() {
    const r = validar(pendiente, valor.trim())
    if (r.ok) alResponder(r.valor)
    else setError(r.error)
  }
  const escribir = (v: string) => {
    setValor(v)
    if (error) setError('')
  }
  const etiqueta = datos.etiqueta ?? (pendiente.tipo === 'numero' ? 'Cantidad' : 'Detalle')

  return (
    <>
      <Text style={[estilos.titulo, { color: t.tinta }]}>{datos.titulo}</Text>
      {datos.texto ? <Text style={[estilos.texto, { color: t.suave }]}>{datos.texto}</Text> : null}
      {pendiente.tipo === 'numero' ? (
        <CampoNumero
          rotulo={etiqueta}
          valor={valor}
          alCambiar={escribir}
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
          onChangeText={escribir}
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
    </>
  )
}

/** Android: la hoja nativa, que sube con el teclado. */
function HojaPregunta({ pendiente, alResponder }: { pendiente: Pendiente; alResponder: (v: string | null) => void }) {
  const t = useTema()
  return (
    <BottomSheet
      isPresented
      onDismiss={() => alResponder(null)}
      containerColor={t.superficie}
      contentPadding={{ top: 8, bottom: 20, left: 20, right: 20 }}
      modifiers={process.env.EXPO_OS === 'android' ? [imePadding()] : undefined}
    >
      <RNHostView matchContents={{ vertical: true }}>
        <View style={{ gap: 14 }}>
          <Formulario pendiente={pendiente} alResponder={alResponder} />
        </View>
      </RNHostView>
    </BottomSheet>
  )
}

/**
 * Web: el cuadro propio. VA ARRIBA, NO ABAJO: el teclado ocupa la mitad de
 * abajo de la pantalla y un cuadro pegado abajo quedaba tapado.
 */
function CuadroWeb({ pendiente, alResponder }: { pendiente: Pendiente; alResponder: (v: string | null) => void }) {
  const t = useTema()
  const { modo } = useModo()
  const borde = useSafeAreaInsets()
  const { ancho } = useDisposicion()
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
              boxShadow: sombraLosa(modo, t.sombra),
            },
          ]}
        >
          <Formulario pendiente={pendiente} alResponder={alResponder} />
        </View>
      </View>
    </Modal>
  )
}

const estilos = StyleSheet.create({
  fondo: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(14,16,20,0.42)' },
  capa: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center' },
  cuadro: { borderRadius: 24, borderCurve: 'continuous', borderWidth: 1, padding: 20, gap: 14 },
  titulo: { fontFamily: LETRA.tituloFuerte, fontSize: 19, letterSpacing: -0.3 },
  texto: { fontFamily: LETRA.texto, fontSize: 14, lineHeight: 20, marginTop: -6 },
  botones: { flexDirection: 'row', gap: 10, marginTop: 2 },
})
