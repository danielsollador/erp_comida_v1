import Icono from '../../../components/Icono'
import { Seccion } from '../../../components/ui'
import { cantidad } from '../../../lib/inventario'
import { useMoneda } from '../../../lib/moneda'
import { ALMACENES, ALMACEN_DE, type Almacen } from '../../../lib/tiposArticulo'
import type { ConteoResumen, Ingrediente, SugerenciaCompra, TipoArticulo } from '../../../lib/types'

/**
 * La portada de Inventario: los cuatro almacenes de la pizarra, cada uno con
 * lo que importa de él, y debajo lo que pide atención hoy. Se entra a un
 * almacén tocando su ficha.
 *
 *   Reventa        compra → depósito → menú → venta
 *   Materia prima  compra → crudo → preparado → menú
 *   Consumible     compra → depósito → receta
 *   Desechable     compra → gasto
 */

export type ResumenAlmacen = {
  tipo: TipoArticulo
  mercancias: number
  bajoMinimo: number
  sinCosto: number
  /** Stock × costo promedio. Para desechables, lo gastado en el período. */
  plata: number
  /** Solo materia prima: cuántas preparaciones hay y cuántas se podrían hacer hoy. */
  preparaciones?: number
}

const CAMINO: Record<TipoArticulo, string[]> = {
  reventa: ['compra', 'depósito', 'menú', 'venta'],
  insumo: ['compra', 'crudo', 'preparado', 'menú'],
  consumible: ['compra', 'depósito', 'receta'],
  desechable: ['compra', 'gasto'],
  preparacion: ['crudo', 'cocina', 'menú'],
}

export default function Almacenes({
  resumenes,
  nombreRango,
  sugerencias,
  ingredientes,
  perdidas,
  ultimoConteo,
  onEntrar,
  onComprar,
  onVerComprar,
  onVerControl,
}: {
  resumenes: ResumenAlmacen[]
  nombreRango: string
  sugerencias: SugerenciaCompra[]
  ingredientes: Ingrediente[]
  perdidas: number
  ultimoConteo: ConteoResumen | null
  onEntrar: (tipo: TipoArticulo) => void
  onComprar: (ing: Ingrediente) => void
  onVerComprar: () => void
  onVerControl: () => void
}) {
  const { fmt: dinero } = useMoneda()
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {ALMACENES.map((a) => {
          const r = resumenes.find((x) => x.tipo === a.valor)
          return <FichaAlmacen key={a.valor} a={a} r={r} nombreRango={nombreRango} onEntrar={() => onEntrar(a.valor)} />
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4">
        <Seccion
          titulo="Qué comprar"
          ayuda="Lo que está bajo mínimo o no llega a la semana al ritmo de venta."
          accion={
            sugerencias.length > 0 ? (
              <button type="button" onClick={onVerComprar} className="text-sm font-medium text-acento-700 hover:underline">
                Ver todo ({sugerencias.length})
              </button>
            ) : undefined
          }
        >
          {sugerencias.length === 0 ? (
            <p className="text-sm text-neutral-500 flex items-center gap-2 py-2">
              <Icono nombre="ok" size={16} className="text-exito-600" />
              Nada por comprar: todo está por encima del mínimo.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-500/10">
              {sugerencias.slice(0, 5).map((s) => {
                const ing = ingredientes.find((i) => i.id === s.ingrediente_id)
                return (
                  <li key={s.ingrediente_id} className="py-2.5 flex items-center gap-3">
                    {ing && <span className={`w-2 h-2 rounded-full shrink-0 ${ALMACEN_DE[ing.tipo].punto}`} />}
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium truncate">{s.ingrediente_nombre}</span>
                      <span className="block text-xs text-neutral-500 truncate">{s.razon}</span>
                    </span>
                    <span className="font-semibold tabular-nums whitespace-nowrap">
                      +{cantidad(s.cantidad_sugerida)} {s.unidad}
                    </span>
                    {ing && (
                      <button
                        type="button"
                        onClick={() => onComprar(ing)}
                        className="vp-control shrink-0 rounded-full px-3 py-1 text-xs font-semibold"
                      >
                        Llegó
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Seccion>

        <Seccion
          titulo="Control"
          ayuda="Lo que se perdió y cuándo se contó por última vez."
          accion={
            <button type="button" onClick={onVerControl} className="text-sm font-medium text-acento-700 hover:underline">
              Abrir
            </button>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-neutral-500/6 p-3.5">
              <p className="text-xs text-neutral-500">Pérdidas · {nombreRango.toLowerCase()}</p>
              <p className={`font-display text-2xl font-semibold tracking-tight tabular-nums mt-1 ${perdidas > 0 ? 'text-peligro-600' : ''}`}>
                {dinero(perdidas)}
              </p>
              <p className="text-[11px] text-neutral-500 mt-1">mermas y faltantes de conteo</p>
            </div>
            <div className="rounded-2xl bg-neutral-500/6 p-3.5">
              <p className="text-xs text-neutral-500">Último conteo</p>
              <p className="font-display text-2xl font-semibold tracking-tight tabular-nums mt-1">
                {ultimoConteo ? new Date(ultimoConteo.fecha).toLocaleDateString('es-VE', { day: 'numeric', month: 'short' }).replace('.', '') : '—'}
              </p>
              <p className="text-[11px] text-neutral-500 mt-1">
                {ultimoConteo ? `${ultimoConteo.contados} contadas · ${ultimoConteo.cuadraron} cuadraron` : 'Todavía no se ha contado'}
              </p>
            </div>
          </div>
        </Seccion>
      </div>
    </div>
  )
}

function FichaAlmacen({ a, r, nombreRango, onEntrar }: { a: Almacen; r?: ResumenAlmacen; nombreRango: string; onEntrar: () => void }) {
  const { fmt: dinero } = useMoneda()
  const esGasto = a.destino === 'gasto'
  const camino = CAMINO[a.valor]
  return (
    <button
      type="button"
      onClick={onEntrar}
      className="vp-losa vp-pulsable group text-left p-4 sm:p-5 flex flex-col gap-4 min-h-[13rem] hover:shadow-[0_1px_2px_rgb(23_24_27/0.04),0_18px_40px_-16px_rgb(23_24_27/0.22)] transition-shadow"
    >
      <div className="flex items-start justify-between gap-3">
        <span className={`inline-grid place-items-center w-11 h-11 rounded-2xl ${a.sello}`}>
          <Icono nombre={a.icono} size={22} />
        </span>
        <span className="text-xs text-neutral-500 tabular-nums text-right">
          {r ? `${r.mercancias} mercancía${r.mercancias === 1 ? '' : 's'}` : '…'}
          {r?.preparaciones != null && r.preparaciones > 0 && (
            <span className="block">{r.preparaciones} preparación{r.preparaciones === 1 ? '' : 'es'}</span>
          )}
        </span>
      </div>
      <div>
        <h2 className="font-display text-lg font-semibold tracking-tight leading-tight">{a.texto}</h2>
        <p className="text-xs text-neutral-500 mt-0.5 leading-snug">{a.ejemplo}</p>
      </div>
      <div className="mt-auto">
        <p className="text-xs text-neutral-500">{esGasto ? `Gastado · ${nombreRango.toLowerCase()}` : 'Plata en el depósito'}</p>
        <p className="font-display text-2xl font-semibold tracking-tight tabular-nums leading-none mt-1">{r ? dinero(r.plata) : '…'}</p>
        <p className="mt-2 text-xs">
          {!r ? (
            ' '
          ) : esGasto ? (
            <span className="text-neutral-500">sin stock: va directo a gasto</span>
          ) : r.bajoMinimo > 0 ? (
            <span className="text-aviso-700 font-semibold">
              {r.bajoMinimo} bajo mínimo
            </span>
          ) : (
            <span className="text-exito-700">todo por encima del mínimo</span>
          )}
          {r && r.sinCosto > 0 && <span className="text-neutral-400"> · {r.sinCosto} sin costo</span>}
        </p>
      </div>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-neutral-400">
        {camino.map((paso, i) => (
          <span key={paso} className="inline-flex items-center gap-1.5">
            {i > 0 && <span aria-hidden>→</span>}
            <span className={i === 1 ? `font-semibold ${esGasto ? 'text-aviso-700' : 'text-neutral-600'}` : ''}>{paso}</span>
          </span>
        ))}
      </p>
    </button>
  )
}
