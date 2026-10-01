import { useMemo, useState } from 'react'
import { nombre } from '../../../lib/palabras'
import { Ayuda } from '../../../components/Ayuda'
import { BarrasGanancia, GraficoBarras, GraficoDona, MapaCalor } from '../../../components/Grafico'
import { colorSerie } from '../../../lib/paleta'
import { Tabla, Th, useOrden } from '../../../components/Tabla'
import { Filtros, Seccion } from '../../../components/ui'
import { explicar } from '../../../lib/glosario'
import type { ParCombo, ProductoVendido, ReporteCombos, ReporteResumen } from '../../../lib/types'
import { Bloque, DIA_LARGO, SerieTiempo, Vacio, capitalizar, enteros, recortarSerie, type Dinero } from './comunes'

/** Un cambio de filtro pedido desde un grafico: tocar un producto, una categoria. */
export type CambioFiltro = { c?: string; p?: string }

/**
 * La seccion Ventas: cuando se vende, que se vende y que se vende junto.
 *
 * Eran tres pestañas ("Cuando se vende", "Que se vendio", "Combinaciones") y
 * el Resumen repetia parte de las dos primeras. Ahora es UNA seccion en tres
 * bloques con nombre, en el orden en que se pregunta: primero cuando, luego
 * que, luego con que.
 *
 * SE BAJA TOCANDO. Una categoria en "que parte es cada una" o un producto en
 * "cuanto deja cada uno" se tocan y la pantalla entera se queda con eso: es
 * el mismo filtro de la fila de arriba, puesto desde el grafico. Con un
 * producto elegido, el reparto por categoria no tiene de que hablar y se va.
 */
export default function Ventas({
  datos,
  combos,
  dinero,
  corto,
  fmt,
  paso,
  alCambiarPaso,
  alFiltrar,
}: {
  datos: ReporteResumen
  combos: ReporteCombos | null
  dinero: Dinero
  corto: (x: number) => string
  fmt: (usd: number | null | undefined, decimales?: number) => string
  /** El grano elegido: 'auto' | 'dia' | 'semana' | 'mes'. */
  paso: string
  alCambiarPaso: (id: string) => void
  alFiltrar: (cambios: CambioFiltro) => void
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
  const filtro = datos.filtro
  const de = filtro ? filtro.producto || filtro.categoria : ''
  const unProducto = filtro?.producto_id != null
  const unaCategoria = !unProducto && filtro?.categoria_id != null

  // Recorta los tramos vacios de los extremos (ver `comunes.recortarSerie`).
  const { serie, anterior: serieAnterior } = useMemo(
    () => recortarSerie(datos.serie, datos.serie_anterior),
    [datos.serie, datos.serie_anterior],
  )

  const mejor = serie.reduce<(typeof serie)[number] | null>(
    (m, p) => (p.pedidos > 0 && (!m || p.ventas > m.ventas) ? p : m),
    null,
  )
  const promedioTramo = serie.length > 0 ? datos.ventas / serie.length : 0

  // ── Cuando: el mapa y los dias ──
  const conVentas = datos.por_dia_semana.filter((d) => d.pedidos > 0)
  const mejorDia = conVentas.reduce<(typeof conVentas)[number] | null>(
    (m, d) => (!m || (d.promedio ?? 0) > (m.promedio ?? 0) ? d : m),
    null,
  )
  const diasConPromedio = datos.por_dia_semana.filter((d) => d.promedio != null && d.pedidos > 0)
  const promedioDia =
    diasConPromedio.length > 0 ? diasConPromedio.reduce((t, d) => t + (d.promedio ?? 0), 0) / diasConPromedio.length : 0
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
  const sinReceta = datos.top_productos.filter((p) => p.sin_receta)
  const totalCategorias = datos.por_categoria.reduce((t, g) => t + g.ventas, 0)

  return (
    <>
      {/* ── 1. Cuando se vende ─────────────────────────────────────────── */}
      <Bloque titulo={de ? `Cuándo se vende ${de}` : 'Cuándo se vende'} descripcion="La hora es la de tomar el pedido, no la de cobrarlo.">
        {serie.length > 0 ? (
          <Seccion
            titulo={`Ventas y unidades por ${datos.granularidad}`}
            ayuda={`Barras: la plata, eje izquierdo. Línea: las unidades vendidas, eje derecho.${
              ant ? ` En gris, ${ant.etiqueta}, tramo a tramo: la misma hora, el mismo día de la semana.` : ''
            } La punteada es el promedio de plata por ${datos.granularidad}.`}
            /* EL GRANO LO ELIGE EL DUEÑO. El automatico mira el largo del
               rango y casi siempre acierta, pero "casi" no sirve cuando lo
               que quieres ver es justo el dia (Leider, 24-sep). Va en la
               esquina de la tarjeta, que es donde se busca un ajuste del
               grafico y no una accion de la pantalla. */
            accion={
              <Filtros
                tamano="chico"
                activo={paso}
                alElegir={alCambiarPaso}
                opciones={[
                  { valor: 'auto', texto: 'Auto' },
                  { valor: 'dia', texto: 'Día' },
                  { valor: 'semana', texto: 'Semana' },
                  { valor: 'mes', texto: 'Mes' },
                ]}
              />
            }
          >
            <SerieTiempo
              alto={240}
              formato={corto}
              formatoDetalle={(n) => dinero(n)}
              puntos={serie.map((p) => ({
                etiqueta: p.etiqueta,
                valor: p.ventas,
                detalle: `${p.pedidos} ${p.pedidos === 1 ? 'pedido' : 'pedidos'}`,
              }))}
              anterior={ant && serieAnterior.length === serie.length ? serieAnterior.map((p) => p.ventas) : undefined}
              nombres={{ actual: 'Ventas', anterior: ant ? capitalizar(ant.etiqueta) : 'Período anterior' }}
              referencia={serie.length > 1 ? { valor: promedioTramo, texto: 'promedio' } : undefined}
              lineas={[{ nombre: 'Unidades', valores: serie.map((p) => p.unidades) }]}
              formatoDerecha={enteros}
              pie={
                mejor
                  ? `mejor tramo: ${mejor.etiqueta}, ${dinero(mejor.ventas)} en ${mejor.pedidos} pedido(s)`
                  : undefined
              }
            />
          </Seccion>
        ) : (
          <Vacio>Todavía no hay ventas {de ? `de ${de} ` : ''}en este período.</Vacio>
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
                ayuda="Cada casilla es una hora de un día de la semana, sumando todo el período. Más oscuro, más movimiento."
                accion={
                  <Filtros
                    tamano="chico"
                    activo={medida}
                    alElegir={setMedida}
                    opciones={[
                      { valor: 'pedidos', texto: 'Pedidos' },
                      { valor: 'ventas', texto: 'Ventas' },
                    ]}
                  />
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
            {/* Las dos tarjetas reparten el alto del mapa de calor de al lado:
                con alto fijo se quedaban cortas y la fila terminaba escalonada
                (Leider, 30-sep). */}
            <div className="flex flex-col gap-3">
              {datos.por_dia_semana.length > 0 && (
                <Seccion
                  estirar
                  titulo="Qué día vendes más"
                  ayuda={
                    <Ayuda explica={explicar('kpi.dia_tipico')} titulo="Día típico">
                      Lo que vende un día típico de cada uno, no la suma de todos. La línea punteada es el promedio.
                    </Ayuda>
                  }
                >
                  <GraficoBarras
                    estirar
                    // Con centavos cuando los dias tipicos son chicos: "$0 $0
                    // $1 $1" no compara nada.
                    formato={(promedioDia < 10 ? dinero : corto) as (n: number) => string}
                    datos={datos.por_dia_semana.map((d) => ({
                      etiqueta: d.nombre,
                      valor: d.promedio ?? 0,
                      detalle: `${d.pedidos} pedidos en total`,
                    }))}
                    resaltar={(d) => d.etiqueta === mejorDia?.nombre}
                    referencia={diasConPromedio.length > 1 ? { valor: promedioDia, texto: 'promedio' } : undefined}
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
                <Seccion estirar titulo="Pedidos por hora" ayuda="Sumando todos los días del período.">
                  <GraficoBarras
                    estirar
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
      <Bloque
        titulo={unProducto ? `Qué dejó ${de}` : unaCategoria ? `Qué se vendió de ${de}` : 'Qué se vendió'}
        descripcion={unProducto ? undefined : 'Ordenado por ingresos. Toca un producto para ver solo ese.'}
      >
        {datos.top_productos.length === 0 ? (
          <Vacio>Todavía no se vendió nada {de ? `de ${de} ` : ''}en este período.</Vacio>
        ) : (
          <>
            <div className={`grid grid-cols-1 gap-3 ${unProducto ? '' : 'xl:grid-cols-[3fr_2fr]'}`}>
              <Seccion
                titulo="Cuánto vende y cuánto deja cada producto"
                ayuda="Verde, lo que te queda de cada venta después de pagar la mercancía."
              >
                <BarrasGanancia
                  formato={dinero}
                  filas={datos.top_productos.map((p) => ({
                    nombre: p.nombre,
                    ingreso: p.ingresos,
                    costo: p.sin_receta ? null : p.costo,
                    unidades: p.unidades,
                    id: p.producto_id,
                  }))}
                  alTocar={unProducto ? undefined : (f) => alFiltrar({ p: String(f.id) })}
                />
                {/* Sin receta no hay costo: la barra va rayada y la fila dice
                    "sin receta". Aqui, cuantos son y donde se arregla. */}
                {sinReceta.length > 0 && (
                  <p className="text-sm text-aviso-800 bg-aviso-500/10 rounded-xl px-3 py-2.5 mt-3">
                    {sinReceta.length === 1
                      ? '1 producto no tiene receta, así que no se sabe cuánto deja. '
                      : `${sinReceta.length} productos no tienen receta, así que no se sabe cuánto dejan. `}
                    <a href="/menu?s=recetas" className="underline font-medium whitespace-nowrap">
                      Cargar recetas
                    </a>
                  </p>
                )}
              </Seccion>
              {/* El reparto: por categoria del menu; dentro de una categoria,
                  por producto. Con un solo producto no hay reparto. */}
              {!unProducto && unaCategoria && datos.top_productos.length > 0 && (
                <Seccion titulo={`Qué parte es cada producto de ${de}`} ayuda="Sobre lo vendido de la categoría. Toca uno para verlo solo.">
                  <GraficoDona
                    formato={dinero}
                    centro={{
                      valor: dinero(datos.ventas),
                      texto: `en ${datos.top_productos.length} ${datos.top_productos.length === 1 ? 'producto' : 'productos'}`,
                    }}
                    partes={datos.top_productos.map((p, i) => ({
                      nombre: p.nombre,
                      valor: p.ingresos,
                      detalle: `${p.unidades} ${p.unidades === 1 ? 'unidad' : 'unidades'}`,
                      color: colorSerie(i),
                      id: p.producto_id,
                    }))}
                    alTocar={(parte) => alFiltrar({ p: String(parte.id) })}
                  />
                </Seccion>
              )}
              {!unProducto && !unaCategoria && datos.por_categoria.length > 0 && (
                <Seccion titulo="Qué parte es comida, bebida, envíos" ayuda="Por la categoría de cada producto en el menú. Toca una para ver solo esa.">
                  <GraficoDona
                    formato={dinero}
                    centro={{
                      valor: dinero(totalCategorias),
                      texto: `vendidos en ${datos.por_categoria.length} categoría${datos.por_categoria.length === 1 ? '' : 's'}`,
                    }}
                    partes={datos.por_categoria.map((g, i) => ({
                      nombre: g.nombre,
                      valor: g.ventas,
                      detalle: `${g.pedidos} ${g.pedidos === 1 ? 'pedido' : 'pedidos'}`,
                      color: colorSerie(i),
                      id: g.id,
                    }))}
                    alTocar={(parte) => alFiltrar({ c: String(parte.id), p: '' })}
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
                      <Th clave="uds" alinear="derecha" className="py-2 px-0">{nombre('productos.uds')}</Th>
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
                          {!filtro && p.categoria && (
                            <span className="ml-2 text-xs font-normal text-neutral-400">{p.categoria}</span>
                          )}
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
        <Bloque
          titulo={de ? `Qué se vende junto con ${de}` : 'Qué se vende junto'}
          descripcion={de ? `Sobre los pedidos cobrados del período que llevan ${de}.` : 'Sobre los pedidos cobrados del período.'}
        >
          {!combos.suficientes_datos ? (
            <Vacio>
              Llevas {combos.pedidos_analizados} pedido(s) cobrados {de ? `con ${de} ` : ''}en este período. Con unos cuantos
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
