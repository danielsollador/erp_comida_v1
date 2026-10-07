import type { ReactNode } from 'react'
import { ALMACEN_DE, ALMACENES } from '../../lib/tiposArticulo'
import type { TipoArticulo } from '../../lib/types'
import { fmtNum } from '../../lib/moneda'
import Icono from '../Icono'

/**
 * Las piezas con que Compras habla de los cuatro almacenes: el punto de color
 * de un renglón, el sello de una ficha, el selector de "qué es" y la barra de
 * "a dónde va la plata". Un solo color por tipo, en todas partes, para que
 * quien aprende que el cobre es materia prima lo reconozca en la lista de
 * facturas sin leer.
 */

/** El punto de color del tipo: lo mínimo que cabe en una fila apretada. */
export function PuntoTipo({ tipo, className = '' }: { tipo: TipoArticulo; className?: string }) {
  const a = ALMACEN_DE[tipo]
  return <span aria-hidden className={`inline-block w-2 h-2 rounded-full shrink-0 ${a.punto} ${className}`} />
}

/** La pastilla con el nombre del tipo, con o sin su ícono. */
export function SelloTipo({ tipo, icono = false }: { tipo: TipoArticulo; icono?: boolean }) {
  const a = ALMACEN_DE[tipo]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${a.sello}`}>
      {icono ? <Icono nombre={a.icono} size={12} /> : <PuntoTipo tipo={tipo} />}
      {a.texto}
    </span>
  )
}

/**
 * "¿Qué es?": los cuatro almacenes como cuatro fichas. Cada una dice en una
 * línea su camino y a dónde va la plata, que es lo que la cajera necesita
 * para elegir sin haber leído ningún manual.
 */
export function ElegirAlmacen({
  valor,
  alElegir,
  compacto = false,
}: {
  valor: TipoArticulo | null
  alElegir: (tipo: TipoArticulo) => void
  /** Dos columnas siempre, sin el ejemplo: para una ventana angosta. */
  compacto?: boolean
}) {
  return (
    <div role="radiogroup" className={`grid gap-2 ${compacto ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}>
      {ALMACENES.map((a) => {
        const esta = valor === a.valor
        return (
          <button
            key={a.valor}
            type="button"
            role="radio"
            aria-checked={esta}
            onClick={() => alElegir(a.valor)}
            className={`vp-pulsable group text-left rounded-2xl p-3 transition-colors ${
              esta
                ? 'bg-neutral-900 text-white shadow-[0_8px_24px_-12px_rgb(23_24_27/0.5)]'
                : 'bg-neutral-500/6 hover:bg-neutral-500/10 text-neutral-900'
            }`}
          >
            <span className="flex items-center justify-between gap-2">
              <span
                className={`inline-grid place-items-center w-8 h-8 rounded-xl ${
                  esta ? 'bg-white/12 text-white' : `${a.sello}`
                }`}
              >
                <Icono nombre={a.icono} size={16} />
              </span>
              <span className={`w-2 h-2 rounded-full ${a.punto} ${esta ? '' : 'opacity-70'}`} aria-hidden />
            </span>
            <span className="block mt-2.5 text-sm font-semibold leading-tight">{a.texto}</span>
            <span className={`block mt-1 text-xs leading-snug ${esta ? 'text-white/70' : 'text-neutral-500'}`}>
              {compacto ? a.detalle : a.ejemplo}
            </span>
            <span
              className={`block mt-2 text-[11px] font-semibold tracking-wide ${
                esta ? 'text-white/60' : a.destino === 'gasto' ? 'text-aviso-700' : 'text-neutral-400'
              }`}
            >
              {a.destino === 'gasto' ? '→ gasto del mes' : '→ depósito'}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export type ParteDeLaPlata = { tipo: TipoArticulo; monto: number }

/**
 * A dónde va la plata de una factura (o de un período): una barra partida por
 * tipo y, debajo, lo que entra al depósito y lo que se va a gasto. Es la
 * respuesta a la pregunta del dueño sin pasar por la contabilidad.
 */
export function DestinoPlata({
  partes,
  moneda = '$',
  titulo,
  pie,
}: {
  partes: ParteDeLaPlata[]
  moneda?: string
  titulo?: string
  pie?: ReactNode
}) {
  const total = partes.reduce((s, p) => s + p.monto, 0)
  const deposito = partes.filter((p) => ALMACEN_DE[p.tipo].destino === 'deposito').reduce((s, p) => s + p.monto, 0)
  const gasto = total - deposito
  const ordenadas = [...ALMACENES, ALMACEN_DE.preparacion]
    .map((a) => ({ a, monto: partes.filter((p) => p.tipo === a.valor).reduce((s, p) => s + p.monto, 0) }))
    .filter((x) => x.monto > 0)
  if (total <= 0) return null
  return (
    <div>
      {titulo && <p className="vp-etiqueta mb-2">{titulo}</p>}
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-neutral-500/10">
        {ordenadas.map(({ a, monto }) => (
          <span
            key={a.valor}
            className={`${a.punto} h-full transition-[width] duration-500 ease-[cubic-bezier(0.2,0.7,0.2,1)]`}
            style={{ width: `${(monto / total) * 100}%` }}
            title={`${a.texto}: ${moneda}${fmtNum(monto, 2)}`}
          />
        ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
        {ordenadas.map(({ a, monto }) => (
          <li key={a.valor} className="inline-flex items-center gap-1.5">
            <PuntoTipo tipo={a.valor} />
            {a.texto}
            <span className="tabular-nums font-semibold text-neutral-800">
              {moneda}
              {fmtNum(monto, 2)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-neutral-600">
        Al depósito{' '}
        <span className="font-semibold tabular-nums text-neutral-900">
          {moneda}
          {fmtNum(deposito, 2)}
        </span>
        {gasto > 0 && (
          <>
            {' '}
            · a gasto{' '}
            <span className="font-semibold tabular-nums text-aviso-700">
              {moneda}
              {fmtNum(gasto, 2)}
            </span>
          </>
        )}
      </p>
      {pie}
    </div>
  )
}
