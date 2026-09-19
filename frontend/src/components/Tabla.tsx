import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type ThHTMLAttributes,
} from 'react'
import { useAyuda } from './Ayuda'
import { explicar } from '../lib/glosario'

/**
 * Las tablas del ERP: se ordenan por cualquier columna y se ven completas.
 *
 * Son las dos reglas de la casa para tablas, y ninguna se cumplia. El orden
 * lo decidia el backend y no habia forma de cambiarlo, aunque nadie busca "la
 * fila 14": se busca el insumo mas caro, la venta mas grande, el respaldo mas
 * viejo. Y en pantallas angostas la tabla se cortaba por la derecha -- en la
 * tablet, la columna de acciones del inventario quedaba a medias.
 */

type Direccion = 'asc' | 'desc'
type Valor = string | number | Date | null | undefined

export type Orden = {
  clave: string | null
  dir: Direccion
  alternar: (clave: string) => void
}

const OrdenCtx = createContext<Orden | null>(null)
// De que seccion del glosario saca sus explicaciones esta tabla. Se declara
// una vez en `<Tabla glosario="inventario">` y cada `Th` compone su clave con
// la misma `clave` con la que ya ordena: asi no hay una segunda lista de
// nombres que mantener en paralelo con la primera.
const GlosarioCtx = createContext<string | undefined>(undefined)

function comparar(a: Valor, b: Valor): number {
  // Lo vacio siempre al final, se ordene como se ordene: una fila sin dato no
  // es "la menor", es la que no tiene dato.
  const vacioA = a == null || a === ''
  const vacioB = b == null || b === ''
  if (vacioA && vacioB) return 0
  if (vacioA) return 1
  if (vacioB) return -1
  if (a instanceof Date || b instanceof Date) return Number(a) - Number(b)
  if (typeof a === 'number' && typeof b === 'number') return a - b
  // Con locale 'es': la ñ va despues de la n y los acentos no separan "Azucar"
  // de "Azúcar". Con `numeric`, la factura 9 va antes que la 10 y no despues.
  return String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' })
}

/**
 * Ordenar una tabla haciendo clic en el titulo de la columna.
 *
 * `campos` dice de donde sale el valor de cada columna. `inicial` es la
 * columna con la que abre; con un guion delante, al reves ('-fecha' = lo mas
 * reciente primero).
 *
 *   const orden = useOrden<Insumo>({ nombre: (i) => i.nombre, stock: (i) => i.stock }, 'nombre')
 *   <Tabla orden={orden}> … <Th clave="stock" alinear="derecha">Stock</Th>
 *   {orden.ordenar(insumos).map(…)}
 */
export function useOrden<T>(
  campos: Record<string, (fila: T) => Valor>,
  inicial = '',
): Orden & { ordenar: (filas: T[]) => T[] } {
  // Clave y direccion viven en UN solo estado a proposito. Con dos `useState`
  // habia que llamar a `setDir` dentro del actualizador de `setClave`, y un
  // actualizador tiene que ser puro: React lo corre dos veces en desarrollo,
  // la direccion se invertia dos veces y el segundo clic en una columna no
  // hacia nada.
  const [{ clave, dir }, setEstado] = useState<{ clave: string | null; dir: Direccion }>({
    clave: inicial ? inicial.replace(/^-/, '') : null,
    dir: inicial.startsWith('-') ? 'desc' : 'asc',
  })

  const alternar = useCallback((c: string) => {
    // Segundo clic en la misma columna: se invierte. Es lo que hace todo el
    // mundo, y es lo que la flecha esta prometiendo.
    setEstado((o) => ({ clave: c, dir: o.clave === c && o.dir === 'asc' ? 'desc' : 'asc' }))
  }, [])

  // Sin memorizar: `campos` se declara en el render de la pantalla y es un
  // objeto nuevo cada vez, asi que memorizar obligaria a guardarlo en una ref
  // y leerla durante el render --que es justo lo que React pide no hacer--.
  // Ordenar unas decenas de filas no se nota.
  const ordenar = (filas: T[]) => {
    const campo = clave ? campos[clave] : undefined
    if (!campo) return filas
    // Copia: ordenar en sitio el array del estado deja a React viendo la
    // misma referencia y la tabla no se repinta.
    return [...filas].sort((a, b) => (dir === 'asc' ? 1 : -1) * comparar(campo(a), campo(b)))
  }

  return { clave, dir, alternar, ordenar }
}

/**
 * Sin acentos y en minusculas: buscar "azucar" tiene que encontrar "Azúcar",
 * y "bolivares" tiene que encontrar "Bolívares". Nadie escribe los acentos
 * cuando esta buscando algo con prisa en el mostrador.
 */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    // El rango son las marcas de acento que `NFD` separa de su letra.
    .replace(/[̀-ͯ]/g, '')
}

/**
 * Las palabras de una busqueda, sin acentos y en minusculas. Lista vacia =
 * no hay nada que filtrar.
 */
export function palabrasDe(consulta: string): string[] {
  return normalizar(consulta).split(/\s+/).filter(Boolean)
}

/**
 * Si `donde` contiene TODAS las palabras, en cualquier orden. Asi "emp per"
 * encuentra "Empanada - Pernil" sin escribirlo entero.
 */
export function contiene(donde: string, palabras: string[]): boolean {
  if (palabras.length === 0) return true
  const heno = normalizar(donde)
  return palabras.every((p) => heno.includes(p))
}

export type Buscador = {
  texto: string
  fijar: (t: string) => void
  etiqueta: string
  /** Lo que `filtrar` vio en la ultima pasada, para poder decirlo en pantalla. */
  total: number
  visibles: number
}

/**
 * El buscador de una tabla: filtra por texto sobre las columnas que se le
 * digan.
 *
 * POR QUE. Ordenar no es buscar. Con veinticuatro cuentas contables, o con
 * cuarenta insumos, encontrar "la de propinas" pedia recorrer la lista con el
 * ojo aunque la tabla estuviera ordenada por codigo. Leider (19-sep): "tienes
 * que poder filtrar por nombre y codigo".
 *
 * Cada palabra se busca por separado y todas tienen que aparecer, asi que
 * "caja bol" encuentra "Caja en bolivares" sin escribirlo entero ni en orden.
 *
 *   const buscador = useBuscador<Cuenta>((c) => [c.codigo, c.nombre], 'Buscar por código o nombre')
 *   <Tabla orden={orden} buscador={buscador}> … {orden.ordenar(buscador.filtrar(cuentas)).map(…)}
 */
export function useBuscador<T>(
  campos: (fila: T) => (string | number | null | undefined)[],
  etiqueta = 'Buscar…',
): Buscador & { filtrar: (filas: T[]) => T[] } {
  const [texto, fijar] = useState('')
  // Se rellenan en `filtrar` y los lee la barra. Funciona porque las filas se
  // arman dentro del `<Tabla>` de la pantalla --o sea, durante SU pintada--
  // y la barra se dibuja despues, en la pintada de `Tabla`.
  const estado: Buscador = { texto, fijar, etiqueta, total: 0, visibles: 0 }

  const filtrar = (filas: T[]) => {
    estado.total = filas.length
    const palabras = palabrasDe(texto)
    const salida = palabras.length
      ? filas.filter((f) =>
          contiene(campos(f).filter((v) => v != null && v !== '').join(' '), palabras),
        )
      : filas
    estado.visibles = salida.length
    return salida
  }

  return {
    texto,
    fijar,
    etiqueta,
    filtrar,
    get total() {
      return estado.total
    },
    get visibles() {
      return estado.visibles
    },
  }
}

/**
 * El envoltorio de toda tabla.
 *
 * Reparte el orden a los `Th` de adentro y, en un telefono, la convierte en
 * fichas apiladas (ver `.vp-tabla` en index.css): una tabla de ocho columnas
 * en 375 px no se puede "ver completa" de ninguna otra manera. Para eso cada
 * celda necesita saber de que columna es, y eso se copia aqui desde el
 * `thead` en vez de escribirlo a mano en noventa celdas.
 */
export function Tabla({
  orden,
  buscador,
  glosario,
  children,
  className = '',
}: {
  orden?: Orden
  /** De `useBuscador`: dibuja el campo de busqueda sobre la tabla. */
  buscador?: Buscador
  /** Seccion del glosario (`lib/glosario.ts`) de la que salen las ayudas. */
  glosario?: string
  children: ReactNode
  className?: string
}) {
  const caja = useRef<HTMLDivElement>(null)
  const [apilada, setApilada] = useState(false)
  // De que columnas se puede ordenar. Se leen del `thead` --cada `Th` deja su
  // clave en un `data-clave`-- porque en modo ficha el `thead` no se ve y hace
  // falta otro sitio desde donde ordenar.
  const [columnas, setColumnas] = useState<{ clave: string; titulo: string }[]>([])

  // Apilar o no apilar se decide MIDIENDO, no por el ancho de la pantalla:
  // se quita la clase, se pregunta cuanto necesita la tabla de verdad y se
  // vuelve a poner si no cabe. Con un punto de quiebre fijo, la tabla de
  // cuatro columnas se apilaba sin necesidad y la de ocho seguia cortandose
  // en la tablet, que es justo lo que habia que arreglar.
  useLayoutEffect(() => {
    const c = caja.current
    if (!c) return
    let anchoAnterior = -1
    const medir = () => {
      const tabla = c.querySelector('table')
      if (!tabla) return
      const disponible = c.clientWidth
      // Solo cuando cambia el ANCHO: al apilarse cambia el alto, y responder
      // a eso seria perseguirse la cola.
      if (disponible === anchoAnterior) return
      anchoAnterior = disponible
      c.classList.remove('vp-apilada')
      const noCabe = tabla.scrollWidth > disponible + 1
      if (noCabe) c.classList.add('vp-apilada')
      // El estado solo se toca cuando cambia de verdad: si no, cada medida
      // dispara una pintada, que dispara otra medida.
      setApilada((antes) => (antes === noCabe ? antes : noCabe))
    }
    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(c)
    return () => observador.disconnect()
  })

  // Sin lista de dependencias a proposito: los rotulos y las columnas hay que
  // rehacerlos cada vez que cambian las filas. Los dos `setState` de adentro
  // solo disparan si el valor cambio de verdad, asi que no se encadenan.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const tabla = caja.current?.querySelector('table')
    if (!tabla) return
    const ordenables = [...tabla.querySelectorAll('thead th[data-clave]')].map((th) => ({
      clave: (th as HTMLElement).dataset.clave as string,
      titulo: (th.textContent ?? '').trim(),
    }))
    setColumnas((antes) =>
      antes.length === ordenables.length && antes.every((c, i) => c.clave === ordenables[i].clave)
        ? antes
        : ordenables,
    )
    const titulos = [...tabla.querySelectorAll('thead th')].map((th) => (th.textContent ?? '').trim())
    for (const fila of tabla.querySelectorAll('tbody tr, tfoot tr')) {
      let i = 0
      for (const celda of fila.querySelectorAll('td')) {
        const c = celda as HTMLTableCellElement
        // Una celda combinada -- "no hay nada registrado", el total del pie --
        // no pertenece a una columna: se deja correr de lado a lado.
        if (c.colSpan > 1) {
          i += c.colSpan
          continue
        }
        const titulo = titulos[i] ?? ''
        if (titulo) c.dataset.etiqueta = titulo
        else delete c.dataset.etiqueta
        i += 1
      }
    }
  })

  return (
    <OrdenCtx.Provider value={orden ?? null}>
      <GlosarioCtx.Provider value={glosario}>
      <div ref={caja} className={`vp-tabla ${className}`}>
        {/* El buscador va ARRIBA de la tabla, siempre visible: es lo primero
            que se toca al entrar a una lista larga. */}
        {buscador && (
          <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-200">
            <div className="relative flex-1 min-w-0">
              <svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden
                className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                value={buscador.texto}
                onChange={(e) => buscador.fijar(e.target.value)}
                // Escape limpia: es lo que hace todo el mundo para volver a
                // ver la lista entera sin ir a borrar letra por letra.
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    buscador.fijar('')
                  }
                }}
                placeholder={buscador.etiqueta}
                aria-label={buscador.etiqueta}
                className="w-full bg-transparent border border-neutral-300 rounded-lg pl-9 pr-3 py-1.5 text-sm"
              />
            </div>
            {buscador.texto && (
              <>
                <span className="text-xs text-neutral-500 tabular-nums shrink-0">
                  {buscador.visibles} de {buscador.total}
                </span>
                <button
                  type="button"
                  onClick={() => buscador.fijar('')}
                  className="shrink-0 text-xs text-neutral-500 hover:text-neutral-900 px-2 py-1 rounded-lg hover:bg-neutral-100"
                >
                  Limpiar
                </button>
              </>
            )}
          </div>
        )}
        {/* Cuando no queda ninguna, se dice aqui: la tabla vacia de abajo
            diria "todavia no hay nada registrado", que es mentira -- hay,
            pero no coincide con lo que se escribio. */}
        {buscador && buscador.texto && buscador.visibles === 0 && (
          <p className="px-3 py-6 text-sm text-neutral-400 text-center">
            Ninguna fila coincide con «{buscador.texto}».
          </p>
        )}
        {/* En ficha no hay encabezados que tocar, y la regla de la casa es que
            toda tabla se ordene por cualquier columna: la barra hace de
            `thead` cuando el `thead` no esta. */}
        {apilada && orden && columnas.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-200 text-xs">
            <span className="text-neutral-500 shrink-0">Ordenar por</span>
            <select
              value={orden.clave ?? ''}
              onChange={(e) => orden.alternar(e.target.value)}
              className="min-w-0 flex-1 border border-neutral-300 rounded-lg px-2 py-1.5 text-xs bg-transparent"
            >
              {orden.clave === null && <option value="">—</option>}
              {columnas.map((c) => (
                <option key={c.clave} value={c.clave}>
                  {c.titulo}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => orden.clave && orden.alternar(orden.clave)}
              disabled={!orden.clave}
              title={orden.dir === 'asc' ? 'De menor a mayor' : 'De mayor a menor'}
              className="shrink-0 w-9 h-9 grid place-items-center rounded-lg border border-neutral-300 disabled:opacity-40"
            >
              {orden.dir === 'asc' ? '↑' : '↓'}
            </button>
          </div>
        )}
        {children}
      </div>
      </GlosarioCtx.Provider>
    </OrdenCtx.Provider>
  )
}

/**
 * El titulo de una columna. Con `clave`, ademas ordena por ella.
 *
 * Sin `clave` es un `th` normal: para la columna de los botones, que no tiene
 * nada por lo que ordenar.
 */
export function Th({
  clave,
  ayuda,
  alinear = 'izquierda',
  className = '',
  children,
  ...resto
}: {
  clave?: string
  /** Clave del glosario, cuando no coincide con `clave` o la columna no ordena. */
  ayuda?: string
  alinear?: 'izquierda' | 'derecha'
  children?: ReactNode
} & ThHTMLAttributes<HTMLTableCellElement>) {
  const orden = useContext(OrdenCtx)
  const seccion = useContext(GlosarioCtx)
  const al = alinear === 'derecha' ? 'text-right' : 'text-left'
  const claveAyuda = ayuda ?? (seccion && clave ? `${seccion}.${clave}` : undefined)
  const explicacion = explicar(claveAyuda)
  // La ayuda va en el `<th>` y no dentro del boton de ordenar: un boton
  // dentro de otro boton no es HTML valido y rompe la navegacion por teclado.
  const { props: ayudaProps, panel } = useAyuda(
    explicacion,
    typeof children === 'string' ? children : '',
  )
  const marca = explicacion ? 'vp-con-ayuda' : ''

  if (!clave || !orden) {
    return (
      <th {...resto} {...ayudaProps} data-ayuda={claveAyuda} className={`${al} p-3 ${className}`}>
        <span className={marca}>{children}</span>
        {panel}
      </th>
    )
  }

  const activa = orden.clave === clave
  return (
    <th
      {...resto}
      {...ayudaProps}
      data-clave={clave}
      data-ayuda={claveAyuda}
      aria-sort={activa ? (orden.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`${al} p-3 ${className}`}
    >
      <button
        type="button"
        onClick={() => orden.alternar(clave)}
        title="Ordenar por esta columna"
        className={`vp-orden inline-flex items-center gap-0.5 ${
          alinear === 'derecha' ? 'flex-row-reverse' : ''
        } ${activa ? 'text-neutral-900' : ''}`}
      >
        <span className={marca}>{children}</span>
        {/* Las dos puntas siempre a la vista: asi se ve que la columna se
            puede ordenar aunque todavia no sea la ordenada. */}
        <svg viewBox="0 0 10 14" width="7" height="10" aria-hidden className="shrink-0">
          <path d="M5 0 9 5H1z" fill="currentColor" opacity={activa && orden.dir === 'asc' ? 1 : 0.28} />
          <path d="M5 14 1 9h8z" fill="currentColor" opacity={activa && orden.dir === 'desc' ? 1 : 0.28} />
        </svg>
      </button>
      {panel}
    </th>
  )
}
