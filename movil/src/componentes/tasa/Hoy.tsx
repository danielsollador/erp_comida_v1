import { Text, View } from 'react-native'
import { fechaCorta } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import type { EstadoTasa, PuntoTasa } from '../../lib/tipos'
import { CampoNumero, Pastilla } from '../kit'
import { Aviso, Boton, Ficha } from '../ui'
import { num, pct } from '../reportes/cuentas'
import { Sparkline } from '../reportes/Grafico'
import { usePaletaDatos } from '../reportes/paleta'
import { Cabeza, Dato, estilos, ParDatos } from './comunes'

// Los billetes con los que se cobra en el mostrador. La tasa a secas no le
// dice nada a nadie; "20 dolares son 17.000" si.
const BILLETES = [1, 5, 10, 20, 50, 100]

/**
 * LA TASA DE HOY, como la seccion "Tasa de hoy" de pages/Tasa.tsx: con la
 * que se cobra, las otras tres cifras, la tendencia del mes, los billetes y
 * cargarla a mano. El aviso de lo que paso al tocar un boton va junto a los
 * botones y no arriba de todo: en el telefono, arriba no se ve.
 */
export default function Hoy({
  estado,
  tendencia,
  manual,
  alCambiarManual,
  ocupado,
  error,
  aviso,
  alFijar,
  alConsultar,
  alElegir,
}: {
  estado: EstadoTasa
  tendencia: PuntoTasa[]
  manual: string
  alCambiarManual: (v: string) => void
  ocupado: boolean
  error: string
  aviso: string
  alFijar: () => void
  alConsultar: () => void
  /** Elegir el dolar o el euro del BCV como la tasa con la que se cobra. */
  alElegir: (fuente: 'bcv' | 'eur') => void
}) {
  const t = useTema()
  const p = usePaletaDatos()
  const fuente = estado.cobro?.fuente ?? 'bcv'
  const esManual = fuente === 'manual'
  // Bs por dolar con los que se cobra hoy (la tasa de cobro elegida), no el dolar oficial.
  const bcvHoy = estado.cobro?.tasa ?? estado.bcv ?? 0

  return (
    <>
      <Ficha>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Cabeza titulo="Tasa con la que cobras hoy" texto="Es la que convierte a bolívares en el punto de venta." />
          </View>
          <Pastilla texto={estado.cobro?.etiqueta ?? 'Dólar BCV'} tono={esManual ? 'ojo' : 'bien'} />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <Text style={{ fontFamily: LETRA.tituloFuerte, fontSize: 40, letterSpacing: -1.2, color: t.tinta }}>
            {bcvHoy ? num(bcvHoy) : '—'}
          </Text>
          <Text style={[estilos.texto, { color: t.suave }]}>Bs por dólar</Text>
        </View>

        {estado.cobro?.aviso ? <Text style={[estilos.texto, { color: t.aviso, marginTop: 6 }]}>{estado.cobro.aviso}</Text> : null}
        {estado.cobro?.vieja ? (
          <Text style={[estilos.texto, { color: t.aviso, marginTop: 6 }]}>
            Tu tasa manual es de otro día. Si ya no aplica, elige otra abajo.
          </Text>
        ) : null}

        {estado.desactualizada ? (
          <Text style={[estilos.texto, { color: t.aviso, marginTop: 6 }]}>
            Esta tasa es del {fechaCorta(estado.fecha, true)}, no de hoy. Refresca o cárgala a mano.
          </Text>
        ) : null}

        <View style={{ gap: 16, marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: t.gris100 }}>
          <ParDatos>
            <Dato titulo="Dólar BCV" ayuda="kpi.dolar_bcv" valor={estado.bcv ? num(estado.bcv) : '—'} nota="Bs por dólar, oficial" />
            <Dato titulo="Euro BCV" ayuda="kpi.euro" valor={estado.eur ? num(estado.eur) : '—'} nota="Bs por euro" />
          </ParDatos>
          <ParDatos>
            <Dato titulo="Paralelo" ayuda="kpi.paralelo" valor={estado.paralelo ? num(estado.paralelo) : '—'} nota="Binance P2P" />
            <Dato titulo="Brecha" ayuda="kpi.brecha" valor={estado.brecha_pct != null ? pct(estado.brecha_pct) : '—'} nota="paralelo vs oficial" />
          </ParDatos>
          <ParDatos>
            <Dato
              titulo="Última semana"
              ayuda="kpi.variacion_semana"
              valor={
                estado.variacion_semana_pct != null ? `${estado.variacion_semana_pct > 0 ? '+' : ''}${pct(estado.variacion_semana_pct)}` : '—'
              }
              nota="movimiento del oficial"
            />
          </ParDatos>
        </View>

        {/* La tendencia debajo de la cifra: "va subiendo" o "va quieta" sin
            abrir el analisis. Solo el oficial, que es con el que se cobra. */}
        {tendencia.length >= 2 ? (
          <View style={{ marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.gris100 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6, gap: 8 }}>
              <Text style={[estilos.nota, { color: t.tenue, marginTop: 0 }]}>Últimos {tendencia.length} días con tasa</Text>
              <Text style={[estilos.nota, { color: t.tenue, marginTop: 0, fontFamily: LETRA.cifra }]}>
                {num(tendencia[0].bcv)} → {num(tendencia[tendencia.length - 1].bcv)}
              </Text>
            </View>
            <Sparkline valores={tendencia.map((x) => x.bcv)} color={p.serie[0]} alto={44} />
          </View>
        ) : null}

        <Text style={[estilos.nota, { color: t.tenue, marginTop: 12 }]}>
          {estado.en_vivo
            ? `Conectado a bcv.org.ve y Binance P2P${estado.fuente_actualizada ? ` · fecha valor ${estado.fuente_actualizada}` : ''}`
            : 'Sin conexión a las fuentes ahora mismo. El local sigue cobrando con la última tasa conocida.'}
        </Text>
      </Ficha>

      {bcvHoy > 0 ? (
        <Ficha>
          <Cabeza
            titulo="Para cobrar rápido"
            texto={`Cuánto es cada billete a la tasa con la que cobras hoy (${estado.cobro?.etiqueta ?? 'Dólar BCV'}). El punto de venta ya convierte solo; esto es para el que pregunta "¿cuánto es en bolívares?" antes de pedir.`}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            {BILLETES.map((usd) => (
              <View key={usd} style={{ width: '31.5%', flexGrow: 1, borderRadius: 14, borderCurve: 'continuous', backgroundColor: t.gris100, paddingVertical: 10, alignItems: 'center' }}>
                <Text style={[estilos.nota, { color: t.suave, marginTop: 0 }]}>${usd}</Text>
                <Text style={[estilos.cifra, { color: t.tinta, fontFamily: LETRA.cifraFuerte }]} numberOfLines={1} adjustsFontSizeToFit>
                  {num(usd * bcvHoy, usd >= 20 ? 0 : 2)}
                </Text>
              </View>
            ))}
          </View>
          {estado.paralelo ? (
            <Text style={[estilos.nota, { color: t.tenue, marginTop: 12 }]}>
              Al paralelo, $20 serían {num(20 * estado.paralelo, 0)}.{' '}
              {estado.paralelo > bcvHoy
                ? `La brecha de ${pct((estado.paralelo / bcvHoy - 1) * 100)} es lo que se pierde al reponer comprando divisas con lo que cobras a esta tasa.`
                : 'Cobras por encima del paralelo: al reponer comprando divisas no se pierde por la brecha.'}
            </Text>
          ) : null}
        </Ficha>
      ) : null}

      <Ficha style={{ gap: 14 }}>
        <Cabeza
          titulo="Con qué tasa cobro en bolívares"
          texto="Los precios siguen en dólares. Aquí eliges a cuántos bolívares se pasa cada dólar al cobrar. Lo ya cobrado no cambia, y el dólar y el euro del BCV se siguen actualizando solos."
        />
        <View style={{ gap: 10 }}>
          <Boton
            texto={`Dólar BCV${estado.bcv ? ` · ${num(estado.bcv)}` : ''}${fuente === 'bcv' ? ' ✓' : ''}`}
            tono={fuente === 'bcv' ? 'acento' : 'neutro'}
            alTocar={() => alElegir('bcv')}
            deshabilitado={ocupado || fuente === 'bcv' || !estado.bcv}
          />
          <Boton
            texto={`Euro BCV${estado.eur ? ` · ${num(estado.eur)}` : ''}${fuente === 'eur' ? ' ✓' : ''}`}
            tono={fuente === 'eur' ? 'acento' : 'neutro'}
            alTocar={() => alElegir('eur')}
            deshabilitado={ocupado || fuente === 'eur' || !estado.eur}
          />
        </View>
        <Text style={[estilos.nota, { color: t.suave }]}>O escribe una tasa tuya: dura hasta que la cambies.</Text>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
          <CampoNumero
            rotulo="Tu tasa (Bs por $)"
            valor={manual}
            alCambiar={alCambiarManual}
            placeholder="145,80"
            style={{ flex: 1 }}
            returnKeyType="done"
            onSubmitEditing={alFijar}
          />
          <View style={{ width: 110 }}>
            <Boton texto={esManual ? 'Cambiar ✓' : 'Usar'} alTocar={alFijar} ocupado={ocupado} />
          </View>
        </View>
        <View style={{ gap: 10 }}>
          <Boton texto={ocupado ? 'Consultando...' : 'Consultar BCV ahora'} tono="neutro" alTocar={alConsultar} deshabilitado={ocupado} />
        </View>
        {error ? <Aviso texto={error} tono="peligro" /> : null}
        {aviso ? <Aviso texto={aviso} /> : null}
      </Ficha>
    </>
  )
}
