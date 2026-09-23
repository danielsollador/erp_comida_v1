import { useEffect, useState } from 'react'
import Icono from '../components/Icono'
import NavBar from '../components/NavBar'
import { useSeccion } from '../components/Secciones'
import { FiltroFechas } from '../components/Fechas'
import { useRango } from '../lib/fechas'
import { Lecturas, Pagina, Seccion } from '../components/ui'
import { BarrasApiladas, GraficoDona, GraficoLineas, Variacion } from '../components/Grafico'
import { api } from '../lib/api'
import { fmtBs, useMoneda } from '../lib/moneda'
import { etiquetaMetodo } from '../lib/pagos'
import type { ReporteCombos, ReporteInventario, ReportePerdidas, ReporteResumen } from '../lib/types'
import { Bloque, Kpi, Linea, type Dinero } from './partes/reportes/comunes'
import Ventas from './partes/reportes/Ventas'
import Perdidas from './partes/reportes/Perdidas'
import Inventario from './partes/reportes/Inventario'

/**
 * Reportes, en cuatro secciones (Leider, 22-sep):
 *
 *   Resumen    lo basico que hay que mirar: las cuatro cifras, la linea de
 *              ventas, cuanto se facturo (pastel), como pagaron, el resultado.
 *   Ventas     cuando se vende (linea, mapa de calor, dias y horas), que se
 *              vendio y que se vende junto.
 *   Perdidas   analisis de merma: que se pierde mas y menos, por que, cuanto
 *              pesa sobre la venta, y las ventas que no llegaron.
 *   Inventario donde esta la plata, para cuantos dias alcanza, que comprar.
 *
 * Antes eran "Resumen / Cuando se vende / Que se vendio / Combinaciones", y
 * el Resumen repetia parte de las otras tres. Cada seccion pide solo SUS
 * datos y sigue el mismo esqueleto: cifras, lecturas, bloques con nombre.
 */
const SECCIONES = [
  { id: 'resumen', texto: 'Resumen' },
  { id: 'ventas', texto: 'Ventas' },
  { id: 'perdidas', texto: 'Pérdidas' },
  { id: 'inventario', texto: 'Inventario' },
]

export default function Reportes() {
  const [seccion, irA] = useSeccion(SECCIONES)
  // Hoy por defecto: es lo que se mira al cerrar. El filtro del encabezado
  // abre cualquier otro periodo, y queda en la URL.
  const [rango, setRango] = useRango('hoy')
  const [datos, setDatos] = useState<ReporteResumen | null>(null)
  const [combos, setCombos] = useState<ReporteCombos | null>(null)
  const [perdidas, setPerdidas] = useState<ReportePerdidas | null>(null)
  const [inventario, setInventario] = useState<ReporteInventario | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const { fmt, fmtCongelado, sufijo } = useMoneda()

  // Cada seccion trae lo suyo y nada mas: Perdidas e Inventario no hacen
  // esperar al Resumen, y el Resumen no calcula la canasta de combos.
  useEffect(() => {
    let vigente = true
    setCargando(true)
    setError('')
    const necesitaResumen = seccion === 'resumen' || seccion === 'ventas'
    const pedidos: Promise<unknown>[] = []
    if (necesitaResumen) pedidos.push(api.reporte(rango).then((r) => vigente && setDatos(r)))
    if (seccion === 'ventas') pedidos.push(api.reporteCombos(rango).then((c) => vigente && setCombos(c)).catch(() => vigente && setCombos(null)))
    if (seccion === 'perdidas') pedidos.push(api.reportePerdidas(rango).then((p) => vigente && setPerdidas(p)))
    if (seccion === 'inventario') pedidos.push(api.reporteInventario(rango).then((i) => vigente && setInventario(i)))
    Promise.all(pedidos)
      .catch((e) => vigente && setError(e instanceof Error ? e.message : 'No se pudo cargar el reporte'))
      .finally(() => vigente && setCargando(false))
    return () => {
      vigente = false
    }
  }, [rango, seccion])

  // La tasa MEDIA del periodo, sacada de los bolivares que de verdad entraron.
  // En la vista en bolivares manda esta y no la de hoy: si no, el resumen del
  // mes pasado cambiaria solo cada vez que se mueve el dolar.
  const tasaPeriodo = datos && datos.ventas > 0 ? datos.ventas_bs / datos.ventas || null : null
  const dinero: Dinero = (x, d) => fmtCongelado(x, tasaPeriodo, d)
  const corto = (x: number) => dinero(x, 0)

  const etiqueta = seccion === 'perdidas' ? perdidas?.etiqueta : seccion === 'inventario' ? inventario?.etiqueta : datos?.etiqueta

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar
        titulo="Reportes"
        secciones={SECCIONES}
        seccion={seccion}
        alCambiarSeccion={irA}
        filtro={<FiltroFechas rango={rango} alCambiar={setRango} />}
      />

      <Pagina>
        {cargando && <p className="text-neutral-400 text-sm">Cargando...</p>}
        {error && !cargando && <p className="text-peligro-600 text-sm">{error}</p>}

        {!cargando && !error && (
          <>
            {etiqueta && (
              <div className="space-y-0.5">
                <p className="text-sm text-neutral-500">
                  {etiqueta}
                  {seccion === 'inventario' && ' · el stock es el de hoy'}
                </p>
                {datos && (seccion === 'resumen' || seccion === 'ventas') && (
                  <>
                    {/* Los bolivares del periodo salen de sumar cada venta a
                        la tasa de SU dia. */}
                    {datos.ventas_bs > 0 && (
                      <p className="text-xs text-neutral-500">
                        Equivalen a {fmtBs(datos.ventas_bs)} cobrados, cada venta a la tasa de su día.
                      </p>
                    )}
                    {datos.consolidado_en && (
                      <p className="text-[11px] text-neutral-400">
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
                  </>
                )}
              </div>
            )}

            {seccion === 'resumen' && datos && <Resumen datos={datos} dinero={dinero} corto={corto} sufijo={sufijo} />}
            {seccion === 'ventas' && datos && <Ventas datos={datos} combos={combos} dinero={dinero} corto={corto} fmt={fmt} />}
            {seccion === 'perdidas' && perdidas && <Perdidas datos={perdidas} dinero={dinero} corto={corto} />}
            {seccion === 'inventario' && inventario && <Inventario datos={inventario} dinero={dinero} corto={corto} />}
          </>
        )}
      </Pagina>
    </div>
  )
}

// ── Resumen ──────────────────────────────────────────────────────────────────

/**
 * Lo basico que el dueño necesita mirar, y nada mas. Lo que aqui se dibuja
 * en chico (la linea de ventas) esta entero en Ventas; lo que aqui es una
 * cifra (la merma dentro de "gastos") tiene su seccion en Perdidas.
 */
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

  return (
    <>
      {/* ── 1. Las cifras ─────────────────────────────────────────────── */}
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

      {/* ── 2. Las ventas ─────────────────────────────────────────────── */}
      {datos.serie.length > 0 && (
        <Bloque titulo="Ventas" descripcion="El detalle por hora, día y producto está en la pestaña Ventas.">
          <Seccion
            titulo={`Ventas por ${datos.granularidad} · ${sufijo}`}
            ayuda={ant ? `La línea punteada es ${ant.etiqueta}.` : undefined}
          >
            <GraficoLineas
              alto={200}
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
            />
          </Seccion>
        </Bloque>
      )}

      {/* ── 3. Facturacion y cobros ───────────────────────────────────── */}
      {datos.ventas > 0 && (
        <Bloque titulo="Facturación y cobros">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Facturacion datos={datos} dinero={dinero} />
            <Seccion titulo="Cómo te pagaron" ayuda="Por pago, no por pedido: una venta mixta se reparte.">
              <GraficoDona
                formato={dinero}
                centro={{ valor: corto(datos.ventas), texto: 'cobrado' }}
                partes={Object.entries(datos.por_metodo_pago)
                  .sort(([, a], [, b]) => b - a)
                  .map(([metodo, monto]) => ({ nombre: etiquetaMetodo(metodo), valor: monto }))}
              />
            </Seccion>
          </div>
        </Bloque>
      )}

      {/* ── 4. El resultado ───────────────────────────────────────────── */}
      <Bloque titulo="Resultado" descripcion="Los mismos números del Estado de Resultados en Contabilidad.">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="bg-white rounded-2xl border border-neutral-200 p-4">
            <h2 className="font-semibold mb-3">De dónde sale la ganancia</h2>
            {/* La barra es la misma cuenta de abajo, en proporcion: cuanto de
                cada dolar vendido se va en mercancia, cuanto en gastos y
                cuanto queda. */}
            {datos.ventas > 0 && (
              <div className="mb-3">
                <BarrasApiladas
                  formato={dinero}
                  filas={[
                    {
                      nombre: 'Cada venta',
                      partes: [
                        { nombre: 'Mercancía', valor: datos.costo_insumos, color: 'var(--color-neutral-400)' },
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
                    { nombre: 'Mercancía', color: 'var(--color-neutral-400)' },
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
                <Linea dinero={dinero} etiqueta="IVA cobrado (se le debe al SENIAT)" monto={-datos.iva_cobrado} />
                <Linea dinero={dinero} etiqueta="Ingreso del negocio" monto={datos.ingresos_netos} subtotal />
              </>
            )}
            <Linea dinero={dinero} etiqueta="Costo de la mercancía" monto={-datos.costo_insumos} />
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
                {ant.etiqueta.slice(1)}: {dinero(ant.ventas)} en ventas y {dinero(ant.ganancia_neta)} de ganancia neta.
              </p>
            )}
            {(datos.pedidos_anulados > 0 || datos.devoluciones > 0) && (
              <p className="text-xs text-aviso-700 mt-3 bg-aviso-50 rounded-lg px-3 py-2">
                {datos.pedidos_anulados > 0 && (
                  <>Se anularon {datos.pedidos_anulados} pedido(s) por {dinero(datos.valor_anulado)}. </>
                )}
                {datos.devoluciones > 0 && (
                  <>{datos.devoluciones} venta(s) por {dinero(datos.valor_devuelto)} fueron devueltas y ya no cuentan arriba. </>
                )}
                El detalle está en Pérdidas.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <h2 className="font-semibold flex items-center gap-2">
              <Icono nombre="chispa" size={17} className="text-acento-600" /> Análisis del negocio
              {/* Los avisos los redacta el servidor con cifras en dolares. */}
              {sufijo !== 'USD' && <span className="text-xs font-normal text-neutral-400">· cifras en dólares</span>}
            </h2>
            {datos.insights.length > 0 ? (
              <Lecturas items={datos.insights} />
            ) : (
              <p className="text-sm text-neutral-500">Nada que señalar en este período.</p>
            )}
          </div>
        </div>
      </Bloque>
    </>
  )
}

/**
 * Cuánto de lo que se vendió llegó a tener factura, como pastel: dos partes
 * y lo que importa es la proporción de un vistazo (Leider, 22-sep). El
 * porcentaje grande es la respuesta; la leyenda da las ventas y la plata.
 */
function Facturacion({ datos, dinero }: { datos: ReporteResumen; dinero: Dinero }) {
  const sinFacturar = Math.max(Math.round((datos.ventas - datos.valor_facturado) * 100) / 100, 0)
  const pct = (datos.valor_facturado / datos.ventas) * 100
  const ventasSinFactura = Math.max(datos.pedidos - datos.facturadas, 0)

  return (
    <Seccion
      titulo="Cuánto se facturó"
      ayuda="No todo se factura al momento: se puede decidir después, desde el histórico de Ventas."
      accion={
        <div className="text-right">
          <div className="text-3xl font-bold tabular-nums leading-none">{pct.toFixed(0)}%</div>
          <div className="text-[11px] text-neutral-500">facturado</div>
        </div>
      }
    >
      <GraficoDona
        pastel
        alto={140}
        formato={dinero}
        partes={[
          {
            nombre: 'Con factura',
            valor: datos.valor_facturado,
            detalle: `${datos.facturadas} ${datos.facturadas === 1 ? 'venta' : 'ventas'}`,
            color: 'var(--color-exito-500)',
          },
          {
            nombre: 'Sin factura',
            valor: sinFacturar,
            detalle: `${ventasSinFactura} ${ventasSinFactura === 1 ? 'venta' : 'ventas'}`,
            color: 'var(--color-neutral-300)',
          },
        ]}
      />
      {datos.iva_cobrado > 0 && (
        <p className="mt-3 text-xs text-neutral-500">
          De la parte facturada salen {dinero(datos.iva_cobrado)} de IVA que se le deben al SENIAT. Lo que no se
          facturó no genera IVA.
        </p>
      )}
    </Seccion>
  )
}
