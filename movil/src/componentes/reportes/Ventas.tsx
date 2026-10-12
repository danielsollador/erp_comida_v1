import { useMemo, useState } from 'react'
import { Text, View } from 'react-native'
import { abrir } from '../../lib/modulos'
import { LETRA, useTema } from '../../lib/tema'
import type { ParCombo, ProductoVendido, ReporteCombos, ReporteResumen } from '../../lib/tipos'
import { Pastilla } from '../kit'
import { Ficha } from '../ui'
import { Bloque, c, DosColumnas, Enlace, Segmentado, Seccion, SerieTiempo, SinDatos, Vacio } from './comunes'
import { capitalizar, enteros, grano, recortarSerie, usePalabra, type Dinero } from './cuentas'
import { BarrasGanancia, GraficoBarras, GraficoDona, MapaCalor } from './Grafico'
import { colorSerie, usePaletaDatos } from './paleta'
import { TablaDatos } from './Tabla'

/** Un cambio de filtro pedido desde un grafico: tocar un producto, una categoria. */
export type CambioFiltro = { c?: string[]; p?: string[] }

// El backend etiqueta los dias en corto ("Sab"); en una frase se dice entero.
const DIA_LARGO: Record<string, string> = {
  Lun: 'lunes',
  Mar: 'martes',
  Mie: 'miércoles',
  Jue: 'jueves',
  Vie: 'viernes',
  Sab: 'sábado',
  Dom: 'domingo',
}

/**
 * LA SECCION VENTAS, como pages/partes/reportes/Ventas.tsx de la web: cuando
 * se vende, que se vende y que se vende junto, en ese orden.
 *
 * SE BAJA TOCANDO: una categoria en "que parte es cada una" o un producto en
 * "cuanto deja cada uno" se tocan y la pantalla entera se queda con eso. Es
 * el mismo filtro de la fila de arriba, puesto desde el grafico.
 *
 * El grano de la serie (Auto / Día / Semana / Mes) esta en la fila de
 * filtros de arriba ("Gráfico"), junto al periodo.
 */
export default function Ventas({
  datos,
  combos,
  dinero,
  corto,
  fmt,
  alFiltrar,
}: {
  datos: ReporteResumen
  combos: ReporteCombos | null
  dinero: Dinero
  corto: (x: number) => string
  fmt: (usd: number | null | undefined, decimales?: number) => string
  alFiltrar: (cambios: CambioFiltro) => void
}) {
  const t = useTema()
  const p = usePaletaDatos()
  const { nombre } = usePalabra()
  const [medida, setMedida] = useState<'pedidos' | 'ventas'>('pedidos')

  const ant = datos.anterior
  const filtro = datos.filtro
  const de = filtro ? filtro.producto || filtro.categoria : ''
  const unProducto = filtro?.producto_id != null
  const unaCategoria = !unProducto && filtro?.categoria_id != null
  const g = grano(datos.granularidad)

  const { serie, anterior: serieAnterior } = useMemo(() => recortarSerie(datos.serie, datos.serie_anterior), [datos.serie, datos.serie_anterior])
  const mejor = serie.reduce<(typeof serie)[number] | null>((m, x) => (x.pedidos > 0 && (!m || x.ventas > m.ventas) ? x : m), null)

  // ── Cuando: el mapa y los dias ──
  const conVentas = datos.por_dia_semana.filter((d) => d.pedidos > 0)
  const mejorDia = conVentas.reduce<(typeof conVentas)[number] | null>((m, d) => (!m || (d.promedio ?? 0) > (m.promedio ?? 0) ? d : m), null)
  const diasConPromedio = datos.por_dia_semana.filter((d) => d.promedio != null && d.pedidos > 0)
  const promedioDia = diasConPromedio.length > 0 ? diasConPromedio.reduce((s, d) => s + (d.promedio ?? 0), 0) / diasConPromedio.length : 0
  const porHora = new Map<number, { pedidos: number; ventas: number }>()
  for (const celda of datos.calor) {
    const h = porHora.get(celda.hora) ?? { pedidos: 0, ventas: 0 }
    h.pedidos += celda.pedidos
    h.ventas += celda.ventas
    porHora.set(celda.hora, h)
  }
  const horas = [...porHora.entries()].sort(([a], [b]) => a - b)
  const horaPico = horas.reduce<[number, { pedidos: number; ventas: number }] | null>((m, h) => (!m || h[1].pedidos > m[1].pedidos ? h : m), null)
  const unDia = datos.calor.length === 0 && datos.por_dia_semana.length === 0

  // ── Que ──
  const sinReceta = datos.top_productos.filter((x) => x.sin_receta)
  const totalCategorias = datos.por_categoria.reduce((s, x) => s + x.ventas, 0)

  return (
    <>
      {/* ── 1. Cuando se vende ── */}
      <Bloque titulo={de ? `Cuándo se vende ${de}` : 'Cuándo se vende'} descripcion="La hora es la de tomar el pedido, no la de cobrarlo.">
        <Seccion
          titulo={`Unidades y ventas por ${g}`}
          ayuda={`Barras: las unidades vendidas, eje izquierdo. Línea: la plata, eje derecho.${
            ant ? ` En gris, ${ant.etiqueta}, tramo a tramo: la misma hora, el mismo día de la semana.` : ''
          } La punteada es el promedio de unidades por ${g}.`}
        >
          <SerieTiempo
            alto={240}
            formato={enteros}
            formatoDetalle={enteros}
            puntos={serie.map((x) => ({ etiqueta: x.etiqueta, valor: x.unidades, detalle: `${x.pedidos} ${x.pedidos === 1 ? 'pedido' : 'pedidos'}` }))}
            anterior={ant && serieAnterior.length === serie.length ? serieAnterior.map((x) => x.unidades) : undefined}
            nombres={{ actual: 'Unidades', anterior: ant ? capitalizar(ant.etiqueta) : 'Período anterior' }}
            referencia={serie.length > 1 ? { valor: datos.unidades / serie.length, texto: 'promedio' } : undefined}
            lineas={[{ nombre: 'Ventas', valores: serie.map((x) => x.ventas) }]}
            formatoDerecha={corto}
            pie={mejor ? `mejor tramo: ${mejor.etiqueta}, ${dinero(mejor.ventas)} en ${mejor.pedidos} pedido(s)` : undefined}
          />
          {serie.length === 0 ? <SinDatos que={de ? `ventas de ${de}` : 'ventas'} alto={240} /> : null}
        </Seccion>

        {unDia ? (
          datos.pedidos > 0 ? (
            <Vacio>
              Con un solo día la pregunta la responde el gráfico de horas de arriba. Elige una semana o un mes en el filtro para ver qué días y horas
              concentran la venta.
            </Vacio>
          ) : null
        ) : (
          <DosColumnas>
            <Seccion
              titulo="A qué hora y qué día entran los clientes"
              ayuda="Cada casilla es una hora de un día de la semana, sumando todo el período. Más oscuro, más movimiento."
              accion={
                <Segmentado
                  activo={medida}
                  alElegir={setMedida}
                  opciones={[
                    { valor: 'pedidos', texto: 'Pedidos' },
                    { valor: 'ventas', texto: 'Ventas' },
                  ]}
                />
              }
            >
              {datos.calor.length > 0 ? <MapaCalor celdas={datos.calor} medida={medida} formato={dinero} /> : <SinDatos que="pedidos" alto={220} />}
              {horaPico ? (
                <Text style={[c.nota, { color: t.suave, marginTop: 12 }]}>
                  La hora con más pedidos es las {horaPico[0]}:00, con {horaPico[1].pedidos} en el período.
                </Text>
              ) : null}
            </Seccion>
            <View style={{ gap: 12 }}>
            <Seccion
              titulo="Qué día vendes más"
              explica="kpi.dia_tipico"
              ayuda="Lo que vende un día típico de cada uno, no la suma de todos. La línea punteada es el promedio."
            >
              {conVentas.length === 0 ? (
                <SinDatos que="ventas" alto={120} />
              ) : (
                <GraficoBarras
                  alto={150}
                  // Con centavos cuando los dias tipicos son chicos: "$0 $0 $1" no compara nada.
                  formato={promedioDia < 10 ? (n) => dinero(n) : corto}
                  datos={datos.por_dia_semana.map((d) => ({ etiqueta: d.nombre, valor: d.promedio ?? 0, detalle: `${d.pedidos} pedidos en total` }))}
                  resaltar={(d) => d.etiqueta === mejorDia?.nombre}
                  referencia={diasConPromedio.length > 1 ? { valor: promedioDia, texto: 'promedio' } : undefined}
                />
              )}
              {mejorDia && conVentas.length > 1 ? (
                <Text style={[c.nota, { color: t.suave, marginTop: 10 }]}>
                  El {DIA_LARGO[mejorDia.nombre] ?? mejorDia.nombre.toLowerCase()} típico vende {dinero(mejorDia.promedio ?? 0)}.
                </Text>
              ) : null}
            </Seccion>
            <Seccion titulo="Pedidos por hora" ayuda="Sumando todos los días del período.">
              {horas.length === 0 ? (
                <SinDatos que="pedidos" alto={120} />
              ) : (
                <GraficoBarras
                  alto={150}
                  formato={(n) => `${n}`}
                  datos={horas.map(([h, v]) => ({ etiqueta: `${h}`, valor: v.pedidos, detalle: dinero(v.ventas) }))}
                  resaltar={(d) => horaPico != null && d.etiqueta === `${horaPico[0]}`}
                />
              )}
            </Seccion>
            </View>
          </DosColumnas>
        )}
      </Bloque>

      {/* ── 2. Que se vendio ── */}
      <Bloque
        titulo={unProducto ? `Qué dejó ${de}` : unaCategoria ? `Qué se vendió de ${de}` : 'Qué se vendió'}
        descripcion={unProducto ? undefined : 'Ordenado por ingresos. Toca un producto para ver solo ese.'}
      >
        {datos.top_productos.length === 0 ? (
          <DosColumnas>
            <Seccion titulo="Cuánto vende y cuánto deja cada producto" ayuda="Verde, lo que te queda de cada venta después de pagar la mercancía.">
              <SinDatos que={de ? `ventas de ${de}` : 'productos vendidos'} alto={200} />
            </Seccion>
            <Seccion titulo="Qué parte es comida, bebida, envíos" ayuda="Por la categoría de cada producto en el menú.">
              <SinDatos que="ventas" alto={200} />
            </Seccion>
          </DosColumnas>
        ) : (
          <>
            <DosColumnas>
              <Seccion titulo="Cuánto vende y cuánto deja cada producto" ayuda="Verde, lo que te queda de cada venta después de pagar la mercancía.">
                <BarrasGanancia
                  formato={dinero}
                  filas={datos.top_productos.map((x) => ({
                    nombre: x.nombre,
                    ingreso: x.ingresos,
                    costo: x.sin_receta ? null : x.costo,
                    unidades: x.unidades,
                    id: x.producto_id,
                  }))}
                  alTocar={unProducto ? undefined : (f) => alFiltrar({ p: [String(f.id)] })}
                />
                {/* Sin receta no hay costo: la barra va rayada. Aqui, cuantos son y donde se arregla. */}
                {sinReceta.length > 0 ? (
                  <View style={{ backgroundColor: t.avisoSuave, borderRadius: 12, padding: 12, marginTop: 14 }}>
                    <Text style={[c.nota, { color: t.avisoFuerte }]}>
                      {sinReceta.length === 1
                        ? '1 producto no tiene receta, así que no se sabe cuánto deja. '
                        : `${sinReceta.length} productos no tienen receta, así que no se sabe cuánto dejan. `}
                      <Enlace texto="Cargar recetas" alTocar={() => abrir('/menu/recetas')} />
                    </Text>
                  </View>
                ) : null}
              </Seccion>
              {/* El reparto: por categoria; dentro de una categoria, por producto. */}
              {!unProducto && unaCategoria ? (
                <Seccion titulo={`Qué parte es cada producto de ${de}`} ayuda="Sobre lo vendido de la categoría. Toca uno para verlo solo.">
                  <GraficoDona
                    formato={dinero}
                    centro={{
                      valor: dinero(datos.ventas),
                      texto: `en ${datos.top_productos.length} ${datos.top_productos.length === 1 ? 'producto' : 'productos'}`,
                    }}
                    partes={datos.top_productos.map((x, i) => ({
                      nombre: x.nombre,
                      valor: x.ingresos,
                      detalle: `${x.unidades} ${x.unidades === 1 ? 'unidad' : 'unidades'}`,
                      color: colorSerie(p, i),
                      id: x.producto_id,
                    }))}
                    alTocar={(parte) => alFiltrar({ p: [String(parte.id)] })}
                  />
                </Seccion>
              ) : null}
              {!unProducto && !unaCategoria && datos.por_categoria.length > 0 ? (
                <Seccion titulo="Qué parte es comida, bebida, envíos" ayuda="Por la categoría de cada producto en el menú. Toca una para ver solo esa.">
                  <GraficoDona
                    formato={dinero}
                    centro={{
                      valor: dinero(totalCategorias),
                      texto: `vendidos en ${datos.por_categoria.length} categoría${datos.por_categoria.length === 1 ? '' : 's'}`,
                    }}
                    partes={datos.por_categoria.map((x, i) => ({
                      nombre: x.nombre,
                      valor: x.ventas,
                      detalle: `${x.pedidos} ${x.pedidos === 1 ? 'pedido' : 'pedidos'}`,
                      color: colorSerie(p, i),
                      id: x.id,
                    }))}
                    alTocar={(parte) => alFiltrar({ c: [String(parte.id)], p: [] })}
                  />
                </Seccion>
              ) : null}
            </DosColumnas>

            <Ficha>
              <Text style={{ fontFamily: LETRA.titulo, fontSize: 16.5, color: t.tinta, marginBottom: 6 }}>Producto por producto</Text>
              <TablaDatos<ProductoVendido>
                filas={datos.top_productos}
                claveFila={(x, i) => `${x.nombre}-${i}`}
                altoFila={filtro ? 48 : 56}
                columnas={[
                  {
                    clave: 'producto',
                    titulo: 'Producto',
                    ancho: 150,
                    orden: (x) => x.nombre,
                    celda: (x) => (
                      <View>
                        <Text style={[c.texto, { color: t.tinta, fontFamily: LETRA.textoFuerte, fontSize: 14 }]} numberOfLines={1}>
                          {x.nombre}
                        </Text>
                        {(!filtro && x.categoria) || x.sin_receta ? (
                          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 2 }}>
                            {!filtro && x.categoria ? (
                              <Text style={[c.nota, { color: t.tenue }]} numberOfLines={1}>
                                {x.categoria}
                              </Text>
                            ) : null}
                            {x.sin_receta ? <Pastilla texto="sin receta" tono="ojo" /> : null}
                          </View>
                        ) : null}
                      </View>
                    ),
                  },
                  { clave: 'uds', titulo: nombre('productos.uds'), ancho: 84, derecha: true, orden: (x) => x.unidades, celda: (x) => enteros(x.unidades) },
                  { clave: 'ingresos', titulo: 'Ingresos', ancho: 104, derecha: true, orden: (x) => x.ingresos, celda: (x) => dinero(x.ingresos) },
                  {
                    clave: 'ganancia',
                    titulo: 'Ganancia',
                    ancho: 104,
                    derecha: true,
                    orden: (x) => x.ganancia,
                    // Sin receta no hay costo: la ganancia seria todo el ingreso.
                    celda: (x) => (x.sin_receta ? '—' : dinero(x.ganancia)),
                    color: (x) => (x.sin_receta ? t.tenue : undefined),
                  },
                  {
                    clave: 'margen',
                    titulo: 'Margen',
                    ancho: 76,
                    derecha: true,
                    fuerte: true,
                    orden: (x) => x.margen_pct,
                    celda: (x) => (x.sin_receta ? '?' : `${x.margen_pct.toFixed(0)}%`),
                    color: (x) => (x.sin_receta ? t.tenue : x.margen_pct >= 50 ? t.exito : x.margen_pct >= 30 ? t.aviso : t.peligro),
                  },
                ]}
              />
            </Ficha>
          </>
        )}
      </Bloque>

      {/* ── 3. Que se vende junto ── */}
      {combos ? (
        <Bloque
          titulo={de ? `Qué se vende junto con ${de}` : 'Qué se vende junto'}
          descripcion={de ? `Sobre los pedidos cobrados del período que llevan ${de}.` : 'Sobre los pedidos cobrados del período.'}
        >
          {!combos.suficientes_datos ? (
            <Vacio>
              Llevas {combos.pedidos_analizados} pedido(s) cobrados {de ? `con ${de} ` : ''}en este período. Con unos cuantos más el sistema puede decirte
              qué productos salen juntos y qué ofrecer en caja.
            </Vacio>
          ) : (
            <DosColumnas>
              <Seccion
                titulo="Combinaciones"
                ayuda={`Sobre ${combos.pedidos_analizados} pedidos. La confianza es: de cada 100 pedidos con el primero, cuántos llevaron también el segundo.`}
              >
                {combos.pares.length > 0 ? (
                  <TablaDatos<ParCombo>
                    filas={combos.pares}
                    claveFila={(x) => `${x.producto}-${x.acompanante}`}
                    columnas={[
                      {
                        clave: 'combinacion',
                        titulo: 'Combinación',
                        ancho: 170,
                        orden: (x) => `${x.producto} ${x.acompanante}`,
                        celda: (x) => (
                          <Text style={[c.texto, { color: t.tinta, fontSize: 14 }]} numberOfLines={2}>
                            <Text style={{ fontFamily: LETRA.textoFuerte }}>{x.producto}</Text>
                            <Text style={{ color: t.tenue }}> + </Text>
                            <Text style={{ fontFamily: LETRA.textoFuerte }}>{x.acompanante}</Text>
                          </Text>
                        ),
                      },
                      { clave: 'veces', titulo: 'Veces', ancho: 70, derecha: true, orden: (x) => x.juntos, celda: (x) => String(x.juntos), color: () => t.suave },
                      { clave: 'confianza', titulo: 'Confianza', ancho: 96, derecha: true, fuerte: true, orden: (x) => x.confianza_pct, celda: (x) => `${x.confianza_pct}%` },
                    ]}
                  />
                ) : (
                  <Text style={[c.texto, { color: t.tenue }]}>Todavía no hay un par que se repita lo suficiente como para llamarlo patrón.</Text>
                )}
              </Seccion>

              {combos.acompanamiento ? (
                <Seccion titulo="Cuántos se van sin bebida">
                  <View style={{ flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: p.vacio }}>
                    <View style={{ width: `${combos.acompanamiento.con_bebida_pct}%`, backgroundColor: p.bien }} />
                    <View style={{ width: `${combos.acompanamiento.sin_bebida_pct}%`, backgroundColor: p.ojo }} />
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                    <Text style={[c.texto, { color: t.exito, fontFamily: LETRA.textoFuerte }]}>{combos.acompanamiento.con_bebida_pct}% con bebida</Text>
                    <Text style={[c.texto, { color: t.aviso, fontFamily: LETRA.textoFuerte }]}>{combos.acompanamiento.sin_bebida_pct}% sin bebida</Text>
                  </View>
                  {combos.oportunidad ? (
                    <Text style={[c.texto, { color: t.fuerte, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.gris100 }]}>
                      <Text style={{ fontFamily: LETRA.textoFuerte }}>{combos.oportunidad.pedidos_sin_bebida} pedidos</Text> salieron sin nada de tomar. Si
                      el cajero lograra convencer a {combos.oportunidad.conversion_supuesta_pct} de cada 100, serían{' '}
                      <Text style={{ fontFamily: LETRA.textoFuerte, color: t.exito }}>{fmt(combos.oportunidad.venta_potencial)}</Text> más de venta y{' '}
                      {fmt(combos.oportunidad.ganancia_potencial)} de ganancia.
                    </Text>
                  ) : null}
                </Seccion>
              ) : null}
            </DosColumnas>
          )}
        </Bloque>
      ) : null}
    </>
  )
}
