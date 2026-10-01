import { Fragment, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * El globo de informacion que sigue al cursor, compartido por todos los
 * graficos de HTML (barras, barras apiladas, dona, mapa de calor).
 *
 * POR QUE NO EL `title` DEL NAVEGADOR, que es lo que habia. Tarda cerca de un
 * segundo en salir, no se puede leer de un barrido --hay que parar el cursor y
 * esperar en cada casilla--, sale con la tipografia del sistema operativo y en
 * modo oscuro sigue siendo un rectangulo amarillo de Windows. Para un mapa de
 * calor de cien casillas eso no es informacion: es un examen de paciencia
 * (Leider, 24-sep: "todos estos graficos tienen que tener informacion sobre
 * herramienta cuando yo pose el cursor").
 *
 * VA EN UN PORTAL AL `body` a proposito: el mapa de calor vive dentro de un
 * contenedor con `overflow-x: auto` y un globo escrito dentro se recortaria
 * justo en las casillas del borde, que son las que mas cuesta identificar.
 *
 * Y es el MISMO globo del grafico de lineas --misma lamina, mismo radio, misma
 * sombra--, para que pasar de un grafico a otro no se sienta como cambiar de
 * aplicativo.
 */
function useGlobo() {
  const [globo, setGlobo] = useState<{ x: number; y: number; nodo: ReactNode } | null>(null)

  /** Se cuelga de un elemento: `<div {...enHover(<>…</>)} />`. */
  const enHover = (nodo: ReactNode) => ({
    onPointerEnter: (e: PointerEvent) => setGlobo({ x: e.clientX, y: e.clientY, nodo }),
    onPointerMove: (e: PointerEvent) => setGlobo({ x: e.clientX, y: e.clientY, nodo }),
    onPointerLeave: () => setGlobo(null),
  })

  // Se dibuja arriba y a la derecha del cursor, y se voltea contra el borde de
  // la pantalla: en la ultima columna de un mapa ancho, un globo fijo a la
  // derecha se sale de la ventana.
  const Globo = () =>
    globo
      ? createPortal(
          <div
            className="pointer-events-none fixed z-50 rounded-xl border border-neutral-200 bg-white px-3 py-2 shadow-lg text-xs"
            style={{
              left: globo.x + 14,
              top: globo.y - 10,
              transform: `translate(${globo.x > window.innerWidth - 220 ? '-100%' : '0'}, -100%)`,
            }}
          >
            {globo.nodo}
          </div>,
          document.body,
        )
      : null

  return { enHover, Globo }
}

/**
 * Cuanto mide de ancho un elemento, al dia. Para decidir cuantos rotulos
 * caben bajo las barras: en un telefono caben cuatro fechas, en una pantalla
 * ancha caben las treinta y una.
 */
function useAncho<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [ancho, setAncho] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const medir = () => setAncho(el.getBoundingClientRect().width)
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, ancho }
}

/** Una linea del globo: rotulo a la izquierda, cifra a la derecha. */
function LineaGlobo({ nombre, valor, color }: { nombre: string; valor: string; color?: string }) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      {color && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />}
      <span className="text-neutral-500">{nombre}</span>
      <span className="ml-auto pl-3 font-semibold tabular-nums">{valor}</span>
    </div>
  )
}

/**
 * Una serie en el tiempo, dibujada a mano.
 *
 * POR QUE NO UNA LIBRERIA. Vertigo Timon usa recharts y se ve muy bien, pero
 * arrastra ~130 KB a un paquete que ya avisa por tamaño, y en una tablet del
 * mostrador eso se nota al abrir. Para UNA linea con su cruceta, el trazo son
 * cuatro cuentas: lo que cuesta de un grafico no es dibujarlo, es decidir que
 * se dibuja. Ademas asi los colores salen de la paleta del ERP, el globo de
 * detalle se ve como el resto de la interfaz y el modo oscuro funciona solo,
 * sin configurar un tema aparte para la libreria.
 *
 * COMO ESCALA SIN MEDIR NADA. El `viewBox` es de 0 a 100 en los dos ejes
 * --coordenadas en porcentaje-- y `preserveAspectRatio="none"` lo estira a la
 * caja que le toque. El trazo no se deforma gracias a `vector-effect`. Todo lo
 * que lleva texto --el globo, los puntos, las etiquetas-- va en HTML encima,
 * posicionado tambien en porcentaje: dentro del SVG estirado saldria
 * distorsionado, y asi tampoco hay que medir el contenedor.
 */
export type SerieGrafico = {
  nombre: string
  /** Un color de la paleta, como `var(--color-acento-500)`. */
  color: string
  /** Un hueco (null) parte la linea en vez de inventar el tramo. */
  valores: (number | null)[]
  /** Relleno suave bajo la linea. Solo para la principal. */
  relleno?: boolean
  /** Punteada: para lo que es referencia y no la cifra principal. */
  punteada?: boolean
}

export function GraficoLineas({
  etiquetas,
  series,
  formato = (n) => n.toFixed(2),
  formatoDetalle,
  alto = 200,
  pie,
}: {
  etiquetas: string[]
  series: SerieGrafico[]
  /** Para el eje: corto, que compite con la linea por el sitio. */
  formato?: (n: number) => string
  /** Para el globo: ahi si cabe el numero entero, y es donde se mira de cerca. */
  formatoDetalle?: (n: number) => string
  alto?: number
  /** Nota bajo el grafico, a la derecha de la leyenda. */
  pie?: ReactNode
}) {
  // El dia que el cursor esta señalando. null = nadie mirando.
  const [activo, setActivo] = useState<number | null>(null)
  const detalle = formatoDetalle ?? formato

  const todos = series.flatMap((s) => s.valores).filter((v): v is number => v != null)
  if (todos.length === 0 || etiquetas.length === 0) {
    return <p className="text-sm text-neutral-400 py-8 text-center">Sin datos para dibujar.</p>
  }

  const min = Math.min(...todos)
  const max = Math.max(...todos)
  // Un margen arriba y abajo para que la linea no toque los bordes. Si todos
  // los valores son iguales, se inventa un rango para no dividir entre cero.
  const span = max - min || max * 0.02 || 1
  const techo = max + span * 0.12
  // El margen de abajo no cruza el cero si nada es negativo: una serie de
  // ventas con dias en cero mostraba "$-21" en el eje, y no existe vender
  // menos de nada. La tasa, que nunca baja de cientos, no lo nota.
  const pisoCrudo = min - span * 0.12
  const piso = min >= 0 && pisoCrudo < 0 ? 0 : pisoCrudo
  const n = etiquetas.length

  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100)
  const y = (v: number) => ((techo - v) / (techo - piso)) * 100

  /** Los tramos continuos: un hueco parte la linea en vez de inventar el salto. */
  const tramos = (valores: (number | null)[]): { x: number; y: number }[][] => {
    const salida: { x: number; y: number }[][] = []
    let actual: { x: number; y: number }[] = []
    valores.forEach((v, i) => {
      if (v == null) {
        if (actual.length) salida.push(actual)
        actual = []
        return
      }
      actual.push({ x: x(i), y: y(v) })
    })
    if (actual.length) salida.push(actual)
    return salida
  }

  const linea = (puntos: { x: number; y: number }[]) =>
    puntos.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')

  /** La misma linea, cerrada contra el suelo. */
  const area = (puntos: { x: number; y: number }[]) =>
    `${linea(puntos)} L${puntos[puntos.length - 1].x.toFixed(2)},100 L${puntos[0].x.toFixed(2)},100 Z`

  /** Que dia queda bajo el dedo o el cursor. */
  const seguir = (e: PointerEvent<HTMLDivElement>) => {
    const caja = e.currentTarget.getBoundingClientRect()
    if (!caja.width) return
    const fraccion = (e.clientX - caja.left) / caja.width
    setActivo(Math.max(0, Math.min(n - 1, Math.round(fraccion * (n - 1)))))
  }

  // El globo se pega al borde cuando el dia esta en una punta: centrado
  // siempre, se saldria de la tarjeta en el primer y el ultimo dia.
  const anclaGlobo = (i: number) =>
    x(i) < 22 ? 'translateX(0)' : x(i) > 78 ? 'translateX(-100%)' : 'translateX(-50%)'

  return (
    <div>
      <div className="flex gap-2" style={{ height: alto }}>
        {/* El eje, con una cifra en cada linea de referencia: el techo, las
            tres de en medio y el piso. Solo con techo y piso, un pico a media
            altura no se podia leer sin posar el cursor (auditoria de graficos,
            30-sep): un eje sin cifras es un dibujo, no un grafico. */}
        <div className="flex flex-col justify-between py-0.5 text-[10px] tabular-nums text-neutral-400 shrink-0 text-right">
          {[0, 25, 50, 75, 100].map((p) => (
            <span key={p}>{formato(techo - ((techo - piso) * p) / 100)}</span>
          ))}
        </div>

        <div
          className="relative flex-1 min-w-0 rounded-lg border border-neutral-100"
          // `pan-y`: arrastrar a lo ancho recorre los dias, pero deslizar
          // hacia abajo sigue desplazando la pagina. Sin esto, en la tablet el
          // grafico se traga el gesto de bajar.
          style={{ touchAction: 'pan-y' }}
          onPointerMove={seguir}
          onPointerDown={seguir}
          onPointerLeave={() => setActivo(null)}
          onPointerCancel={() => setActivo(null)}
        >
          {/* EL GRAFICO SE DESTAPA DE IZQUIERDA A DERECHA, con un `clip-path`
              sobre TODO el SVG. Antes cada linea se dibujaba sola con
              `stroke-dasharray`, que es el truco habitual, pero aqui no
              funciona: `vector-effect: non-scaling-stroke` hace que el patron
              de guiones se mida en pixeles de pantalla mientras `pathLength`
              lo normaliza contra el largo del trazo, y las dos cosas juntas
              partian la linea en pedazos sueltos en vez de dibujarla. Un solo
              recorte que avanza resuelve el efecto para la linea, el relleno y
              la punteada a la vez, y es una sola propiedad animada. */}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full vp-revelar-izq"
            role="img"
            aria-label={`Evolución de ${series.map((s) => s.nombre).join(', ')}`}
          >
            {/* Tres lineas de referencia, discretas. */}
            {[25, 50, 75].map((p) => (
              <line
                key={p}
                x1="0"
                x2="100"
                y1={p}
                y2={p}
                stroke="var(--color-neutral-100)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {series.map((s) =>
              s.relleno
                ? tramos(s.valores)
                    .filter((t) => t.length > 1)
                    .map((t, i) => (
                      <path
                        key={`${s.nombre}-relleno-${i}`}
                        d={area(t)}
                        fill={s.color}
                        stroke="none"
                        opacity={0.08}
                      />
                    ))
                : null,
            )}

            {series.map((s) =>
              tramos(s.valores).map((t, i) => (
                <path
                  key={`${s.nombre}-${i}`}
                  // Un tramo de un solo punto no dibuja nada con `L`: se le da
                  // largo cero y el `strokeLinecap` redondo lo vuelve un punto.
                  d={t.length > 1 ? linea(t) : `M${t[0].x.toFixed(2)},${t[0].y.toFixed(2)} l0,0`}
                  // En pixeles de pantalla, no en unidades del viewBox: con
                  // `non-scaling-stroke` los guiones se ven iguales sea cual
                  // sea el ancho de la tarjeta.
                  strokeDasharray={s.punteada ? '5 4' : undefined}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2"
                  strokeLinecap={s.punteada ? 'butt' : 'round'}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              )),
            )}

            {/* La cruceta del dia señalado. */}
            {activo != null && (
              <line
                x1={x(activo)}
                x2={x(activo)}
                y1="0"
                y2="100"
                stroke="var(--color-neutral-300)"
                strokeWidth="1"
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>

          {/* Los puntos van en HTML y no en el SVG: dentro del viewBox estirado
              un circulo sale ovalado. */}
          {activo != null &&
            series.map((s) => {
              const v = s.valores[activo]
              if (v == null) return null
              return (
                <span
                  key={`punto-${s.nombre}`}
                  className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
                  style={{ left: `${x(activo)}%`, top: `${y(v)}%`, background: s.color }}
                />
              )
            })}

          {/* El globo: la fecha y las tres tasas de ese dia. */}
          {activo != null && (
            <div
              className="pointer-events-none absolute z-10 rounded-xl border border-neutral-200 bg-white px-3 py-2 shadow-lg"
              style={{ left: `${x(activo)}%`, top: '50%', transform: `${anclaGlobo(activo)} translateY(-50%)` }}
            >
              <div className="mb-1 text-[11px] font-semibold text-neutral-500">{etiquetas[activo]}</div>
              {series.map((s) => (
                <div key={`globo-${s.nombre}`} className="flex items-center gap-2 whitespace-nowrap text-xs">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="text-neutral-500">{s.nombre}</span>
                  <span className="ml-auto pl-2 font-semibold tabular-nums">
                    {s.valores[activo] != null ? detalle(s.valores[activo] as number) : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mt-1.5 pl-[3.2rem]">
        <span className="text-[10px] tabular-nums text-neutral-400">{etiquetas[0]}</span>
        <span className="text-[10px] tabular-nums text-neutral-400">{etiquetas[n - 1]}</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
        {series.map((s) => (
          <span key={s.nombre} className="flex items-center gap-1.5 text-[11px] text-neutral-500">
            <span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} />
            {s.nombre}
          </span>
        ))}
        {pie && <span className="ml-auto text-[11px] text-neutral-400">{pie}</span>}
      </div>
    </div>
  )
}

// ── Lo que comparten los graficos nuevos ────────────────────────────────────

/**
 * Colores para series SIN orden (categorias, metodos de pago). El primero es
 * el cobre del logo y el segundo el grafito, que son los dos que mas
 * contrastan entre si y con el papel; de ahi en adelante se alterna. Salen de
 * la paleta y no de un hexadecimal, asi el modo oscuro los invierte solo.
 */
export const PALETA_CATEGORICA = [
  'var(--color-acento-500)',
  'var(--color-neutral-800)',
  'var(--color-aviso-500)',
  'var(--color-exito-500)',
  'var(--color-acento-300)',
  'var(--color-neutral-400)',
  'var(--color-peligro-400)',
  'var(--color-aviso-300)',
]

/**
 * Cuanto cambio algo contra el periodo anterior, en un chip: ▲ 12% en verde,
 * ▼ 8% en rojo. `invertir` es para lo que esta bien que baje (anulaciones,
 * gastos): ahi bajar es verde.
 */
export function Variacion({
  pct,
  invertir = false,
  texto,
}: {
  pct: number | null | undefined
  invertir?: boolean
  /** "vs ayer", "vs la semana pasada". Va en gris, detras del numero. */
  texto?: string
}) {
  if (pct == null) return null
  const igual = Math.abs(pct) < 0.5
  const bueno = invertir ? pct < 0 : pct > 0
  const color = igual ? 'text-neutral-500' : bueno ? 'text-exito-700' : 'text-peligro-600'
  const flecha = igual ? '=' : pct > 0 ? '▲' : '▼'
  return (
    <span className={`inline-flex items-baseline gap-1 text-[11px] font-semibold tabular-nums ${color}`}>
      {flecha} {igual ? 'igual' : `${Math.abs(pct).toFixed(0)}%`}
      {texto && <span className="font-normal text-neutral-400">{texto}</span>}
    </span>
  )
}

// ── Dona ────────────────────────────────────────────────────────────────────

export type ParteDona = { nombre: string; valor: number; color?: string; detalle?: string; id?: number | null }

/**
 * Un reparto: como te pagaron, que parte es comida y que parte bebida.
 *
 * Es un solo circulo con un `stroke-dasharray` por parte: el radio esta
 * elegido para que la circunferencia mida exactamente 100, asi cada arco se
 * declara en porcentaje sin trigonometria. La leyenda lleva los numeros;
 * el anillo solo da la proporcion, que es lo unico que un anillo sabe dar.
 */
export function GraficoDona({
  partes,
  formato,
  centro,
  pastel = false,
  alTocar,
}: {
  partes: ParteDona[]
  formato: (n: number) => string
  /** El total y que es; va de cabecera. */
  centro?: { valor: string; texto: string }
  alto?: number
  /** Dos o tres partes de un todo (facturado / sin facturar): una sola
      barra al 100 %, repartida. */
  pastel?: boolean
  /** Tocar una parte: para bajar a verla sola (filtrar por esa categoria). */
  alTocar?: (p: ParteDona) => void
}) {
  // YA NO ES UN ANILLO. Con cinco categorias el pastel se leia; con quince
  // era un abanico de astillas del mismo color con una leyenda que no cabia
  // en un telefono (Leider, 30-sep: "si agregas muchas variables se volvera
  // un desastre, tiene que ser barras"). Cada parte es una barra con su
  // nombre entero, su cifra y su porcentaje: crece hacia abajo, no se
  // aprieta, y se ordena de mayor a menor.
  const { enHover, Globo } = useGlobo()
  const total = partes.reduce((s, p) => s + Math.max(p.valor, 0), 0)
  if (total <= 0 || partes.length === 0) {
    return <p className="text-sm text-neutral-400 py-6 text-center">Sin datos para dibujar.</p>
  }
  const filas = partes
    .map((p, i) => ({
      ...p,
      valor: Math.max(p.valor, 0),
      pct: (Math.max(p.valor, 0) / total) * 100,
      color: p.color ?? PALETA_CATEGORICA[i % PALETA_CATEGORICA.length],
    }))
    .sort((a, b) => b.valor - a.valor)
  const max = filas[0].valor
  const globo = (f: (typeof filas)[number]) =>
    enHover(
      <>
        <div className="mb-1 font-semibold text-neutral-500">{f.nombre}</div>
        <LineaGlobo nombre="Vale" valor={formato(f.valor)} color={f.color} />
        <LineaGlobo nombre="Del total" valor={`${f.pct.toFixed(0)}%`} />
        {f.detalle && <div className="mt-0.5 text-[11px] text-neutral-400">{f.detalle}</div>}
      </>,
    )

  if (pastel) {
    return (
      <div>
        <Globo />
        <div className="flex h-5 w-full overflow-hidden rounded-md bg-neutral-100">
          {filas.map((f) => (
            <div key={f.nombre} style={{ width: `${f.pct}%`, background: f.color }} className="h-full" {...globo(f)} />
          ))}
        </div>
        <ul className="mt-3 space-y-1.5 text-sm">
          {filas.map((f) => (
            <li key={f.nombre} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: f.color }} />
              <span className="flex-1 min-w-0 text-neutral-700">
                {f.nombre}
                {f.detalle && <span className="text-xs text-neutral-400"> · {f.detalle}</span>}
              </span>
              <span className="tabular-nums font-medium whitespace-nowrap">{formato(f.valor)}</span>
              <span className="w-10 text-right tabular-nums text-xs text-neutral-400">{f.pct.toFixed(0)}%</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div>
      <Globo />
      {centro && (
        <p className="mb-3 text-sm text-neutral-500">
          <span className="font-semibold text-neutral-800 tabular-nums">{centro.valor}</span> {centro.texto}
        </p>
      )}
      <ul className="space-y-2.5">
        {filas.map((f) => (
          <li
            key={f.nombre}
            className={`grid grid-cols-[minmax(0,7.5rem)_1fr_auto] sm:grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-x-3 text-sm ${
              alTocar && f.id != null ? 'cursor-pointer rounded-lg -mx-1.5 px-1.5 py-0.5 hover:bg-neutral-500/5' : ''
            }`}
            role={alTocar && f.id != null ? 'button' : undefined}
            tabIndex={alTocar && f.id != null ? 0 : undefined}
            title={alTocar && f.id != null ? `Ver solo ${f.nombre}` : undefined}
            onClick={alTocar && f.id != null ? () => alTocar(f) : undefined}
            onKeyDown={alTocar && f.id != null ? (e) => e.key === 'Enter' && alTocar(f) : undefined}
          >
            {/* El nombre entero, en dos renglones si hace falta: en el
                anillo se cortaba en "Bebi…" y habia que adivinar. */}
            <span className="min-w-0">
              <span className="block text-neutral-700 leading-tight line-clamp-2" title={f.nombre}>
                {f.nombre}
              </span>
              {f.detalle && <span className="block text-[11px] text-neutral-400 truncate">{f.detalle}</span>}
            </span>
            <div className="h-4 rounded-md bg-neutral-100 overflow-hidden">
              <div
                className="h-full rounded-md"
                style={{ width: `${max > 0 ? (f.valor / max) * 100 : 0}%`, background: f.color, minWidth: f.valor > 0 ? 3 : 0 }}
                {...globo(f)}
              />
            </div>
            <span className="text-right whitespace-nowrap tabular-nums">
              <span className="font-medium">{formato(f.valor)}</span>
              <span className="ml-2 inline-block w-8 text-xs text-neutral-400">{f.pct.toFixed(0)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Barras ──────────────────────────────────────────────────────────────────

export type BarraDato = {
  etiqueta: string
  valor: number
  detalle?: string
  color?: string
  /** Segunda cifra, bajo la principal: "3 ped." debajo de "$1,20". Existe
      porque el dato de apoyo vivia solo en el globo del cursor, y en la
      tablet del mostrador no hay cursor (Leider, 30-sep). */
  secundario?: string
}

/**
 * Barras verticales para pocos tramos con orden propio: los siete dias de la
 * semana, las horas de un dia, los dias de un mes.
 *
 * TAMBIEN PARA LA SERIE EN EL TIEMPO CORTA. La linea de `GraficoLineas` une
 * puntos, y con un mes de ventas donde se vendio ocho dias la linea sube y
 * baja por los ceros dibujando una sierra que parece volatilidad; en barras
 * cada dia es una barra y un dia sin venta es un hueco, que es lo que paso
 * (auditoria de graficos, 30-sep). La linea queda para series largas, donde
 * de verdad hay una tendencia que seguir.
 *
 * Lo que un grafico de barras tiene que tener para leerse solo: el eje con
 * cifras (`ejeY`), el periodo anterior detras de cada barra para comparar
 * (`anterior`, en gris claro y mas ancho, como una sombra), y una linea de
 * referencia con su rotulo (`referencia`: el promedio, la meta).
 */
export function GraficoBarras({
  datos,
  formato,
  alto = 170,
  resaltar,
  estirar = false,
  anterior,
  nombres,
  referencia,
  ejeY = false,
}: {
  datos: BarraDato[]
  formato: (n: number) => string
  alto?: number
  /** Que barra va en cobre (la mayor, la de hoy). Las demas, grafito. */
  resaltar?: (d: BarraDato, i: number) => boolean
  /** En vez del alto fijo, ocupa el que le deje su contenedor. Con alto fijo
      dos graficos apilados no llegan al pie de la tarjeta de al lado y la
      fila queda descuadrada. */
  estirar?: boolean
  /** El mismo tramo del periodo anterior, detras de cada barra. */
  anterior?: (number | null)[]
  /** Como se llaman las dos series en la leyenda, cuando hay `anterior`. */
  nombres?: { actual: string; anterior: string }
  /** Una linea punteada con su rotulo: el promedio, la meta. */
  referencia?: { valor: number; texto: string }
  /** El eje con cifras y lineas de referencia. Para una serie en el tiempo;
      los siete dias de la semana se leen con la cifra encima y ya. */
  ejeY?: boolean
}) {
  const { enHover, Globo } = useGlobo()
  const { ref: plano, ancho } = useAncho<HTMLDivElement>()
  if (datos.length === 0) {
    return <p className="text-sm text-neutral-400 py-6 text-center">Sin datos para dibujar.</p>
  }
  const conAnterior =
    anterior != null && anterior.length === datos.length && anterior.some((v) => v != null && v > 0)
  const max = Math.max(
    ...datos.map((d) => d.valor),
    ...(conAnterior ? anterior.map((v) => v ?? 0) : []),
    referencia?.valor ?? 0,
    0,
  )
  const pct = (v: number) => (max > 0 ? (Math.max(v, 0) / max) * 100 : 0)
  // Con muchas barras no caben todas las etiquetas: una de cada tantas,
  // segun lo que mida el grafico. La que se muestra puede desbordar su
  // casilla porque las vecinas van vacias. Mientras no se midio, una de
  // cada doce, que es lo que cabe en un telefono con fechas "01/09".
  const letras = Math.max(...datos.map((d) => d.etiqueta.length), 1)
  const anchoRotulo = letras * 7 + 8
  const salto = ancho > 0 ? Math.max(1, Math.ceil((datos.length * anchoRotulo) / ancho)) : Math.ceil(datos.length / 12)
  // Las cifras encima de las barras, solo si caben.
  const conCifras = datos.length <= 12 && (ancho === 0 || ancho / datos.length >= 36)
  const columnas = ejeY ? 'auto minmax(0,1fr)' : 'minmax(0,1fr)'

  return (
    <div className={estirar ? 'flex-1 min-h-[120px] flex flex-col' : ''}>
      <Globo />
      {/* Una rejilla de dos columnas y dos filas (eje | barras / nada |
          rotulos): asi los rotulos del eje X quedan exactamente bajo las
          barras sin medir cuanto ocupa el eje Y. */}
      <div
        className={`grid gap-x-2 ${estirar ? 'flex-1 min-h-0' : ''}`}
        style={{ gridTemplateColumns: columnas, gridTemplateRows: estirar ? 'minmax(0,1fr) auto' : `${alto}px auto` }}
      >
        {ejeY && (
          <div className="flex flex-col justify-between pt-5 pb-px text-[10px] tabular-nums text-neutral-400 text-right">
            {[100, 75, 50, 25, 0].map((p) => (
              <span key={p}>{formato((max * p) / 100)}</span>
            ))}
          </div>
        )}
        <div ref={plano} className="relative min-w-0">
          {/* Veinte pixeles libres arriba, para la cifra de la barra mas alta. */}
          <div className="absolute inset-x-0 bottom-0 top-5">
            {ejeY &&
              [25, 50, 75].map((p) => (
                <div key={p} className="absolute inset-x-0 border-t border-neutral-100" style={{ top: `${p}%` }} />
              ))}
            <div className="absolute inset-x-0 bottom-0 border-t border-neutral-200" />
            {referencia && max > 0 && referencia.valor > 0 && (
              <div
                className="absolute inset-x-0 z-[1] border-t border-dashed border-neutral-400 pointer-events-none"
                style={{ bottom: `${pct(referencia.valor)}%` }}
              />
            )}
            <div className="absolute inset-0 flex items-end gap-1.5">
              {datos.map((d, i) => {
                const fuerte = resaltar ? resaltar(d, i) : false
                const ant = conAnterior ? anterior[i] : null
                return (
                  <div
                    key={d.etiqueta + i}
                    className="group relative flex-1 min-w-0 h-full cursor-default"
                    {...enHover(
                      <>
                        <div className="mb-1 font-semibold text-neutral-500">{d.etiqueta}</div>
                        <LineaGlobo nombre={nombres?.actual ?? 'Total'} valor={formato(d.valor)} />
                        {ant != null && (
                          <LineaGlobo nombre={nombres?.anterior ?? 'Anterior'} valor={formato(ant)} color="var(--color-neutral-300)" />
                        )}
                        {d.detalle && <div className="mt-0.5 text-[11px] text-neutral-400">{d.detalle}</div>}
                      </>,
                    )}
                  >
                    {ant != null && ant > 0 && (
                      <div
                        className="absolute inset-x-0 bottom-0 rounded-t-md bg-neutral-300/50"
                        style={{ height: `${pct(ant)}%` }}
                      />
                    )}
                    {/* EL HOVER NO PINTA DE COBRE. El cobre significa "esta es
                        la barra fuerte"; para el cursor cambia la opacidad,
                        que se ve en los dos temas. */}
                    <div
                      className={`vp-barra absolute bottom-0 rounded-t-md min-h-[2px] transition-opacity group-hover:opacity-70 ${
                        fuerte ? 'bg-acento-500' : 'bg-neutral-900'
                      }`}
                      style={{
                        height: `${pct(d.valor)}%`,
                        left: conAnterior ? '18%' : 0,
                        right: conAnterior ? '18%' : 0,
                        animationDelay: `${Math.min(i * 18, 400)}ms`,
                        background: d.color,
                      }}
                    />
                    {conCifras && d.valor > 0 && (
                      <span
                        className="pointer-events-none absolute inset-x-0 text-center leading-tight whitespace-nowrap"
                        style={{ bottom: `calc(${pct(d.valor)}% + 3px)` }}
                      >
                        <span className="block text-xs text-neutral-600 tabular-nums">{formato(d.valor)}</span>
                        {d.secundario && <span className="block text-[11px] text-neutral-400 tabular-nums">{d.secundario}</span>}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        {ejeY && <span />}
        {/* Los rotulos del eje X: el mismo reparto y la misma separacion que
            las barras, asi cada uno queda bajo la suya. */}
        <div className="flex gap-1.5 mt-1 min-w-0">
          {datos.map((d, i) => (
            <span key={d.etiqueta + i} className="flex-1 min-w-0 text-center text-xs text-neutral-500 whitespace-nowrap overflow-visible h-4">
              {i % salto === 0 ? d.etiqueta : ''}
            </span>
          ))}
        </div>
      </div>
      {/* La leyenda: que es cada cosa. El rotulo de la referencia va aqui y
          no encima de la linea, donde tapaba la ultima barra. */}
      {(conAnterior || (referencia && referencia.valor > 0)) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
          {conAnterior && (
            <>
              <span className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                <span className="h-2.5 w-2.5 rounded-sm bg-neutral-900" />
                {nombres?.actual ?? 'Este período'}
              </span>
              <span className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                <span className="h-2.5 w-2.5 rounded-sm bg-neutral-300/70" />
                {nombres?.anterior ?? 'Período anterior'}
              </span>
            </>
          )}
          {referencia && referencia.valor > 0 && (
            <span className="flex items-center gap-1.5 text-[11px] text-neutral-500">
              <span className="w-4 border-t border-dashed border-neutral-400" />
              {referencia.texto} <span className="tabular-nums">{formato(referencia.valor)}</span>
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export type ParteApilada = { nombre: string; valor: number; color: string }
export type FilaApilada = { nombre: string; partes: ParteApilada[]; detalle?: string }

/**
 * Barras horizontales apiladas: cada fila es un producto y la barra se parte
 * en lo que costo y lo que dejo. Todas las filas comparten la escala --la mas
 * larga llena el ancho--, que es lo que permite comparar de un vistazo.
 */
export function BarrasApiladas({
  filas,
  formato,
  leyenda,
}: {
  filas: FilaApilada[]
  formato: (n: number) => string
  /** Que significa cada color. Se dibuja una vez, arriba. */
  leyenda?: { nombre: string; color: string }[]
}) {
  const { enHover, Globo } = useGlobo()
  if (filas.length === 0) {
    return <p className="text-sm text-neutral-400 py-6 text-center">Sin datos para dibujar.</p>
  }
  const totales = filas.map((f) => f.partes.reduce((s, p) => s + Math.max(p.valor, 0), 0))
  const max = Math.max(...totales, 0)
  return (
    <div>
      <Globo />
      {leyenda && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
          {leyenda.map((l) => (
            <span key={l.nombre} className="flex items-center gap-1.5 text-[11px] text-neutral-500">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />
              {l.nombre}
            </span>
          ))}
        </div>
      )}
      <div className="space-y-2">
        {filas.map((f, i) => (
          <div
            key={f.nombre}
            className="grid grid-cols-[minmax(0,10rem)_1fr_auto] lg:grid-cols-[minmax(0,15rem)_1fr_auto] items-center gap-3 text-sm"
          >
            {/* DOS LINEAS ANTES QUE PUNTOS SUSPENSIVOS. La columna medida
                9 rem y a esa anchura "Pastelito mechada criolla" y "Pastelito
                mechada gourmet" se cortaban las dos en "Pastelito mechada c…":
                dos barras distintas con el mismo nombre en pantalla, que es
                justo lo que un grafico no puede hacer. Ahora la columna es mas
                ancha donde hay sitio y el nombre se acomoda en dos lineas. */}
            <span className="text-neutral-700 leading-tight line-clamp-2" title={f.nombre}>
              {f.nombre}
            </span>
            <div className="flex h-5 rounded-md overflow-hidden bg-neutral-100" style={{ width: max > 0 ? `${(totales[i] / max) * 100}%` : 0 }}>
              {f.partes.map((p) =>
                p.valor > 0 ? (
                  <div
                    key={p.nombre}
                    className="vp-barra-h h-full"
                    style={{ width: `${(p.valor / totales[i]) * 100}%`, background: p.color }}
                    {...enHover(
                      <>
                        <div className="mb-1 font-semibold text-neutral-500">{f.nombre}</div>
                        {f.partes
                          .filter((q) => q.valor > 0)
                          .map((q) => (
                            <LineaGlobo key={q.nombre} nombre={q.nombre} valor={formato(q.valor)} color={q.color} />
                          ))}
                      </>,
                    )}
                  />
                ) : null,
              )}
            </div>
            <span className="tabular-nums font-medium whitespace-nowrap text-right">
              {formato(totales[i])}
              {f.detalle && <span className="text-xs text-neutral-400 font-normal"> {f.detalle}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export type FilaGanancia = {
  nombre: string
  ingreso: number
  /** null = sin receta: no se sabe cuanto costo. */
  costo: number | null
  /** Cuantas se vendieron. */
  unidades?: number
  /** El producto del menu, para filtrar tocando la fila. null en la venta libre. */
  id?: number | null
}

/**
 * Cuanto vende y cuanto deja cada producto, SIN LEYENDA (Leider, 30-sep: "no
 * me gusta esa leyenda, en tlf se ve peor"). Cada fila dice en palabras lo
 * que la barra dibuja: la cifra es verde como la parte verde, roja si se
 * pierde, ambar si falta la receta. No hay que aprender colores. Junto al
 * nombre, cuantas se vendieron.
 *
 * La barra mide lo vendido (o lo que costo, si costo mas); gris es lo que se
 * fue en mercancia, verde lo que quedo, rojo lo que falto para cubrirla, y
 * rayado lo vendido sin receta: se sabe lo que entro, no lo que dejo.
 *
 * Trae todos los productos y muestra los primeros `primeros`, con un boton
 * para ver el resto.
 */
export function BarrasGanancia({
  filas,
  formato,
  primeros = 8,
  alTocar,
}: {
  filas: FilaGanancia[]
  formato: (n: number) => string
  primeros?: number
  /** Tocar una fila: bajar a ver solo ese producto. */
  alTocar?: (f: FilaGanancia) => void
}) {
  const { enHover, Globo } = useGlobo()
  const [todas, setTodas] = useState(false)
  if (filas.length === 0) {
    return <p className="text-sm text-neutral-400 py-6 text-center">Sin datos para dibujar.</p>
  }
  const visibles = todas ? filas : filas.slice(0, primeros)
  // Todas las filas comparten escala: la mas larga llena el ancho.
  const max = Math.max(...filas.map((f) => Math.max(f.ingreso, f.costo ?? 0)), 0.000001)
  const ancho = (v: number) => `${(Math.max(v, 0) / max) * 100}%`

  return (
    <div>
      <Globo />
      <ul className="space-y-3.5">
        {visibles.map((f) => {
          const sinReceta = f.costo == null
          const costo = f.costo ?? 0
          const queda = f.ingreso - costo
          const pct = f.ingreso > 0 ? (queda / f.ingreso) * 100 : 0
          const pierde = !sinReceta && queda < -0.004
          const uds = f.unidades
          const tocable = alTocar != null && f.id != null
          return (
            <li
              key={f.nombre}
              className={tocable ? 'cursor-pointer rounded-lg -mx-1.5 px-1.5 py-1 hover:bg-neutral-500/5' : ''}
              role={tocable ? 'button' : undefined}
              tabIndex={tocable ? 0 : undefined}
              title={tocable ? `Ver solo ${f.nombre}` : undefined}
              onClick={tocable ? () => alTocar(f) : undefined}
              onKeyDown={tocable ? (e) => e.key === 'Enter' && alTocar(f) : undefined}
              {...enHover(
                <>
                  <div className="mb-1 font-semibold text-neutral-500">{f.nombre}</div>
                  {uds != null && <LineaGlobo nombre="Unidades" valor={`${uds}`} />}
                  <LineaGlobo nombre="Vendió" valor={formato(f.ingreso)} />
                  {!sinReceta && <LineaGlobo nombre="Mercancía" valor={formato(costo)} color="var(--color-neutral-400)" />}
                  {!sinReceta && (
                    <LineaGlobo
                      nombre={pierde ? 'Perdió' : 'Le quedó'}
                      valor={formato(Math.abs(queda))}
                      color={pierde ? 'var(--color-peligro-500)' : 'var(--color-exito-500)'}
                    />
                  )}
                </>,
              )}
            >
              {/* En telefono, si el nombre es largo, las cifras bajan a su
                  propio renglon en vez de apretar el nombre. */}
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="min-w-0 text-sm leading-snug">
                  <span className="font-medium text-neutral-800">{f.nombre}</span>
                  {uds != null && (
                    <span className="ml-2 text-neutral-500 whitespace-nowrap">
                      <span className="tabular-nums">{uds}</span> {uds === 1 ? 'vendido' : 'vendidos'}
                    </span>
                  )}
                </span>
                <span className="ml-auto text-right text-sm whitespace-nowrap">
                  <span className="tabular-nums text-neutral-600">{formato(f.ingreso)}</span>
                  <span className="text-neutral-400"> · </span>
                  {sinReceta ? (
                    <span className="text-aviso-700 font-medium">sin receta</span>
                  ) : pierde ? (
                    <span className="text-peligro-600 font-semibold">
                      pierde <span className="tabular-nums">{formato(-queda)}</span>
                    </span>
                  ) : (
                    <span className="text-exito-700 font-semibold">
                      deja <span className="tabular-nums">{formato(queda)}</span>{' '}
                      <span className="font-normal tabular-nums">({pct.toFixed(0)}%)</span>
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-1.5 h-2.5 rounded-full bg-neutral-100 overflow-hidden">
                {sinReceta ? (
                  <div
                    className="vp-barra-h h-full rounded-full"
                    style={{
                      width: ancho(f.ingreso),
                      background:
                        'repeating-linear-gradient(-45deg, var(--color-aviso-300) 0 5px, color-mix(in srgb, var(--color-aviso-300) 45%, transparent) 5px 10px)',
                    }}
                  />
                ) : (
                  <div className="flex h-full rounded-full overflow-hidden" style={{ width: ancho(Math.max(f.ingreso, costo)) }}>
                    <div className="vp-barra-h h-full" style={{ flex: `${Math.min(costo, f.ingreso)} 0 0`, background: 'var(--color-neutral-300)' }} />
                    {queda > 0 && <div className="vp-barra-h h-full" style={{ flex: `${queda} 0 0`, background: 'var(--color-exito-500)' }} />}
                    {pierde && <div className="vp-barra-h h-full" style={{ flex: `${-queda} 0 0`, background: 'var(--color-peligro-400)' }} />}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {filas.length > primeros && (
        <button
          type="button"
          onClick={() => setTodas((v) => !v)}
          className="vp-pulsable mt-3 w-full rounded-xl py-2.5 text-sm font-medium text-neutral-600 bg-neutral-100/70"
        >
          {todas ? 'Ver solo los primeros' : `Ver los ${filas.length} productos`}
        </button>
      )}
    </div>
  )
}

// ── Mapa de calor ───────────────────────────────────────────────────────────

export type CeldaCalor = { dia: number; hora: number; pedidos: number; ventas: number }

const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

/**
 * Cuando entran los clientes: dias de la semana en las filas, horas en las
 * columnas, y el color dice cuantos. Solo las horas en las que alguna vez
 * hubo algo: la madrugada vacia aplastaba la parte que importa.
 *
 * La intensidad es `color-mix` del cobre con transparente: un solo color que
 * se va llenando, en vez de una escala de varios tonos que hay que aprender.
 */
export function MapaCalor({
  celdas,
  medida,
  formato,
}: {
  celdas: CeldaCalor[]
  medida: 'pedidos' | 'ventas'
  formato: (n: number) => string
}) {
  const { enHover, Globo } = useGlobo()
  if (celdas.length === 0) {
    return <p className="text-sm text-neutral-400 py-6 text-center">Sin datos para dibujar.</p>
  }
  const horas = celdas.map((c) => c.hora)
  const desde = Math.min(...horas)
  const hasta = Math.max(...horas)
  const filas = Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i)
  const valor = (c: CeldaCalor) => (medida === 'pedidos' ? c.pedidos : c.ventas)
  const max = Math.max(...celdas.map(valor), 0)
  // SOLO SE MARCA SI HAY UNA SOLA GANADORA. Con pocos dias cargados todas las
  // casillas empatan, y marcar las cinco no dice nada: dice que no hay hora
  // pico todavia, que es distinto. Entonces no se marca ninguna.
  const hayPicoUnico = max > 0 && celdas.filter((c) => valor(c) === max).length === 1
  const porCelda = new Map(celdas.map((c) => [`${c.dia}-${c.hora}`, c]))

  // LOS DIAS SON LAS COLUMNAS Y VAN ABAJO; LAS HORAS, LAS FILAS.
  //
  // Estaba al reves. Asi el mapa queda en los mismos ejes que los dos graficos
  // que tiene al lado --"Que dia vendes mas" y "Pedidos por hora"-- y los tres
  // se leen sin cambiar de marco mental (Leider, 24-sep: "para dar orden").
  //
  // Y son los SIETE dias, aunque alguno este vacio: una columna en blanco los
  // lunes dice "aqui no se abre", que es informacion. Ademas el ancho del mapa
  // deja de cambiar segun los datos que haya.
  const dias = [0, 1, 2, 3, 4, 5, 6]

  return (
    <div>
      <Globo />
      {/* El scroll horizontal envuelve SOLO la cuadricula. Con la leyenda
          dentro, el anillo del cuadradito de "la hora mas fuerte" --que
          sobresale 3 px por su `outline-offset`-- se recortaba contra el canto
          del contenedor y salia a medias (Leider, 24-sep). */}
      <div className="overflow-x-auto">
      <div
        className="grid gap-[2px] text-[10px]"
        // LAS SIETE COLUMNAS SE REPARTEN TODO EL ANCHO (`1fr`). Antes tenian
        // tope de 3,4 rem y el mapa terminaba a media tarjeta, con una franja
        // blanca a la derecha que parecia un error de dibujo (Leider, 24-sep:
        // "tiene que ocupar todo").
        //
        // Casillas anchas y BAJAS: las horas son las filas, y con dieciseis
        // horas de jornada una casilla cuadrada hacia una tarjeta de seiscientos
        // pixeles que dejaba a los dos graficos de al lado flotando en el aire.
        style={{ gridTemplateColumns: `2.2rem repeat(7, minmax(2rem, 1fr))` }}
      >
        {filas.map((h) => (
          <Fragment key={h}>
            <span className="text-neutral-400 tabular-nums self-center text-right pr-1">{h}</span>
            {dias.map((d) => {
              const c = porCelda.get(`${d}-${h}`)
              const v = c ? valor(c) : 0
              const intensidad = max > 0 && v > 0 ? 12 + (v / max) * 88 : 0
              // La casilla mas alta, marcada: el mapa pregunta "cuando entran
              // los clientes" y la respuesta es UNA casilla; sin señalarla hay
              // que comparar cincuenta tonos de cobre a ojo.
              const esPico = hayPicoUnico && v === max
              return (
                <div
                  key={d}
                  className={`h-[22px] rounded-[4px] bg-neutral-100 ${
                    esPico ? 'outline outline-2 outline-offset-1 outline-acento-600' : ''
                  }`}
                  style={
                    intensidad
                      ? { background: `color-mix(in oklab, var(--color-acento-500) ${intensidad.toFixed(0)}%, transparent)` }
                      : undefined
                  }
                  {...enHover(
                    <>
                      <div className="mb-1 font-semibold text-neutral-500">
                        {DIAS_CORTOS[d]} · {h}:00
                      </div>
                      {c ? (
                        <>
                          <LineaGlobo nombre="Pedidos" valor={String(c.pedidos)} />
                          <LineaGlobo nombre="Vendido" valor={formato(c.ventas)} />
                        </>
                      ) : (
                        <div className="text-neutral-400">Sin movimiento</div>
                      )}
                    </>,
                  )}
                />
              )
            })}
          </Fragment>
        ))}
        {/* Los nombres de los dias, ABAJO: es donde se leen en los otros dos
            graficos de este bloque. */}
        <span />
        {dias.map((d) => (
          <span key={d} className="text-center text-neutral-500 pt-0.5">
            {DIAS_CORTOS[d]}
          </span>
        ))}
      </div>
      </div>
      <div className="flex items-center justify-end gap-2 mt-2 px-1 text-[10px] text-neutral-400">
        {hayPicoUnico && (
          <span className="mr-auto flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] outline outline-2 outline-offset-1 outline-acento-600 bg-acento-500" />
            la hora más fuerte
          </span>
        )}
        {/* La escala con sus dos extremos en cifras: "menos / mas" sin numero
            no dice cuanto es el mas oscuro (auditoria de graficos, 30-sep). */}
        <span>menos</span>
        {[15, 35, 60, 85, 100].map((p) => (
          <span
            key={p}
            className="h-2.5 w-2.5 rounded-[3px]"
            style={{ background: `color-mix(in oklab, var(--color-acento-500) ${p}%, transparent)` }}
          />
        ))}
        <span>
          más{' '}
          <span className="tabular-nums text-neutral-500">
            · {medida === 'pedidos' ? `${max} ${max === 1 ? 'pedido' : 'pedidos'}` : formato(max)}
          </span>
        </span>
      </div>
    </div>
  )
}


// ── Sparkline ───────────────────────────────────────────────────────────────

/**
 * Una linea chiquita sin ejes ni globo, para poner debajo de una cifra: la
 * tasa de los ultimos 30 dias bajo la tasa de hoy. Dice "va subiendo" o "va
 * quieta" de un vistazo; para leer un dia concreto esta el analisis.
 */
export function Sparkline({
  valores,
  color = 'var(--color-acento-500)',
  alto = 36,
}: {
  valores: (number | null)[]
  color?: string
  alto?: number
}) {
  const puntos = valores.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null)
  if (puntos.length < 2) return null
  const min = Math.min(...puntos.map((p) => p[1]))
  const max = Math.max(...puntos.map((p) => p[1]))
  const span = max - min || max * 0.02 || 1
  const n = valores.length
  const x = (i: number) => (i / (n - 1)) * 100
  const y = (v: number) => 92 - ((v - min) / span) * 84
  const d = puntos.map(([i, v], k) => `${k === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const ultimo = puntos[puntos.length - 1]
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full" style={{ height: alto }} aria-hidden>
      <path
        d={`${d} L${x(ultimo[0]).toFixed(2)},100 L${x(puntos[0][0]).toFixed(2)},100 Z`}
        fill={color}
        opacity={0.1}
        stroke="none"
      />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}


// ── Cascada ─────────────────────────────────────────────────────────────────

export type PasoCascada = {
  nombre: string
  /** Lo que suma o resta. En un `total` o un `resultado`, se ignora el signo. */
  valor: number
  /** `total`: la barra arranca de cero (las ventas). `resultado`: lo que queda
      al final, tambien desde cero. Sin tipo: un paso que suma o resta. */
  tipo?: 'total' | 'resultado'
  color?: string
}

/**
 * De donde sale la ganancia, como cascada: las ventas enteras a la
 * izquierda, cada cosa que se lleva una parte baja un escalon, y lo que
 * queda es la ultima barra, desde cero. Es EL grafico de un estado de
 * resultados en cualquier tablero (Power BI lo trae de serie), y lo que
 * tenia antes el Resumen era un vaso dibujado a mano que habia que
 * aprender a leer (auditoria de graficos, 30-sep).
 *
 * Si los costos se pasan de las ventas, el resultado cae por debajo de
 * cero: la linea del cero queda a la vista y la ultima barra cuelga en
 * rojo, que es exactamente la noticia.
 */
export function GraficoCascada({
  pasos,
  formato,
  alto = 220,
}: {
  pasos: PasoCascada[]
  formato: (n: number) => string
  alto?: number
}) {
  const { enHover, Globo } = useGlobo()
  if (pasos.length === 0) {
    return <p className="text-sm text-neutral-400 py-6 text-center">Sin datos para dibujar.</p>
  }
  // Cada paso va de `desde` a `hasta`; el acumulado es donde queda la cascada.
  let acumulado = 0
  const tramos = pasos.map((p) => {
    if (p.tipo === 'total') {
      acumulado = p.valor
      return { ...p, desde: 0, hasta: p.valor }
    }
    if (p.tipo === 'resultado') {
      return { ...p, desde: 0, hasta: acumulado }
    }
    const desde = acumulado
    acumulado += p.valor
    return { ...p, desde, hasta: acumulado }
  })
  const niveles = tramos.flatMap((t) => [t.desde, t.hasta])
  const techo = Math.max(...niveles, 0)
  const piso = Math.min(...niveles, 0)
  const rango = techo - piso || 1
  const y = (v: number) => ((v - piso) / rango) * 100
  const colorDe = (t: (typeof tramos)[number]) => {
    if (t.color) return t.color
    if (t.tipo === 'total') return 'var(--color-neutral-900)'
    if (t.tipo === 'resultado') return t.hasta >= 0 ? 'var(--color-exito-500)' : 'var(--color-peligro-500)'
    return t.valor >= 0 ? 'var(--color-exito-500)' : 'var(--color-neutral-400)'
  }

  return (
    <div>
      <Globo />
      <div className="relative" style={{ height: alto }}>
        {/* La linea del cero, y una referencia tenue a mitad de camino. */}
        <div className="absolute inset-x-0 border-t border-neutral-200" style={{ bottom: `${y(0)}%` }} />
        <div className="absolute inset-0 flex items-stretch gap-2">
          {tramos.map((t, i) => {
            const alto_ = Math.abs(y(t.hasta) - y(t.desde))
            const base = Math.min(y(t.desde), y(t.hasta))
            const cifra = t.tipo ? t.hasta : t.valor
            return (
              <div
                key={t.nombre + i}
                className="group relative flex-1 min-w-0"
                {...enHover(
                  <>
                    <div className="mb-1 font-semibold text-neutral-500">{t.nombre}</div>
                    <LineaGlobo nombre={t.tipo ? 'Queda' : t.valor >= 0 ? 'Suma' : 'Se lleva'} valor={formato(Math.abs(cifra))} color={colorDe(t)} />
                    {!t.tipo && <LineaGlobo nombre="Acumulado" valor={formato(t.hasta)} />}
                  </>,
                )}
              >
                <div
                  className="vp-barra absolute left-[8%] right-[8%] rounded-md min-h-[2px] transition-opacity group-hover:opacity-70"
                  style={{ bottom: `${base}%`, height: `${alto_}%`, background: colorDe(t), animationDelay: `${i * 90}ms` }}
                />
                {/* El escalon hasta la barra siguiente, punteado. */}
                {i < tramos.length - 1 && (
                  <div
                    className="absolute left-[92%] w-[16%] border-t border-dashed border-neutral-300 pointer-events-none"
                    style={{ bottom: `${y(t.hasta)}%` }}
                  />
                )}
                <span
                  className={`pointer-events-none absolute inset-x-0 text-center text-xs tabular-nums font-medium whitespace-nowrap ${
                    t.tipo === 'resultado' ? (t.hasta >= 0 ? 'text-exito-700' : 'text-peligro-600') : 'text-neutral-700'
                  }`}
                  style={{ bottom: `calc(${base + alto_}% + 3px)` }}
                >
                  {t.tipo ? (cifra < 0 ? '−' : '') : t.valor >= 0 ? '+' : '−'}
                  {formato(Math.abs(cifra))}
                </span>
              </div>
            )
          })}
        </div>
      </div>
      <div className="flex gap-2 mt-1.5">
        {tramos.map((t, i) => (
          <span key={t.nombre + i} className="flex-1 min-w-0 text-center text-[11px] leading-tight text-neutral-500">
            {t.nombre}
          </span>
        ))}
      </div>
    </div>
  )
}
