/**
 * Un campo de texto con su lista de sugerencias, dibujada por nosotros.
 *
 * Reemplaza a `<datalist>`. El desplegable nativo de un datalist NO se puede
 * estilar --ni el fondo, ni el radio, ni la tipografía-- y en Windows salía un
 * recuadro negro flotando encima del campo de abajo: de otro programa, y
 * tapando lo que el cajero iba a tocar después.
 *
 * Sigue siendo un campo de texto libre, no un `<select>`, y eso es a propósito:
 * un proveedor que no está en el directorio se puede teclear igual. La lista es
 * una comodidad para no volver a escribir "Distribuidora La Montaña" cada vez
 * --y para que no terminen dos proveedores por un error de tecleo--, no un
 * requisito para poder comprar.
 */
import { useEffect, useMemo, useRef, useState } from 'react'

export default function CampoSugerido({
  value,
  onChange,
  opciones,
  placeholder,
  className = '',
  vacio = 'Ninguno guardado todavía',
  ...resto
}: {
  value: string
  onChange: (valor: string) => void
  opciones: string[]
  placeholder?: string
  className?: string
  /** Qué decir cuando no hay ninguna coincidencia. */
  vacio?: string
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'className'>) {
  const [abierto, setAbierto] = useState(false)
  const [marcada, setMarcada] = useState(-1)
  const caja = useRef<HTMLDivElement>(null)
  const lista = useRef<HTMLUListElement>(null)

  const sugeridas = useMemo(() => {
    const q = value.trim().toLowerCase()
    // Con el campo ya lleno del valor exacto no se filtra a uno solo: quien
    // eligió y vuelve a abrir quiere ver la lista, no su propia respuesta.
    const coincide = opciones.filter((o) => o.toLowerCase().includes(q))
    return q && coincide.length === 1 && coincide[0].toLowerCase() === q ? opciones : coincide
  }, [opciones, value])

  // Cerrar al tocar fuera. `mousedown` y no `click`: si se espera al click, el
  // blur del campo ya cerró la lista y el toque cae en lo que haya debajo.
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false)
    }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierto])

  // La marcada tiene que verse: con quince proveedores, bajar con el teclado
  // dejaba la selección fuera de la parte visible de la lista.
  useEffect(() => {
    if (marcada < 0) return
    lista.current?.children[marcada]?.scrollIntoView({ block: 'nearest' })
  }, [marcada])

  function elegir(opcion: string) {
    onChange(opcion)
    setAbierto(false)
    setMarcada(-1)
  }

  function alTeclear(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!abierto) {
        setAbierto(true)
        setMarcada(0)
        return
      }
      const paso = e.key === 'ArrowDown' ? 1 : -1
      setMarcada((m) => (sugeridas.length === 0 ? -1 : (m + paso + sugeridas.length) % sugeridas.length))
      return
    }
    if (e.key === 'Enter' && abierto && marcada >= 0 && sugeridas[marcada]) {
      // Solo se traga el Enter si de verdad hay algo marcado: si no, el campo
      // se comporta como cualquier otro y el formulario sigue su curso.
      e.preventDefault()
      elegir(sugeridas[marcada])
      return
    }
    if (e.key === 'Escape' && abierto) {
      e.preventDefault()
      setAbierto(false)
      setMarcada(-1)
    }
  }

  return (
    <div ref={caja} className={`relative ${className}`}>
      <input
        {...resto}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value)
          setAbierto(true)
          setMarcada(-1)
        }}
        onFocus={() => setAbierto(true)}
        onKeyDown={alTeclear}
        role="combobox"
        aria-expanded={abierto}
        aria-autocomplete="list"
        autoComplete="off"
        className="w-full border border-neutral-300 rounded-lg pl-3 pr-8 py-2 text-sm"
      />
      {/* La misma flecha que dibuja `select` (ver index.css): en la misma fila
          hay desplegables nativos, y dos flechas distintas se notan. */}
      <button
        type="button"
        tabIndex={-1}
        aria-label="Ver la lista"
        onClick={() => setAbierto((v) => !v)}
        className="absolute right-0 top-0 h-full px-3 flex items-center text-neutral-900"
      >
        <span className="vp-flecha" />
      </button>

      {abierto && (
        <ul
          ref={lista}
          role="listbox"
          className="absolute z-30 left-0 right-0 mt-1 max-h-56 overflow-y-auto bg-white border border-neutral-200 rounded-xl shadow-lg py-1"
        >
          {sugeridas.map((o, i) => (
            <li key={o}>
              <button
                type="button"
                role="option"
                aria-selected={i === marcada}
                // `mousedown` y no `click`: el click llega después del blur del
                // campo, y para entonces la lista ya no está.
                onMouseDown={(e) => {
                  e.preventDefault()
                  elegir(o)
                }}
                onMouseEnter={() => setMarcada(i)}
                className={`w-full text-left px-3 py-2 text-sm leading-snug ${
                  i === marcada
                    ? 'bg-acento-500/15 text-acento-800 font-medium'
                    : 'text-neutral-700'
                }`}
              >
                {o}
              </button>
            </li>
          ))}
          {sugeridas.length === 0 && (
            <li className="px-3 py-2 text-sm text-neutral-400">
              {value.trim() ? `Sin coincidencias · se guardará "${value.trim()}"` : vacio}
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
