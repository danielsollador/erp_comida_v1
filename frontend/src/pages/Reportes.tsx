import { useEffect, useState } from 'react'
import Icono from '../components/Icono'
import NavBar from '../components/NavBar'
import { useSeccion } from '../components/Secciones'
import { FiltroFechas } from '../components/Fechas'
import { useRango } from '../lib/fechas'
import { Ayuda } from '../components/Ayuda'
import { explicar } from '../lib/glosario'
import { Tabla, Th, useOrden } from '../components/Tabla'
import { Lecturas, Pagina, Seccion } from '../components/ui'
import {
  BarrasApiladas,
  GraficoBarras,
  GraficoDona,
  GraficoLineas,
  MapaCalor,
  PALETA_CATEGORICA,
  Variacion,
} from '../components/Grafico'
import { api } from '../lib/api'
import { fmtBs, useMoneda } from '../lib/moneda'
import { etiquetaMetodo } from '../lib/pagos'
import type {
  ParCombo,
  ProductoVendido,
  ReporteCombos,
  ReporteResumen,
} from '../lib/types'

const SECCIONES = [
  { id: 'resumen', texto: 'Resumen' },
  { id: 'ritmo', texto: 'Cuándo se vende' },
  { id: 'productos', texto: 'Qué se vendió' },
  { id: 'combos', texto: 'Combinaciones' },
]

export default function Reportes() {
  const [seccion, irA] = useSeccion(SECCIONES)
  // Hoy por defecto: es lo que se mira al cerrar. El filtro del encabezado
  // abre cualquier otro periodo, y queda en la URL.
  const [rango, setRango] = useRango('hoy')
  const [datos, setDatos] = useState<ReporteResumen | null>(null)
  // Llega ordenado por ingresos, que es el ranking que el backend arma; aqui
  // se puede dar vuelta a la pregunta: que dejo mas GANANCIA, o que tiene el
  // margen mas flaco, que casi nunca es el mismo producto.
  const ordenProductos = useOrden<ProductoVendido>({
    producto: (p) => p.nombre,
    uds: (p) => p.unidades,
    ingresos: (p) => p.ingresos,
    ganancia: (p) => p.ganancia,
    margen: (p) => p.margen_pct,
  })
  const [combos, setCombos] = useState<ReporteCombos | null>(null)
  const [cargando, setCargando] = useState(true)
  const { fmt, fmtCongelado, sufijo } = useMoneda()

  useEffect(() => {
    setCargando(true)
    api.reporte(rango).then((r) => {
      setDatos(r)
      setCargando(false)
    })
    api.reporteCombos(rango).then(setCombos).catch(() => setCombos(null))
  }, [rango])

  // La tasa MEDIA del periodo, sacada de los bolivares que de verdad entraron.
  // En la vista en bolivares manda esta y no la de hoy: si no, el resumen del
  // mes pasado cambiaria solo cada vez que se mueve el dolar, y ademas no
  // cuadraria con la linea de abajo, que si suma cada venta a la tasa de su dia.
  const tasaPeriodo = datos && datos.ventas > 0 ? datos.ventas_bs / datos.ventas || null : null
  const dinero = (x: number, d?: number) => fmtCongelado(x, tasaPeriodo, d)
  const corto = (x: number) => dinero(x, 0)

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Reportes" secciones={SECCIONES} seccion={seccion} alCambiarSeccion={irA} filtro={<FiltroFechas rango={rango} alCambiar={setRango} />} />

      <Pagina>
        {cargando && <p className="text-neutral-400 text-sm">Cargando...</p>}

        {datos && !cargando && (
          <>
            <p className="text-sm text-neutral-500">{datos.etiqueta}</p>

            {/* Los bolivares del periodo salen de sumar cada venta a la tasa
                de SU dia. Convertir el total en dolares a la tasa de hoy haria
                que el historico se moviera solo cada vez que sube el dolar. */}
            {datos.ventas_bs > 0 && (
              <p className="text-xs text-neutral-500 -mt-2">
                Equivalen a {fmtBs(datos.ventas_bs)} cobrados, cada venta a la tasa de su dia.
              </p>
            )}
            {/* Los dias ya cerrados se leen de lo que la noche dejo guardado;
                hoy se calcula al momento. Se dice para que "consolidado a las
                3:30" explique por que una devolucion de ayer tarda en verse. */}
            {datos.consolidado_en && (
              <p className="text-[11px] text-neutral-400 -mt-2">
                Días anteriores consolidados el{' '}
                {new Date(datos.consolidado_en.replace(/(\.\d{3})\d+$/, '$1')).toLocaleString('es-VE', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                ; hoy se calcula al momento.
              </p>
            )}

            {seccion === 'resumen' && <Resumen datos={datos} dinero={dinero} corto={corto} sufijo={sufijo} />}

            {seccion === 'ritmo' && <Ritmo datos={datos} dinero={dinero} corto={corto} />}

            {seccion === 'productos' && (
              <Productos datos={datos} dinero={dinero} corto={corto} orden={ordenProductos} />
            )}

            {seccion === 'combos' && <SeccionCombos combos={combos} fmt={fmt} />}
          </>
        )}
      </Pagina>
    </div>
  )
}

type Dinero = (x: number, d?: number) => string

// El backend etiqueta los dias en corto ("Sab") para que quepan bajo una
// barra; en una frase se dice entero.
const DIA_LARGO: Record<string, string> = {
  Lun: 'lunes',
  Mar: 'martes',
  Mie: 'miércoles',
  Jue: 'jueves',
  Vie: 'viernes',
  Sab: 'sábado',
  Dom: 'domingo',
}

// ── Resumen ──────────────────────────────────────────────────────────────────

function Resumen({
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
  const ant = datos.anterior
  const vs = ant ? `vs ${ant.etiqueta}` : undefined
  const mejor = datos.serie.reduce<(typeof datos.serie)[number] | null>(
    (m, p) => (p.pedidos > 0 && (!m || p.ventas > m.ventas) ? p : m),
    null,
  )

  return (
    <>
      {/* Cada cifra lleva su cambio contra el periodo anterior del mismo
          tamaño. "Vendiste $400" no dice nada solo; "$400, 12% menos que la
          semana pasada" si. */}
      <div className="vp-escalonado grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          titulo="Ventas"
          ayuda="kpi.ventas"
          valor={dinero(datos.ventas)}
          destacado
          delta={ant && <Variacion pct={ant.cambio_ventas_pct} texto={vs} />}
        />
        <Kpi
          titulo="Ganancia neta"
          ayuda="kpi.ganancia_neta"
          valor={dinero(datos.ganancia_neta)}
          tono={datos.ganancia_neta >= 0 ? 'bueno' : 'malo'}
          destacado
          delta={ant && <Variacion pct={ant.cambio_ganancia_pct} texto={vs} />}
        />
        <Kpi
          titulo="Pedidos"
          ayuda="kpi.pedidos"
          valor={String(datos.pedidos)}
          delta={ant && <Variacion pct={ant.cambio_pedidos_pct} texto={vs} />}
        />
        {/* La mediana va al lado del promedio a proposito: un solo pedido
            grande (un catering) mueve el promedio a un numero que no gasta
            ningun cliente, y el dueno decide sobre eso. */}
        <Kpi
          titulo="Ticket promedio"
          ayuda="kpi.ticket_promedio"
          valor={dinero(datos.ticket_promedio)}
          delta={ant && <Variacion pct={ant.cambio_ticket_pct} texto={vs} />}
          nota={
            Math.abs(datos.ticket_mediano - datos.ticket_promedio) > 0.01
              ? `el cliente típico gastó ${dinero(datos.ticket_mediano)}`
              : undefined
          }
        />
      </div>

      {datos.insights.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-semibold flex items-center gap-2">
            <Icono nombre="chispa" size={17} className="text-acento-600" /> Análisis del negocio
            {/* Los avisos los redacta el servidor y sus cifras van en
                dolares, que es la moneda en que el negocio lleva sus
                numeros. Se dice aqui para que no parezcan la misma
                moneda que las tarjetas de arriba. */}
            {sufijo !== 'USD' && (
              <span className="text-xs font-normal text-neutral-400">· cifras en dólares</span>
            )}
          </h2>
          <Lecturas items={datos.insights} />
        </div>
      )}

      {datos.serie.length > 0 && (
        <Seccion
          titulo={`Ventas por ${datos.granularidad} · ${sufijo}`}
          ayuda={
            ant
              ? `La línea punteada es ${ant.etiqueta}, tramo a tramo: la misma hora, el mismo día de la semana.`
              : undefined
          }
        >
          <GraficoLineas
            alto={210}
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
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl border border-neutral-200 p-4">
          <h2 className="font-semibold mb-1">De dónde sale la ganancia</h2>
          <p className="text-xs text-neutral-500 mb-3">
            Los mismos números del Estado de Resultados en Contabilidad.
          </p>
          {/* La barra de arriba es la misma cuenta de abajo, en proporcion:
              cuanto de cada dolar vendido se va en insumos, cuanto en gastos
              y cuanto queda. */}
          {datos.ventas > 0 && (
            <div className="mb-3">
              <BarrasApiladas
                formato={dinero}
                filas={[
                  {
                    nombre: 'Cada venta',
                    partes: [
                      { nombre: 'Insumos', valor: datos.costo_insumos, color: 'var(--color-neutral-400)' },
                      { nombre: 'Gastos y mermas', valor: datos.gastos, color: 'var(--color-aviso-500)' },
                      ...(datos.iva_cobrado > 0
                        ? [{ nombre: 'IVA (del SENIAT)', valor: datos.iva_cobrado, color: 'var(--color-neutral-300)' }]
                        : []),
                      {
                        nombre: datos.ganancia_neta >= 0 ? 'Ganancia' : 'Pérdida',
                        valor: Math.abs(datos.ganancia_neta),
                        color: datos.ganancia_neta >= 0 ? 'var(--color-exito-500)' : 'var(--color-peligro-500)',
                      },
                    ],
                  },
                ]}
                leyenda={[
                  { nombre: 'Insumos', color: 'var(--color-neutral-400)' },
                  { nombre: 'Gastos y mermas', color: 'var(--color-aviso-500)' },
                  ...(datos.iva_cobrado > 0 ? [{ nombre: 'IVA', color: 'var(--color-neutral-300)' }] : []),
                  {
                    nombre: datos.ganancia_neta >= 0 ? 'Ganancia' : 'Pérdida',
                    color: datos.ganancia_neta >= 0 ? 'var(--color-exito-500)' : 'var(--color-peligro-500)',
                  },
                ]}
              />
            </div>
          )}
          <Linea dinero={dinero} etiqueta="Ventas cobradas" monto={datos.ventas} />
          {datos.iva_cobrado > 0 && (
            <>
              {/* El IVA entra por caja pero se le debe al SENIAT: contarlo
                  como ingreso inflaba la ganancia mostrada. */}
              <Linea dinero={dinero} etiqueta="IVA cobrado (se le debe al SENIAT)" monto={-datos.iva_cobrado} />
              <Linea dinero={dinero} etiqueta="Ingreso del negocio" monto={datos.ingresos_netos} subtotal />
            </>
          )}
          <Linea dinero={dinero} etiqueta="Costo de insumos" monto={-datos.costo_insumos} />
          <Linea
            dinero={dinero}
            etiqueta={`Ganancia bruta (${datos.margen_pct.toFixed(0)}% margen)`}
            monto={datos.ganancia_bruta}
            subtotal
          />
          <Linea dinero={dinero} etiqueta="Gastos, mermas y faltantes" monto={-datos.gastos} />
          <Linea dinero={dinero} etiqueta="Ganancia neta" monto={datos.ganancia_neta} total />
          {ant && (
            <p className="text-xs text-neutral-500 mt-2">
              {ant.etiqueta[0].toUpperCase()}
              {ant.etiqueta.slice(1)}: {dinero(ant.ventas)} en ventas y {dinero(ant.ganancia_neta)} de
              ganancia neta.
            </p>
          )}
          {(datos.pedidos_anulados > 0 || datos.devoluciones > 0) && (
            <p className="text-xs text-aviso-700 mt-3 bg-aviso-50 rounded-lg px-3 py-2">
              {datos.pedidos_anulados > 0 && (
                <>
                  Se anularon {datos.pedidos_anulados} pedido(s) por{' '}
                  {dinero(datos.valor_anulado)} que no llegaron a venderse.
                </>
              )}
              {datos.devoluciones > 0 && (
                <>
                  {datos.pedidos_anulados > 0 && ' '}
                  {datos.devoluciones} venta(s) por {dinero(datos.valor_devuelto)} fueron
                  devueltas por el cliente y ya no cuentan arriba.
                </>
              )}
            </p>
          )}
        </div>

        <div className="space-y-3">
          <Seccion titulo="Cómo te pagaron" ayuda="Por pago, no por pedido: una venta mixta se reparte.">
            <GraficoDona
              formato={dinero}
              centro={{ valor: corto(datos.ventas), texto: 'cobrado' }}
              partes={Object.entries(datos.por_metodo_pago)
                .sort(([, a], [, b]) => b - a)
                .map(([metodo, monto]) => ({ nombre: etiquetaMetodo(metodo), valor: monto }))}
            />
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
      </div>

      {datos.ventas > 0 && <Facturacion datos={datos} dinero={dinero} />}
    </>
  )
}

// ── Cuando se vende ──────────────────────────────────────────────────────────

/**
 * Las preguntas de turnos y compras: a que hora entra la gente, que dia de la
 * semana es el fuerte. Con un solo dia no hay mapa que dibujar, y se dice.
 */
function Ritmo({ datos, dinero, corto }: { datos: ReporteResumen; dinero: Dinero; corto: (x: number) => string }) {
  const [medida, setMedida] = useState<'pedidos' | 'ventas'>('pedidos')

  if (datos.calor.length === 0 && datos.por_dia_semana.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-neutral-200 p-4">
        <h2 className="font-semibold mb-1">Cuándo se vende</h2>
        <p className="text-sm text-neutral-500">
          {datos.pedidos > 0
            ? 'Con un solo día la pregunta la responde el gráfico de horas del Resumen. Elige una semana o un mes arriba para ver qué días y horas concentran la venta.'
            : 'Todavía no hay ventas en este período.'}
        </p>
      </div>
    )
  }

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

  return (
    <>
      {datos.calor.length > 0 && (
        <Seccion
          titulo="A qué hora entran los clientes"
          ayuda="Cada casilla es un día de la semana a una hora, sumando todo el período. Más oscuro, más pedidos. La hora es la de tomar el pedido, no la de cobrarlo."
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
              La hora con más pedidos es las {horaPico[0]}:00, con {horaPico[1].pedidos} en el período.
            </p>
          )}
        </Seccion>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
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
    </>
  )
}

// ── Que se vendio ────────────────────────────────────────────────────────────

function Productos({
  datos,
  dinero,
  corto,
  orden,
}: {
  datos: ReporteResumen
  dinero: Dinero
  corto: (x: number) => string
  orden: ReturnType<typeof useOrden<ProductoVendido>>
}) {
  if (datos.top_productos.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-neutral-200 p-4">
        <p className="text-sm text-neutral-400">Todavía no se vendió nada en este período.</p>
      </div>
    )
  }
  const conCosto = datos.top_productos.filter((p) => !p.sin_receta)

  return (
    <>
      {/* La barra parte cada producto en lo que costo y lo que dejo. Lo que
          vende mucho y deja poco se ve enseguida: barra larga, casi toda
          gris. */}
      <Seccion
        titulo="Cuánto vende y cuánto deja cada producto"
        ayuda="La barra completa es el ingreso; la parte verde, lo que quedó después de los insumos. Los productos sin receta no se pueden partir."
      >
        <BarrasApiladas
          formato={dinero}
          leyenda={[
            { nombre: 'Costo de insumos', color: 'var(--color-neutral-300)' },
            { nombre: 'Ganancia', color: 'var(--color-exito-500)' },
            { nombre: 'Sin receta (costo desconocido)', color: 'var(--color-aviso-300)' },
          ]}
          filas={datos.top_productos.slice(0, 8).map((p) => ({
            nombre: p.nombre,
            detalle: p.sin_receta ? '?' : `${p.margen_pct.toFixed(0)}%`,
            partes: p.sin_receta
              ? [{ nombre: 'Ingreso (sin costo conocido)', valor: p.ingresos, color: 'var(--color-aviso-300)' }]
              : [
                  { nombre: 'Costo de insumos', valor: p.costo, color: 'var(--color-neutral-300)' },
                  { nombre: 'Ganancia', valor: Math.max(p.ganancia, 0), color: 'var(--color-exito-500)' },
                ],
          }))}
        />
        {conCosto.length > 0 && (
          <p className="text-xs text-neutral-500 mt-3">
            En total, {corto(conCosto.reduce((s, p) => s + p.ingresos, 0))} vendidos con receta dejaron{' '}
            {corto(conCosto.reduce((s, p) => s + p.ganancia, 0))} de ganancia bruta.
          </p>
        )}
      </Seccion>

      <div className="bg-white rounded-2xl border border-neutral-200 p-4">
        <h2 className="font-semibold mb-3">Qué se vendió</h2>
        <Tabla orden={orden} glosario="productos">
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
              {orden.ordenar(datos.top_productos).map((p) => (
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
                  {/* Sin receta no hay costo, asi que la ganancia seria
                      todo el ingreso y el margen 100%: mostrarlos como
                      numeros validos hacia pasar por producto estrella
                      justo al que no se sabe cuanto cuesta. */}
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
  )
}

/**
 * Cuánto de lo que se vendió llegó a tener factura.
 *
 * La pregunta del dueño es una sola y tiene una sola respuesta: qué
 * porcentaje facturó. Por eso el porcentaje es el número grande y todo lo
 * demás lo sustenta. La barra da la proporción de un vistazo y las dos filas
 * dan el detalle con las unidades separadas -cuántas ventas en una columna y
 * cuánto dinero en otra-, porque mezclar "$1.240 · 8 ventas · 62%" en un
 * renglón obliga a leerlo tres veces para sacar una cifra.
 *
 * El cierre dice la consecuencia: el IVA que se le debe al SENIAT sale solo
 * de la parte facturada, que es el motivo por el que esta decisión importa.
 */
function Facturacion({
  datos,
  dinero,
}: {
  datos: ReporteResumen
  dinero: (x: number, d?: number) => string
}) {
  const sinFacturar = Math.max(round2(datos.ventas - datos.valor_facturado), 0)
  const pct = (datos.valor_facturado / datos.ventas) * 100
  const ventasSinFactura = Math.max(datos.pedidos - datos.facturadas, 0)

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">Cuánto se facturó</h2>
          <p className="text-xs text-neutral-500">
            No todo se factura al momento: el dueño puede decidirlo después, desde el histórico
            de Ventas.
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-3xl font-bold tabular-nums leading-none">{pct.toFixed(0)}%</div>
          <div className="text-[11px] text-neutral-500">facturado</div>
        </div>
      </div>

      {/* Los dos tramos se dibujan aunque uno sea diminuto: con un solo div
          verde sobre fondo gris, un 1% no se veia y parecia que no habia
          facturado nada. */}
      <div className="mt-3 flex h-3 rounded-full overflow-hidden bg-neutral-100">
        <div
          className="bg-exito-500"
          style={{ width: `${pct}%`, minWidth: datos.valor_facturado > 0 ? 4 : 0 }}
        />
        <div
          className="bg-neutral-300"
          style={{ width: `${100 - pct}%`, minWidth: sinFacturar > 0 ? 4 : 0 }}
        />
      </div>

      <dl className="mt-3 text-sm divide-y divide-neutral-100">
        <FilaFacturacion
          color="bg-exito-500"
          etiqueta="Con factura"
          ventas={datos.facturadas}
          monto={dinero(datos.valor_facturado)}
        />
        <FilaFacturacion
          color="bg-neutral-300"
          etiqueta="Sin factura"
          ventas={ventasSinFactura}
          monto={dinero(sinFacturar)}
        />
      </dl>

      {datos.iva_cobrado > 0 && (
        <p className="mt-3 text-xs text-neutral-500">
          De esa parte facturada salen {dinero(datos.iva_cobrado)} de IVA que se le deben al
          SENIAT. Lo que no se facturó no genera IVA.
        </p>
      )}
    </div>
  )
}

function FilaFacturacion({
  color,
  etiqueta,
  ventas,
  monto,
}: {
  color: string
  etiqueta: string
  ventas: number
  monto: string
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${color}`} />
      <dt className="flex-1 whitespace-nowrap">{etiqueta}</dt>
      <dd className="w-20 text-right tabular-nums text-neutral-500 whitespace-nowrap">
        {ventas} {ventas === 1 ? 'venta' : 'ventas'}
      </dd>
      <dd className="w-24 text-right tabular-nums font-medium whitespace-nowrap">{monto}</dd>
    </div>
  )
}

const round2 = (x: number) => Math.round(x * 100) / 100

function Kpi({
  titulo,
  valor,
  ayuda,
  destacado = false,
  tono,
  nota,
  delta,
}: {
  titulo: string
  valor: string
  /** Clave del glosario: la explicacion al posar el cursor en el titulo. */
  ayuda?: string
  destacado?: boolean
  tono?: 'bueno' | 'malo'
  /** Aclaracion bajo el numero, cuando el numero solo puede enganar. */
  nota?: string
  /** El cambio contra el periodo anterior, ya dibujado. */
  delta?: React.ReactNode
}) {
  const color = tono === 'malo' ? 'text-peligro-600' : tono === 'bueno' ? 'text-exito-600' : ''
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4">
      <div className="text-xs text-neutral-500">
        <Ayuda explica={explicar(ayuda)} titulo={titulo}>
          {titulo}
        </Ayuda>
      </div>
      <div className={`font-bold tabular-nums ${destacado ? 'text-2xl' : 'text-xl'} ${color}`}>
        {valor}
      </div>
      {delta && <div className="mt-0.5">{delta}</div>}
      {nota && <div className="mt-0.5 text-[11px] leading-snug text-aviso-700">{nota}</div>}
    </div>
  )
}

function Linea({
  etiqueta,
  monto,
  dinero,
  subtotal = false,
  total = false,
}: {
  etiqueta: string
  monto: number
  /** Formatea en la vista cambiaria elegida, a la tasa del periodo. */
  dinero: (x: number) => string
  subtotal?: boolean
  total?: boolean
}) {
  return (
    <div
      className={`flex justify-between py-1.5 ${
        subtotal || total ? 'border-t border-neutral-200 mt-1 pt-2' : ''
      } ${total ? 'font-bold text-base' : subtotal ? 'font-semibold' : 'text-sm'}`}
    >
      <span className={monto < 0 ? 'text-neutral-600' : ''}>{etiqueta}</span>
      <span
        className={`tabular-nums ${
          total && monto < 0 ? 'text-peligro-600' : monto < 0 ? 'text-neutral-600' : ''
        }`}
      >
        {monto < 0 ? '-' : ''}{dinero(Math.abs(monto))}
      </span>
    </div>
  )
}


function SeccionCombos({
  combos,
  fmt,
}: {
  combos: ReporteCombos | null
  fmt: (usd: number | null | undefined, decimales?: number) => string
}) {
  // Antes de cualquier `return`: los hooks no pueden quedar detras de una
  // salida temprana o React pierde la cuenta entre pintadas.
  const ordenCombos = useOrden<ParCombo>({
    combinacion: (p) => `${p.producto} ${p.acompanante}`,
    veces: (p) => p.juntos,
    confianza: (p) => p.confianza_pct,
  })

  if (!combos) return null

  if (!combos.suficientes_datos) {
    return (
      <div className="bg-white rounded-2xl border border-neutral-200 p-4">
        <h2 className="font-semibold mb-1">Qué se vende junto</h2>
        <p className="text-sm text-neutral-500">
          Llevas {combos.pedidos_analizados} pedido(s) cobrados en este período. Con unos cuantos
          más el sistema puede decirte qué productos salen juntos y qué ofrecer en caja.
        </p>
      </div>
    )
  }

  const acomp = combos.acompanamiento
  const oport = combos.oportunidad

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border border-neutral-200 p-4">
        <h2 className="font-semibold mb-1">Qué se vende junto</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Sobre {combos.pedidos_analizados} pedidos cobrados. La confianza es: de cada 100 pedidos
          con el primer producto, cuántos llevaron también el segundo.
        </p>

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
                    <td className="text-right py-2 tabular-nums font-medium">
                      {par.confianza_pct}%
                    </td>
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
      </div>

      {acomp && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-4">
          <h2 className="font-semibold mb-3">Cuántos se van sin bebida</h2>
          <div className="flex h-3 rounded-full overflow-hidden bg-neutral-100 mb-2">
            <div
              className="bg-exito-500"
              style={{ width: `${acomp.con_bebida_pct}%` }}
              title={`${acomp.con_bebida_pct}% con bebida`}
            />
            <div
              className="bg-aviso-400"
              style={{ width: `${acomp.sin_bebida_pct}%` }}
              title={`${acomp.sin_bebida_pct}% sin bebida`}
            />
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-exito-700 font-medium tabular-nums">
              {acomp.con_bebida_pct}% con bebida
            </span>
            <span className="text-aviso-700 font-medium tabular-nums">
              {acomp.sin_bebida_pct}% sin bebida
            </span>
          </div>

          {oport && (
            <div className="mt-3 pt-3 border-t border-neutral-100">
              <p className="text-sm text-neutral-700">
                <span className="font-semibold">{oport.pedidos_sin_bebida} pedidos</span> salieron
                sin nada de tomar. Si el cajero lograra convencer a{' '}
                {oport.conversion_supuesta_pct} de cada 100, serían{' '}
                <span className="font-semibold text-exito-700">
                  {fmt(oport.venta_potencial)}
                </span>{' '}
                más de venta y {fmt(oport.ganancia_potencial)} de ganancia en este período.
              </p>
              <p className="text-xs text-neutral-400 mt-1">
                El punto de venta ya sugiere la bebida sola mientras se arma la comanda.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
