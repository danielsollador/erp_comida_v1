import { useSearchParams } from 'react-router-dom'

/**
 * Las secciones de un módulo, arriba y centradas.
 *
 * POR QUE. Cada módulo había ido creciendo hacia abajo: Usuarios era la lista
 * de cuentas y, debajo, el formulario de alta; Caja eran seis tarjetas
 * apiladas; Contabilidad e Impuestos se habían resuelto con pestañas propias,
 * cada una con su estilo, metidas dentro del contenido. Tres soluciones
 * distintas para lo mismo, y en ninguna se ve de un vistazo qué se puede hacer
 * en el módulo donde estás. Leider (16-sep): "no me gusta nada este separado
 * por pestañas dentro del modulo... en la parte superior, para cada modulo,
 * Usuarios, Crear cuenta, Crear Rol. Y asi para TODOS los modulos".
 *
 * Arriba y centrado, en el encabezado: el mismo sitio en todas las pantallas,
 * así deja de ser algo que hay que buscar.
 *
 * LA SECCION VIVE EN LA URL (`?s=`), no en un `useState`. Con estado local, el
 * botón de volver del navegador --y el gesto de volver de la tablet-- se
 * saltaban las secciones y sacaban del módulo entero; y no se podía mandar a
 * alguien directo a "Crear cuenta". Con la URL, volver hace lo que se espera y
 * cada sección tiene su enlace.
 */
export type Seccion = { id: string; texto: string }

export function useSeccion(secciones: Seccion[]): [string, (id: string) => void] {
  const [params, setParams] = useSearchParams()
  const pedida = params.get('s')
  const activa = secciones.some((s) => s.id === pedida) ? (pedida as string) : secciones[0].id
  // `replace`: elegir sección no llena el historial de pasos intermedios, pero
  // la URL sí queda compartible.
  const ir = (id: string) => setParams(id === secciones[0].id ? {} : { s: id }, { replace: true })
  return [activa, ir]
}

export function Secciones({
  secciones,
  activa,
  alCambiar,
  dark = false,
}: {
  secciones: Seccion[]
  activa: string
  alCambiar: (id: string) => void
  dark?: boolean
}) {
  if (secciones.length < 2) return null
  return (
    <nav
      aria-label="Secciones"
      className={`flex justify-start sm:justify-center gap-1 px-3 pb-2 overflow-x-auto ${
        dark ? 'border-neutral-800' : ''
      }`}
    >
      {secciones.map((s) => {
        const esta = s.id === activa
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => alCambiar(s.id)}
            aria-current={esta ? 'page' : undefined}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-medium whitespace-nowrap ${
              esta
                ? 'bg-neutral-900 text-white'
                : dark
                  ? 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
            }`}
          >
            {s.texto}
          </button>
        )
      })}
    </nav>
  )
}
