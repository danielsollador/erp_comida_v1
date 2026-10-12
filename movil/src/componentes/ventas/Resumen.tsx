import { router, type Href } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { etiquetaMetodo } from '../../../../frontend/src/lib/pagos'
import { fmtBs, useMoneda, type VistaMoneda } from '../../lib/moneda'
import { LETRA, useTema } from '../../lib/tema'
import type { ResumenVentas } from '../../lib/tipos'
import { usePalabras } from '../configuracion/Lenguaje'
import { Kpi, useDisposicion } from '../kit'
import { Boton, Ficha, Nota, Titulo } from '../ui'
import { incluyeHoy, useDinero } from './logica'

// El nombre corto de la moneda que se esta viendo, como `sufijo` en la web.
const SUFIJO: Record<VistaMoneda, string> = { usd: 'USD', bs: 'Bs', usd_calle: 'USD calle', eur: 'EUR' }

/**
 * RESUMEN, como la seccion de la web (pages/Ventas.tsx): las ocho cifras que
 * un dueño pregunta primero y como le pagaron. Los montos van a la tasa MEDIA
 * del periodo (los bolivares que de verdad entraron entre lo vendido): con
 * la de hoy, el resumen de un mes viejo se moveria solo.
 *
 * La grafica "Ventas por día" de la web es una pieza de Reportes: aqui no se
 * repite, se lleva a Reportes > Ventas con el mismo periodo.
 */
export default function Resumen({ r, nombre, consulta }: { r: ResumenVentas; nombre: string; consulta: string }) {
  const t = useTema()
  const { tablet } = useDisposicion()
  const dinero = useDinero()
  const { vista } = useMoneda()
  const { modo } = usePalabras()
  const tasaPeriodo = r.ventas > 0 ? r.ventas_bs / r.ventas || null : null
  const fmt = (x: number | null | undefined, d?: number) => dinero(x, tasaPeriodo, d)
  const cambio = r.cambio_pct
  const incompleto = incluyeHoy(r.hasta)
  const ancho = { flexBasis: tablet ? '23%' : '46%', flexGrow: 1 } as const

  return (
    <>
      <View style={estilos.rejilla}>
        <Kpi
          style={ancho}
          etiqueta="Ventas"
          cifra={fmt(r.ventas)}
          nota={r.ventas_bs > 0 ? `${fmtBs(r.ventas_bs)} cobrados, cada venta a su tasa` : r.etiqueta}
        />
        <Kpi style={ancho} etiqueta="Ventas por día" cifra={fmt(r.promedio_diario)} nota={`Sobre ${r.dias} día(s) ${incompleto ? 'transcurridos' : ''}`} />
        <Kpi style={ancho} etiqueta="Pedidos" cifra={String(r.pedidos)} nota={`${r.unidades} unidades`} />
        <Kpi style={ancho} etiqueta="Pedidos por día" cifra={r.pedidos_por_dia.toFixed(1).replace('.', ',')} />
        <Kpi
          style={ancho}
          etiqueta={modo === 'tecnico' ? 'Ticket promedio' : 'Gasta en promedio cada cliente'}
          cifra={fmt(r.ticket_promedio)}
          nota={Math.abs(r.ticket_mediano - r.ticket_promedio) > 0.01 ? `El cliente típico gastó ${fmt(r.ticket_mediano)}` : undefined}
        />
        <Kpi
          style={ancho}
          etiqueta="Contra el período anterior"
          cifra={cambio == null ? '—' : `${cambio > 0 ? '+' : ''}${cambio.toFixed(0)}%`}
          color={cambio == null ? undefined : cambio >= 0 ? t.exito : t.aviso}
          tono={cambio != null && cambio < 0 ? 'aviso' : undefined}
          nota={`Antes: ${fmt(r.anterior.ventas)} en ${r.anterior.pedidos} pedidos${incompleto ? ' · este período aún no termina' : ''}`}
        />
        <Kpi
          style={ancho}
          etiqueta="Facturadas"
          cifra={String(r.facturadas)}
          nota={r.pedidos ? `${((r.facturadas / r.pedidos) * 100).toFixed(0)}% de las ventas · ${fmt(r.valor_facturado)}` : undefined}
        />
        <Kpi
          style={ancho}
          etiqueta="Dinero perdido"
          cifra={fmt(r.perdidas.total)}
          tono={r.perdidas.pct_sobre_ventas > 3 ? 'aviso' : undefined}
          nota={`${r.perdidas.pct_sobre_ventas.toFixed(1).replace('.', ',')}% de lo vendido`}
        />
      </View>

      {r.serie.length > 0 ? (
        <Ficha style={{ gap: 10 }}>
          <Titulo>{`Ventas por ${r.granularidad} · ${SUFIJO[vista]}`}</Titulo>
          <Nota>
            {r.mejor ? `${nombre}. El mejor tramo fue ${r.mejor.etiqueta}: ${fmt(r.mejor.ventas)} en ${r.mejor.pedidos} pedidos.` : nombre}
          </Nota>
          <Boton
            texto="Ver la gráfica en Reportes"
            icono="reportes"
            tono="neutro"
            alTocar={() => router.push(`/reportes/ventas${consulta}` as Href)}
          />
        </Ficha>
      ) : null}

      <View style={[estilos.par, tablet && { flexDirection: 'row' }]}>
        <Ficha style={{ flex: 1 }}>
          <Titulo>Cómo te pagaron</Titulo>
          <Reparto
            filas={Object.entries(r.por_metodo_pago).map(([n, ventas]) => ({ nombre: etiquetaMetodo(n), ventas }))}
            total={r.ventas}
            fmt={fmt}
          />
        </Ficha>
        {r.por_operador.length > 1 || r.por_punto_venta.length > 1 ? (
          <Ficha style={{ flex: 1 }}>
            <Titulo>{r.por_operador.length > 1 ? 'Quién cobró' : 'Por caja'}</Titulo>
            <Reparto
              filas={(r.por_operador.length > 1 ? r.por_operador : r.por_punto_venta).map((g) => ({
                nombre: g.nombre,
                ventas: g.ventas,
                detalle: `${g.pedidos} pedidos`,
              }))}
              total={r.ventas}
              fmt={fmt}
            />
          </Ficha>
        ) : null}
      </View>
    </>
  )
}

/** Cada parte con su barra: cuanto de lo vendido entro por ahi. */
function Reparto({
  filas,
  total,
  fmt,
}: {
  filas: { nombre: string; ventas: number; detalle?: string }[]
  total: number
  fmt: (v: number) => string
}) {
  const t = useTema()
  if (filas.length === 0) return <Nota style={{ color: t.tenue, marginTop: 8 }}>Sin cobros en el período.</Nota>
  return (
    <View style={{ gap: 12, marginTop: 10 }}>
      {filas.map((f) => {
        const pct = total > 0 ? (f.ventas / total) * 100 : 0
        return (
          <View key={f.nombre}>
            <View style={estilos.repartoFila}>
              <Text style={[estilos.repartoNombre, { color: t.fuerte }]} numberOfLines={1}>
                {f.nombre}
                {f.detalle ? <Text style={{ color: t.tenue, fontFamily: LETRA.texto }}> · {f.detalle}</Text> : null}
              </Text>
              <Text style={[estilos.repartoValor, { color: t.tinta }]}>
                {fmt(f.ventas)} <Text style={{ color: t.tenue, fontSize: 13 }}>{pct.toFixed(0)}%</Text>
              </Text>
            </View>
            <View style={[estilos.barra, { backgroundColor: t.gris100 }]}>
              <View style={[estilos.barraLlena, { width: `${Math.min(100, pct)}%`, backgroundColor: t.acento }]} />
            </View>
          </View>
        )
      })}
    </View>
  )
}

const estilos = StyleSheet.create({
  rejilla: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  par: { gap: 12 },
  repartoFila: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 },
  repartoNombre: { flex: 1, fontFamily: LETRA.textoFuerte, fontSize: 14.5 },
  repartoValor: { fontFamily: LETRA.cifra, fontSize: 14.5 },
  barra: { height: 6, borderRadius: 3, marginTop: 6, overflow: 'hidden' },
  barraLlena: { height: '100%', borderRadius: 3 },
})
