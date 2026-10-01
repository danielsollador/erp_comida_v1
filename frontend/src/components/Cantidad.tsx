import { useEffect, useState } from 'react'
import { Numerico } from './Teclado'
import { aBase, convertirTexto, otraUnidad } from '../lib/unidades'

/**
 * El boton de la unidad al lado de una cantidad: "kg ⇄". Un toque y se
 * escribe en gramos; otro y vuelve a kilos. Para lo que no tiene otra cara
 * (unidad, paquete) es solo el rotulo.
 *
 * Es el mismo de la receta, y vive aqui para que sea el mismo en todo el
 * sistema: comprar, mermar, contar, la ficha, las facturas (ver
 * `lib/unidades.ts`).
 */
export function BotonUnidad({
  unidad,
  vista,
  alCambiar,
  className = '',
}: {
  /** La unidad en que se guarda la mercancia. */
  unidad: string
  /** En la que se esta escribiendo ahora. */
  vista: string
  alCambiar: (vista: string) => void
  className?: string
}) {
  const otra = otraUnidad(unidad)
  if (!otra) {
    return <span className={`shrink-0 text-xs font-semibold text-neutral-500 px-1 ${className}`}>{unidad}</span>
  }
  const siguiente = vista === unidad ? otra : unidad
  return (
    <button
      type="button"
      onClick={() => alCambiar(siguiente)}
      title={`Escribir en ${siguiente}`}
      aria-label={`Cambiar a ${siguiente}`}
      className={`shrink-0 min-w-[3.25rem] rounded-lg bg-neutral-500/10 hover:bg-neutral-500/20 px-2 py-1.5 text-xs font-semibold tabular-nums text-neutral-700 ${className}`}
    >
      {vista} ⇄
    </button>
  )
}

/**
 * Una casilla de cantidad con su unidad al lado, que se puede cambiar.
 *
 * Recibe y entrega el valor en la unidad de la mercancia (`unidad`); lo que se
 * ve y se escribe puede estar en la otra cara. Si la mercancia cambia de
 * unidad (se elige "lt" en vez de "kg"), vuelve a la nueva.
 */
export function CampoCantidad({
  etiqueta,
  unidad,
  valor,
  alCambiar,
  ayuda,
  placeholder = '0',
  autoFocus,
}: {
  etiqueta: string
  unidad: string
  /** En `unidad`, como texto ('' = vacio). */
  valor: string
  alCambiar: (enUnidad: string) => void
  ayuda?: string
  placeholder?: string
  autoFocus?: boolean
}) {
  const [vista, setVista] = useState(unidad)
  const [texto, setTexto] = useState(valor)

  // Otra unidad de fondo (se cambio "Se mide en"): se vuelve a escribir en
  // ella, con el valor tal como estaba.
  useEffect(() => {
    setVista(unidad)
    setTexto(valor)
    // Solo cuando cambia la unidad: `valor` cambia con cada tecla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unidad])

  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">{etiqueta}</span>
      <span className="flex items-center gap-2">
        <Numerico
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value)
            alCambiar(aBase(e.target.value, unidad, vista))
          }}
          placeholder={placeholder}
          autoFocus={autoFocus}
          etiqueta={`${etiqueta} (${vista})`}
          className="flex-1 min-w-0 border border-neutral-300 rounded-lg px-3 py-2 text-sm"
        />
        <BotonUnidad
          unidad={unidad}
          vista={vista}
          alCambiar={(nueva) => {
            setTexto((t) => convertirTexto(t, unidad, vista, nueva))
            setVista(nueva)
          }}
        />
      </span>
      {ayuda && <span className="block text-xs text-neutral-500 mt-1">{ayuda}</span>}
    </label>
  )
}
