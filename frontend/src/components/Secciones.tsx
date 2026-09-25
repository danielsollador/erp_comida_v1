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
export type Seccion = {
  id: string
  texto: string
  /**
   * Cuantas cosas hay en esa seccion. VA APARTE y no dentro de `texto`.
   *
   * El punto de venta escribia "Pedidos · 5" de corrido, asi que la cifra
   * pesaba igual que el nombre y la pestaña crecia y encogia cada vez que
   * entraba una comanda -- moviendo de sitio la pestaña de al lado. Separada,
   * se le puede bajar el peso (que es un dato, no un titulo) y llevar cifras
   * tabulares, que no bailan al cambiar de numero.
   */
  contador?: number
}

export function useSeccion(
  secciones: Seccion[],
  // Nombre del parametro en la URL. Por defecto 's'; un modulo con
  // sub-secciones DENTRO de una sub-seccion (menu y recetas, cada uno con
  // las suyas) necesita un segundo nombre para no pisar al de afuera.
  param = 's',
): [string, (id: string) => void] {
  const [params, setParams] = useSearchParams()
  const pedida = params.get(param)
  const activa = secciones.some((s) => s.id === pedida) ? (pedida as string) : secciones[0].id
  // `replace`: elegir sección no llena el historial de pasos intermedios, pero
  // la URL sí queda compartible. Los demás parámetros (el rango de fechas,
  // `?r=`/`?d=`/`?h=`) se conservan: cambiar de sección no cambia el periodo.
  const ir = (id: string) => {
    const p = new URLSearchParams(params)
    if (id === secciones[0].id) p.delete(param)
    else p.set(param, id)
    setParams(p, { replace: true })
  }
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
      className={`flex justify-start sm:justify-center px-3 pb-2 overflow-x-auto ${
        dark ? 'border-neutral-800' : ''
      }`}
    >
      {/* `shrink-0`: con muchas secciones el carril se desplaza entero dentro
          del encabezado en vez de apretujar las pestañas hasta partirlas. */}
      <div className={`inline-flex shrink-0 items-center gap-1 rounded-full p-1 ${dark ? 'bg-neutral-800' : 'vp-segmentado'}`}>
      {secciones.map((s) => {
        const esta = s.id === activa
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => alCambiar(s.id)}
            aria-current={esta ? 'page' : undefined}
            className={`vp-seccion shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm whitespace-nowrap ${
              esta
                ? 'vp-segmento-elegido bg-neutral-900 text-white font-semibold'
                : dark
                  ? 'text-neutral-400 font-medium hover:text-white hover:bg-neutral-800'
                  : 'text-neutral-600 font-medium hover:text-neutral-900'
            }`}
          >
            {s.texto}
            {/* Solo si hay algo que contar: un "0" permanente es ruido, y la
                pestaña sin cifra se lee mas limpia. */}
            {s.contador != null && s.contador > 0 && (
              <span
                className={`rounded-full px-1.5 min-w-[20px] text-center text-[11px] font-semibold tabular-nums ${
                  esta ? 'bg-white/20' : 'bg-neutral-500/15'
                }`}
              >
                {s.contador}
              </span>
            )}
          </button>
        )
      })}
      </div>
    </nav>
  )
}
