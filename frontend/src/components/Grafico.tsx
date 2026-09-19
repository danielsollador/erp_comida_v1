import { Fragment, useState, type PointerEvent, type ReactNode } from 'react'

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
        {/* El eje: solo el techo y el piso. Tres numeros mas no dicen nada que
            la linea no diga, y en una tablet estorban. */}
        <div className="flex flex-col justify-between py-0.5 text-[10px] tabular-nums text-neutral-400 shrink-0">
          <span>{formato(techo)}</span>
          <span>{formato(piso)}</span>
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

export type ParteDona = { nombre: string; valor: number; color?: string; detalle?: string }

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
  alto = 150,
}: {
  partes: ParteDona[]
  formato: (n: number) => string
  /** Lo que va en el hueco: el total y que es. */
  centro?: { valor: string; texto: string }
  alto?: number
}) {
  const [activa, setActiva] = useState<number | null>(null)
  const total = partes.reduce((s, p) => s + Math.max(p.valor, 0), 0)
  if (total <= 0 || partes.length === 0) {
    return <p className="text-sm text-neutral-400 py-6 text-center">Sin datos para dibujar.</p>
  }
  // r = 100 / (2π): la circunferencia mide 100 y los arcos van en porcentaje.
  const r = 15.9155
  let acumulado = 0
  const arcos = partes.map((p, i) => {
    const pct = (Math.max(p.valor, 0) / total) * 100
    const arco = { pct, desde: acumulado, color: p.color ?? PALETA_CATEGORICA[i % PALETA_CATEGORICA.length] }
    acumulado += pct
    return arco
  })

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative shrink-0" style={{ width: alto, height: alto }}>
        <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90" role="img" aria-label="Reparto">
          <circle cx="21" cy="21" r={r} fill="none" stroke="var(--color-neutral-100)" strokeWidth="5" />
          {arcos.map((a, i) =>
            a.pct > 0 ? (
              <circle
                key={i}
                cx="21"
                cy="21"
                r={r}
                fill="none"
                stroke={a.color}
                strokeWidth={activa === i ? 6.2 : 5}
                // Un respiro entre arcos: 0.6 de los 100 se deja en blanco,
                // salvo si la parte es tan chica que el respiro se la come.
                strokeDasharray={`${Math.max(a.pct - (a.pct > 1.5 ? 0.6 : 0), 0.001)} ${100 - Math.max(a.pct - (a.pct > 1.5 ? 0.6 : 0), 0.001)}`}
                strokeDashoffset={-a.desde}
                className="transition-all duration-200"
                onPointerEnter={() => setActiva(i)}
                onPointerLeave={() => setActiva(null)}
              />
            ) : null,
          )}
        </svg>
        {centro && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-base font-bold tabular-nums leading-none">
              {activa != null ? `${arcos[activa].pct.toFixed(0)}%` : centro.valor}
            </span>
            <span className="text-[10px] text-neutral-500 mt-1 px-3 leading-tight">
              {activa != null ? partes[activa].nombre : centro.texto}
            </span>
          </div>
        )}
      </div>

      <ul className="flex-1 min-w-[10rem] space-y-1.5 text-sm">
        {partes.map((p, i) => (
          <li
            key={p.nombre}
            className={`flex items-center gap-2 rounded-lg px-1.5 py-0.5 -mx-1.5 transition-colors ${
              activa === i ? 'bg-neutral-100' : ''
            }`}
            onPointerEnter={() => setActiva(i)}
            onPointerLeave={() => setActiva(null)}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: arcos[i].color }} />
            <span className="flex-1 min-w-0 truncate text-neutral-700">
              {p.nombre}
              {p.detalle && <span className="text-xs text-neutral-400"> · {p.detalle}</span>}
            </span>
            <span className="tabular-nums font-medium whitespace-nowrap">{formato(p.valor)}</span>
            <span className="w-10 text-right tabular-nums text-xs text-neutral-400">{arcos[i].pct.toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Barras ──────────────────────────────────────────────────────────────────

export type BarraDato = { etiqueta: string; valor: number; detalle?: string; color?: string }

/**
 * Barras verticales para pocas categorias con orden propio: los siete dias de
 * la semana, las horas de un dia. Para una serie larga en el tiempo esta
 * `GraficoLineas`, que ademas superpone el periodo anterior.
 */
export function GraficoBarras({
  datos,
  formato,
  alto = 170,
  resaltar,
}: {
  datos: BarraDato[]
  formato: (n: number) => string
  alto?: number
  /** Que barra va en cobre (la mayor, la de hoy). Las demas, grafito. */
  resaltar?: (d: BarraDato, i: number) => boolean
}) {
  if (datos.length === 0) {
    return <p className="text-sm text-neutral-400 py-6 text-center">Sin datos para dibujar.</p>
  }
  const max = Math.max(...datos.map((d) => d.valor), 0)
  // Con muchas barras no caben todas las etiquetas: una de cada tantas.
  const salto = Math.ceil(datos.length / 16)
  return (
    <div className="flex items-end gap-1.5 overflow-x-auto overflow-y-hidden" style={{ height: alto }}>
      {datos.map((d, i) => {
        const pct = max > 0 ? (d.valor / max) * 100 : 0
        const fuerte = resaltar ? resaltar(d, i) : false
        return (
          <div
            key={d.etiqueta + i}
            className="group flex-1 min-w-[22px] flex flex-col items-center justify-end h-full gap-1 cursor-default"
            title={`${d.etiqueta}: ${formato(d.valor)}${d.detalle ? ` · ${d.detalle}` : ''}`}
          >
            <span className="text-[10px] text-neutral-500 tabular-nums whitespace-nowrap">
              {d.valor > 0 && datos.length <= 12 ? formato(d.valor) : ''}
            </span>
            <div
              className={`vp-barra w-full rounded-t-md min-h-[2px] transition-colors group-hover:bg-acento-500 ${
                fuerte ? 'bg-acento-500' : 'bg-neutral-900'
              }`}
              style={{
                height: `${pct}%`,
                animationDelay: `${Math.min(i * 18, 400)}ms`,
                background: d.color,
              }}
            />
            <span className="text-[10px] text-neutral-500 whitespace-nowrap h-3">
              {i % salto === 0 ? d.etiqueta : ''}
            </span>
          </div>
        )
      })}
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
  if (filas.length === 0) {
    return <p className="text-sm text-neutral-400 py-6 text-center">Sin datos para dibujar.</p>
  }
  const totales = filas.map((f) => f.partes.reduce((s, p) => s + Math.max(p.valor, 0), 0))
  const max = Math.max(...totales, 0)
  return (
    <div>
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
          <div key={f.nombre} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
            <span className="truncate text-neutral-700" title={f.nombre}>
              {f.nombre}
            </span>
            <div className="flex h-4 rounded-md overflow-hidden bg-neutral-100" style={{ width: max > 0 ? `${(totales[i] / max) * 100}%` : 0 }}>
              {f.partes.map((p) =>
                p.valor > 0 ? (
                  <div
                    key={p.nombre}
                    className="vp-barra-h h-full"
                    style={{ width: `${(p.valor / totales[i]) * 100}%`, background: p.color }}
                    title={`${p.nombre}: ${formato(p.valor)}`}
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
  if (celdas.length === 0) {
    return <p className="text-sm text-neutral-400 py-6 text-center">Sin datos para dibujar.</p>
  }
  const horas = celdas.map((c) => c.hora)
  const desde = Math.min(...horas)
  const hasta = Math.max(...horas)
  const columnas = Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i)
  const valor = (c: CeldaCalor) => (medida === 'pedidos' ? c.pedidos : c.ventas)
  const max = Math.max(...celdas.map(valor), 0)
  const porCelda = new Map(celdas.map((c) => [`${c.dia}-${c.hora}`, c]))
  // Las filas de un dia en que nunca abrio no aportan nada, pero un dia con
  // pocas ventas si: se quitan solo los dias sin una sola celda.
  const dias = [0, 1, 2, 3, 4, 5, 6].filter((d) => celdas.some((c) => c.dia === d))

  return (
    <div className="overflow-x-auto">
      <div
        className="grid gap-[3px] text-[10px]"
        // Las casillas tienen tope: con diez horas y una pantalla ancha, a
        // `1fr` cada una media setenta pixeles y el mapa ocupaba media pagina.
        style={{ gridTemplateColumns: `2.2rem repeat(${columnas.length}, minmax(1.4rem, 2.4rem))` }}
      >
        <span />
        {columnas.map((h) => (
          <span key={h} className="text-center text-neutral-400 tabular-nums">
            {h % 2 === 0 || columnas.length <= 10 ? `${h}` : ''}
          </span>
        ))}
        {dias.map((d) => (
          <Fragment key={d}>
            <span className="text-neutral-500 self-center">{DIAS_CORTOS[d]}</span>
            {columnas.map((h) => {
              const c = porCelda.get(`${d}-${h}`)
              const v = c ? valor(c) : 0
              const intensidad = max > 0 && v > 0 ? 12 + (v / max) * 88 : 0
              return (
                <div
                  key={h}
                  className="aspect-square rounded-[4px] bg-neutral-100"
                  style={
                    intensidad
                      ? { background: `color-mix(in oklab, var(--color-acento-500) ${intensidad.toFixed(0)}%, transparent)` }
                      : undefined
                  }
                  title={
                    c
                      ? `${DIAS_CORTOS[d]} ${h}:00 · ${c.pedidos} pedido(s) · ${formato(c.ventas)}`
                      : `${DIAS_CORTOS[d]} ${h}:00 · nada`
                  }
                />
              )
            })}
          </Fragment>
        ))}
      </div>
      <div className="flex items-center justify-end gap-1.5 mt-2 text-[10px] text-neutral-400">
        menos
        {[15, 35, 60, 85, 100].map((p) => (
          <span
            key={p}
            className="h-2.5 w-2.5 rounded-[3px]"
            style={{ background: `color-mix(in oklab, var(--color-acento-500) ${p}%, transparent)` }}
          />
        ))}
        más
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
