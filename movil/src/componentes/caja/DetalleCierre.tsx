import { Stack, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { apiCaja } from '../../lib/api-caja'
import { useCarga } from '../../lib/carga'
import { hoyEnCaracas } from '../../lib/formato'
import { useMoneda } from '../../lib/moneda'
import { horaCorta } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import { HojaFormulario, ListaFicha, Vacio } from '../kit'
import { Aviso, Boton, Campo, Cargando, Etiqueta, Ficha, Fila, Nota, Pantalla, Problema } from '../ui'
import { cuadra, diaLargo, sumarDias } from './logica'
import { mensajeDe } from './piezas'

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/

/**
 * UN CIERRE DEL HISTORIAL, abierto: que paso forma de pago por forma de
 * pago. Es la diferencia entre "faltaron 6" y "faltaron 6 en efectivo, el
 * resto cuadro" (en la web, la fila desplegada del historial).
 *
 * No hay ruta para pedir un cierre suelto: se piden los cierres de su dia
 * (viene en `?fecha=`) y se busca el suyo. Sin fecha, el ultimo año.
 */
export default function DetalleCierre() {
  const t = useTema()
  const { fmt } = useMoneda()
  const { id, fecha } = useLocalSearchParams<{ id: string; fecha?: string }>()
  const numero = Number(id)
  const hoy = hoyEnCaracas()
  const desde = fecha && ES_FECHA.test(fecha) ? fecha : sumarDias(hoy, -365)
  const hasta = fecha && ES_FECHA.test(fecha) ? fecha : hoy
  const { datos, error, refrescando, refrescar } = useCarga(
    async () => ({ cierre: (await apiCaja.listarCierres(desde, hasta)).find((c) => c.id === numero) ?? null }),
    120,
    `${numero}|${desde}`,
  )
  const [anulando, setAnulando] = useState(false)

  const c = datos?.cierre
  const dif = c ? c.diferencia + c.divisas_diferencia : 0

  return (
    <Pantalla refrescando={refrescando} alRefrescar={refrescar}>
      <Stack.Screen options={{ title: 'Cierre de caja' }} />
      {error && !datos ? <Problema mensaje={error} alReintentar={refrescar} /> : null}
      {!datos && !error ? <Cargando /> : null}
      {datos && !c ? <Vacio icono="caja" titulo="No se encontró ese cierre" detalle="Puede que sea de otra fecha. Búscalo en el Historial." /> : null}

      {c ? (
        <>
          <Ficha style={{ gap: 6 }}>
            <Etiqueta>
              {diaLargo(c.fecha, hoy)} · {horaCorta(c.fecha)}
            </Etiqueta>
            {c.anulado ? (
              <Text style={[e.veredicto, { color: t.tenue }]}>Cierre anulado</Text>
            ) : cuadra(dif) ? (
              <Text style={[e.veredicto, { color: t.exito }]}>Cuadró</Text>
            ) : (
              <Text style={[e.veredicto, { color: t.peligro }]} numberOfLines={1} adjustsFontSizeToFit>
                Descuadre {fmt(dif)}
              </Text>
            )}
            {c.anulado ? <Aviso texto={`Anulado${c.motivo_anulacion ? `: ${c.motivo_anulacion}` : ''}`} tono="peligro" /> : null}
            <View style={{ marginTop: 6 }}>
              <Fila nombre="Vendido" valor={fmt(c.total_sistema)} />
              <Fila nombre="Cerró" valor={c.operador || '—'} texto />
              <Fila nombre="Nota" valor={c.nota || 'sin nota'} texto ultima />
            </View>
          </Ficha>

          <ListaFicha titulo="Desglose por forma de pago">
            {c.lineas.map((l, i) => (
              <View
                key={l.cuenta + l.metodo}
                style={[e.linea, i < c.lineas.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 }]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[e.metodo, { color: t.tinta }]}>{l.metodo || l.etiqueta}</Text>
                  <Text style={[e.detalle, { color: t.suave }]}>
                    sistema {fmt(l.esperado)} · contado {fmt(l.contado)}
                  </Text>
                </View>
                <Text style={[e.diferencia, { color: cuadra(l.diferencia) ? t.exito : t.peligro }]}>
                  {cuadra(l.diferencia) ? 'cuadra' : fmt(l.diferencia)}
                </Text>
              </View>
            ))}
            {c.lineas.length === 0 ? (
              <Nota style={{ color: t.tenue, paddingHorizontal: 16, paddingVertical: 10 }}>Cierre viejo, sin detalle por forma de pago.</Nota>
            ) : null}
          </ListaFicha>

          {!c.anulado ? <Boton texto="Anular este cierre" tono="peligro" alTocar={() => setAnulando(true)} /> : null}

          {anulando ? (
            <Anular
              id={c.id}
              alCerrar={() => setAnulando(false)}
              alAnular={() => {
                setAnulando(false)
                refrescar()
              }}
            />
          ) : null}
        </>
      ) : null}
    </Pantalla>
  )
}

/** Anular pide el motivo, que queda registrado (`dialogo.pedirTexto` de la web, obligatorio). */
function Anular({ id, alCerrar, alAnular }: { id: number; alCerrar: () => void; alAnular: () => void }) {
  const [motivo, setMotivo] = useState('')
  const [falta, setFalta] = useState(false)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function anular() {
    if (guardando) return
    if (!motivo.trim()) {
      setFalta(true)
      return
    }
    setGuardando(true)
    setError('')
    try {
      await apiCaja.anularCierre(id, motivo.trim())
      alAnular()
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo anular el cierre'))
      setGuardando(false)
    }
  }

  return (
    <HojaFormulario
      visible
      alCerrar={alCerrar}
      titulo="Anular este cierre"
      pie={
        <>
          <View style={{ flex: 1 }}>
            <Boton texto="Cancelar" tono="neutro" alTocar={alCerrar} />
          </View>
          <View style={{ flex: 1 }}>
            <Boton texto="Anular cierre" tono="peligro" alTocar={anular} ocupado={guardando} />
          </View>
        </>
      }
    >
      <Nota>El cierre no se borra: se revierte su diferencia y el día se puede volver a cerrar.</Nota>
      {error ? <Aviso texto={error} tono="peligro" /> : null}
      <Campo
        rotulo="Por qué se anula (queda registrado)"
        value={motivo}
        onChangeText={(v) => {
          setMotivo(v)
          setFalta(false)
        }}
        error={falta ? 'Falta este dato' : undefined}
      />
    </HojaFormulario>
  )
}

const e = StyleSheet.create({
  veredicto: { fontFamily: LETRA.tituloFuerte, fontSize: 32, letterSpacing: -0.8 },
  linea: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 56 },
  metodo: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  detalle: { fontFamily: LETRA.cifra, fontSize: 13, marginTop: 3 },
  diferencia: { fontFamily: LETRA.cifraFuerte, fontSize: 15 },
})
