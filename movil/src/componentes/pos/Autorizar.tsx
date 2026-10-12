import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { apiPos } from '../../lib/api-pos'
import { escucharEnVivo } from '../../lib/pos'
import { LETRA, useTema } from '../../lib/tema'
import type { Autorizacion, SolicitudAutorizacion } from '../../lib/tipos'
import { Boton, Campo, Pestanas } from '../ui'
import { BotonChico } from './piezas'

/*
 * LA FIRMA DE ALGUIEN AUTORIZADO (components/Autorizar.tsx de la web), de
 * dos formas:
 *
 *   CON PIN         quien autoriza esta al lado: teclea sus cuatro a seis
 *                   numeros y listo. El PIN lo identifica solo.
 *   PEDIR PERMISO   quien autoriza no esta en el local: le llega la
 *                   solicitud a su aplicacion (la campana) y aprueba desde
 *                   alli. Esta pantalla se queda esperando la respuesta.
 *
 * Lo que sale (`alCambiar`) viaja junto con la operacion; el servidor lo
 * vuelve a comprobar.
 */
export function Autorizar({
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
  // Lo ultimo, para los avisos que llegan por el canal y para soltar la
  // solicitud si el cuadro se cierra con ella en el aire.
  const solicitudRef = useRef<SolicitudAutorizacion | null>(null)
  const alCambiarRef = useRef(alCambiar)
  useEffect(() => {
    solicitudRef.current = solicitud
    alCambiarRef.current = alCambiar
  })

  const recibir = useCallback((s: SolicitudAutorizacion) => {
    setSolicitud(s)
    alCambiarRef.current(s.estado === 'aprobada' ? { solicitud_id: s.id } : null)
  }, [])

  // La respuesta llega por el canal en vivo; y por si el canal se durmio, se
  // pregunta cada cuatro segundos mientras haya una solicitud pendiente.
  const pendienteId = solicitud?.estado === 'pendiente' ? solicitud.id : null
  useEffect(() => {
    if (pendienteId === null) return
    const desuscribir = escucharEnVivo((evt) => {
      const s = evt.data as SolicitudAutorizacion | undefined
      if (evt.event === 'autorizacion_resuelta' && s?.id === pendienteId) recibir(s)
    })
    const reloj = setInterval(() => {
      apiPos.verSolicitud(pendienteId).then(recibir).catch(() => undefined)
    }, 4000)
    return () => {
      desuscribir()
      clearInterval(reloj)
    }
  }, [pendienteId, recibir])

  // Si se cierra el cuadro con la solicitud en el aire, se cancela: que al
  // dueño no le quede un aviso de algo que ya nadie espera.
  useEffect(
    () => () => {
      const s = solicitudRef.current
      if (s && s.estado === 'pendiente') apiPos.cancelarSolicitud(s.id).catch(() => undefined)
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
    alCambiar(
      m === 'pin' && /^\d{4,6}$/.test(pin)
        ? { pin }
        : m === 'remoto' && solicitud?.estado === 'aprobada'
          ? { solicitud_id: solicitud.id }
          : null,
    )
    // Quien esta del otro lado, para no dejar a la cajera esperando a nadie.
    if (m === 'remoto')
      apiPos
        .autorizantesConectados()
        .then((d) => setConectados(d.autorizantes))
        .catch(() => setConectados(null))
  }

  async function pedir() {
    setError('')
    setPidiendo(true)
    try {
      const s = await apiPos.solicitarAutorizacion({ accion, detalle, monto, pedido_id: pedidoId })
      setSolicitud(s)
      alCambiar(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo pedir')
    } finally {
      setPidiendo(false)
    }
  }

  async function cancelar() {
    if (solicitud) await apiPos.cancelarSolicitud(solicitud.id).catch(() => undefined)
    setSolicitud(null)
    alCambiar(null)
  }

  return (
    <View style={{ gap: 12 }}>
      <Pestanas
        opciones={[
          { id: 'pin', texto: 'Con PIN' },
          { id: 'remoto', texto: 'Pedir permiso' },
        ]}
        valor={modo}
        alCambiar={cambiarModo}
      />

      {modo === 'pin' ? (
        <Campo
          rotulo="PIN de quien autoriza"
          value={pin}
          onChangeText={cambiarPin}
          secureTextEntry
          keyboardType="number-pad"
          maxLength={6}
          placeholder="••••"
          ayuda="Solo quien tiene un rol que autoriza tiene PIN. Si no está en el local, usa «Pedir permiso»."
          style={{ fontSize: 24, letterSpacing: 10, textAlign: 'center' }}
        />
      ) : null}

      {modo === 'remoto' && !solicitud ? (
        <View style={{ gap: 8 }}>
          <Text style={[e.texto, { color: t.suave }]}>
            Se le avisa a quien puede autorizar y aprueba desde su aplicación, esté donde esté.
          </Text>
          {conectados !== null ? (
            <Text style={[e.nota, { color: conectados > 0 ? t.exito : t.aviso }]}>
              {conectados > 0
                ? `${conectados} persona(s) que autorizan tienen la aplicación abierta ahora.`
                : 'Nadie que autorice tiene la aplicación abierta ahora: lo verá cuando la abra.'}
            </Text>
          ) : null}
          <Boton texto={pidiendo ? 'Enviando…' : 'Enviar solicitud'} tono="neutro" alTocar={() => void pedir()} ocupado={pidiendo} />
        </View>
      ) : null}

      {modo === 'remoto' && solicitud ? (
        <View
          style={[
            e.caja,
            {
              backgroundColor:
                solicitud.estado === 'aprobada' ? t.exitoSuave : solicitud.estado === 'pendiente' ? t.gris100 : t.peligroSuave,
            },
          ]}
        >
          {solicitud.estado === 'pendiente' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <ActivityIndicator color={t.suave} />
              <Text style={[e.texto, { color: t.fuerte, flex: 1 }]}>Solicitud #{solicitud.id} enviada. Esperando respuesta…</Text>
              <BotonChico texto="Cancelar" color={t.fuerte} alTocar={() => void cancelar()} />
            </View>
          ) : null}
          {solicitud.estado === 'aprobada' ? (
            <Text style={[e.texto, { color: t.exito }]}>
              Aprobado por <Text style={{ fontFamily: LETRA.textoFuerte }}>{solicitud.resuelta_por}</Text>. Ya puedes guardar.
            </Text>
          ) : null}
          {solicitud.estado === 'rechazada' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text style={[e.texto, { color: t.peligro, flexShrink: 1 }]}>
                <Text style={{ fontFamily: LETRA.textoFuerte }}>{solicitud.resuelta_por}</Text> no lo autorizó.
              </Text>
              <BotonChico texto="Pedir de nuevo" color={t.peligro} alTocar={() => setSolicitud(null)} />
            </View>
          ) : null}
          {solicitud.estado === 'vencida' || solicitud.estado === 'cancelada' || solicitud.estado === 'usada' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text style={[e.texto, { color: t.peligro, flexShrink: 1 }]}>La solicitud ya no sirve ({solicitud.estado}).</Text>
              <BotonChico texto="Pedir otra" color={t.peligro} alTocar={() => setSolicitud(null)} />
            </View>
          ) : null}
        </View>
      ) : null}

      {error ? <Text style={[e.texto, { color: t.peligro }]}>{error}</Text> : null}
    </View>
  )
}

const e = StyleSheet.create({
  texto: { fontFamily: LETRA.texto, fontSize: 14.5, lineHeight: 20 },
  nota: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
  caja: { borderRadius: 16, padding: 14 },
})
