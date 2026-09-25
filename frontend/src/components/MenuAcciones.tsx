import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * El menu de "⋯" de una fila.
 *
 * VIVE AQUI Y NO DENTRO DE UNA PANTALLA porque es el gesto con el que se
 * administra CUALQUIER lista del ERP: las categorias del menu, las del
 * deposito, y lo que venga. Leider (24-sep): "no puede ser que el cliente
 * tenga que aprender de forma distinta como crear para cada modulo". Nacio
 * dentro de Menu.tsx; al necesitarlo Inventario, lo correcto era sacarlo, no
 * escribir uno parecido al lado.
 */
// `marcada`: una de dos (o mas) opciones excluyentes, y esta es la vigente.
type Opcion = { texto: string; ayuda?: string; peligro?: boolean; marcada?: boolean; onElegir: () => void }

/**
 * El menú de "⋯".
 *
 * Lo que borra no puede estar al lado de lo que se toca todo el día: en una
 * tablet, "Borrar categoría" como enlace de texto pegado al nombre estaba a un
 * dedo mal puesto de distancia.
 */
export default function MenuAcciones({
  etiqueta,
  opciones,
  encabezado,
  disparador,
}: {
  etiqueta: string
  opciones: Opcion[]
  /** Algo que se elige de un toque y no cierra el menu, como el color. */
  encabezado?: ReactNode
  /**
   * Otro boton en vez del "⋯", dibujado por quien llama.
   *
   * Existe para que un filtro desplegable pueda usar ESTE menu --el mismo
   * panel, la misma lamina, el mismo comportamiento al tocar fuera o pulsar
   * Escape-- con su propia pastilla por disparador, en vez de escribirse otro
   * menu al lado (Leider, 24-sep, sobre el desplegable nativo: "se ve
   * horrible").
   */
  disparador?: (estado: { abierto: boolean; alternar: () => void }) => ReactNode
}) {
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false)
    }
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false)
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', escape)
    }
  }, [abierto])

  return (
    <div ref={caja} className="relative shrink-0">
      {disparador ? (
        disparador({ abierto, alternar: () => setAbierto((v) => !v) })
      ) : (
        <button
          onClick={() => setAbierto((v) => !v)}
          aria-label={etiqueta}
          aria-haspopup="menu"
          aria-expanded={abierto}
          className="w-9 h-9 grid place-items-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden>
            <circle cx="3" cy="8" r="1.5" />
            <circle cx="8" cy="8" r="1.5" />
            <circle cx="13" cy="8" r="1.5" />
          </svg>
        </button>
      )}
      {abierto && (
        <div
          role="menu"
          className="vp-menu absolute right-0 top-full mt-1.5 z-30 min-w-56 max-h-[60vh] overflow-y-auto p-1"
        >
          {encabezado}
          {opciones.map((o) => (
            <button
              key={o.texto}
              role={o.marcada === undefined ? 'menuitem' : 'menuitemradio'}
              aria-checked={o.marcada}
              onClick={() => {
                setAbierto(false)
                if (!o.marcada) o.onElegir()
              }}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm hover:bg-neutral-50 ${
                o.peligro ? 'text-peligro-600' : ''
              } ${o.marcada ? 'font-semibold' : ''}`}
            >
              {o.marcada !== undefined && (
                <span aria-hidden className={`inline-block w-4 ${o.marcada ? 'text-acento-700' : 'text-transparent'}`}>
                  ✓
                </span>
              )}
              {o.texto}
              {o.ayuda && <span className="block text-[11px] text-neutral-400">{o.ayuda}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
