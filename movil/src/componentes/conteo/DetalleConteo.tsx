import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { apiPreparaciones } from '../../lib/api-preparaciones'
import { descargar } from '../../lib/archivos'
import { avisar } from '../../lib/dialogo'
import { useMoneda } from '../../lib/moneda'
import { LETRA, useTema } from '../../lib/tema'
import type { ConteoDetalle } from '../../lib/tipos'
import { HojaFormulario, Pastilla } from '../kit'
import { Boton, Cargando } from '../ui'
import { fechaNumerica, fmtCant } from '../preparaciones/cuentas'
import { mensajeDe } from '../preparaciones/piezas'

/**
 * Una planilla de conteo ya cargada, renglon por renglon (`DetalleConteo`
 * de la web). Es el documento que se compara contra el papel que trajo el
 * trabajador. Las diferencias van arriba (es lo que se viene a mirar) y lo
 * que cuadro queda abajo, pero se muestra: saber que 40 mercancias dieron
 * exacto es parte de lo que hace creible al conteo.
 */
export default function DetalleConteo({ id, alCerrar }: { id: number; alCerrar: () => void }) {
  const t = useTema()
  const { fmt: dinero } = useMoneda()
  const [d, setD] = useState<ConteoDetalle | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    apiPreparaciones
      .conteo(id)
      .then(setD)
      .catch((e: unknown) => setError(mensajeDe(e, 'No se pudo traer el conteo')))
  }, [id])

  async function bajar() {
    if (!d) return
    try {
      await descargar(apiPreparaciones.rutaExportarConteo(d.id), `conteo-${d.id}.csv`)
    } catch (e) {
      await avisar('No se pudo descargar el archivo', mensajeDe(e, 'Intenta otra vez.'))
    }
  }

  return (
    <HojaFormulario
      visible
      alCerrar={alCerrar}
      titulo={d ? `Conteo del ${fechaNumerica(d.fecha)}` : 'Conteo'}
      pie={
        <>
          {d ? (
            <View style={{ flex: 1 }}>
              <Boton texto="Descargar" tono="neutro" alTocar={() => void bajar()} />
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            <Boton texto="Cerrar" alTocar={alCerrar} />
          </View>
        </>
      }
    >
      {!d ? (
        error ? (
          <Text style={[e.texto, { color: t.peligro }]}>{error}</Text>
        ) : (
          <Cargando />
        )
      ) : (
        <>
          <View style={{ gap: 8 }}>
            <Text style={[e.texto, { color: t.suave }]}>
              {d.contados} mercancía(s) contada(s), {d.cuadraron} cuadraron.
              {d.operador ? ` Lo hizo ${d.operador}.` : ''}
            </Text>
            {d.ciego ? (
              <Pastilla texto="a ciegas" tono="bien" />
            ) : (
              <Text style={[e.texto, { color: t.tenue }]}>Se contó viendo lo que el sistema esperaba.</Text>
            )}
            <Text style={[e.texto, { color: t.tinta }]}>
              Faltó <Text style={[e.cifra, { color: t.peligro }]}>{dinero(d.faltante_valor)}</Text>
              {'    '}Sobró <Text style={[e.cifra, { color: t.exito }]}>{dinero(d.sobrante_valor)}</Text>
            </Text>
          </View>
          <View>
            {d.lineas.map((l, i) => (
              <View key={l.ingrediente_id} style={[e.fila, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.gris200 }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[e.nombre, { color: t.tinta }]}>{l.nombre}</Text>
                  <Text style={[e.sub, { color: t.tenue }]}>
                    {l.unidad} · sistema {fmtCant(l.sistema)} · contado {fmtCant(l.contado)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  {l.diferencia === 0 ? (
                    <Text style={[e.cifra, { color: t.exito }]}>cuadra</Text>
                  ) : (
                    <>
                      <Text style={[e.cifra, { color: l.diferencia < 0 ? t.peligro : t.aviso }]}>
                        {l.diferencia > 0 ? '+' : ''}
                        {fmtCant(l.diferencia)}
                      </Text>
                      <Text style={[e.sub, { color: t.suave }]}>{dinero(l.valor)}</Text>
                    </>
                  )}
                </View>
              </View>
            ))}
          </View>
        </>
      )}
    </HojaFormulario>
  )
}

const e = StyleSheet.create({
  texto: { fontFamily: LETRA.texto, fontSize: 14, lineHeight: 20 },
  cifra: { fontFamily: LETRA.cifraFuerte, fontSize: 14.5 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  sub: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 2 },
})
