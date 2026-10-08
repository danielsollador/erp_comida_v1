import { useEffect, useMemo, useRef, useState } from 'react'
import { CONCEPTOS } from '../../lib/compras'
import { llano } from '../../lib/filtros'
import { ALMACEN_DE } from '../../lib/tiposArticulo'
import type { ConceptoGasto, Ingrediente } from '../../lib/types'
import Icono from '../Icono'
import { PuntoTipo } from './Almacenes'

/**
 * Elegir la mercancía de un renglón: se escribe y aparece. Un `<select>` de
 * doscientas mercancías se recorre con el pulgar; escribiendo "har" se
 * encuentra la harina. Cada opción dice qué es (su punto de color), en qué
 * se lleva y cuánto hay, para no confundir "Queso" en kg con "Queso" en
 * unidad. Al final siempre está "Crear mercancía nueva", que abre la ventana
 * con las parecidas (NuevaMercancia).
 *
 * En una factura el renglón puede no ser mercancía (el flete, un servicio):
 * con `alConcepto`, debajo salen esos conceptos para marcarlo de un toque.
 */
export default function ElegirMercancia({
  ingredientes,
  valor,
  alElegir,
  alCrear,
  tono,
  id,
  sugerencia,
  permitirPreparaciones = false,
  placeholder,
  alConcepto,
}: {
  ingredientes: Ingrediente[]
  valor: number
  alElegir: (id: number) => void
  alCrear: () => void
  tono?: 'mal' | 'ojo'
  id?: string
  /** Lo que dice el papel: para buscar con eso de entrada. */
  sugerencia?: string
  /** Una receta de preparación puede llevar otra preparación. */
  permitirPreparaciones?: boolean
  placeholder?: string
  /** Para un renglón de factura: marcarlo como flete, servicio, equipo u otro. */
  alConcepto?: (c: ConceptoGasto) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [marcada, setMarcada] = useState(0)
  const caja = useRef<HTMLDivElement>(null)
  const entrada = useRef<HTMLInputElement>(null)
  const lista = useRef<HTMLUListElement>(null)

  const elegida = ingredientes.find((i) => i.id === valor) ?? null

  const visibles = useMemo(() => {
    const q = llano(texto.trim())
    const activas = ingredientes.filter((i) => i.activo !== false && (permitirPreparaciones || i.tipo !== 'preparacion'))
    if (!q) return activas.slice(0, 40)
    const palabras = q.split(/\s+/)
    return activas
      .map((i) => {
        const nombre = llano(i.nombre)
        const puntos = palabras.every((p) => nombre.includes(p)) ? (nombre.startsWith(q) ? 2 : 1) : 0
        return { i, puntos }
      })
      .filter((x) => x.puntos > 0)
      .sort((a, b) => b.puntos - a.puntos || a.i.nombre.localeCompare(b.i.nombre))
      .slice(0, 40)
      .map((x) => x.i)
  }, [texto, ingredientes, permitirPreparaciones])

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: PointerEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false)
    }
    document.addEventListener('pointerdown', fuera)
    return () => document.removeEventListener('pointerdown', fuera)
  }, [abierto])

  useEffect(() => {
    lista.current?.children[marcada]?.scrollIntoView({ block: 'nearest' })
  }, [marcada])

  function abrir() {
    setTexto('')
    setAbierto(true)
    setTimeout(() => entrada.current?.focus(), 0)
  }

  function elegir(i: Ingrediente) {
    alElegir(i.id)
    setAbierto(false)
  }

  const borde =
    tono === 'mal'
      ? 'ring-1 ring-peligro-300 border-peligro-400'
      : tono === 'ojo'
        ? 'ring-1 ring-aviso-300 border-aviso-400'
        : 'border-neutral-300'

  return (
    <div ref={caja} id={id} className="relative">
      {!abierto ? (
        <button
          type="button"
          onClick={abrir}
          className={`w-full flex items-center gap-2 border rounded-xl px-3 py-2 text-sm text-left bg-white ${borde}`}
        >
          {elegida ? (
            <>
              <PuntoTipo tipo={elegida.tipo} />
              <span className="font-medium truncate">{elegida.nombre}</span>
              <span className="text-xs text-neutral-500 shrink-0">· {elegida.unidad}</span>
            </>
          ) : (
            <>
              <Icono nombre="buscar" size={15} className="text-neutral-400 shrink-0" />
              <span className="text-neutral-500 truncate">{placeholder ?? '¿Qué mercancía es?'}</span>
            </>
          )}
          <span aria-hidden className="vp-flecha ml-auto shrink-0 opacity-60" />
        </button>
      ) : (
        <div className={`flex items-center gap-2 border rounded-xl px-3 py-2 bg-white ${borde}`}>
          <Icono nombre="buscar" size={15} className="text-neutral-400 shrink-0" />
          <input
            ref={entrada}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value)
              setMarcada(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setMarcada((m) => Math.min(m + 1, visibles.length))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setMarcada((m) => Math.max(m - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                if (marcada < visibles.length) elegir(visibles[marcada])
                else alCrear()
              } else if (e.key === 'Escape') {
                setAbierto(false)
              }
            }}
            placeholder={sugerencia ? `Buscar… (el papel dice «${sugerencia}»)` : 'Escribe para buscar'}
            aria-label="Buscar mercancía"
            aria-autocomplete="list"
            className="flex-1 min-w-0 !border-0 !bg-transparent !rounded-none !p-0 text-sm outline-none"
          />
        </div>
      )}

      {abierto && (
        <ul
          ref={lista}
          role="listbox"
          className="vp-menu absolute z-30 left-0 right-0 mt-1.5 max-h-72 overflow-auto p-1"
        >
          {visibles.map((i, n) => {
            const a = ALMACEN_DE[i.tipo]
            return (
              <li
                key={i.id}
                role="option"
                aria-selected={i.id === valor}
                onMouseEnter={() => setMarcada(n)}
                onClick={() => elegir(i)}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm cursor-pointer ${
                  n === marcada ? 'bg-neutral-500/10' : ''
                }`}
              >
                <PuntoTipo tipo={i.tipo} />
                <span className="font-medium min-w-0 truncate">{i.nombre}</span>
                <span className="text-xs text-neutral-500 shrink-0">{a.texto}</span>
                <span className="ml-auto text-xs text-neutral-500 tabular-nums shrink-0">
                  {i.tipo === 'desechable'
                    ? 'sin stock'
                    : `hay ${Number(i.stock_actual || 0).toLocaleString('es-VE', { maximumFractionDigits: 2 })} ${i.unidad}`}
                </span>
              </li>
            )
          })}
          {visibles.length === 0 && (
            <li className="px-2.5 py-2 text-sm text-neutral-500">Ninguna se llama así.</li>
          )}
          <li
            role="option"
            aria-selected={false}
            onMouseEnter={() => setMarcada(visibles.length)}
            onClick={alCrear}
            className={`mt-1 flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold cursor-pointer text-acento-700 ${
              marcada === visibles.length ? 'bg-neutral-500/10' : ''
            }`}
          >
            <Icono nombre="mas" size={15} />
            Crear mercancía nueva{texto.trim() ? `: «${texto.trim()}»` : ''}
          </li>
          {alConcepto && (
            <li role="presentation" className="mt-1 border-t border-neutral-500/10 px-2.5 pt-2 pb-1.5">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-neutral-500 mb-1.5">No es mercancía</span>
              <span className="flex flex-wrap gap-1.5">
                {CONCEPTOS.map((c) => (
                  <button
                    key={c.valor}
                    type="button"
                    onClick={() => {
                      setAbierto(false)
                      alConcepto(c.valor)
                    }}
                    title={c.ayuda}
                    className="vp-control rounded-full px-3 py-1 text-xs font-medium text-neutral-700"
                  >
                    {c.texto}
                  </button>
                ))}
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
