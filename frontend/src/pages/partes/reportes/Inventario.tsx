import { Link } from 'react-router-dom'
import { BarrasApiladas, GraficoDona } from '../../../components/Grafico'
import { Tabla, Th, useOrden } from '../../../components/Tabla'
import { Lecturas, Seccion } from '../../../components/ui'
import type { EstadoDeposito, InsumoDelDeposito, ReporteInventario } from '../../../lib/types'
import { Bloque, Kpi, Vacio, type Dinero } from './comunes'

/**
 * Analisis de inventario: donde esta la plata del deposito, para cuantos dias
 * alcanza cada cosa, que no se mueve y que hay que comprar (Leider, 22-sep).
 *
 * El stock es de HOY; el consumo con que se lee es el del periodo elegido
 * arriba. Asi "te dura 4 dias" sale del ritmo real de estos dias y no de un
 * minimo que alguien puso a dedo hace meses.
 */
export default function Inventario({ datos, dinero, corto }: { datos: ReporteInventario; dinero: Dinero; corto: (x: number) => string }) {
  const orden = useOrden<InsumoDelDeposito>(
    {
      nombre: (i) => i.nombre,
      hay: (i) => i.cantidad,
      valor: (i) => i.valor,
      consumo: (i) => i.por_dia,
      // Lo que no se consume (null) va al final: lo urgente es lo que se acaba.
      dias: (i) => (i.dias_de_stock == null ? 1e9 : i.dias_de_stock),
      estado: (i) => ORDEN_ESTADO[i.estado],
    },
    'dias',
  )

  const top = datos.por_insumo.filter((i) => i.valor > 0).slice(0, 10)

  return (
    <>
      {/* ── Las cifras ─────────────────────────────────────────────────── */}
      <div className="vp-escalonado grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          titulo="Valor del depósito"
          ayuda="kpi.valor_deposito"
          valor={dinero(datos.valor_total)}
          destacado
          nota={`${datos.activos} mercancía(s) activas, al costo promedio`}
        />
        <Kpi
          titulo="Salió a costo en el período"
          valor={dinero(datos.consumido)}
          destacado
          nota={
            datos.rotacion != null
              ? `el depósito rotó ${datos.rotacion.toLocaleString('es-VE', { maximumFractionDigits: 1 })} vez/veces`
              : undefined
          }
        />
        <Kpi
          titulo="Bajo mínimo o agotadas"
          ayuda="kpi.bajo_minimo"
          valor={String(datos.bajo_minimo + datos.agotados)}
          tono={datos.agotados > 0 ? 'malo' : datos.bajo_minimo > 0 ? undefined : 'bueno'}
          nota={datos.agotados > 0 ? `${datos.agotados} agotada(s)` : 'ninguna agotada'}
        />
        <Kpi
          titulo="Subida de precios"
          valor={datos.inflacion_pct != null ? `${datos.inflacion_pct > 0 ? '+' : ''}${datos.inflacion_pct.toFixed(0)}%` : '—'}
          tono={datos.inflacion_pct != null && datos.inflacion_pct >= 10 ? 'malo' : undefined}
          nota={
            datos.inflacion_pct != null
              ? `lo que subió la mercancía en ${datos.dias} día(s)`
              : 'hacen falta dos compras del mismo insumo para medirla'
          }
        />
      </div>

      {datos.insights.length > 0 && <Lecturas items={datos.insights} />}

      {datos.valor_total <= 0 && datos.activos === 0 ? (
        <Vacio>
          Todavía no hay mercancía cargada. Se carga desde <Link to="/inventario" className="underline">Inventario</Link>.
        </Vacio>
      ) : (
        <>
          {/* ── Donde esta la plata ──────────────────────────────────── */}
          <Bloque titulo="Dónde está la plata" descripcion="Lo que hay en el estante, valorado al costo promedio.">
            <div className="grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-3">
              <Seccion titulo="Las mercancías que más valen" ayuda="Las diez con más plata parada. Conviene contarlas más seguido.">
                {top.length > 0 ? (
                  <BarrasApiladas
                    formato={dinero}
                    leyenda={[
                      { nombre: 'Materia prima', color: 'var(--color-neutral-800)' },
                      { nombre: 'Reventa', color: 'var(--color-acento-500)' },
                    ]}
                    filas={top.map((i) => ({
                      nombre: i.nombre,
                      detalle: `${i.pct.toFixed(0)}%`,
                      partes: [
                        {
                          nombre: i.tipo === 'reventa' ? 'Reventa' : 'Materia prima',
                          valor: i.valor,
                          color: i.tipo === 'reventa' ? 'var(--color-acento-500)' : 'var(--color-neutral-800)',
                        },
                      ],
                    }))}
                  />
                ) : (
                  <p className="text-sm text-neutral-400 py-6 text-center">Sin existencias con valor.</p>
                )}
              </Seccion>
              <div className="space-y-3">
                <Seccion titulo="Materia prima y reventa">
                  <GraficoDona
                    formato={dinero}
                    centro={{ valor: corto(datos.valor_total), texto: 'en el depósito' }}
                    partes={[
                      { nombre: 'Materia prima', valor: datos.valor_insumos, color: 'var(--color-neutral-800)' },
                      { nombre: 'Reventa', valor: datos.valor_reventa, color: 'var(--color-acento-500)' },
                    ].filter((p) => p.valor > 0)}
                  />
                </Seccion>
                {datos.quietos > 0 && (
                  <Seccion titulo="Plata quieta" ayuda={`Mercancía sin ninguna salida en ${datos.dias} día(s).`}>
                    <div className="text-2xl font-bold tabular-nums">{dinero(datos.valor_quieto)}</div>
                    <p className="text-sm text-neutral-600 mt-1">
                      en {datos.quietos} mercancía(s) que no se tocaron:{' '}
                      {datos.por_insumo
                        .filter((i) => i.estado === 'quieto' && i.valor > 0)
                        .slice(0, 4)
                        .map((i) => i.nombre)
                        .join(', ')}
                      {datos.quietos > 4 && '…'}
                    </p>
                  </Seccion>
                )}
              </div>
            </div>
          </Bloque>

          {/* ── Para cuantos dias alcanza ────────────────────────────── */}
          <Bloque
            titulo="Para cuántos días alcanza"
            descripcion={`Al ritmo de consumo de los últimos ${datos.dias} día(s): ventas, mermas y consumo del personal.`}
          >
            <div className="bg-white rounded-2xl border border-neutral-200 p-4">
              <Tabla orden={orden}>
                <table className="w-full text-sm">
                  <thead className="text-neutral-500 text-xs uppercase">
                    <tr>
                      <Th clave="nombre" className="py-2 px-0">Mercancía</Th>
                      <Th clave="hay" alinear="derecha" className="py-2 px-0">Hay</Th>
                      <Th clave="valor" alinear="derecha" className="py-2 px-0 hidden md:table-cell">Vale</Th>
                      <Th clave="consumo" alinear="derecha" className="py-2 px-0 hidden sm:table-cell">Por día</Th>
                      <Th clave="dias" alinear="derecha" className="py-2 px-0">Días</Th>
                      <Th clave="estado" alinear="derecha" className="py-2 px-0">Estado</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {orden.ordenar(datos.por_insumo).map((i) => (
                      <tr key={i.ingrediente_id} className="border-t border-neutral-100">
                        <td className="py-2 font-medium">
                          {i.nombre}
                          {i.tipo === 'reventa' && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-neutral-400">reventa</span>}
                        </td>
                        <td className="py-2 text-right tabular-nums whitespace-nowrap">
                          {i.cantidad.toLocaleString('es-VE', { maximumFractionDigits: 2 })} {i.unidad}
                        </td>
                        <td className="py-2 text-right tabular-nums hidden md:table-cell">{dinero(i.valor)}</td>
                        <td className="py-2 text-right tabular-nums text-neutral-500 hidden sm:table-cell">
                          {i.por_dia > 0 ? i.por_dia.toLocaleString('es-VE', { maximumFractionDigits: 2 }) : '—'}
                        </td>
                        <td className={`py-2 text-right tabular-nums font-semibold ${colorDias(i)}`}>
                          {i.dias_de_stock == null ? '—' : i.dias_de_stock >= 999 ? '∞' : i.dias_de_stock.toFixed(0)}
                        </td>
                        <td className="py-2 text-right">
                          <Estado estado={i.estado} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Tabla>
            </div>
          </Bloque>

          {/* ── Que comprar ──────────────────────────────────────────── */}
          <Bloque titulo="Qué hay que comprar" descripcion="Lo que cruzó el mínimo o no llega a la semana al ritmo actual.">
            {datos.por_comprar.length === 0 ? (
              <Vacio>Nada por comprar ahora mismo: todo está por encima del mínimo y alcanza más de una semana.</Vacio>
            ) : (
              <div className="bg-white rounded-2xl border border-neutral-200 p-4">
                <ul className="divide-y divide-neutral-100 text-sm">
                  {datos.por_comprar.map((s) => (
                    <li key={s.ingrediente_id} className="py-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <span className="font-medium">{s.ingrediente_nombre}</span>
                      <span className="font-semibold tabular-nums text-acento-700">
                        comprar {s.cantidad_sugerida.toLocaleString('es-VE', { maximumFractionDigits: 2 })} {s.unidad}
                      </span>
                      <span className="text-xs text-neutral-500 basis-full sm:basis-auto">{s.razon}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-neutral-500 mt-3">
                  La lista completa, con proveedores y precios, está en{' '}
                  <Link to="/inventario?s=comprar" className="underline">Inventario · Qué comprar</Link>.
                </p>
              </div>
            )}
          </Bloque>

          {/* ── Que subio de precio ──────────────────────────────────── */}
          {datos.inflacion.length > 0 && (
            <Bloque titulo="Qué subió de precio" descripcion="Última compra contra la primera del período, por mercancía.">
              <div className="bg-white rounded-2xl border border-neutral-200 p-4">
                <table className="w-full text-sm">
                  <thead className="text-neutral-500 text-xs uppercase">
                    <tr>
                      <th className="py-2 text-left font-medium">Mercancía</th>
                      <th className="py-2 text-right font-medium">Antes</th>
                      <th className="py-2 text-right font-medium">Ahora</th>
                      <th className="py-2 text-right font-medium">Cambio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.inflacion.map((i) => (
                      <tr key={i.ingrediente_id} className="border-t border-neutral-100">
                        <td className="py-2 font-medium">{i.nombre}</td>
                        <td className="py-2 text-right tabular-nums text-neutral-500">{dinero(i.costo_inicial, 2)}</td>
                        <td className="py-2 text-right tabular-nums">{dinero(i.costo_actual, 2)}</td>
                        <td
                          className={`py-2 text-right tabular-nums font-semibold ${
                            i.cambio_pct >= 10 ? 'text-peligro-600' : i.cambio_pct > 0 ? 'text-aviso-700' : 'text-exito-700'
                          }`}
                        >
                          {i.cambio_pct > 0 ? '+' : ''}
                          {i.cambio_pct.toFixed(0)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Bloque>
          )}
        </>
      )}
    </>
  )
}

// Lo urgente primero cuando se ordena por estado.
const ORDEN_ESTADO: Record<EstadoDeposito, number> = { agotado: 0, bajo: 1, ok: 2, sobra: 3, quieto: 4 }

const ESTADOS: Record<EstadoDeposito, { texto: string; clase: string }> = {
  agotado: { texto: 'Agotado', clase: 'bg-peligro-50 text-peligro-700' },
  bajo: { texto: 'Bajo mínimo', clase: 'bg-aviso-50 text-aviso-700' },
  ok: { texto: 'Bien', clase: 'bg-exito-50 text-exito-700' },
  sobra: { texto: 'Sobra', clase: 'bg-neutral-100 text-neutral-600' },
  quieto: { texto: 'Sin movimiento', clase: 'bg-neutral-100 text-neutral-500' },
}

function Estado({ estado }: { estado: EstadoDeposito }) {
  const e = ESTADOS[estado]
  return (
    <span className={`inline-block text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 whitespace-nowrap ${e.clase}`}>
      {e.texto}
    </span>
  )
}

function colorDias(i: InsumoDelDeposito): string {
  if (i.dias_de_stock == null) return 'text-neutral-400'
  if (i.dias_de_stock <= 3) return 'text-peligro-600'
  if (i.dias_de_stock <= 7) return 'text-aviso-700'
  return ''
}
