import { useCallback, useEffect, useState } from 'react'
import { Pastilla, Seccion, Vacio } from '../../../components/ui'
import { api } from '../../../lib/api'
import { useMoneda } from '../../../lib/moneda'
import type { Categoria, CostoIndirecto, CostoParaPrecios, CostoTeoricoFila } from '../../../lib/types'

/**
 * El control del depósito que no depende de que la cocina anote nada
 * (docs/plan-compras-inventario-produccion.md, fase 4):
 *
 *  - COSTO TEÓRICO vs REAL: lo que debió salir según las recetas contra lo
 *    que encontró el conteo. Una diferencia grande en el pollo es porción
 *    generosa, merma sin anotar o algo peor, y se ve en plata.
 *  - EL ACEITE POR PIEZA: lo cargado a la freidora entre lo que se frió.
 *  - CON QUÉ COSTO SE FIJAN PRECIOS: último costo, promedio o el mayor. Los
 *    libros van siempre a promedio (VEN-NIF); esto es solo para decidir.
 */

const PERIODOS = [
  { dias: 7, texto: '7 días' },
  { dias: 30, texto: '30 días' },
  { dias: 90, texto: '3 meses' },
]

const METODOS: { valor: CostoParaPrecios; texto: string; detalle: string }[] = [
  { valor: 'reposicion', texto: 'Último costo', detalle: 'lo que cuesta reponerlo hoy' },
  { valor: 'promedio', texto: 'Promedio', detalle: 'lo que costó lo que hay' },
  { valor: 'mayor', texto: 'El mayor', detalle: 'el más alto de los dos' },
]

function haceDias(dias: number) {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return d.toLocaleDateString('en-CA')
}

export default function Control() {
  const { fmt: dinero } = useMoneda()
  const [dias, setDias] = useState(30)
  const [teorico, setTeorico] = useState<CostoTeoricoFila[] | null>(null)
  const [indirectos, setIndirectos] = useState<CostoIndirecto[]>([])
  const [metodo, setMetodo] = useState<CostoParaPrecios>('reposicion')
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [error, setError] = useState('')

  const cargar = useCallback(() => {
    const desde = haceDias(dias)
    Promise.all([api.costoTeorico(desde), api.costosIndirectos(desde), api.obtenerConfig(), api.listarCategorias()])
      .then(([t, i, c, cats]) => {
        setTeorico(t)
        setIndirectos(i)
        setMetodo(c.costo_para_precios ?? 'reposicion')
        setCategorias(cats.filter((x) => x.activo !== false))
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar'))
  }, [dias])
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

  const fmt = (n: number) => n.toLocaleString('es-VE', { maximumFractionDigits: 3 })
  const perdido = (teorico ?? []).reduce((s, f) => s + Math.min(f.valor_diferencia, 0), 0)
  const conConteo = (teorico ?? []).some((f) => f.diferencia_conteo !== 0)
  const variantes = categorias.flatMap((c) =>
    (c.productos ?? [])
      .filter((p) => p.activo !== false)
      .flatMap((p) => (p.variantes ?? []).filter((v) => v.activo !== false).map((v) => ({ v, nombre: p.variantes.length > 1 ? `${p.nombre} ${v.nombre}` : p.nombre }))),
  )

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-peligro-50 px-3 py-2 text-sm text-peligro-700">{error}</p>}
      <div className="flex gap-1.5">
        {PERIODOS.map((p) => (
          <button
            key={p.dias}
            type="button"
            onClick={() => setDias(p.dias)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${dias === p.dias ? 'bg-neutral-900 text-white' : 'bg-white border border-neutral-300'}`}
          >
            {p.texto}
          </button>
        ))}
      </div>

      <Seccion
        titulo="Lo que debió salir contra lo que hay"
        ayuda="Según las recetas y lo vendido, contra lo que encontró el conteo. La diferencia es lo que se fue sin explicación."
      >
        {teorico === null ? (
          <p className="text-sm text-neutral-500 py-6 text-center">Cargando…</p>
        ) : teorico.length === 0 ? (
          <Vacio titulo="Sin movimientos en el período" detalle="Aparece en cuanto haya ventas con receta." />
        ) : (
          <>
            {conConteo ? (
              <p className={`mb-3 text-sm ${perdido < -0.005 ? 'text-peligro-700' : 'text-exito-700'}`}>
                {perdido < -0.005 ? (
                  <>
                    Se fueron <b className="tabular-nums">{dinero(-perdido)}</b> que las recetas no explican.
                  </>
                ) : (
                  'Los conteos cuadran con lo que dicen las recetas.'
                )}
              </p>
            ) : (
              <p className="mb-3 text-sm text-neutral-500">
                Para ver la diferencia hace falta contar el depósito (Mercancía → Contar). Aquí está lo que debió salir.
              </p>
            )}
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
                <tbody className="divide-y divide-neutral-100">
                  {teorico.map((f) => (
                    <tr key={f.ingrediente_id}>
                      <td className="py-2">{f.nombre}</td>
                      <td className="py-2 text-right tabular-nums">
                        {fmt(f.teorico)} {f.unidad}
                      </td>
                      <td className="py-2 text-right tabular-nums text-neutral-600">{f.mermas ? `${fmt(f.mermas)} ${f.unidad}` : '—'}</td>
                      <td className="py-2 text-right tabular-nums">
                        {f.diferencia_conteo ? (
                          <span className={f.diferencia_conteo < 0 ? 'text-peligro-700' : 'text-exito-700'}>
                            {f.diferencia_conteo > 0 ? '+' : ''}
                            {fmt(f.diferencia_conteo)} {f.unidad}
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

      <Seccion
        titulo="Aceite de freír por pieza"
        ayuda="Lo cargado a la freidora, repartido entre las piezas fritas que se vendieron. Se suma al costo de lo que se fríe."
      >
        {indirectos.length === 0 ? (
          <p className="text-sm text-neutral-500">
            Marca el aceite como «costo indirecto» en su ficha (Mercancía) y anota cada vez que cargas la freidora.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 text-sm">
            {indirectos.map((i) => (
              <li key={i.ingrediente_id} className="py-2 flex items-start justify-between gap-3">
                <span>
                  <span className="block font-medium">{i.nombre}</span>
                  <span className="block text-xs text-neutral-500">
                    Cargado {fmt(i.cargado)} {i.unidad} ({dinero(i.valor)}) · {fmt(i.piezas)} piezas fritas
                  </span>
                </span>
                <span className="text-right shrink-0">
                  <span className="block font-semibold tabular-nums">{i.por_pieza != null ? dinero(i.por_pieza) : '—'}</span>
                  <span className="block text-xs text-neutral-500">por pieza</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {variantes.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-neutral-700">
              Qué se fríe ({variantes.filter((x) => x.v.se_frie).length})
            </summary>
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

      <Seccion
        titulo="Con qué costo fijar precios"
        ayuda="Solo para los márgenes y precios sugeridos del menú. La contabilidad sigue a costo promedio, que es lo que pide la norma."
      >
        <div className="grid grid-cols-3 gap-2">
          {METODOS.map((m) => (
            <button
              key={m.valor}
              type="button"
              onClick={() => void elegirMetodo(m.valor)}
              className={`rounded-lg border px-3 py-2 text-left text-sm ${metodo === m.valor ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 bg-white'}`}
            >
              <span className="block font-medium">{m.texto}</span>
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
  )
}
