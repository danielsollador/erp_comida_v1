import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { apiVentas } from '../../lib/api-ventas'
import { LETRA, useTema } from '../../lib/tema'
import type { Autorizacion, SolicitudAutorizacion } from '../../lib/tipos'
import { useEnVivo } from '../cocina/enVivo'
import { Boton, Nota, Pestanas } from '../ui'

/**
 * La firma de alguien autorizado, de dos formas, como components/Autorizar.tsx
 * de la web:
 *
 *   Con PIN         quien autoriza esta al lado y teclea sus 4 a 6 numeros.
 *   Pedir permiso   no esta en el local: le llega la solicitud a su aplicacion
 *                   y aprueba desde alli. Esto se queda esperando la respuesta
 *                   por el canal en vivo, y pregunta cada 4 s por si el canal
 *                   se durmio.
 *
 * Lo que sale (`alCambiar`) va junto con la operacion; el servidor lo vuelve
 * a comprobar. Si se cierra con una solicitud en el aire, se cancela: que al
 * dueño no le quede un aviso de algo que ya nadie espera.
 */
export default function Autorizar({
  accion,
  detalle,
  monto,
  pedidoId,
  alCambiar,
}: {
  accion: string
  detalle: string
  monto: number
  pedidoId?: number
  alCambiar: (a: Autorizacion | null) => void
}) {
  const t = useTema()
  const [modo, setModo] = useState<'pin' | 'remoto'>('pin')
  const [pin, setPin] = useState('')
  const [solicitud, setSolicitud] = useState<SolicitudAutorizacion | null>(null)
  const [conectados, setConectados] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [pidiendo, setPidiendo] = useState(false)
  const solicitudRef = useRef<SolicitudAutorizacion | null>(null)
  const alCambiarRef = useRef(alCambiar)
  useEffect(() => {
    solicitudRef.current = solicitud
    alCambiarRef.current = alCambiar
  })

  const esperando = solicitud?.estado === 'pendiente'

  function recibir(s: SolicitudAutorizacion) {
    setSolicitud(s)
    alCambiarRef.current(s.estado === 'aprobada' ? { solicitud_id: s.id } : null)
  }

  useEnVivo((evt) => {
    const s = evt.data as SolicitudAutorizacion
    if (evt.event === 'autorizacion_resuelta' && s && s.id === solicitudRef.current?.id) recibir(s)
  }, esperando)

  useEffect(() => {
    if (!esperando || !solicitud) return
    const id = setInterval(() => {
      apiVentas.verSolicitud(solicitud.id).then(recibir).catch(() => undefined)
    }, 4000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esperando, solicitud?.id])

  useEffect(
    () => () => {
      const s = solicitudRef.current
      if (s && s.estado === 'pendiente') apiVentas.cancelarSolicitud(s.id).catch(() => undefined)
    },
    [],
  )

  function cambiarPin(v: string) {
    const limpio = v.replace(/\D/g, '').slice(0, 6)
    setPin(limpio)
    // El PIN sale hacia afuera en cuanto tiene largo de PIN.
    alCambiar(/^\d{4,6}$/.test(limpio) ? { pin: limpio } : null)
  }

  function cambiarModo(m: 'pin' | 'remoto') {
    setModo(m)
    setError('')
    if (m === 'remoto') apiVentas.autorizantesConectados().then((d) => setConectados(d.autorizantes)).catch(() => setConectados(null))
    alCambiar(
      m === 'pin' && /^\d{4,6}$/.test(pin)
        ? { pin }
        : m === 'remoto' && solicitud?.estado === 'aprobada'
          ? { solicitud_id: solicitud.id }
          : null,
    )
  }

  async function pedir() {
    setError('')
    setPidiendo(true)
    try {
      const s = await apiVentas.solicitar({ accion, detalle, monto, pedido_id: pedidoId })
      setSolicitud(s)
      alCambiar(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo pedir')
    } finally {
      setPidiendo(false)
    }
  }

  async function cancelar() {
    if (solicitud) await apiVentas.cancelarSolicitud(solicitud.id).catch(() => undefined)
    setSolicitud(null)
    alCambiar(null)
  }

  const reintentar = (texto: string) => (
    <Pressable onPress={() => setSolicitud(null)} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
      <Text style={[e.enlace, { color: t.tinta }]}>{texto}</Text>
    </Pressable>
  )

  return (
    <View style={{ gap: 10 }}>
      <Pestanas
        opciones={[
          { id: 'pin', texto: 'Con PIN' },
          { id: 'remoto', texto: 'Pedir permiso' },
        ]}
        valor={modo}
        alCambiar={cambiarModo}
      />

      {modo === 'pin' ? (
        <View style={{ gap: 6 }}>
          <Text style={[e.rotulo, { color: t.suave }]}>PIN DE QUIEN AUTORIZA</Text>
          <TextInput
            value={pin}
            onChangeText={cambiarPin}
            secureTextEntry
            keyboardType="number-pad"
            maxLength={6}
            placeholder="••••"
            placeholderTextColor={t.tenue}
            accessibilityLabel="PIN"
            style={[e.pin, { color: t.tinta, borderColor: t.gris200, backgroundColor: t.superficie }]}
          />
          <Nota style={{ color: t.tenue }}>Solo quien tiene un rol que autoriza tiene PIN. Si no está en el local, usa «Pedir permiso».</Nota>
        </View>
      ) : null}

      {modo === 'remoto' && !solicitud ? (
        <View style={{ gap: 8 }}>
          <Nota>Se le avisa a quien puede autorizar y aprueba desde su aplicación, esté donde esté.</Nota>
          {conectados !== null ? (
            <Nota style={{ color: conectados > 0 ? t.exito : t.aviso }}>
              {conectados > 0
                ? `${conectados} persona(s) que autorizan tienen la aplicación abierta ahora.`
                : 'Nadie que autorice tiene la aplicación abierta ahora: lo verá cuando la abra.'}
            </Nota>
          ) : null}
          <Boton texto={pidiendo ? 'Enviando…' : 'Enviar solicitud'} tono="neutro" ocupado={pidiendo} alTocar={() => void pedir()} />
        </View>
      ) : null}

      {modo === 'remoto' && solicitud ? (
        <View
          style={[
            e.estado,
            {
              backgroundColor:
                solicitud.estado === 'aprobada' ? t.exitoSuave : solicitud.estado === 'pendiente' ? t.gris100 : t.peligroSuave,
            },
          ]}
        >
          {solicitud.estado === 'pendiente' ? (
            <View style={e.fila}>
              <ActivityIndicator color={t.suave} />
              <Text style={[e.texto, { color: t.fuerte }]}>Solicitud #{solicitud.id} enviada. Esperando respuesta…</Text>
              <Pressable onPress={() => void cancelar()} hitSlop={8}>
                <Text style={[e.enlace, { color: t.fuerte }]}>Cancelar</Text>
              </Pressable>
            </View>
          ) : null}
          {solicitud.estado === 'aprobada' ? (
            <Text style={[e.texto, { color: t.exito }]}>Aprobado por {solicitud.resuelta_por}. Ya puedes guardar.</Text>
          ) : null}
          {solicitud.estado === 'rechazada' ? (
            <>
              <Text style={[e.texto, { color: t.peligro }]}>{solicitud.resuelta_por} no lo autorizó.</Text>
              {reintentar('Pedir de nuevo')}
            </>
          ) : null}
          {solicitud.estado === 'vencida' || solicitud.estado === 'cancelada' || solicitud.estado === 'usada' ? (
            <>
              <Text style={[e.texto, { color: t.peligro }]}>La solicitud ya no sirve ({solicitud.estado}).</Text>
              {reintentar('Pedir otra')}
            </>
          ) : null}
        </View>
      ) : null}

      {error ? <Nota style={{ color: t.peligro }}>{error}</Nota> : null}
    </View>
  )
}

const e = StyleSheet.create({
  rotulo: { fontFamily: LETRA.textoFuerte, fontSize: 11, letterSpacing: 1.2 },
  pin: {
    fontFamily: LETRA.cifraFuerte,
    fontSize: 26,
    letterSpacing: 10,
    textAlign: 'center',
    borderWidth: 1,
    borderRadius: 14, borderCurve: 'continuous',
    paddingVertical: 10,
  },
  estado: { borderRadius: 14, borderCurve: 'continuous', padding: 12, gap: 4 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  texto: { flex: 1, fontFamily: LETRA.texto, fontSize: 14, lineHeight: 19 },
  enlace: { fontFamily: LETRA.textoFuerte, fontSize: 14, textDecorationLine: 'underline' },
})
