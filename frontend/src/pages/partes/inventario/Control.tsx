import { useCallback, useEffect, useState } from 'react'
import AccionFila from '../../../components/AccionFila'
import CambiosDeHoy from '../../../components/CambiosDeHoy'
import { Tabla, Th, useBuscador, useOrden } from '../../../components/Tabla'
import { Filtros, Pastilla, Seccion, Vacio } from '../../../components/ui'
import { api } from '../../../lib/api'
import { cantidad, unidadDe } from '../../../lib/inventario'
import { useMoneda } from '../../../lib/moneda'
import type { Rango } from '../../../lib/fechas'
import type { Categoria, ConteoResumen, CostoIndirecto, CostoParaPrecios, CostoTeoricoFila, Merma, SobranteInventario } from '../../../lib/types'

/**
 * El control del inventario: lo que no depende de que la cocina anote nada.
 *
 *  - TEÓRICO vs REAL: lo que debió salir según las recetas contra lo que
 *    encontró el conteo. Una diferencia grande en el pollo es porción
 *    generosa, merma sin anotar o algo peor, y se ve en plata.
 *  - PÉRDIDAS: lo que se botó, y los faltantes de conteo, por separado.
 *  - CONTEOS: cuándo se contó, quién y si fue a ciegas.
 *  - EL ACEITE POR PIEZA y CON QUÉ COSTO SE FIJAN PRECIOS.
 */

type Vista = 'teorico' | 'perdidas' | 'conteos' | 'costos'

const METODOS: { valor: CostoParaPrecios; texto: string; detalle: string }[] = [
  { valor: 'reposicion', texto: 'Último costo', detalle: 'lo que cuesta reponerlo hoy' },
  { valor: 'promedio', texto: 'Promedio', detalle: 'lo que costó lo que hay' },
  { valor: 'mayor', texto: 'El mayor', detalle: 'el más alto de los dos' },
]

export default function Control({
  rango,
  nombreRango,
  mermas,
  sobrantes,
  conteos,
  onRevertirMerma,
  onRevertirSobrante,
  onAbrirConteo,
  onContar,
}: {
  rango: Rango
  nombreRango: string
  mermas: Merma[]
  sobrantes: SobranteInventario[]
  conteos: ConteoResumen[]
  onRevertirMerma: (m: Merma) => void
  onRevertirSobrante: (s: SobranteInventario) => void
  onAbrirConteo: (id: number) => void
  onContar: () => void
}) {
  const { fmt: dinero } = useMoneda()
  const [vista, setVista] = useState<Vista>('teorico')
  const [teorico, setTeorico] = useState<CostoTeoricoFila[] | null>(null)
  const [indirectos, setIndirectos] = useState<CostoIndirecto[]>([])
  const [metodo, setMetodo] = useState<CostoParaPrecios>('reposicion')
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [error, setError] = useState('')

  const cargar = useCallback(() => {
    Promise.all([api.costoTeorico(rango.desde, rango.hasta), api.costosIndirectos(rango.desde, rango.hasta), api.obtenerConfig(), api.listarCategorias()])
      .then(([t, i, c, cats]) => {
        setTeorico(t)
        setIndirectos(i)
        setMetodo(c.costo_para_precios ?? 'reposicion')
        setCategorias(cats.filter((x) => x.activo !== false))
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar'))
  }, [rango.desde, rango.hasta])
  useEffect(cargar, [cargar])

  async function elegirMetodo(m: CostoParaPrecios) {
    setMetodo(m)
    try {
      await api.fijarCostoParaPrecios(m)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    }
  }

  async function fritura(v: { id: number; nombre: string; precio: number; activo: boolean }, se_frie: boolean) {
    try {
      await api.marcarFritura(v, se_frie)
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    }
  }

  const buscadorMermas = useBuscador<Merma>((m) => [m.ingrediente_nombre, m.motivo], 'Buscar por mercancía o motivo')
  const ordenMermas = useOrden<Merma>(
    { fecha: (m) => new Date(m.fecha), insumo: (m) => m.ingrediente_nombre, cantidad: (m) => m.cantidad, motivo: (m) => m.motivo, valor: (m) => m.valor },
    '-fecha',
  )

  const fmt = (n: number) => n.toLocaleString('es-VE', { maximumFractionDigits: 2 })
  const perdido = (teorico ?? []).reduce((s, f) => s + Math.min(f.valor_diferencia, 0), 0)
  const conConteo = (teorico ?? []).some((f) => f.diferencia_conteo !== 0)
  const variantes = categorias.flatMap((c) =>
    (c.productos ?? [])
      .filter((p) => p.activo !== false)
      .flatMap((p) => (p.variantes ?? []).filter((v) => v.activo !== false).map((v) => ({ v, nombre: p.variantes.length > 1 ? `${p.nombre} ${v.nombre}` : p.nombre }))),
  )
  const vivas = mermas.filter((m) => !m.revertida)
  const perdidas = vivas.filter((m) => !m.por_conteo).reduce((s, m) => s + m.valor, 0)
  const ajustes = vivas.filter((m) => m.por_conteo).reduce((s, m) => s + m.valor, 0)

  return (
    <div className="space-y-4">
      {error && <p className="rounded-2xl bg-peligro-500/10 px-4 py-3 text-sm text-peligro-700">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Filtros
          opciones={[
            { valor: 'teorico' as Vista, texto: 'Debió salir vs. hay' },
            { valor: 'perdidas' as Vista, texto: 'Pérdidas', contador: vivas.filter((m) => !m.por_conteo).length },
            { valor: 'conteos' as Vista, texto: 'Conteos', contador: conteos.length },
            { valor: 'costos' as Vista, texto: 'Aceite y precios' },
          ]}
          activo={vista}
          alElegir={setVista}
        />
        <button type="button" onClick={onContar} className="vp-control vp-pulsable rounded-full px-4 py-2 text-sm font-semibold">
          Conteo físico
        </button>
      </div>

      <CambiosDeHoy />

      {vista === 'teorico' && (
        <Seccion
          titulo="Lo que debió salir contra lo que hay"
          ayuda={`Según las recetas y lo vendido (${nombreRango.toLowerCase()}), contra lo que encontró el conteo. La diferencia es lo que se fue sin explicación.`}
        >
          {teorico === null ? (
            <p className="text-sm text-neutral-500 py-6 text-center">Cargando…</p>
          ) : teorico.length === 0 ? (
            <Vacio titulo="Sin movimientos en el período" detalle="Aparece en cuanto haya ventas con receta." />
          ) : (
            <>
              <div className={`mb-3 rounded-2xl p-3.5 text-sm ${conConteo ? (perdido < -0.005 ? 'bg-peligro-500/10 text-peligro-700' : 'bg-exito-500/10 text-exito-800') : 'bg-neutral-500/6 text-neutral-600'}`}>
                {conConteo ? (
                  perdido < -0.005 ? (
                    <>
                      Se fueron <b className="font-display text-lg tabular-nums">{dinero(-perdido)}</b> que las recetas no explican.
                    </>
                  ) : (
                    'Los conteos cuadran con lo que dicen las recetas.'
                  )
                ) : (
                  <>
                    Para ver la diferencia hace falta contar el inventario.{' '}
                    <button type="button" onClick={onContar} className="font-semibold underline">
                      Contar ahora
                    </button>
                    . Aquí está lo que debió salir.
                  </>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-neutral-500 text-left">
                      <th className="py-1.5 font-medium">Mercancía</th>
                      <th className="py-1.5 font-medium text-right">Debió salir</th>
                      <th className="py-1.5 font-medium text-right">Mermas</th>
                      <th className="py-1.5 font-medium text-right">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-500/10">
                    {teorico.map((f) => (
                      <tr key={f.ingrediente_id}>
                        <td className="py-2 font-medium">{f.nombre}</td>
                        <td className="py-2 text-right tabular-nums">
                          {fmt(f.teorico)} {unidadDe(f.teorico, f.unidad)}
                        </td>
                        <td className="py-2 text-right tabular-nums text-neutral-600">{f.mermas ? `${fmt(f.mermas)} ${unidadDe(f.mermas, f.unidad)}` : '—'}</td>
                        <td className="py-2 text-right tabular-nums">
                          {f.diferencia_conteo ? (
                            <span className={f.diferencia_conteo < 0 ? 'text-peligro-700' : 'text-exito-700'}>
                              {f.diferencia_conteo > 0 ? '+' : ''}
                              {fmt(f.diferencia_conteo)} {unidadDe(f.diferencia_conteo, f.unidad)}
                              <span className="block text-xs">
                                {dinero(f.valor_diferencia)}
                                {f.pct_desvio != null && ` · ${Math.abs(f.pct_desvio)} %`}
                              </span>
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Seccion>
      )}

      {vista === 'perdidas' && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 items-start">
          <Seccion
            titulo="Pérdidas registradas"
            ayuda={`Lo que se botó o se dañó (${nombreRango.toLowerCase()}). Los faltantes de un conteo se marcan aparte: bajan el stock igual, pero dicen que el sistema estaba mal, no que se perdió comida. Una merma por error se revierte: no se borra, queda el reverso asentado.`}
            accion={
              <span className="text-right text-sm">
                <b className="block font-display text-lg tabular-nums text-peligro-600">{dinero(perdidas)}</b>
                {ajustes > 0 && <span className="block text-[11px] font-normal text-neutral-500 tabular-nums">+ {dinero(ajustes)} en ajustes de conteo</span>}
              </span>
            }
            plano
          >
            {mermas.length === 0 ? (
              <Vacio titulo="Sin pérdidas registradas" detalle="Bien ahí." />
            ) : (
              <Tabla orden={ordenMermas} buscador={buscadorMermas} glosario="perdidas">
                <table className="w-full text-sm">
                  <thead className="text-neutral-500 text-xs">
                    <tr>
                      <Th clave="fecha">Fecha</Th>
                      <Th clave="insumo">Mercancía</Th>
                      <Th clave="cantidad" alinear="derecha">Cantidad</Th>
                      <Th clave="motivo">Motivo</Th>
                      <Th clave="valor" alinear="derecha">Valor</Th>
                      <Th alinear="derecha"></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordenMermas.ordenar(buscadorMermas.filtrar(mermas)).map((m) => (
                      <tr key={m.id} className={`border-t border-neutral-100 ${m.revertida ? 'opacity-50' : ''}`}>
                        <td className="p-3 text-neutral-500 whitespace-nowrap">{new Date(m.fecha).toLocaleDateString('es-VE')}</td>
                        <td className="p-3 font-medium">{m.ingrediente_nombre}</td>
                        <td className="p-3 text-right tabular-nums whitespace-nowrap">
                          {cantidad(m.cantidad)} {unidadDe(m.cantidad, m.unidad)}
                        </td>
                        <td className="p-3 text-neutral-500">
                          {m.por_conteo && <Pastilla tono="ojo">conteo</Pastilla>} {m.motivo || '—'}
                        </td>
                        <td className={`p-3 text-right tabular-nums font-medium ${m.por_conteo ? 'text-neutral-500' : 'text-peligro-600'}`}>{dinero(m.valor)}</td>
                        <td className="p-3 text-right">
                          {m.revertida ? <span className="text-xs text-neutral-500">revertida</span> : <AccionFila onClick={() => onRevertirMerma(m)}>Revertir</AccionFila>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Tabla>
            )}
          </Seccion>

          <Seccion titulo="Conteos que sumaron stock" ayuda="Entraron al inventario por un conteo físico hacia arriba. Si fue un error de tecleo, se puede revertir.">
            {sobrantes.length === 0 ? (
              <p className="text-sm text-neutral-500">Ninguno en el período.</p>
            ) : (
              <ul className="divide-y divide-neutral-500/10 text-sm">
                {sobrantes.map((sb) => (
                  <li key={sb.id} className="py-2 flex items-center justify-between gap-2">
                    <span className={sb.revertido ? 'text-neutral-400 line-through' : ''}>
                      {sb.ingrediente_nombre}
                      <span className="ml-1 text-xs text-neutral-400">
                        +{cantidad(sb.cantidad)} {unidadDe(sb.cantidad, sb.unidad)} · {new Date(sb.fecha).toLocaleDateString('es-VE')}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="tabular-nums">{dinero(sb.valor)}</span>
                      {!sb.revertido && <AccionFila onClick={() => onRevertirSobrante(sb)}>Revertir</AccionFila>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Seccion>
        </div>
      )}

      {vista === 'conteos' && (
        <Seccion
          titulo="Conteos hechos"
          ayuda="Cada planilla de inventario físico que se cargó, con lo que encontró. Un conteo a ciegas, sin ver lo que el sistema esperaba, es el que de verdad prueba algo. El preparado también se cuenta: «hay 1 kg de guiso» se traduce a crudo."
        >
          {conteos.length === 0 ? (
            <Vacio titulo="Todavía no se ha contado en este período" detalle="Un conteo semanal del crudo es lo que hace honesto todo lo demás." />
          ) : (
            <ul className="divide-y divide-neutral-500/10 text-sm">
              {conteos.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => onAbrirConteo(c.id)} className="vp-celda w-full py-2.5 px-1 flex items-center justify-between gap-2 text-left rounded-lg">
                    <span>
                      {new Date(c.fecha).toLocaleDateString('es-VE')}
                      {c.ciego && (
                        <>
                          {' '}
                          <Pastilla tono="bien">a ciegas</Pastilla>
                        </>
                      )}
                      <span className="block text-xs text-neutral-400">
                        {c.contados} mercancía(s) · {c.cuadraron} cuadraron
                        {c.operador && ` · ${c.operador}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-right tabular-nums">
                      <span className={c.neto < 0 ? 'text-peligro-600 font-medium' : 'text-neutral-600'}>
                        {c.neto < 0 ? '−' : c.neto > 0 ? '+' : ''}
                        {dinero(Math.abs(c.neto))}
                      </span>
                      <span className="block text-xs text-neutral-400">faltó {dinero(c.faltante_valor)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Seccion>
      )}

      {vista === 'costos' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <Seccion titulo="Aceite de freír por unidad" ayuda="Lo cargado a la freidora, repartido entre las unidades fritas que se vendieron. Se suma al costo de lo que se fríe.">
            {indirectos.length === 0 ? (
              <p className="text-sm text-neutral-500">Marca el aceite como «costo indirecto» en su ficha (Materia prima) y anota cada vez que cargas la freidora.</p>
            ) : (
              <ul className="divide-y divide-neutral-500/10 text-sm">
                {indirectos.map((i) => (
                  <li key={i.ingrediente_id} className="py-2 flex items-start justify-between gap-3">
                    <span>
                      <span className="block font-medium">{i.nombre}</span>
                      <span className="block text-xs text-neutral-500">
                        Cargado {fmt(i.cargado)} {unidadDe(i.cargado, i.unidad)} ({dinero(i.valor)}) · {fmt(i.piezas)} unidades fritas
                      </span>
                    </span>
                    <span className="text-right shrink-0">
                      <span className="block font-semibold tabular-nums">{i.por_pieza != null ? dinero(i.por_pieza) : '—'}</span>
                      <span className="block text-xs text-neutral-500">por unidad</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {variantes.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-neutral-700">Qué se fríe ({variantes.filter((x) => x.v.se_frie).length})</summary>
                <ul className="mt-2 grid sm:grid-cols-2 gap-x-4">
                  {variantes.map(({ v, nombre }) => (
                    <li key={v.id}>
                      <label className="flex items-center gap-2 py-1 text-sm cursor-pointer">
                        <input type="checkbox" checked={!!v.se_frie} onChange={(e) => void fritura(v, e.target.checked)} />
                        {nombre}
                      </label>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Seccion>

          <Seccion titulo="Con qué costo fijar precios" ayuda="Solo para los márgenes y precios sugeridos del menú. La contabilidad sigue a costo promedio, que es lo que pide la norma.">
            <div className="grid grid-cols-3 gap-2">
              {METODOS.map((m) => (
                <button
                  key={m.valor}
                  type="button"
                  onClick={() => void elegirMetodo(m.valor)}
                  className={`vp-pulsable rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${metodo === m.valor ? 'bg-neutral-900 text-white' : 'bg-neutral-500/6 hover:bg-neutral-500/10'}`}
                >
                  <span className="block font-semibold">{m.texto}</span>
                  <span className={`block text-xs ${metodo === m.valor ? 'text-white/70' : 'text-neutral-500'}`}>{m.detalle}</span>
                </button>
              ))}
            </div>
            {metodo === 'reposicion' && (
              <p className="mt-2">
                <Pastilla tono="acento">Recomendado con inflación</Pastilla>
              </p>
            )}
          </Seccion>
        </div>
      )}
    </div>
  )
}
