import { useState } from 'react'
import { Alert, Text, View } from 'react-native'
import { Barra } from '../../componentes/Encabezado'
import { Boton, Cargando, Etiqueta, Ficha, Nota, Pantalla, Problema } from '../../componentes/ui'
import { api } from '../../lib/api'
import { parte, useCarga } from '../../lib/carga'
import { useMoneda } from '../../lib/moneda'
import { useSesion } from '../../lib/sesion'
import { LETRA, useTema } from '../../lib/tema'
import type { SolicitudAutorizacion } from '../../lib/tipos'

/**
 * LA CAMPANA: lo que la caja pide permiso para hacer (un descuento, editar una
 * venta cobrada, anular) y quien puede autorizarlo lo resuelve desde el
 * telefono, sin estar en el local. Las mismas solicitudes que ve la web
 * (/autorizaciones) y el mismo historial.
 */
export default function Notificaciones() {
  const t = useTema()
  const { fmt } = useMoneda()
  const { acceso } = useSesion()
  const autoriza = acceso?.puede.autoriza ?? false
  const [ocupada, setOcupada] = useState<number | null>(null)

  const { datos, error, refrescando, refrescar } = useCarga(async () => {
    const [pendientes, historial] = await Promise.all([
      autoriza ? parte(api.solicitudesPendientes()) : Promise.resolve(null),
      parte(api.historialAutorizaciones()),
    ])
    return { pendientes, historial }
  }, 15)

  async function resolver(s: SolicitudAutorizacion, aprobar: boolean) {
    setOcupada(s.id)
    try {
      await (aprobar ? api.aprobarSolicitud(s.id) : api.rechazarSolicitud(s.id))
      refrescar()
    } catch (e) {
      Alert.alert('No se pudo', e instanceof Error ? e.message : '')
    } finally {
      setOcupada(null)
    }
  }

  const pendientes = datos?.pendientes?.ok ? datos.pendientes.valor.filter((s) => s.estado === 'pendiente') : []
  const historial = datos?.historial?.ok ? datos.historial.valor.filter((s) => s.estado !== 'pendiente').slice(0, 20) : []

  return (
    <Pantalla refrescando={refrescando} alRefrescar={refrescar} arriba={<Barra titulo="Notificaciones" />}>
      {error && !datos ? <Problema mensaje={error} alReintentar={refrescar} /> : null}
      {!datos && !error ? <Cargando /> : null}

      {datos && autoriza && (
        <>
          <Etiqueta style={{ marginTop: 4 }}>Esperan tu permiso</Etiqueta>
          {pendientes.length === 0 ? (
            <Ficha>
              <Nota>Nada pendiente. Cuando la caja pida permiso para algo, aparece aquí.</Nota>
            </Ficha>
          ) : (
            pendientes.map((s) => (
              <Ficha key={s.id} tono="aviso">
                <Text style={{ fontFamily: LETRA.titulo, fontSize: 16, color: t.tinta }}>{s.detalle || s.accion}</Text>
                <Nota style={{ marginTop: 4 }}>
                  {s.solicitante_nombre || s.solicitante}
                  {s.pedido_numero ? ` · comanda #${s.pedido_numero}` : ''}
                  {s.monto ? ` · ${fmt(s.monto)}` : ''}
                </Nota>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                  <View style={{ flex: 1 }}>
                    <Boton texto="Rechazar" tono="neutro" alTocar={() => resolver(s, false)} ocupado={ocupada === s.id} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Boton texto="Aprobar" alTocar={() => resolver(s, true)} ocupado={ocupada === s.id} />
                  </View>
                </View>
              </Ficha>
            ))
          )}
        </>
      )}

      {datos && (
        <>
          <Etiqueta style={{ marginTop: 8 }}>Lo último</Etiqueta>
          {historial.length === 0 ? (
            <Ficha>
              <Nota>Todavía no hay autorizaciones resueltas.</Nota>
            </Ficha>
          ) : (
            <Ficha style={{ paddingVertical: 8 }}>
              {historial.map((s, i) => (
                <View
                  key={s.id}
                  style={{ paddingVertical: 10, borderBottomWidth: i === historial.length - 1 ? 0 : 0.5, borderBottomColor: t.gris200 }}
                >
                  <Text style={{ fontFamily: LETRA.textoFuerte, fontSize: 14.5, color: t.tinta }}>{s.detalle || s.accion}</Text>
                  <Nota style={{ marginTop: 2 }}>
                    {s.estado === 'aprobada' || s.estado === 'usada'
                      ? `Aprobada por ${s.resuelta_por || '—'}`
                      : s.estado === 'rechazada'
                        ? `Rechazada por ${s.resuelta_por || '—'}`
                        : s.estado === 'vencida'
                          ? 'Venció sin respuesta'
                          : 'Cancelada'}
                    {` · pidió ${s.solicitante_nombre || s.solicitante}`}
                  </Nota>
                </View>
              ))}
            </Ficha>
          )}
        </>
      )}
    </Pantalla>
  )
}
