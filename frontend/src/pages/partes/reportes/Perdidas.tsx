import { BarrasApiladas, GraficoDona, Variacion } from '../../../components/Grafico'
import { PALETA } from '../../../lib/paleta'
import { Tabla, Th, useOrden } from '../../../components/Tabla'
import { Lecturas, Seccion } from '../../../components/ui'
import type { Merma, ReportePerdidas } from '../../../lib/types'
import { Bloque, Kpi, Linea, SerieTiempo, SinDatos, Vacio, type Dinero } from './comunes'

/**
 * Analisis de perdidas: que se merma mas, que se merma menos, por que, y
 * cuanto pesa sobre la venta (Leider, 22-sep: "necesito analisis de
 * perdidas").
 *
 * La merma se separa en dos desde el backend: la que alguien REGISTRO (se
 * cayo, se quemo, se vencio) y la que aparecio en un CONTEO (el sistema decia
 * 10 y habia 7). Las dos son plata perdida, pero se arreglan distinto, y
 * sumarlas sin decirlo escondia justo la que preocupa.
 */
export default function Perdidas({ datos, dinero, corto }: { datos: ReportePerdidas; dinero: Dinero; corto: (x: number) => string }) {
  const de = datos.filtro ? datos.filtro.ingrediente || datos.filtro.categoria : ''
  const orden = useOrden<Merma>(
    {
      fecha: (m) => m.fecha,
      insumo: (m) => m.ingrediente_nombre,
      cantidad: (m) => m.cantidad,
      motivo: (m) => (m.por_conteo ? 'Conteo físico' : m.motivo),
      valor: (m) => m.valor,
    },
    '-fecha',
  )

  const top = datos.por_insumo.slice(0, 8)
  // "Lo que menos se merma": lo de abajo de la lista, sin repetir lo de arriba.
  const menos = datos.por_insumo.length > 3 ? datos.por_insumo.slice(-5).reverse().filter((p) => !top.includes(p)) : []
  const hayVentasQueNoLlegaron =
    datos.anulados > 0 || datos.devoluciones > 0 || datos.con_descuento > 0 || datos.cortesias > 0

  return (
    <>
      {/* ── Las cifras ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          titulo={de ? `Merma de ${de}` : 'Merma del período'}
          ayuda="kpi.perdidas"
          valor={dinero(datos.merma)}
          tono={datos.merma > 0 ? 'malo' : undefined}
          destacado
          delta={
            datos.merma_anterior > 0 || datos.merma > 0 ? (
              <Variacion pct={datos.cambio_pct} invertir texto="vs el período anterior" />
            ) : undefined
          }
          nota={`${datos.registros} registro(s)`}
        />
        <Kpi
          titulo="Peso sobre la venta"
          ayuda="kpi.merma_inventario"
          valor={datos.ventas > 0 ? `${datos.peso_pct.toFixed(1)}%` : '—'}
          tono={datos.peso_pct > 3 ? 'malo' : datos.merma > 0 ? undefined : 'bueno'}
          destacado
          nota={datos.ventas > 0 ? `de ${corto(datos.ventas)} vendidos` : 'sin ventas en el período'}
        />
        <Kpi
          titulo="Faltantes de conteo"
          valor={dinero(datos.merma_por_conteo)}
          nota="lo que el conteo encontró de menos"
        />
        <Kpi
          titulo="Consumo del personal"
          valor={dinero(datos.consumo_personal)}
          nota="no es merma: es un costo autorizado"
        />
      </div>

      {datos.insights.length > 0 && <Lecturas items={datos.insights} />}

      {/* Sin mermas los bloques se quedan en su sitio, cada grafico diciendo
          que esta vacio: una pantalla que se queda sin tarjetas parece un
          error (Leider, 1-oct). */}
      {datos.merma <= 0 && (
        <Vacio>
          No hay mermas {de ? `de ${de} ` : ''}registradas en este período.{' '}
          {datos.sin_merma > 0 && `Las ${datos.sin_merma} mercancías activas están sin ninguna pérdida anotada.`}
        </Vacio>
      )}
      {(
        <>
          {/* ── Cuando ───────────────────────────────────────────────── */}
          {(datos.serie.length > 1 || datos.merma <= 0) && (
            <Bloque titulo="Cuándo se perdió">
              <Seccion titulo={`Merma por ${datos.granularidad}`} ayuda="Al costo congelado del momento en que se registró.">
                {/* Barras, no linea: una merma es un hecho suelto, y la
                    linea unia un registro de $13 con cuatro dias en cero
                    dibujando un triangulo (auditoria de graficos, 30-sep). */}
                {datos.merma <= 0 && <SinDatos que="mermas" alto={180} />}
                {datos.merma > 0 && (
                <SerieTiempo
                  alto={180}
                  formato={corto}
                  formatoDetalle={(n) => dinero(n)}
                  color={PALETA.mal}
                  nombres={{ actual: 'Merma', anterior: 'Período anterior' }}
                  puntos={datos.serie.map((p) => ({
                    etiqueta: p.etiqueta,
                    valor: p.valor,
                    detalle: `${p.veces} ${p.veces === 1 ? 'registro' : 'registros'}`,
                  }))}
                />
                )}
              </Seccion>
            </Bloque>
          )}

          {/* ── Que ──────────────────────────────────────────────────── */}
          <Bloque titulo="Qué se merma más y qué menos" descripcion="Por mercancía, en plata.">
            <div className="grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-3">
              <Seccion
                titulo="Lo que más se pierde"
                ayuda="La barra completa es lo perdido; la parte ámbar salió de un conteo, no de un registro."
              >
                {top.length === 0 && <SinDatos que="mermas" alto={160} />}
                {top.length > 0 && (
                <BarrasApiladas
                  formato={dinero}
                  leyenda={[
                    { nombre: 'Registrada (se botó, se dañó)', color: PALETA.mal },
                    { nombre: 'Faltante de conteo', color: PALETA.ojo },
                  ]}
                  filas={top.map((p) => ({
                    nombre: p.nombre,
                    detalle: `${p.pct.toFixed(0)}% · ${p.cantidad.toLocaleString('es-VE', { maximumFractionDigits: 2 })} ${p.unidad}`,
                    partes: [
                      { nombre: 'Registrada', valor: Math.max(p.valor - p.valor_conteo, 0), color: PALETA.mal },
                      { nombre: 'Faltante de conteo', valor: p.valor_conteo, color: PALETA.ojo },
                    ],
                  }))}
                />
                )}
              </Seccion>

              <Seccion titulo="Lo que menos se pierde" ayuda="Y lo que no se perdió nada, que también es un dato.">
                {menos.length > 0 ? (
                  <ul className="text-sm divide-y divide-neutral-100">
                    {menos.map((p) => (
                      <li key={p.ingrediente_id} className="flex items-center gap-3 py-1.5">
                        <span className="flex-1 min-w-0 truncate">{p.nombre}</span>
                        <span className="text-xs text-neutral-400 tabular-nums">
                          {p.cantidad.toLocaleString('es-VE', { maximumFractionDigits: 2 })} {p.unidad}
                        </span>
                        <span className="w-20 text-right tabular-nums font-medium">{dinero(p.valor)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-neutral-500">
                    Con {datos.por_insumo.length} mercancía(s) con merma, todas están en la lista de la izquierda.
                  </p>
                )}
                <p className="mt-3 pt-3 border-t border-neutral-100 text-sm">
                  <span className="font-semibold text-exito-700">{datos.sin_merma}</span>{' '}
                  <span className="text-neutral-600">
                    mercancía(s) activas sin ninguna merma en el período.
                  </span>
                </p>
              </Seccion>
            </div>
          </Bloque>

          {/* ── Por que ──────────────────────────────────────────────── */}
          <Bloque titulo="Por qué se perdió">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <Seccion titulo="Motivos" ayuda="El motivo que se escribió al registrar. Los faltantes de conteo van aparte.">
                {datos.por_motivo.length === 0 && <SinDatos que="mermas" alto={160} />}
                {datos.por_motivo.length > 0 && (
                <GraficoDona
                  formato={dinero}
                  centro={{ valor: corto(datos.merma), texto: 'perdidos' }}
                  partes={datos.por_motivo.map((m) => ({
                    nombre: m.motivo,
                    valor: m.valor,
                    detalle: `${m.veces} vez/veces`,
                    color: m.motivo === 'Conteo fisico' ? PALETA.ojo : undefined,
                  }))}
                />
                )}
              </Seccion>
              <Seccion titulo="Registrada contra encontrada">
                <Linea dinero={dinero} etiqueta="Merma registrada a mano" monto={datos.merma_registrada} />
                <Linea dinero={dinero} etiqueta="Faltantes que encontró un conteo" monto={datos.merma_por_conteo} />
                <Linea dinero={dinero} etiqueta="Total perdido" monto={datos.merma} total />
                {(datos.por_operador?.length ?? 0) > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">Quién la anotó</p>
                    {datos.por_operador!.map((o) => (
                      <Linea key={o.operador} dinero={dinero} etiqueta={`${o.operador} · ${o.veces} ${o.veces === 1 ? 'vez' : 'veces'}`} monto={o.valor} />
                    ))}
                  </div>
                )}
                <p className="text-xs text-neutral-500 mt-3">
                  Lo registrado a mano se arregla en la cocina: porciones, almacenamiento, compras de más.
                  Lo que aparece en un conteo nadie lo anotó cuando pasó: o se bota sin avisar, o se está
                  yendo por la puerta.
                </p>
              </Seccion>
            </div>
          </Bloque>

          {/* ── Detalle ──────────────────────────────────────────────── */}
          <Bloque titulo="Registro por registro">
            <div className="bg-white rounded-2xl border border-neutral-200 p-4">
              {datos.detalle.length === 0 && <SinDatos que="registros de merma" alto={100} />}
              {datos.detalle.length > 0 && (
              <Tabla orden={orden} glosario="perdidas">
                <table className="w-full text-sm">
                  <thead className="text-neutral-500 text-xs uppercase">
                    <tr>
                      <Th clave="fecha" className="py-2 px-0">Fecha</Th>
                      <Th clave="insumo" className="py-2 px-0">Mercancía</Th>
                      <Th clave="cantidad" alinear="derecha" className="py-2 px-0">Cantidad</Th>
                      <Th clave="motivo" className="py-2 px-0 hidden sm:table-cell">Motivo</Th>
                      <Th clave="valor" alinear="derecha" className="py-2 px-0">Valor</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {orden.ordenar(datos.detalle).map((m) => (
                      <tr key={m.id} className="border-t border-neutral-100">
                        <td className="py-2 tabular-nums text-neutral-500 whitespace-nowrap">
                          {new Date(m.fecha).toLocaleString('es-VE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-2 font-medium">{m.ingrediente_nombre}</td>
                        <td className="py-2 text-right tabular-nums">
                          {m.cantidad.toLocaleString('es-VE', { maximumFractionDigits: 2 })} {m.unidad}
                        </td>
                        <td className="py-2 text-neutral-600 hidden sm:table-cell">
                          {m.por_conteo ? (
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-aviso-700 bg-aviso-50 rounded px-1.5 py-0.5">
                              conteo físico
                            </span>
                          ) : (
                            m.motivo || <span className="text-neutral-400">sin motivo</span>
                          )}
                        </td>
                        <td className="py-2 text-right tabular-nums font-medium">{dinero(m.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Tabla>
              )}
            </div>
          </Bloque>
        </>
      )}

      {/* ── Ventas que no llegaron ───────────────────────────────────── */}
      {hayVentasQueNoLlegaron && (
        <Bloque titulo="Ventas que no llegaron a serlo" descripcion="No son merma, pero es plata que se dejó de cobrar.">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi
              titulo="Cortesías"
              valor={dinero(datos.valor_cortesias)}
              nota={`${datos.cortesias} regalo(s) a precio de lista · costaron ${dinero(datos.costo_cortesias)}`}
            />
            <Kpi
              titulo="Comandas anuladas"
              ayuda="kpi.anuladas"
              valor={dinero(datos.valor_anulado)}
              nota={`${datos.anulados} comanda(s). Si ya se habían preparado, sí es pérdida.`}
            />
            <Kpi
              titulo="Ventas devueltas"
              ayuda="kpi.devueltas"
              valor={dinero(datos.valor_devuelto)}
              nota={`${datos.devoluciones} venta(s) devueltas por el cliente`}
            />
            <Kpi
              titulo="Descuentos"
              ayuda="kpi.descuentos"
              valor={dinero(datos.valor_descuentos)}
              nota={`en ${datos.con_descuento} venta(s)`}
            />
          </div>
        </Bloque>
      )}
    </>
  )
}
