import { useMemo } from 'react'
import { Text, View } from 'react-native'
import { etiquetaMetodo } from '../../../../frontend/src/lib/pagos'
import { LETRA, useTema } from '../../lib/tema'
import type { ReporteResumen } from '../../lib/tipos'
import Icono from '../Icono'
import { Ficha } from '../ui'
import { Bloque, c, Cifra, DosColumnas, Lecturas, Rejilla, Seccion, SerieTiempo, SinDatos } from './comunes'
import { capitalizar, enteros, grano, recortarSerie, usePalabra, type Dinero } from './cuentas'
import { BarrasDeCuenta, GraficoDona, Variacion, type FilaCuenta } from './Grafico'
import { usePaletaDatos, type PaletaDatos } from './paleta'

/**
 * EL RESUMEN, como Resumen en pages/Reportes.tsx de la web: lo basico que el
 * dueño necesita mirar. Las cuatro cifras, la serie de ventas, cuanto se
 * facturo y como pagaron, y de donde sale la ganancia con su analisis.
 *
 * CON UN FILTRO (una categoria, un producto) el resumen es el de ESA parte:
 * lo que es del pedido entero --como pagaron, cuanto se facturo, los gastos
 * del local-- no se reparte y no se muestra.
 */
export default function Resumen({
  datos,
  dinero,
  corto,
  sufijo,
}: {
  datos: ReporteResumen
  dinero: Dinero
  corto: (x: number) => string
  sufijo: string
}) {
  const t = useTema()
  const p = usePaletaDatos()
  const { nombre } = usePalabra()
  const ant = datos.anterior
  const vs = ant ? `vs ${ant.etiqueta}` : undefined
  const filtro = datos.filtro
  const de = filtro ? filtro.producto || filtro.categoria : ''
  // El mismo recorte que en Ventas: fuera los tramos vacios de los extremos.
  const { serie, anterior: serieAnterior } = useMemo(() => recortarSerie(datos.serie, datos.serie_anterior), [datos.serie, datos.serie_anterior])
  const g = grano(datos.granularidad)

  return (
    <>
      {/* ── 1. Las cifras ── */}
      <Rejilla>
        <Cifra
          titulo={de ? `Ventas de ${de}` : 'Ventas'}
          ayuda="kpi.ventas"
          valor={dinero(datos.ventas)}
          destacado
          delta={ant ? <Variacion pct={ant.cambio_ventas_pct} texto={vs} /> : undefined}
        />
        {filtro ? (
          <Cifra
            titulo="Deja"
            ayuda="kpi.deja"
            valor={dinero(datos.ganancia_bruta)}
            tono={datos.ganancia_bruta >= 0 ? 'bueno' : 'malo'}
            destacado
            delta={ant ? <Variacion pct={ant.cambio_ganancia_pct} texto={vs} /> : undefined}
            nota={datos.ventas > 0 ? `${datos.margen_pct.toFixed(0)}% de margen después de la mercancía` : undefined}
          />
        ) : (
          <Cifra
            titulo={nombre('kpi.ganancia_neta')}
            ayuda="kpi.ganancia_neta"
            valor={dinero(datos.ganancia_neta)}
            tono={datos.ganancia_neta >= 0 ? 'bueno' : 'malo'}
            destacado
            delta={ant ? <Variacion pct={ant.cambio_ganancia_pct} texto={vs} /> : undefined}
          />
        )}
        <Cifra
          titulo={filtro ? 'Pedidos que lo llevan' : 'Pedidos'}
          ayuda="kpi.pedidos"
          valor={String(datos.pedidos)}
          delta={ant ? <Variacion pct={ant.cambio_pedidos_pct} texto={vs} /> : undefined}
          nota={!filtro && datos.unidades > 0 ? `${enteros(datos.unidades)} unidades vendidas` : undefined}
        />
        {filtro ? (
          <Cifra titulo="Unidades" ayuda="kpi.unidades" valor={String(datos.unidades)} />
        ) : (
          <Cifra
            titulo={nombre('kpi.ticket_promedio')}
            ayuda="kpi.ticket_promedio"
            valor={dinero(datos.ticket_promedio)}
            delta={ant ? <Variacion pct={ant.cambio_ticket_pct} texto={vs} /> : undefined}
            nota={
              Math.abs(datos.ticket_mediano - datos.ticket_promedio) > 0.01 ? `el cliente típico gastó ${dinero(datos.ticket_mediano)}` : undefined
            }
          />
        )}
      </Rejilla>

      {/* ── 2. Las ventas: las unidades en barras, la plata en linea ──
          El bloque se queda aunque no haya ventas: un grafico que desaparece
          parece un error (Leider, 1-oct). */}
      <Bloque titulo="Ventas" descripcion="El detalle por hora, día y producto está en la pestaña Ventas.">
        <Seccion
          titulo={`Unidades y ventas por ${g}`}
          ayuda={`Barras: las unidades vendidas, eje izquierdo. Línea: la plata en ${sufijo}, eje derecho.${
            ant ? ` En gris, ${ant.etiqueta}, tramo a tramo.` : ''
          } La punteada es el promedio de unidades por ${g}.`}
        >
          <SerieTiempo
            alto={220}
            formato={enteros}
            formatoDetalle={enteros}
            puntos={serie.map((x) => ({
              etiqueta: x.etiqueta,
              valor: x.unidades,
              detalle: `${x.pedidos} ${x.pedidos === 1 ? 'pedido' : 'pedidos'}`,
            }))}
            anterior={ant && serieAnterior.length === serie.length ? serieAnterior.map((x) => x.unidades) : undefined}
            nombres={{ actual: 'Unidades', anterior: ant ? capitalizar(ant.etiqueta) : 'Período anterior' }}
            referencia={serie.length > 1 ? { valor: datos.unidades / serie.length, texto: 'promedio' } : undefined}
            lineas={[{ nombre: 'Ventas', valores: serie.map((x) => x.ventas) }]}
            formatoDerecha={corto}
          />
          {serie.length === 0 ? <SinDatos que="ventas" alto={220} /> : null}
        </Seccion>
      </Bloque>

      {/* ── 3. Facturacion y cobros (del negocio entero, no de un producto) ── */}
      {!filtro && (
        <Bloque titulo="Facturación y cobros">
          <DosColumnas>
            <Facturacion datos={datos} dinero={dinero} p={p} />
            <Seccion titulo="Cómo te pagaron" ayuda="Por pago, no por pedido: una venta mixta se reparte.">
              {datos.ventas > 0 ? (
                <GraficoDona
                  formato={dinero}
                  centro={{ valor: corto(datos.ventas), texto: 'cobrado' }}
                  partes={Object.entries(datos.por_metodo_pago)
                    .sort(([, a], [, b]) => b - a)
                    .map(([metodo, monto]) => ({ nombre: etiquetaMetodo(metodo), valor: monto }))}
                />
              ) : (
                <SinDatos que="cobros" />
              )}
            </Seccion>
          </DosColumnas>
        </Bloque>
      )}

      {/* ── 4. El resultado ── */}
      <Bloque
        titulo={filtro ? `Qué deja ${de}` : 'Resultado'}
        descripcion={
          filtro
            ? 'Lo vendido menos su mercancía. Los gastos del local no son de un producto.'
            : 'Los mismos números del Estado de Resultados en Contabilidad.'
        }
      >
        <DosColumnas>
          <Seccion
            titulo="De dónde sale la ganancia"
            ayuda="Lo vendido arriba; cada renglón se lleva un pedazo; lo que queda, abajo. La barra más larga es lo que más pesa."
          >
            <BarrasDeCuenta formato={dinero} filas={filasDeLaCuenta(datos, p, nombre('kpi.ganancia_neta'))} />
            {ant ? (
              <Text style={[c.nota, { color: t.suave, marginTop: 10 }]}>
                {capitalizar(ant.etiqueta)}: {dinero(ant.ventas)} en ventas y {dinero(ant.ganancia_neta)}{' '}
                {filtro ? 'de ganancia' : 'de ganancia neta'}.
              </Text>
            ) : null}
            {!filtro && (datos.pedidos_anulados > 0 || datos.devoluciones > 0) ? (
              <View style={{ backgroundColor: t.avisoSuave, borderRadius: 12, borderCurve: 'continuous', padding: 12, marginTop: 12 }}>
                <Text style={[c.nota, { color: t.avisoFuerte }]}>
                  {datos.pedidos_anulados > 0 ? `Se anularon ${datos.pedidos_anulados} pedido(s) por ${dinero(datos.valor_anulado)}. ` : ''}
                  {datos.devoluciones > 0
                    ? `${datos.devoluciones} venta(s) por ${dinero(datos.valor_devuelto)} fueron devueltas y ya no cuentan arriba. `
                    : ''}
                  El detalle está en Pérdidas.
                </Text>
              </View>
            ) : null}
          </Seccion>

          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingHorizontal: 2 }}>
              <Icono nombre="chispa" size={17} color={t.acento} />
              <Text style={{ fontFamily: LETRA.titulo, fontSize: 16, color: t.tinta }}>Análisis {de ? `de ${de}` : 'del negocio'}</Text>
              {/* Los avisos los redacta el servidor con cifras en dolares. */}
              {sufijo !== 'USD' ? <Text style={[c.nota, { color: t.tenue }]}>· cifras en dólares</Text> : null}
            </View>
            {datos.insights.length > 0 ? (
              <Lecturas items={datos.insights} />
            ) : (
              <Ficha style={{ padding: 16 }}>
                <Text style={[c.texto, { color: t.suave }]}>Nada que señalar en este período.</Text>
              </Ficha>
            )}
          </View>
        </DosColumnas>
      </Bloque>
    </>
  )
}

/** Los renglones de la cuenta: de las ventas a lo que queda. */
function filasDeLaCuenta(datos: ReporteResumen, p: PaletaDatos, gananciaNeta: string): FilaCuenta[] {
  const filtro = datos.filtro
  const de = filtro ? filtro.producto || filtro.categoria : ''
  const filas: FilaCuenta[] = [{ nombre: filtro ? `Ventas de ${de}` : 'Ventas cobradas', valor: datos.ventas, tipo: 'base' }]
  if (datos.iva_cobrado > 0) {
    filas.push({ nombre: 'IVA cobrado', nota: 'se le debe al SENIAT', valor: -datos.iva_cobrado })
    filas.push({ nombre: 'Ingreso del negocio', valor: datos.ingresos_netos, tipo: 'subtotal' })
  }
  filas.push({ nombre: 'Costo de la mercancía', valor: -datos.costo_insumos, color: p.neutro })
  const margen = datos.ventas > 0 ? `${datos.margen_pct.toFixed(0)}% de margen` : undefined
  if (filtro) {
    filas.push({ nombre: 'Deja', valor: datos.ganancia_bruta, tipo: 'resultado', nota: margen })
    return filas
  }
  filas.push({ nombre: 'Ganancia bruta', valor: datos.ganancia_bruta, tipo: 'subtotal', nota: margen })
  // CUANDO LOS GASTOS SON NEGATIVOS, EL RENGLON CAMBIA DE NOMBRE: un reverso
  // de merma o un sobrante de conteo restan gasto, y con el rotulo fijo la
  // cuenta se leia al reves (Leider, 24-sep).
  if (datos.gastos >= 0) filas.push({ nombre: 'Gastos, mermas y faltantes', valor: -datos.gastos, color: p.ojo })
  else filas.push({ nombre: 'Sobrantes y reversos', nota: 'suman', valor: -datos.gastos })
  filas.push({ nombre: gananciaNeta, valor: datos.ganancia_neta, tipo: 'resultado' })
  return filas
}

/**
 * Cuanto de lo vendido llego a tener factura: una barra partida en dos. El
 * porcentaje grande es la respuesta; la lista da las ventas y la plata.
 */
function Facturacion({ datos, dinero, p }: { datos: ReporteResumen; dinero: Dinero; p: PaletaDatos }) {
  const t = useTema()
  const sinFacturar = Math.max(Math.round((datos.ventas - datos.valor_facturado) * 100) / 100, 0)
  const pct = datos.ventas > 0 ? (datos.valor_facturado / datos.ventas) * 100 : 0
  const ventasSinFactura = Math.max(datos.pedidos - datos.facturadas, 0)
  return (
    <Seccion
      titulo="Cuánto se facturó"
      ayuda="No todo se factura al momento: se puede decidir después, desde el histórico de Ventas."
      accion={
        <Text style={{ fontFamily: LETRA.tituloFuerte, fontSize: 28, color: t.tinta, letterSpacing: -0.6 }}>
          {datos.ventas > 0 ? `${pct.toFixed(0)}%` : '—'}
          <Text style={[c.nota, { color: t.suave }]}> facturado</Text>
        </Text>
      }
    >
      {datos.ventas === 0 ? (
        <SinDatos que="ventas" alto={120} />
      ) : (
        <GraficoDona
          pastel
          formato={dinero}
          partes={[
            {
              nombre: 'Con factura',
              valor: datos.valor_facturado,
              detalle: `${datos.facturadas} ${datos.facturadas === 1 ? 'venta' : 'ventas'}`,
              color: p.bien,
            },
            { nombre: 'Sin factura', valor: sinFacturar, detalle: `${ventasSinFactura} ${ventasSinFactura === 1 ? 'venta' : 'ventas'}`, color: p.neutro },
          ]}
        />
      )}
      {datos.iva_cobrado > 0 ? (
        <Text style={[c.nota, { color: t.suave, marginTop: 12 }]}>
          De la parte facturada salen {dinero(datos.iva_cobrado)} de IVA que se le deben al SENIAT. Lo que no se facturó no genera IVA.
        </Text>
      ) : null}
    </Seccion>
  )
}
