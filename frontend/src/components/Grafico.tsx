import { useState, type PointerEvent, type ReactNode } from 'react'

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
  const piso = min - span * 0.12
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
            aria-label={`Evolucion de ${series.map((s) => s.nombre).join(', ')}`}
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
