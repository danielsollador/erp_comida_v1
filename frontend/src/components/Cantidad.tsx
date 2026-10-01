import { type ComponentProps, useEffect, useState } from 'react'
import { Numerico } from './Teclado'
import { aBase, convertirTexto, otraUnidad } from '../lib/unidades'

/**
 * La casilla de una cantidad con su unidad ADENTRO, pegada a la derecha:
 * "1 ............ kg ⇄". Un toque en "kg ⇄" y se escribe en gramos; otro y
 * vuelve a kilos. Lo que no tiene otra cara (unidad, paquete, piezas) lleva
 * solo el rotulo, en el mismo sitio.
 *
 * ADENTRO Y NO AL LADO. Al lado, el boton le comia el ancho a la casilla y
 * las de un mismo formulario quedaban de largos distintos (Leider, 2-oct:
 * "que ese boton de cambio quede asi igual, pero dentro de la tarjeta para
 * que todo tenga la misma dimension").
 *
 * Es la misma en todo el sistema: la ficha de la mercancia, comprar, mermar,
 * contar, las facturas y la receta (ver `lib/unidades.ts`).
 */
export function CasillaConUnidad({
  unidad,
  vista,
  alCambiarVista,
  rotulo,
  className = '',
  claseCasilla = '',
  ...numerico
}: Omit<ComponentProps<typeof Numerico>, 'className'> & {
  /** La unidad en que se guarda la mercancia. */
  unidad: string
  /** En la que se esta escribiendo ahora. */
  vista: string
  alCambiarVista: (vista: string) => void
  /** Lo que se lee cuando la unidad no tiene otra cara. Por defecto, la unidad. */
  rotulo?: string
  /** El contenedor: el ancho y donde va. */
  className?: string
  /** La casilla: borde, relleno, alineacion. El sitio de la derecha lo reserva esto. */
  claseCasilla?: string
}) {
  const otra = otraUnidad(unidad)
  const siguiente = vista === unidad ? otra : unidad
  return (
    <span className={`relative block ${className}`}>
      <Numerico {...numerico} className={`block w-full ${claseCasilla} pr-[4.5rem]`} />
      {otra && siguiente ? (
        <button
          type="button"
          // Sin quitarle el foco a la casilla: si el teclado esta abierto,
          // sigue abierto y se sigue escribiendo, ya en la otra unidad.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => alCambiarVista(siguiente)}
          title={`Escribir en ${siguiente}`}
          aria-label={`Cambiar a ${siguiente}`}
          // Todo el alto de la casilla se puede tocar; lo que se ve es la
          // pastilla de adentro.
          className="group absolute inset-y-0 right-0 flex items-center pl-1 pr-[5px] touch-manipulation"
        >
          <span className="min-w-[3.25rem] rounded-md bg-neutral-500/10 px-2 py-1 text-center text-xs font-semibold tabular-nums text-neutral-700 group-hover:bg-neutral-500/20 group-active:bg-neutral-500/25">
            {vista} ⇄
          </span>
        </button>
      ) : (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-xs font-semibold text-neutral-500"
        >
          {rotulo ?? unidad}
        </span>
      )}
    </span>
  )
}

/**
 * Una casilla de cantidad con su rotulo arriba y la unidad adentro, que se
 * puede cambiar.
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
      <CasillaConUnidad
        unidad={unidad}
        vista={vista}
        alCambiarVista={(nueva) => {
          setTexto((t) => convertirTexto(t, unidad, vista, nueva))
          setVista(nueva)
        }}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value)
          alCambiar(aBase(e.target.value, unidad, vista))
        }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        etiqueta={`${etiqueta} (${vista})`}
        claseCasilla="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
      />
      {ayuda && <span className="block text-xs text-neutral-500 mt-1">{ayuda}</span>}
    </label>
  )
}
