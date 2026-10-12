import { useState } from 'react'
import { Text, View } from 'react-native'
import { fmtBs } from '../../lib/moneda'
import { aNumero } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import type { EstadoTasa } from '../../lib/tipos'
import { CampoNumero, Selector } from '../kit'
import { Ficha } from '../ui'
import { num } from '../reportes/cuentas'
import { Cabeza, estilos } from './comunes'

/*
 * Las tasas con las que se puede medir un mismo monto. En Venezuela el precio
 * se piensa en dolares pero se cobra en bolivares, y no hay UN dolar: el del
 * BCV --al que la ley obliga a facturar-- y el del mercado, al que de verdad
 * se repone la mercancia. El euro entra porque muchos mayoristas cotizan en
 * euros.
 */
const TASAS: { id: 'bcv' | 'paralelo' | 'eur'; nombre: string; ayuda: string }[] = [
  { id: 'bcv', nombre: 'BCV (oficial)', ayuda: 'Al que hay que facturar' },
  { id: 'paralelo', nombre: 'Paralelo / Binance', ayuda: 'Al que se repone' },
  { id: 'eur', nombre: 'Euro BCV', ayuda: 'Al que cotizan algunos mayoristas' },
]

/**
 * LA CALCULADORA, como la seccion de pages/Tasa.tsx: el mismo dinero medido
 * con cada tasa, y lo que cuesta el viaje de cobrar al oficial y reponer al
 * paralelo. Se calcula en el telefono, mientras se teclea.
 */
export default function Calculadora({ estado }: { estado: EstadoTasa | null }) {
  const t = useTema()
  const [montoCalc, setMontoCalc] = useState('10')
  const [enCalc, setEnCalc] = useState<string>('bcv')

  const tasas: Record<string, number | null | undefined> = { bcv: estado?.bcv, paralelo: estado?.paralelo, eur: estado?.eur }
  const monto = aNumero(montoCalc)
  const valido = Number.isFinite(monto) && monto > 0
  // Todo pasa por bolivares, la unica moneda en la que un monto significa lo mismo mire quien lo mire.
  const bs = !valido ? 0 : enCalc === 'bs' ? monto : monto * (tasas[enCalc] || 0)
  const disponibles = TASAS.filter((x) => (tasas[x.id] ?? 0) > 0)
  const bcv = estado?.bcv ?? 0
  const paralelo = estado?.paralelo ?? 0
  // Lo que se pierde en el viaje: cobrar al oficial y reponer al de la calle.
  const hayBrecha = bcv > 0 && paralelo > bcv
  const enBcv = bcv > 0 ? bs / bcv : 0
  const enParalelo = paralelo > 0 ? bs / paralelo : 0
  const perdida = hayBrecha ? enBcv - enParalelo : 0
  const perdidaPct = hayBrecha && enBcv > 0 ? (perdida / enBcv) * 100 : 0

  return (
    <>
      <Ficha style={{ gap: 14 }}>
        <Cabeza
          titulo="Pasar un monto de una tasa a otra"
          texto="Escribe cuánto y con qué tasa lo estás midiendo. Abajo sale lo mismo medido con las demás."
        />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <CampoNumero rotulo="Monto" valor={montoCalc} alCambiar={setMontoCalc} placeholder="10" style={{ flex: 1 }} />
          <View style={{ flex: 1.3 }}>
            <Selector
              forma="campo"
              etiqueta="Medido en"
              valor={enCalc}
              alCambiar={setEnCalc}
              opciones={[{ valor: 'bs', texto: 'Bolívares' }, ...disponibles.map((x) => ({ valor: x.id as string, texto: `Dólares a ${x.nombre}` }))]}
            />
          </View>
        </View>

        {!valido || disponibles.length === 0 ? (
          <Text style={[estilos.texto, { color: t.tenue }]}>
            {disponibles.length === 0 ? 'Todavía no hay tasas cargadas. Consulta el BCV en "Tasa de hoy".' : 'Escribe un monto para ver las equivalencias.'}
          </Text>
        ) : (
          <View style={{ gap: 8 }}>
            {/* Bolivares primero: es el pivote de todas las demas y lo que pasa por la gaveta. */}
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, borderRadius: 14, backgroundColor: t.fichaPrincipal, paddingHorizontal: 16, paddingVertical: 14 }}>
              <Text style={[estilos.texto, { color: t.fichaPrincipalTinta, fontFamily: LETRA.textoFuerte }]}>En bolívares</Text>
              <Text style={{ fontFamily: LETRA.cifraFuerte, fontSize: 19, color: t.fichaPrincipalTinta, flexShrink: 1 }} numberOfLines={1} adjustsFontSizeToFit>
                {fmtBs(bs)}
              </Text>
            </View>
            {disponibles.map((x) => {
              const tasa = tasas[x.id] as number
              const esEscrito = x.id === enCalc
              return (
                <View
                  key={x.id}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderRadius: 14, backgroundColor: t.gris100, paddingHorizontal: 16, paddingVertical: 12, opacity: esEscrito ? 0.6 : 1 }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[estilos.texto, { color: t.tinta, fontFamily: LETRA.textoFuerte }]} numberOfLines={1}>
                      {x.nombre}
                    </Text>
                    <Text style={[estilos.nota, { color: t.tenue, marginTop: 0 }]}>{esEscrito ? 'lo que escribiste' : `${x.ayuda} · ${num(tasa, 2)} Bs`}</Text>
                  </View>
                  <Text style={{ fontFamily: LETRA.cifraFuerte, fontSize: 19, color: t.tinta }}>${num(bs / tasa, 2)}</Text>
                </View>
              )
            })}
          </View>
        )}
      </Ficha>

      {/* Lo que cuesta el viaje: cobrar al oficial y reponer al paralelo no es neutro. */}
      {valido && hayBrecha ? (
        <Ficha style={{ gap: 14 }}>
          <Cabeza
            titulo="Si cobras esto al oficial y repones al paralelo"
            texto="La ley te obliga a facturar a la tasa del BCV, pero la mercancía se repone comprando divisas a la del mercado. Esa diferencia sale de tu margen, no del de nadie más."
          />
          <View style={{ gap: 8 }}>
            <Renglon nombre="Le cobras al cliente" valor={`${fmtBs(bs)} ($${num(enBcv, 2)} al BCV)`} />
            <Renglon nombre="Con esos bolívares repones" valor={`$${num(enParalelo, 2)}`} />
            <View style={{ borderTopWidth: 1, borderTopColor: t.gris200, paddingTop: 8 }}>
              <Renglon nombre="Se queda en la brecha" valor={`−$${num(perdida, 2)} (${num(perdidaPct, 1)}%)`} fuerte color={t.peligro} />
            </View>
          </View>
          {/* El numero accionable: no "estas perdiendo", sino "a cuanto tendrias que venderlo". */}
          <View style={{ borderRadius: 16, backgroundColor: t.acentoSuave, padding: 16 }}>
            <Text style={{ fontFamily: LETRA.textoFuerte, fontSize: 11.5, letterSpacing: 1.1, textTransform: 'uppercase', color: t.acentoFuerte }}>
              Para que te queden ${num(enBcv, 2)} de verdad
            </Text>
            <Text style={{ fontFamily: LETRA.tituloFuerte, fontSize: 26, color: t.tinta, marginTop: 4 }}>${num(enBcv * (paralelo / bcv), 2)}</Text>
            <Text style={[estilos.nota, { color: t.acentoFuerte }]}>
              Es lo mismo que multiplicar tu precio en dólares por{' '}
              <Text style={{ fontFamily: LETRA.cifraFuerte }}>{num(paralelo / bcv, 3)}</Text> antes de convertirlo a bolívares al BCV. Así, después de
              reponer, te queda el margen que dice tu carta.
            </Text>
          </View>
          <Text style={[estilos.nota, { color: t.tenue }]}>
            Lo cobrado en efectivo en dólares no pasa por aquí: esas divisas ya son divisas y no pierden nada con la brecha. Por eso conviene tener precio en
            divisas y cobrar en ellas cuando se pueda.
          </Text>
        </Ficha>
      ) : null}
    </>
  )
}

function Renglon({ nombre, valor, fuerte = false, color }: { nombre: string; valor: string; fuerte?: boolean; color?: string }) {
  const t = useTema()
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
      <Text style={[estilos.texto, { color: fuerte ? t.tinta : t.suave, fontFamily: fuerte ? LETRA.textoFuerte : LETRA.texto }]}>{nombre}</Text>
      <Text style={[estilos.cifra, { color: color ?? t.tinta, fontFamily: fuerte ? LETRA.cifraFuerte : LETRA.cifra }]}>{valor}</Text>
    </View>
  )
}
