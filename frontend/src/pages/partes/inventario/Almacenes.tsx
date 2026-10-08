import Icono from '../../../components/Icono'
import { Seccion } from '../../../components/ui'
import { cantidad, unidadDe } from '../../../lib/inventario'
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
  const vencidas = sugerencias.length
  return (
    <div className="space-y-4">
      {/* Arriba, chico: lo que hay que vigilar. Son tres cifras y se tocan. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
        <Vigilado
          titulo={`Pérdidas · ${nombreRango.toLowerCase()}`}
          valor={dinero(perdidas)}
          detalle="mermas y faltantes de conteo"
          tono={perdidas > 0 ? 'mal' : undefined}
          alTocar={onVerControl}
        />
        <Vigilado
          titulo="Último conteo"
          valor={ultimoConteo ? new Date(ultimoConteo.fecha).toLocaleDateString('es-VE', { day: 'numeric', month: 'short' }).replace('.', '') : '—'}
          detalle={ultimoConteo ? `${ultimoConteo.contados} contadas · ${ultimoConteo.cuadraron} cuadraron` : 'todavía no se ha contado'}
          alTocar={onVerControl}
        />
        <Vigilado
          titulo="Por comprar"
          valor={String(vencidas)}
          detalle={vencidas === 0 ? 'todo por encima del mínimo' : 'bajo mínimo o no llega a la semana'}
          tono={vencidas > 0 ? 'ojo' : 'bien'}
          alTocar={onVerComprar}
        />
      </div>

      {/* En el medio, grandes: los cuatro almacenes. Es a donde se entra. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {ALMACENES.map((a) => {
          const r = resumenes.find((x) => x.tipo === a.valor)
          return <FichaAlmacen key={a.valor} a={a} r={r} nombreRango={nombreRango} onEntrar={() => onEntrar(a.valor)} />
        })}
      </div>

      {sugerencias.length > 0 && (
        <Seccion
          titulo="Qué comprar"
          ayuda="Lo que está bajo mínimo o no llega a la semana al ritmo de venta."
          accion={
            <button type="button" onClick={onVerComprar} className="text-sm font-medium text-acento-700 hover:underline">
              Ver todo ({sugerencias.length})
            </button>
          }
        >
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
                    +{cantidad(s.cantidad_sugerida)} {unidadDe(s.cantidad_sugerida, s.unidad)}
                  </span>
                  {ing && (
                    <button type="button" onClick={() => onComprar(ing)} className="vp-control shrink-0 rounded-full px-3 py-1 text-xs font-semibold">
                      Llegó
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </Seccion>
      )}
    </div>
  )
}

/** Una cifra chica de arriba: un rótulo, el número y una frase. Se toca. */
function Vigilado({
  titulo,
  valor,
  detalle,
  tono,
  alTocar,
}: {
  titulo: string
  valor: string
  detalle: string
  tono?: 'mal' | 'ojo' | 'bien'
  alTocar: () => void
}) {
  const color = tono === 'mal' ? 'text-peligro-600' : tono === 'ojo' ? 'text-aviso-700' : tono === 'bien' ? 'text-exito-700' : 'text-neutral-900'
  return (
    // En el teléfono, una fila: el rótulo y su frase a la izquierda, la cifra
    // a la derecha. Desde tablet, las tres lado a lado.
    <button
      type="button"
      onClick={alTocar}
      className="vp-losa vp-pulsable text-left px-4 py-2.5 sm:py-3 min-w-0 flex items-center gap-3 sm:flex-col sm:items-stretch sm:gap-0"
    >
      <span className="min-w-0 flex-1 sm:flex-none">
        <span className="block text-xs sm:text-[11px] text-neutral-500 truncate">{titulo}</span>
        <span className="block sm:hidden text-xs text-neutral-500 truncate mt-0.5">{detalle}</span>
      </span>
      <span className={`block shrink-0 font-display text-xl font-semibold tabular-nums leading-tight sm:mt-0.5 ${color}`}>{valor}</span>
      <span className="hidden sm:block text-[11px] text-neutral-500 truncate mt-0.5">{detalle}</span>
    </button>
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
      className="vp-losa vp-pulsable group text-left p-4 sm:p-5 flex flex-col gap-3 sm:gap-5 sm:min-h-[16rem] hover:shadow-[0_1px_2px_rgb(23_24_27/0.04),0_18px_40px_-16px_rgb(23_24_27/0.22)] transition-shadow"
    >
      <div className="flex items-start justify-between gap-3">
        <span className={`inline-grid place-items-center w-11 h-11 rounded-2xl ${a.sello}`}>
          <Icono nombre={a.icono} size={22} />
        </span>
        <span className="text-xs text-neutral-500 tabular-nums text-right">
          {r ? `${r.mercancias} mercancía${r.mercancias === 1 ? '' : 's'}` : '…'}
          {r?.preparaciones != null && r.preparaciones > 0 && (
            <span className="block">{r.preparaciones} {r.preparaciones === 1 ? 'preparación' : 'preparaciones'}</span>
          )}
        </span>
      </div>
      <div>
        <h2 className="font-display text-lg font-semibold tracking-tight leading-tight">{a.texto}</h2>
        <p className="text-xs text-neutral-500 mt-0.5 leading-snug">{a.ejemplo}</p>
      </div>
      <div className="mt-auto">
        <p className="text-xs text-neutral-500">{esGasto ? `Gastado · ${nombreRango.toLowerCase()}` : 'Plata en el depósito'}</p>
        <p className="font-display text-3xl font-semibold tracking-tight tabular-nums leading-none mt-1">{r ? dinero(r.plata) : '…'}</p>
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
