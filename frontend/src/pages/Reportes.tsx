import { useEffect, useState } from 'react'
import Icono from '../components/Icono'
import NavBar from '../components/NavBar'
import { useSeccion } from '../components/Secciones'
import { FiltroFechas } from '../components/Fechas'
import { useRango } from '../lib/fechas'
import { Ayuda } from '../components/Ayuda'
import { explicar } from '../lib/glosario'
import { Tabla, Th, useOrden } from '../components/Tabla'
import { Lecturas, Pagina } from '../components/ui'
import { api } from '../lib/api'
import { fmtBs, fmtNum, useMoneda } from '../lib/moneda'
import type {
  ParCombo,
  ProductoVendido,
  ReporteCombos,
  ReporteResumen,
} from '../lib/types'

const SECCIONES = [
  { id: 'resumen', texto: 'Resumen' },
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

  const maxVenta = datos ? Math.max(...datos.serie.map((s) => s.ventas), 0) : 0
  // La tasa MEDIA del periodo, sacada de los bolivares que de verdad entraron.
  // En la vista en bolivares manda esta y no la de hoy: si no, el resumen del
  // mes pasado cambiaria solo cada vez que se mueve el dolar, y ademas no
  // cuadraria con la linea de abajo, que si suma cada venta a la tasa de su dia.
  const tasaPeriodo = datos && datos.ventas > 0 ? datos.ventas_bs / datos.ventas || null : null
  const dinero = (x: number, d?: number) => fmtCongelado(x, tasaPeriodo, d)

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


            {seccion === 'resumen' && (
              <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi titulo="Ventas" ayuda="kpi.ventas" valor={dinero(datos.ventas)} destacado />
              <Kpi
                titulo="Ganancia neta"
                ayuda="kpi.ganancia_neta"
                valor={dinero(datos.ganancia_neta)}
                tono={datos.ganancia_neta >= 0 ? 'bueno' : 'malo'}
                destacado
              />
              <Kpi titulo="Pedidos" ayuda="kpi.pedidos" valor={String(datos.pedidos)} />
              {/* La mediana va al lado del promedio a proposito: un solo
                  pedido grande (un catering) mueve el promedio a un numero que
                  no gasta ningun cliente, y el dueno decide sobre eso. */}
              <Kpi
                titulo="Ticket promedio"
                ayuda="kpi.ticket_promedio"
                valor={dinero(datos.ticket_promedio)}
                nota={
                  Math.abs(datos.ticket_mediano - datos.ticket_promedio) > 0.01
                    ? `el cliente tipico gasto ${dinero(datos.ticket_mediano)}`
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

            <div className="bg-white rounded-2xl border border-neutral-200 p-4">
              <h2 className="font-semibold mb-1">De donde sale la ganancia</h2>
              <p className="text-xs text-neutral-500 mb-3">
                Los mismos numeros del Estado de Resultados en Contabilidad.
              </p>
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

            {datos.serie.length > 0 && (
              <div className="bg-white rounded-2xl border border-neutral-200 p-4">
                <h2 className="font-semibold mb-4">
                  Ventas por {datos.granularidad} · {sufijo}
                </h2>
                <div className="flex items-end gap-1.5 h-40 overflow-x-auto">
                  {datos.serie.map((punto) => {
                    const alturaPct = maxVenta > 0 ? (punto.ventas / maxVenta) * 100 : 0
                    return (
                      <div
                        key={punto.etiqueta}
                        className="flex-1 min-w-[28px] flex flex-col items-center justify-end h-full gap-1"
                        title={`${punto.etiqueta}: ${dinero(punto.ventas)} en ${punto.pedidos} pedidos`}
                      >
                        <span className="text-[10px] text-neutral-500 tabular-nums">
                          {/* Sin simbolo: no cabe uno por barra, y ya lo dice el titulo. */}
                          {punto.ventas > 0 ? fmtNum(punto.ventas, 0) : ''}
                        </span>
                        <div
                          className="w-full bg-neutral-900 rounded-t-md min-h-[2px]"
                          style={{ height: `${alturaPct}%` }}
                        />
                        <span className="text-[10px] text-neutral-500 whitespace-nowrap">
                          {punto.etiqueta}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-white rounded-2xl border border-neutral-200 p-4">
                <h2 className="font-semibold mb-2">Como te pagaron</h2>
                {Object.entries(datos.por_metodo_pago).map(([metodo, monto]) => (
                  <div key={metodo} className="flex justify-between text-sm py-1">
                    <span className="text-neutral-600">{metodo}</span>
                    <span className="font-medium tabular-nums">{dinero(monto)}</span>
                  </div>
                ))}
                {Object.keys(datos.por_metodo_pago).length === 0 && (
                  <p className="text-neutral-400 text-sm">Sin cobros en el periodo.</p>
                )}
              </div>
              <div className="bg-white rounded-2xl border border-neutral-200 p-4">
                <h2 className="font-semibold mb-2">Pedidos anulados</h2>
                <p className="text-3xl font-bold tabular-nums">{datos.pedidos_anulados}</p>
                <p className="text-xs text-neutral-500 mt-1">
                  Si este numero crece, revisa que esta fallando al tomar los pedidos.
                </p>
              </div>
            </div>
              </>
            )}

            {seccion === 'productos' && (
              <>
            {datos.top_productos.length > 0 && (
              <div className="bg-white rounded-2xl border border-neutral-200 p-4">
                <h2 className="font-semibold mb-3">Que se vendio</h2>
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
                        {/* Sin receta no hay costo, asi que la ganancia seria
                            todo el ingreso y el margen 100%: mostrarlos como
                            numeros validos hacia pasar por producto estrella
                            justo al que no se sabe cuanto cuesta. */}
                        <td className="text-right py-2 tabular-nums">
                          {p.sin_receta ? (
                            <span className="text-neutral-400">—</span>
                          ) : (
                            dinero(p.ganancia)
                          )}
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
            )}
              </>
            )}

            {seccion === 'combos' && <SeccionCombos combos={combos} fmt={fmt} />}
          </>
        )}
      </Pagina>
    </div>
  )
}

function Kpi({
  titulo,
  valor,
  ayuda,
  destacado = false,
  tono,
  nota,
}: {
  titulo: string
  valor: string
  /** Clave del glosario: la explicacion al posar el cursor en el titulo. */
  ayuda?: string
  destacado?: boolean
  tono?: 'bueno' | 'malo'
  /** Aclaracion bajo el numero, cuando el numero solo puede enganar. */
  nota?: string
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
        <h2 className="font-semibold mb-1">Que se vende junto</h2>
        <p className="text-sm text-neutral-500">
          Llevas {combos.pedidos_analizados} pedido(s) cobrados en este periodo. Con unos cuantos
          mas el sistema puede decirte que productos salen juntos y que ofrecer en caja.
        </p>
      </div>
    )
  }

  const acomp = combos.acompanamiento
  const oport = combos.oportunidad

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border border-neutral-200 p-4">
        <h2 className="font-semibold mb-1">Que se vende junto</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Sobre {combos.pedidos_analizados} pedidos cobrados. La confianza es: de cada 100 pedidos
          con el primer producto, cuantos llevaron tambien el segundo.
        </p>

        {combos.pares.length > 0 ? (
          <Tabla orden={ordenCombos} glosario="combos">
            <table className="w-full text-sm">
              <thead className="text-neutral-500 text-xs uppercase">
                <tr>
                  <Th clave="combinacion" className="pb-2 px-0">Combinacion</Th>
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
            Todavia no hay un par que se repita lo suficiente como para llamarlo patron.
          </p>
        )}
      </div>

      {acomp && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-4">
          <h2 className="font-semibold mb-3">Cuantos se van sin bebida</h2>
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
                {oport.conversion_supuesta_pct} de cada 100, serian{' '}
                <span className="font-semibold text-exito-700">
                  {fmt(oport.venta_potencial)}
                </span>{' '}
                mas de venta y {fmt(oport.ganancia_potencial)} de ganancia en este periodo.
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
