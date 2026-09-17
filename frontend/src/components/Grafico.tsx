import type { ReactNode } from 'react'

/**
 * Una serie en el tiempo, dibujada a mano.
 *
 * POR QUE NO UNA LIBRERIA. Vertigo Timon usa recharts para esto y se ve muy
 * bien, pero arrastra ~130 KB a un paquete que ya avisa por tamaño, y en una
 * tablet del mostrador eso se nota al abrir. Una linea con su relleno son
 * cuatro cuentas; lo que cuesta de un grafico no es el trazo, es decidir que
 * se dibuja. Ademas asi los colores salen de la paleta del ERP y el modo
 * oscuro funciona solo, sin configurar un tema aparte para la libreria.
 *
 * COMO ESCALA SIN MEDIR NADA. El `viewBox` es de 0 a 100 en los dos ejes
 * --coordenadas en porcentaje-- y `preserveAspectRatio="none"` lo estira a la
 * caja que le toque. El trazo no se deforma gracias a `vector-effect`, y las
 * etiquetas van en HTML por fuera: dentro del SVG estirado saldrian
 * distorsionadas.
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
  alto = 200,
  pie,
}: {
  etiquetas: string[]
  series: SerieGrafico[]
  formato?: (n: number) => string
  alto?: number
  /** Nota bajo el grafico, a la derecha de la leyenda. */
  pie?: ReactNode
}) {
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

  return (
    <div>
      <div className="flex gap-2" style={{ height: alto }}>
        {/* El eje: solo el techo y el piso. Tres numeros mas no dicen nada que
            la linea no diga, y en una tablet estorban. */}
        <div className="flex flex-col justify-between py-0.5 text-[10px] tabular-nums text-neutral-400 shrink-0">
          <span>{formato(techo)}</span>
          <span>{formato(piso)}</span>
        </div>
        <div className="relative flex-1 min-w-0 rounded-lg border border-neutral-100">
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
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
                      <path key={`${s.nombre}-relleno-${i}`} d={area(t)} fill={s.color} opacity={0.08} stroke="none" />
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
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={s.punteada ? '4 4' : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              )),
            )}
            {/* Una franja invisible por fecha: el navegador muestra el detalle
                al posar encima, sin escribir un tooltip a mano. */}
            {etiquetas.map((e, i) => (
              <rect
                key={e + i}
                x={n === 1 ? 0 : Math.max(0, x(i) - 50 / (n - 1))}
                y="0"
                width={n === 1 ? 100 : 100 / (n - 1)}
                height="100"
                fill="transparent"
              >
                <title>
                  {`${e}\n` +
                    series
                      .map((s) => `${s.nombre}: ${s.valores[i] != null ? formato(s.valores[i] as number) : '—'}`)
                      .join('\n')}
                </title>
              </rect>
            ))}
          </svg>
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
