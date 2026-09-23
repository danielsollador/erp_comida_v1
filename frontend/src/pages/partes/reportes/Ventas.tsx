import { useState } from 'react'
import { Ayuda } from '../../../components/Ayuda'
import {
  BarrasApiladas,
  GraficoBarras,
  GraficoDona,
  GraficoLineas,
  MapaCalor,
  PALETA_CATEGORICA,
} from '../../../components/Grafico'
import { Tabla, Th, useOrden } from '../../../components/Tabla'
import { Seccion } from '../../../components/ui'
import { explicar } from '../../../lib/glosario'
import type { ParCombo, ProductoVendido, ReporteCombos, ReporteResumen } from '../../../lib/types'
import { Bloque, DIA_LARGO, Vacio, type Dinero } from './comunes'

/**
 * La seccion Ventas: cuando se vende, que se vende y que se vende junto.
 *
 * Eran tres pestañas ("Cuando se vende", "Que se vendio", "Combinaciones") y
 * el Resumen repetia parte de las dos primeras. Ahora es UNA seccion en tres
 * bloques con nombre, en el orden en que se pregunta: primero cuando, luego
 * que, luego con que.
 */
export default function Ventas({
  datos,
  combos,
  dinero,
  corto,
  fmt,
}: {
  datos: ReporteResumen
  combos: ReporteCombos | null
  dinero: Dinero
  corto: (x: number) => string
  fmt: (usd: number | null | undefined, decimales?: number) => string
}) {
  // Los hooks antes de cualquier salida temprana.
  const ordenProductos = useOrden<ProductoVendido>({
    producto: (p) => p.nombre,
    uds: (p) => p.unidades,
    ingresos: (p) => p.ingresos,
    ganancia: (p) => p.ganancia,
    margen: (p) => p.margen_pct,
  })
  const ordenCombos = useOrden<ParCombo>({
    combinacion: (p) => `${p.producto} ${p.acompanante}`,
    veces: (p) => p.juntos,
    confianza: (p) => p.confianza_pct,
  })
  const [medida, setMedida] = useState<'pedidos' | 'ventas'>('pedidos')

  const ant = datos.anterior
  const mejor = datos.serie.reduce<(typeof datos.serie)[number] | null>(
    (m, p) => (p.pedidos > 0 && (!m || p.ventas > m.ventas) ? p : m),
    null,
  )

  // ── Cuando: el mapa y los dias ──
  const conVentas = datos.por_dia_semana.filter((d) => d.pedidos > 0)
  const mejorDia = conVentas.reduce<(typeof conVentas)[number] | null>(
    (m, d) => (!m || (d.promedio ?? 0) > (m.promedio ?? 0) ? d : m),
    null,
  )
  const porHora = new Map<number, { pedidos: number; ventas: number }>()
  for (const c of datos.calor) {
    const h = porHora.get(c.hora) ?? { pedidos: 0, ventas: 0 }
    h.pedidos += c.pedidos
    h.ventas += c.ventas
    porHora.set(c.hora, h)
  }
  const horas = [...porHora.entries()].sort(([a], [b]) => a - b)
  const horaPico = horas.reduce<[number, { pedidos: number; ventas: number }] | null>(
    (m, h) => (!m || h[1].pedidos > m[1].pedidos ? h : m),
    null,
  )
  const unDia = datos.calor.length === 0 && datos.por_dia_semana.length === 0

  // ── Que ──
  const conCosto = datos.top_productos.filter((p) => !p.sin_receta)

  return (
    <>
      {/* ── 1. Cuando se vende ─────────────────────────────────────────── */}
      <Bloque titulo="Cuándo se vende" descripcion="La hora es la de tomar el pedido, no la de cobrarlo.">
        {datos.serie.length > 0 ? (
          <Seccion
            titulo={`Ventas por ${datos.granularidad}`}
            ayuda={
              ant
                ? `La línea punteada es ${ant.etiqueta}, tramo a tramo: la misma hora, el mismo día de la semana.`
                : undefined
            }
          >
            <GraficoLineas
              alto={240}
              etiquetas={datos.serie.map((p) => p.etiqueta)}
              formato={corto}
              formatoDetalle={(n) => dinero(n)}
              series={[
                {
                  nombre: 'Este período',
                  color: 'var(--color-neutral-900)',
                  valores: datos.serie.map((p) => p.ventas),
                  relleno: true,
                },
                ...(datos.serie_anterior.length === datos.serie.length && ant
                  ? [
                      {
                        nombre: `${ant.etiqueta[0].toUpperCase()}${ant.etiqueta.slice(1)}`,
                        color: 'var(--color-neutral-400)',
                        valores: datos.serie_anterior.map((p) => p.ventas),
                        punteada: true,
                      },
                    ]
                  : []),
              ]}
              pie={
                mejor
                  ? `mejor tramo: ${mejor.etiqueta}, ${dinero(mejor.ventas)} en ${mejor.pedidos} pedido(s)`
                  : undefined
              }
            />
          </Seccion>
        ) : (
          <Vacio>Todavía no hay ventas en este período.</Vacio>
        )}

        {unDia ? (
          datos.pedidos > 0 && (
            <Vacio>
              Con un solo día la pregunta la responde el gráfico de horas de arriba. Elige una
              semana o un mes en el filtro para ver qué días y horas concentran la venta.
            </Vacio>
          )
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-3">
            {datos.calor.length > 0 && (
              <Seccion
                titulo="A qué hora y qué día entran los clientes"
                ayuda="Cada casilla es un día de la semana a una hora, sumando todo el período. Más oscuro, más pedidos."
                accion={
                  <div className="flex rounded-lg border border-neutral-200 overflow-hidden text-xs">
                    {(['pedidos', 'ventas'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setMedida(m)}
                        className={`px-2.5 py-1 ${medida === m ? 'bg-neutral-900 text-white' : 'text-neutral-600'}`}
                      >
                        {m === 'pedidos' ? 'Pedidos' : 'Ventas'}
                      </button>
                    ))}
                  </div>
                }
              >
                <MapaCalor celdas={datos.calor} medida={medida} formato={dinero} />
                {horaPico && (
                  <p className="text-xs text-neutral-500 mt-3">
                    La hora con más pedidos es las {horaPico[0]}:00, con {horaPico[1].pedidos} en el
                    período.
                  </p>
                )}
              </Seccion>
            )}
            <div className="space-y-3">
              {datos.por_dia_semana.length > 0 && (
                <Seccion
                  titulo="Qué día vendes más"
                  ayuda={
                    <Ayuda explica={explicar('kpi.dia_tipico')} titulo="Día típico">
                      Lo que vende un día típico de cada uno, no la suma de todos.
                    </Ayuda>
                  }
                >
                  <GraficoBarras
                    alto={140}
                    formato={corto}
                    datos={datos.por_dia_semana.map((d) => ({
                      etiqueta: d.nombre,
                      valor: d.promedio ?? 0,
                      detalle: `${d.pedidos} pedidos en total`,
                    }))}
                    resaltar={(d) => d.etiqueta === mejorDia?.nombre}
                  />
                  {mejorDia && conVentas.length > 1 && (
                    <p className="text-xs text-neutral-500 mt-2">
                      El {DIA_LARGO[mejorDia.nombre] ?? mejorDia.nombre.toLowerCase()} típico vende{' '}
                      {dinero(mejorDia.promedio ?? 0)}.
                    </p>
                  )}
                </Seccion>
              )}
              {horas.length > 0 && (
                <Seccion titulo="Pedidos por hora" ayuda="Sumando todos los días del período.">
                  <GraficoBarras
                    alto={140}
                    formato={(n) => `${n}`}
                    datos={horas.map(([h, v]) => ({
                      etiqueta: `${h}`,
                      valor: v.pedidos,
                      detalle: dinero(v.ventas),
                    }))}
                    resaltar={(d) => horaPico != null && d.etiqueta === `${horaPico[0]}`}
                  />
                </Seccion>
              )}
            </div>
          </div>
        )}
      </Bloque>

      {/* ── 2. Que se vendio ──────────────────────────────────────────── */}
      <Bloque titulo="Qué se vendió" descripcion="Ordenado por ingresos; toca una columna para ordenar por otra.">
        {datos.top_productos.length === 0 ? (
          <Vacio>Todavía no se vendió nada en este período.</Vacio>
        ) : (
          <>
            <div className="grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-3">
              <Seccion
                titulo="Cuánto vende y cuánto deja cada producto"
                ayuda="La barra completa es el ingreso; la parte verde, lo que quedó después de la mercancía."
              >
                <BarrasApiladas
                  formato={dinero}
                  leyenda={[
                    { nombre: 'Costo de la mercancía', color: 'var(--color-neutral-300)' },
                    { nombre: 'Ganancia', color: 'var(--color-exito-500)' },
                    { nombre: 'Sin receta (costo desconocido)', color: 'var(--color-aviso-300)' },
                  ]}
                  filas={datos.top_productos.slice(0, 8).map((p) => ({
                    nombre: p.nombre,
                    detalle: p.sin_receta ? '?' : `${p.margen_pct.toFixed(0)}%`,
                    partes: p.sin_receta
                      ? [{ nombre: 'Ingreso (sin costo conocido)', valor: p.ingresos, color: 'var(--color-aviso-300)' }]
                      : [
                          { nombre: 'Costo de la mercancía', valor: p.costo, color: 'var(--color-neutral-300)' },
                          { nombre: 'Ganancia', valor: Math.max(p.ganancia, 0), color: 'var(--color-exito-500)' },
                        ],
                  }))}
                />
                {conCosto.length > 0 && (
                  <p className="text-xs text-neutral-500 mt-3">
                    En total, {corto(conCosto.reduce((s, p) => s + p.ingresos, 0))} vendidos con receta
                    dejaron {corto(conCosto.reduce((s, p) => s + p.ganancia, 0))} de ganancia bruta.
                  </p>
                )}
              </Seccion>
              {datos.por_categoria.length > 0 && (
                <Seccion titulo="Qué parte es comida, bebida, envíos" ayuda="Por la categoría de cada producto en el menú.">
                  <GraficoDona
                    formato={dinero}
                    centro={{ valor: String(datos.por_categoria.length), texto: 'categorías' }}
                    partes={datos.por_categoria.map((g, i) => ({
                      nombre: g.nombre,
                      valor: g.ventas,
                      detalle: `${g.pedidos} pedidos`,
                      color: PALETA_CATEGORICA[(i + 1) % PALETA_CATEGORICA.length],
                    }))}
                  />
                </Seccion>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-neutral-200 p-4">
              <h2 className="font-semibold mb-3">Producto por producto</h2>
              <Tabla orden={ordenProductos} glosario="productos">
                <table className="w-full text-sm">
                  <thead className="text-neutral-500 text-xs uppercase">
                    <tr>
                      <Th clave="producto" className="py-2 px-0">Producto</Th>
                      <Th clave="uds" alinear="derecha" className="py-2 px-0">Uds</Th>
                      <Th clave="ingresos" alinear="derecha" className="py-2 px-0">Ingresos</Th>
                      <Th clave="ganancia" alinear="derecha" className="py-2 px-0">Ganancia</Th>
                      <Th clave="margen" alinear="derecha" className="py-2 px-0">Margen</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordenProductos.ordenar(datos.top_productos).map((p) => (
                      <tr key={p.nombre} className="border-t border-neutral-100">
                        <td className="py-2 font-medium">
                          {p.nombre}
                          {p.sin_receta && (
                            <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-aviso-700 bg-aviso-50 rounded px-1.5 py-0.5">
                              sin receta
                            </span>
                          )}
                        </td>
                        <td className="text-right py-2 tabular-nums">{p.unidades}</td>
                        <td className="text-right py-2 tabular-nums">{dinero(p.ingresos)}</td>
                        {/* Sin receta no hay costo: la ganancia seria todo el
                            ingreso y el margen 100%, y eso no significa nada. */}
                        <td className="text-right py-2 tabular-nums">
                          {p.sin_receta ? <span className="text-neutral-400">—</span> : dinero(p.ganancia)}
                        </td>
                        <td
                          className={`text-right py-2 tabular-nums font-semibold ${
                            p.sin_receta
                              ? 'text-neutral-400'
                              : p.margen_pct >= 50
                                ? 'text-exito-600'
                                : p.margen_pct >= 30
                                  ? 'text-aviso-600'
                                  : 'text-peligro-600'
                          }`}
                        >
                          {p.sin_receta ? '?' : `${p.margen_pct.toFixed(0)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Tabla>
            </div>
          </>
        )}
      </Bloque>

      {/* ── 3. Que se vende junto ─────────────────────────────────────── */}
      {combos && (
        <Bloque titulo="Qué se vende junto" descripcion="Sobre los pedidos cobrados del período.">
          {!combos.suficientes_datos ? (
            <Vacio>
              Llevas {combos.pedidos_analizados} pedido(s) cobrados en este período. Con unos cuantos
              más el sistema puede decirte qué productos salen juntos y qué ofrecer en caja.
            </Vacio>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-3">
              <Seccion
                titulo="Combinaciones"
                ayuda={`Sobre ${combos.pedidos_analizados} pedidos. La confianza es: de cada 100 pedidos con el primero, cuántos llevaron también el segundo.`}
              >
                {combos.pares.length > 0 ? (
                  <Tabla orden={ordenCombos} glosario="combos">
                    <table className="w-full text-sm">
                      <thead className="text-neutral-500 text-xs uppercase">
                        <tr>
                          <Th clave="combinacion" className="pb-2 px-0">Combinación</Th>
                          <Th clave="veces" alinear="derecha" className="pb-2 px-0">Veces</Th>
                          <Th clave="confianza" alinear="derecha" className="pb-2 px-0">Confianza</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {ordenCombos.ordenar(combos.pares).map((par) => (
                          <tr key={`${par.producto}-${par.acompanante}`} className="border-t border-neutral-100">
                            <td className="py-2">
                              <span className="font-medium">{par.producto}</span>
                              <span className="text-neutral-400"> + </span>
                              <span className="font-medium">{par.acompanante}</span>
                            </td>
                            <td className="text-right py-2 tabular-nums text-neutral-500">{par.juntos}</td>
                            <td className="text-right py-2 tabular-nums font-medium">{par.confianza_pct}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Tabla>
                ) : (
                  <p className="text-neutral-400 text-sm">
                    Todavía no hay un par que se repita lo suficiente como para llamarlo patrón.
                  </p>
                )}
              </Seccion>

              {combos.acompanamiento && (
                <Seccion titulo="Cuántos se van sin bebida">
                  <div className="flex h-3 rounded-full overflow-hidden bg-neutral-100 mb-2">
                    <div className="bg-exito-500" style={{ width: `${combos.acompanamiento.con_bebida_pct}%` }} />
                    <div className="bg-aviso-400" style={{ width: `${combos.acompanamiento.sin_bebida_pct}%` }} />
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-exito-700 font-medium tabular-nums">
                      {combos.acompanamiento.con_bebida_pct}% con bebida
                    </span>
                    <span className="text-aviso-700 font-medium tabular-nums">
                      {combos.acompanamiento.sin_bebida_pct}% sin bebida
                    </span>
                  </div>
                  {combos.oportunidad && (
                    <p className="text-sm text-neutral-700 mt-3 pt-3 border-t border-neutral-100">
                      <span className="font-semibold">{combos.oportunidad.pedidos_sin_bebida} pedidos</span>{' '}
                      salieron sin nada de tomar. Si el cajero lograra convencer a{' '}
                      {combos.oportunidad.conversion_supuesta_pct} de cada 100, serían{' '}
                      <span className="font-semibold text-exito-700">{fmt(combos.oportunidad.venta_potencial)}</span>{' '}
                      más de venta y {fmt(combos.oportunidad.ganancia_potencial)} de ganancia.
                    </p>
                  )}
                </Seccion>
              )}
            </div>
          )}
        </Bloque>
      )}
    </>
  )
}
