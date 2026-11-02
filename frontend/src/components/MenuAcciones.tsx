import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

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
  alinear = 'derecha',
  mantenerAbierto = false,
}: {
  etiqueta: string
  opciones: Opcion[]
  /** Seleccion multiple: elegir no cierra el panel y marcar de nuevo desmarca. */
  mantenerAbierto?: boolean
  /**
   * De que lado del disparador cuelga el panel. El "⋯" de una fila esta a
   * la derecha de la pantalla y el panel se abre hacia la izquierda; una
   * pastilla de filtro esta a la izquierda y el panel tiene que abrirse
   * hacia la derecha, o se sale por el borde.
   */
  alinear?: 'derecha' | 'izquierda'
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
  const panel = useRef<HTMLDivElement>(null)
  const [lugar, setLugar] = useState<CSSProperties | null>(null)

  // EL PANEL FLOTA SOBRE LA PAGINA (portal + fixed), no colgado de la fila.
  // En el telefono las categorias del menu son una tira que se desliza de
  // lado (overflow-x-auto), y eso recorta todo lo que se sale de ella: el
  // "⋯" abria el panel, pero quedaba escondido bajo el borde de la tira y
  // parecia que no hacia nada (13-oct). Flotando, ningun contenedor lo corta.
  useLayoutEffect(() => {
    if (!abierto) {
      setLugar(null)
      return
    }
    const ubicar = () => {
      const d = caja.current?.getBoundingClientRect()
      if (!d) return
      const margen = 8
      const ancho = window.innerWidth
      const alto = window.innerHeight
      const abajo = alto - d.bottom
      // Si abajo no cabe y arriba hay mas sitio, se abre hacia arriba.
      const haciaArriba = abajo < 240 && d.top > abajo
      const css: CSSProperties = {
        position: 'fixed',
        maxHeight: Math.min(alto * 0.6, (haciaArriba ? d.top : abajo) - margen * 2),
        maxWidth: ancho - margen * 2,
      }
      if (haciaArriba) css.bottom = alto - d.top + 6
      else css.top = d.bottom + 6
      if (alinear === 'izquierda') css.left = Math.max(margen, d.left)
      else css.right = Math.max(margen, ancho - d.right)
      setLugar(css)
    }
    ubicar()
    window.addEventListener('resize', ubicar)
    window.addEventListener('scroll', ubicar, true)
    return () => {
      window.removeEventListener('resize', ubicar)
      window.removeEventListener('scroll', ubicar, true)
    }
  }, [abierto, alinear])

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => {
      const t = e.target as Node
      if (caja.current?.contains(t) || panel.current?.contains(t)) return
      setAbierto(false)
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
      {abierto && lugar && createPortal(
        <div ref={panel} role="menu" style={lugar} className="vp-menu z-[60] min-w-56 overflow-y-auto p-1">
          {encabezado}
          {opciones.map((o, i) => (
            <button
              // Con el indice: dos productos pueden llamarse igual.
              key={`${i}-${o.texto}`}
              role={o.marcada === undefined ? 'menuitem' : mantenerAbierto ? 'menuitemcheckbox' : 'menuitemradio'}
              aria-checked={o.marcada}
              onClick={() => {
                if (!mantenerAbierto) setAbierto(false)
                if (mantenerAbierto || !o.marcada) o.onElegir()
              }}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm hover:bg-neutral-50 ${
                o.peligro ? 'text-peligro-600' : ''
              } ${o.marcada ? 'font-semibold' : ''}`}
            >
              {/* El visto y, al lado, el texto con su linea chica debajo: la
                  ayuda ("retirada") va bajo el nombre, no bajo el visto. */}
              <span className="flex items-start gap-0">
                {o.marcada !== undefined && (
                  <span aria-hidden className={`inline-block w-4 shrink-0 ${o.marcada ? 'text-acento-700' : 'text-transparent'}`}>
                    ✓
                  </span>
                )}
                <span className="min-w-0">
                  {o.texto}
                  {o.ayuda && <span className="block text-[11px] font-normal text-neutral-400">{o.ayuda}</span>}
                </span>
              </span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
