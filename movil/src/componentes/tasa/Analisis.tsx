import { Text, View } from 'react-native'
import { etiquetaMetodo } from '../../../../frontend/src/lib/pagos'
import { fmtBs } from '../../lib/moneda'
import { useTema } from '../../lib/tema'
import type { AnalisisTasa, EquivalenciaTasa } from '../../lib/tipos'
import { Ficha } from '../ui'
import { DosColumnas, Lecturas } from '../reportes/comunes'
import { num, pct } from '../reportes/cuentas'
import { GraficoDona, GraficoLineas, Variacion } from '../reportes/Grafico'
import { usePaletaDatos } from '../reportes/paleta'
import { TablaDatos } from '../reportes/Tabla'
import { Cabeza, Dato, estilos, ParDatos } from './comunes'

/** "21/09": la fecha bajo el grafico, como la web. */
const diaMes = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`

/**
 * EL ANALISIS DE LA TASA, como la seccion de pages/Tasa.tsx: las seis cifras
 * del periodo (las dos de la brecha convierten la brecha en plata, y van en
 * dolares aunque arriba se mire otra moneda), como se movio, la brecha dia a
 * dia, por donde entran los bolivares, lo mismo en billetes y que dice esto.
 */
export default function Analisis({ analisis }: { analisis: AnalisisTasa }) {
  const t = useTema()
  const p = usePaletaDatos()
  const etiquetas = analisis.puntos.map((x) => diaMes(x.fecha))
  const conPorc = (n: number | null) => (n != null ? `${n > 0 ? '+' : ''}${pct(n)}` : '—')

  return (
    <>
      <Ficha style={{ gap: 18 }}>
        <ParDatos>
          <Dato
            titulo="Movimiento"
            ayuda="kpi.variacion_periodo"
            valor={conPorc(analisis.variacion_pct)}
            nota={analisis.bcv_inicio && analisis.bcv_fin ? `${num(analisis.bcv_inicio)} → ${num(analisis.bcv_fin)}` : 'del oficial en el período'}
          />
          <Dato
            titulo="Brecha media"
            ayuda="kpi.brecha_media"
            valor={analisis.brecha_media_pct != null ? pct(analisis.brecha_media_pct) : '—'}
            nota={analisis.brecha_fin_pct != null ? `hoy ${pct(analisis.brecha_fin_pct)}` : 'paralelo vs oficial'}
          />
        </ParDatos>
        <ParDatos>
          <Dato titulo="Cobrado en bolívares" ayuda="kpi.cobrado_bs" valor={`$${num(analisis.cobrado_bs_usd)}`} nota="efectivo Bs, pago móvil, tarjeta · en $" />
          <Dato titulo="Se llevó la brecha" ayuda="kpi.costo_brecha" valor={`$${num(analisis.costo_brecha_usd)}`} nota="al reponer comprando divisas · en $" />
        </ParDatos>
        <ParDatos>
          <Dato
            titulo="Expuesto a la brecha"
            ayuda="kpi.exposicion"
            valor={analisis.exposicion_pct != null ? pct(analisis.exposicion_pct) : '—'}
            nota={analisis.cobrado_total_usd > 0 ? `de $${num(analisis.cobrado_total_usd)} cobrados entró en Bs` : 'de lo cobrado entró en Bs'}
          />
          <Dato
            titulo="En 30 días, si sigue así"
            ayuda="kpi.proyeccion_30d"
            valor={analisis.proyeccion_30d != null ? num(analisis.proyeccion_30d) : '—'}
            nota={analisis.proyeccion_30d_pct != null ? `${conPorc(analisis.proyeccion_30d_pct)} · extrapolación` : 'hacen falta 7 días de tasa'}
          />
        </ParDatos>
      </Ficha>

      <Ficha style={{ gap: 12 }}>
        <Cabeza
          titulo="Cómo se movió"
          texto={`${analisis.etiqueta} · ${analisis.dias} día(s) con tasa guardada. Toca o desliza el dedo sobre el gráfico para ver un día concreto.`}
        />
        <GraficoLineas
          alto={220}
          etiquetas={etiquetas}
          formato={(n) => num(n, 0)}
          formatoDetalle={(n) => num(n, 2)}
          series={[
            { nombre: 'Dólar BCV', color: t.tinta, valores: analisis.puntos.map((x) => x.bcv), relleno: true },
            { nombre: 'Paralelo', color: p.serie[0], valores: analisis.puntos.map((x) => x.paralelo) },
            { nombre: 'Euro BCV', color: p.aviso, valores: analisis.puntos.map((x) => x.eur), punteada: true },
          ]}
          pie={analisis.bcv_min && analisis.bcv_max ? `mínimo ${num(analisis.bcv_min)} · máximo ${num(analisis.bcv_max)}` : undefined}
        />
      </Ficha>

      <DosColumnas>
        {analisis.puntos.some((x) => x.brecha_pct != null) ? (
          <Ficha style={{ gap: 12 }}>
            <Cabeza
              titulo="La brecha, día a día"
              texto="Cuánto más caro está el paralelo que el oficial. Es el porcentaje que se pierde de cada bolívar cobrado al oficial."
            />
            <GraficoLineas
              alto={160}
              etiquetas={etiquetas}
              formato={(n) => `${n.toFixed(0)}%`}
              formatoDetalle={(n) => `${num(n, 1)}%`}
              series={[{ nombre: 'Brecha', color: p.aviso, valores: analisis.puntos.map((x) => x.brecha_pct), relleno: true }]}
              pie={analisis.brecha_media_pct != null ? `media del período ${pct(analisis.brecha_media_pct)}` : undefined}
            />
          </Ficha>
        ) : null}
        {analisis.por_metodo_bs.length > 0 ? (
          <Ficha style={{ gap: 12 }}>
            <Cabeza
              titulo="Por dónde entran los bolívares"
              texto={`Lo cobrado en métodos en bolívares, en dólares. Lo que entró en divisas ($${num(analisis.cobrado_divisas_usd)}) no aparece: no lo toca la brecha.`}
            />
            <GraficoDona
              formato={(n) => `$${num(n)}`}
              centro={{ valor: `$${num(analisis.cobrado_bs_usd, 0)}`, texto: 'en bolívares' }}
              partes={analisis.por_metodo_bs.map((x) => ({ nombre: etiquetaMetodo(x.nombre), valor: x.monto }))}
            />
          </Ficha>
        ) : null}
      </DosColumnas>

      {analisis.equivalencias.length > 0 && analisis.bcv_inicio !== analisis.bcv_fin ? (
        <Ficha style={{ gap: 8 }}>
          <Cabeza
            titulo="Lo mismo, en billetes"
            texto="Cuántos bolívares eran al empezar el período y cuántos son hoy. Es la subida que el cliente siente en la caja aunque el menú esté en dólares."
          />
          <TablaDatos<EquivalenciaTasa>
            filas={analisis.equivalencias}
            claveFila={(x) => String(x.usd)}
            columnas={[
              { clave: 'billete', titulo: 'Billete', ancho: 74, celda: (x) => `$${num(x.usd, 0)}` },
              { clave: 'inicio', titulo: 'Al empezar', ancho: 124, derecha: true, celda: (x) => fmtBs(x.bs_inicio, 0), color: () => t.suave },
              { clave: 'fin', titulo: 'Hoy', ancho: 124, derecha: true, fuerte: true, celda: (x) => fmtBs(x.bs_fin, 0) },
              {
                clave: 'diferencia',
                titulo: 'Diferencia',
                ancho: 150,
                derecha: true,
                celda: (x) => (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Variacion pct={x.bs_inicio ? (x.bs_fin / x.bs_inicio - 1) * 100 : null} invertir />
                    <Text style={[estilos.nota, { color: t.tenue, marginTop: 0 }]}>
                      {x.bs_fin - x.bs_inicio >= 0 ? '+' : ''}
                      {num(x.bs_fin - x.bs_inicio, 0)}
                    </Text>
                  </View>
                ),
              },
            ]}
          />
        </Ficha>
      ) : null}

      <View style={{ gap: 10 }}>
        <Text style={[estilos.losaTitulo, { color: t.tinta, paddingHorizontal: 2 }]}>Qué dice esto</Text>
        <Lecturas items={analisis.lecturas} />
      </View>
    </>
  )
}
