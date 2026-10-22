import { useId, useRef, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import Svg, { Circle, Defs, G, Line, Path, Pattern, Rect } from 'react-native-svg'
import { LETRA, useTema } from '../../lib/tema'
import { colorSerie, conAlfa, usePaletaDatos } from './paleta'

/*
 * LOS GRAFICOS DE REPORTES Y DE TASA, los mismos de la web
 * (frontend/src/components/Grafico.tsx) dibujados con react-native-svg.
 *
 * LO QUE CAMBIA EN EL TELEFONO: no hay cursor. En la web el detalle de una
 * barra sale en un globo al posar el raton; aqui se TOCA la barra (o se
 * arrastra el dedo sobre una linea) y el detalle aparece en una franja fija
 * encima del grafico. Fija y no flotando: un globo encima de las barras tapa
 * justo lo que se esta mirando y se sale de la losa en las puntas (regla de
 * Leider: nada se monta encima de otra cosa).
 *
 * Las cifras van en texto de React Native encima del dibujo, no dentro del
 * SVG: asi usan JetBrains Mono como todas las cifras de la app.
 */

// Veinte pixeles libres arriba de la barra mas alta, para su cifra.
const ARRIBA = 20

function useAncho(): [number, (e: LayoutChangeEvent) => void] {
  const [ancho, setAncho] = useState(0)
  const medir = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width)
    setAncho((a) => (a === w ? a : w))
  }
  return [ancho, medir]
}

/** Lo que mide de ancho una etiqueta de cifras (JetBrains Mono de 11 px). */
const anchoTexto = (textos: string[]) => Math.max(...textos.map((s) => s.length), 1) * 6.8 + 4

const limitar = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

/** Una barra con las esquinas de arriba redondas, como `rounded-t-md`. */
function barra(x: number, y: number, w: number, h: number, radio = 4): string {
  const r = Math.max(0, Math.min(radio, w / 2, h))
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`
}

/** Las marcas del eje: de 0 a un tope redondo (paso 1, 2, 2,5 o 5 por potencia de diez). */
function marcasRedondas(max: number): number[] {
  if (!(max > 0)) return [0]
  const paso = pasoRedondo(max / 4)
  const n = Math.ceil(max / paso - 1e-9)
  return Array.from({ length: n + 1 }, (_, i) => +(i * paso).toPrecision(12))
}

function pasoRedondo(crudo: number): number {
  const potencia = 10 ** Math.floor(Math.log10(crudo))
  return [1, 2, 2.5, 5, 10].map((f) => +(f * potencia).toPrecision(12)).find((p) => p >= crudo) ?? 10 * potencia
}

function SinDibujo() {
  const t = useTema()
  return <Text style={[g.sinDibujo, { color: t.tenue }]}>Sin datos para dibujar.</Text>
}

// ── La franja del detalle ───────────────────────────────────────────────────

export type LineaDetalle = { nombre: string; valor: string; color?: string }

/**
 * El detalle de lo que se toco: el tramo, sus cifras con el color de su
 * serie y una nota. Sin nada tocado, una pista corta de que se puede tocar.
 * Tiene alto minimo para que el grafico no salte al tocar.
 */
export function Detalle({
  titulo,
  lineas = [],
  nota,
  pista,
}: {
  titulo?: string
  lineas?: LineaDetalle[]
  nota?: string
  pista: string
}) {
  const t = useTema()
  return (
    <View style={[g.detalle, { backgroundColor: t.gris100 }]}>
      {titulo ? (
        <>
          <Text style={[g.detalleTitulo, { color: t.suave }]} numberOfLines={1}>
            {titulo}
          </Text>
          <View style={g.detalleLineas}>
            {lineas.map((l) => (
              <View key={l.nombre} style={g.detalleLinea}>
                {l.color ? <View style={[g.punto, { backgroundColor: l.color }]} /> : null}
                <Text style={[g.detalleNombre, { color: t.suave }]}>{l.nombre}</Text>
                <Text style={[g.detalleValor, { color: t.tinta }]}>{l.valor}</Text>
              </View>
            ))}
          </View>
          {nota ? <Text style={[g.detalleNota, { color: t.tenue }]}>{nota}</Text> : null}
        </>
      ) : (
        <Text style={[g.pista, { color: t.tenue }]}>{pista}</Text>
      )}
    </View>
  )
}

// ── Variacion ───────────────────────────────────────────────────────────────

/**
 * Cuanto cambio algo contra el periodo anterior: ▲ 12% en verde, ▼ 8% en
 * rojo. `invertir` es para lo que esta bien que baje (la merma, el dolar).
 */
export function Variacion({ pct, invertir = false, texto }: { pct: number | null | undefined; invertir?: boolean; texto?: string }) {
  const t = useTema()
  if (pct == null) return null
  const igual = Math.abs(pct) < 0.5
  const bueno = invertir ? pct < 0 : pct > 0
  const color = igual ? t.suave : bueno ? t.exito : t.peligro
  const flecha = igual ? '=' : pct > 0 ? '▲' : '▼'
  return (
    <Text style={[g.variacion, { color }]}>
      {flecha} {igual ? 'igual' : `${Math.abs(pct).toFixed(0)}%`}
      {texto ? <Text style={[g.variacionTexto, { color: t.tenue }]}> {texto}</Text> : null}
    </Text>
  )
}

// ── Barras ──────────────────────────────────────────────────────────────────

export type BarraDato = { etiqueta: string; valor: number; detalle?: string; color?: string }
/** Una medida que va ENCIMA de las barras, como linea, contra el eje derecho. */
export type LineaSobreBarras = { nombre: string; valores: (number | null)[]; color?: string }

/**
 * Barras verticales para pocos tramos con orden propio: los dias de la
 * semana, las horas, los dias de un mes. Con el eje en cifras redondas
 * (`ejeY`), el periodo anterior detras de cada barra (`anterior`, en gris),
 * una linea de referencia (`referencia`: el promedio) y otra medida encima
 * como linea contra el eje derecho (`lineas`: las unidades en barras y la
 * plata en linea, Leider 30-sep).
 */
export function GraficoBarras({
  datos,
  formato,
  formatoEje,
  alto = 170,
  resaltar,
  anterior,
  nombres,
  referencia,
  ejeY = false,
  lineas,
  formatoDerecha,
  pie,
}: {
  datos: BarraDato[]
  formato: (n: number) => string
  /** El eje redondo ("$150") y la barra exacta ("$114,50"). */
  formatoEje?: (n: number) => string
  alto?: number
  /** Que barra va en cobre oscuro (la mayor, la de hoy). */
  resaltar?: (d: BarraDato, i: number) => boolean
  anterior?: (number | null)[]
  nombres?: { actual: string; anterior: string }
  referencia?: { valor: number; texto: string }
  ejeY?: boolean
  lineas?: LineaSobreBarras[]
  formatoDerecha?: (n: number) => string
  /** Una nota bajo el grafico, a la derecha ("mejor tramo: …"). */
  pie?: ReactNode
}) {
  const t = useTema()
  const p = usePaletaDatos()
  const [ancho, medir] = useAncho()
  const [activo, setActivo] = useState<number | null>(null)
  if (datos.length === 0) return <SinDibujo />

  const n = datos.length
  const sel = activo != null && activo < n ? activo : null
  const conAnterior = anterior != null && anterior.length === n && anterior.some((v) => v != null && v > 0)
  const lineasValidas = (lineas ?? []).filter((l) => l.valores.length === n)
  const conLineas = lineasValidas.length > 0
  const maxDerCrudo = Math.max(...lineasValidas.flatMap((l) => l.valores.map((v) => v ?? 0)), 0)
  const fDer = formatoDerecha ?? formato
  const colorLinea = (l: LineaSobreBarras, k: number) => l.color ?? colorSerie(p, k + 1)
  const max = Math.max(...datos.map((d) => d.valor), ...(conAnterior ? anterior.map((v) => v ?? 0) : []), referencia?.valor ?? 0, 0)
  // CON EJE, EL TOPE ES UNA CIFRA REDONDA: marcas de $50 en $50, no $85,88.
  const marcas = ejeY ? marcasRedondas(max) : []
  const tope = ejeY && marcas.length ? marcas[marcas.length - 1] : max
  const fEje = formatoEje ?? formato
  // El eje derecho comparte las lineas de la rejilla con el izquierdo.
  const tramos = marcas.length > 1 ? marcas.length - 1 : 4
  const maxDer = maxDerCrudo > 0 ? pasoRedondo(maxDerCrudo / tramos) * tramos : 1

  // Con muchas barras se aprieta la separacion: un mes por dias son 31
  // barras en 300 px, y con 6 px entre ellas no quedaria barra.
  const sep = n > 20 ? 2 : n > 12 ? 4 : 6
  const anchoBarra = ancho > 0 ? Math.max((ancho - sep * (n - 1)) / n, 1) : 0
  const cx = (i: number) => i * (anchoBarra + sep) + anchoBarra / 2
  const util = alto - ARRIBA
  const yDe = (v: number) => ARRIBA + util * (1 - (tope > 0 ? Math.max(v, 0) / tope : 0))
  const yDer = (v: number) => ARRIBA + util * (1 - Math.max(v, 0) / maxDer)

  const ejeIzq = ejeY ? marcas.map((m) => ({ y: yDe(m), texto: fEje(m) })) : []
  const ejeDer = conLineas
    ? Array.from({ length: tramos + 1 }, (_, i) => {
        const v = (maxDer * i) / tramos
        return { y: yDer(v), texto: fDer(v) }
      })
    : []
  const anchoIzq = anchoTexto(ejeIzq.map((e) => e.texto))
  const anchoDer = anchoTexto(ejeDer.map((e) => e.texto))

  // Los rotulos de abajo: uno de cada tantos, segun lo que quepa.
  const letras = Math.max(...datos.map((d) => d.etiqueta.length), 1)
  const anchoRotulo = letras * 6.6 + 8
  const salto = ancho > 0 ? Math.max(1, Math.ceil((n * anchoRotulo) / ancho)) : Math.ceil(n / 12)
  // Las cifras encima de las barras, solo si caben y no hay linea encima.
  const conCifras = n <= 12 && anchoBarra >= 30 && !conLineas

  const trazo = (l: LineaSobreBarras) => {
    let d = ''
    let nuevo = true
    l.valores.forEach((v, i) => {
      if (v == null) {
        nuevo = true
        return
      }
      d += `${nuevo ? 'M' : 'L'}${cx(i).toFixed(1)},${yDer(v).toFixed(1)} `
      nuevo = false
    })
    return d.trim()
  }

  const tocar = (x: number) => {
    if (anchoBarra <= 0) return
    const i = limitar(Math.floor(x / (anchoBarra + sep)), 0, n - 1)
    setActivo((a) => (a === i ? null : i))
  }

  const d = sel != null ? datos[sel] : null
  const ant = sel != null && conAnterior ? anterior[sel] : null

  return (
    <View>
      <Detalle
        pista="Toca una barra para ver su detalle."
        titulo={d?.etiqueta}
        nota={d?.detalle}
        lineas={
          d && sel != null
            ? [
                { nombre: nombres?.actual ?? 'Total', valor: formato(d.valor), color: d.color ?? p.serie[0] },
                ...(ant != null ? [{ nombre: nombres?.anterior ?? 'Anterior', valor: formato(ant), color: p.anterior }] : []),
                ...lineasValidas.flatMap((l, k) =>
                  l.valores[sel] != null ? [{ nombre: l.nombre, valor: fDer(l.valores[sel] as number), color: colorLinea(l, k) }] : [],
                ),
              ]
            : []
        }
      />
      <View style={g.fila}>
        {ejeY ? (
          <View style={{ width: anchoIzq, height: alto }}>
            {ejeIzq.map((e) => (
              <Text key={e.texto + e.y} style={[g.eje, { top: limitar(e.y - 7, 0, alto - 14), right: 0, color: t.tenue }]} numberOfLines={1}>
                {e.texto}
              </Text>
            ))}
          </View>
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ height: alto }} onLayout={medir}>
            {ancho > 0 ? (
              <Svg width={ancho} height={alto} pointerEvents="none">
                {ejeY &&
                  marcas.slice(1, -1).map((m) => <Line key={m} x1={0} x2={ancho} y1={yDe(m)} y2={yDe(m)} stroke={t.gris100} strokeWidth={1} />)}
                <Line x1={0} x2={ancho} y1={alto - 0.5} y2={alto - 0.5} stroke={t.gris200} strokeWidth={1} />
                {datos.map((dato, i) => {
                  const x = i * (anchoBarra + sep)
                  const a = conAnterior ? anterior[i] : null
                  const fuerte = resaltar ? resaltar(dato, i) : false
                  const y = yDe(dato.valor)
                  const h = Math.max(alto - y, 2)
                  const borde = conAnterior ? anchoBarra * 0.18 : 0
                  const apagada = sel != null && sel !== i
                  return (
                    <G key={dato.etiqueta + i}>
                      {a != null && a > 0 ? (
                        <Path d={barra(x, yDe(a), anchoBarra, alto - yDe(a))} fill={p.anterior} opacity={apagada ? 0.25 : 0.55} />
                      ) : null}
                      <Path
                        d={barra(x + borde, alto - h, anchoBarra - borde * 2, h)}
                        fill={dato.color ?? (fuerte ? p.fuerte : p.serie[0])}
                        opacity={apagada ? 0.4 : 1}
                      />
                    </G>
                  )
                })}
                {referencia && max > 0 && referencia.valor > 0 ? (
                  <Line
                    x1={0}
                    x2={ancho}
                    y1={yDe(referencia.valor)}
                    y2={yDe(referencia.valor)}
                    stroke={p.referencia}
                    strokeWidth={1.2}
                    strokeDasharray="4 4"
                  />
                ) : null}
                {lineasValidas.map((l, k) => (
                  <Path key={l.nombre} d={trazo(l)} fill="none" stroke={colorLinea(l, k)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                ))}
                {lineasValidas.map((l, k) =>
                  l.valores.map((v, i) =>
                    v == null ? null : (
                      <Circle
                        key={`${l.nombre}-${i}`}
                        cx={cx(i)}
                        cy={yDer(v)}
                        r={sel === i ? 5.5 : n > 20 ? 2.5 : 3.5}
                        fill={colorLinea(l, k)}
                        stroke={t.superficie}
                        strokeWidth={sel === i ? 2.5 : 1.5}
                      />
                    ),
                  ),
                )}
              </Svg>
            ) : null}
            {conCifras &&
              datos.map((dato, i) =>
                dato.valor > 0 ? (
                  <Text
                    key={`c${i}`}
                    pointerEvents="none"
                    numberOfLines={1}
                    style={[g.cifraBarra, { left: cx(i) - 40, top: yDe(dato.valor) - 17, color: t.suave }]}
                  >
                    {formato(dato.valor)}
                  </Text>
                ) : null,
              )}
            {/* Un toque elige la barra. Si el dedo baja la pantalla, el
                desplazamiento se lleva el gesto (se le cede el turno). */}
            <View
              style={StyleSheet.absoluteFill}
              accessibilityLabel="Gráfico de barras: toca una barra para ver su detalle"
              onStartShouldSetResponder={() => true}
              onResponderTerminationRequest={() => true}
              onResponderRelease={(e) => tocar(e.nativeEvent.locationX)}
            />
          </View>
          <View style={g.rotulos}>
            {ancho > 0 &&
              datos.map((dato, i) =>
                i % salto === 0 ? (
                  <Text
                    key={`r${i}`}
                    numberOfLines={1}
                    style={[
                      g.rotulo,
                      { width: anchoRotulo, left: limitar(cx(i) - anchoRotulo / 2, 0, Math.max(ancho - anchoRotulo, 0)), color: sel === i ? t.tinta : t.suave },
                    ]}
                  >
                    {dato.etiqueta}
                  </Text>
                ) : null,
              )}
          </View>
        </View>
        {conLineas ? (
          <View style={{ width: anchoDer, height: alto }}>
            {ejeDer.map((e) => (
              <Text key={e.texto + e.y} style={[g.eje, { top: limitar(e.y - 7, 0, alto - 14), left: 0, color: t.tenue }]} numberOfLines={1}>
                {e.texto}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
      {(conAnterior || conLineas || (referencia && referencia.valor > 0) || pie) && (
        <View style={g.leyenda}>
          {conAnterior ? (
            <>
              <Muestra color={p.serie[0]} texto={nombres?.actual ?? 'Este período'} />
              <Muestra color={p.anterior} texto={nombres?.anterior ?? 'Período anterior'} />
            </>
          ) : null}
          {lineasValidas.map((l, k) => (
            <Muestra key={l.nombre} color={colorLinea(l, k)} texto={l.nombre} linea />
          ))}
          {referencia && referencia.valor > 0 ? (
            <Muestra color={p.referencia} texto={`${referencia.texto} ${formato(referencia.valor)}`} punteada />
          ) : null}
          {pie ? <Text style={[g.pie, { color: t.tenue }]}>{pie}</Text> : null}
        </View>
      )}
    </View>
  )
}

/** Un cuadrito, una raya o una raya punteada con su nombre: la leyenda. */
function Muestra({ color, texto, linea = false, punteada = false }: { color: string; texto: string; linea?: boolean; punteada?: boolean }) {
  const t = useTema()
  return (
    <View style={g.muestra}>
      {punteada ? (
        <Svg width={16} height={4}>
          <Line x1={0} x2={16} y1={2} y2={2} stroke={color} strokeWidth={1.5} strokeDasharray="3 3" />
        </Svg>
      ) : linea ? (
        <View style={{ width: 16, height: 2.5, borderRadius: 2, backgroundColor: color }} />
      ) : (
        <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
      )}
      <Text style={[g.muestraTexto, { color: t.suave }]}>{texto}</Text>
    </View>
  )
}

// ── Lineas ──────────────────────────────────────────────────────────────────

export type SerieGrafico = {
  nombre: string
  color: string
  /** Un hueco (null) parte la linea en vez de inventar el tramo. */
  valores: (number | null)[]
  /** Relleno suave bajo la linea. Solo para la principal. */
  relleno?: boolean
  /** Punteada: para lo que es referencia y no la cifra principal. */
  punteada?: boolean
  /** `der`: contra el eje derecho, con su propia escala. */
  eje?: 'izq' | 'der'
}

/**
 * Una serie larga en el tiempo (90 dias por dias, la tasa del mes): la linea
 * es lo que dibuja una tendencia. Se arrastra el dedo a lo ancho para ver un
 * dia concreto, como el cursor de la web.
 */
export function GraficoLineas({
  etiquetas,
  series,
  formato = (n) => n.toFixed(2),
  formatoDetalle,
  formatoDerecha,
  alto = 200,
  pie,
}: {
  etiquetas: string[]
  series: SerieGrafico[]
  formato?: (n: number) => string
  formatoDetalle?: (n: number) => string
  formatoDerecha?: (n: number) => string
  alto?: number
  pie?: ReactNode
}) {
  const t = useTema()
  const p = usePaletaDatos()
  const [ancho, medir] = useAncho()
  const [activo, setActivo] = useState<number | null>(null)
  const antes = useRef<number | null>(null)
  const movio = useRef(false)
  const detalle = formatoDetalle ?? formato

  const todos = series.flatMap((s) => s.valores).filter((v): v is number => v != null)
  if (todos.length === 0 || etiquetas.length === 0) return <SinDibujo />

  // DOS ESCALAS, cada una con aire arriba y abajo; el piso no cruza el cero
  // si nada es negativo (no existe vender menos de nada).
  const escalaDe = (vals: number[]) => {
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const span = max - min || max * 0.02 || 1
    const techo = max + span * 0.12
    const pisoCrudo = min - span * 0.12
    const piso = min >= 0 && pisoCrudo < 0 ? 0 : pisoCrudo
    return { techo, piso }
  }
  const valoresDe = (lado: 'izq' | 'der') =>
    series
      .filter((s) => (s.eje ?? 'izq') === lado)
      .flatMap((s) => s.valores)
      .filter((v): v is number => v != null)
  const conDerecha = series.some((s) => s.eje === 'der')
  const izq = escalaDe(valoresDe('izq').length ? valoresDe('izq') : todos)
  const der = conDerecha ? escalaDe(valoresDe('der')) : izq
  const n = etiquetas.length
  const sel = activo != null && activo < n ? activo : null

  const x = (i: number) => (n === 1 ? ancho / 2 : (i / (n - 1)) * ancho)
  const y = (v: number, s?: SerieGrafico) => {
    const e = s?.eje === 'der' ? der : izq
    return ((e.techo - v) / (e.techo - e.piso)) * alto
  }
  const detalleDe = (s: SerieGrafico) => (s.eje === 'der' ? (formatoDerecha ?? detalle) : detalle)

  const tramos = (s: SerieGrafico) => {
    const salida: { x: number; y: number }[][] = []
    let actual: { x: number; y: number }[] = []
    s.valores.forEach((v, i) => {
      if (v == null) {
        if (actual.length) salida.push(actual)
        actual = []
        return
      }
      actual.push({ x: x(i), y: y(v, s) })
    })
    if (actual.length) salida.push(actual)
    return salida
  }
  const linea = (pts: { x: number; y: number }[]) => pts.map((q, i) => `${i === 0 ? 'M' : 'L'}${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ')
  const area = (pts: { x: number; y: number }[]) =>
    `${linea(pts)} L${pts[pts.length - 1].x.toFixed(1)},${alto} L${pts[0].x.toFixed(1)},${alto} Z`

  const indice = (px: number) => (n === 1 || ancho <= 0 ? 0 : limitar(Math.round((px / ancho) * (n - 1)), 0, n - 1))

  const ejeDe = (e: { techo: number; piso: number }, f: (n: number) => string) =>
    [0, 25, 50, 75, 100].map((q) => ({ y: (alto * q) / 100, texto: f(e.techo - ((e.techo - e.piso) * q) / 100) }))
  const ejeIzq = ejeDe(izq, formato)
  const ejeDer = conDerecha ? ejeDe(der, formatoDerecha ?? formato) : []
  const anchoIzq = anchoTexto(ejeIzq.map((e) => e.texto))
  const anchoDer = anchoTexto(ejeDer.map((e) => e.texto))

  return (
    <View>
      <Detalle
        pista="Toca o desliza el dedo sobre el gráfico para ver un día."
        titulo={sel != null ? etiquetas[sel] : undefined}
        lineas={
          sel != null
            ? series.map((s) => ({
                nombre: s.nombre,
                valor: s.valores[sel] != null ? detalleDe(s)(s.valores[sel] as number) : '—',
                color: s.color,
              }))
            : []
        }
      />
      <View style={g.fila}>
        <View style={{ width: anchoIzq, height: alto }}>
          {ejeIzq.map((e) => (
            <Text key={`${e.y}`} style={[g.eje, { top: limitar(e.y - 7, 0, alto - 14), right: 0, color: t.tenue }]} numberOfLines={1}>
              {e.texto}
            </Text>
          ))}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={[g.plano, { height: alto, borderColor: t.gris100 }]} onLayout={medir}>
            {ancho > 0 ? (
              <Svg width={ancho} height={alto} pointerEvents="none">
                {[25, 50, 75].map((q) => (
                  <Line key={q} x1={0} x2={ancho} y1={(alto * q) / 100} y2={(alto * q) / 100} stroke={p.vacio} strokeWidth={1} />
                ))}
                {series.map((s) =>
                  s.relleno
                    ? tramos(s)
                        .filter((tr) => tr.length > 1)
                        .map((tr, i) => <Path key={`${s.nombre}-r${i}`} d={area(tr)} fill={s.color} fillOpacity={0.08} />)
                    : null,
                )}
                {series.map((s) =>
                  tramos(s).map((tr, i) => (
                    <Path
                      key={`${s.nombre}-${i}`}
                      d={tr.length > 1 ? linea(tr) : `M${tr[0].x},${tr[0].y} l0.1,0`}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={2}
                      strokeDasharray={s.punteada ? '5 4' : undefined}
                      strokeLinecap={s.punteada ? 'butt' : 'round'}
                      strokeLinejoin="round"
                    />
                  )),
                )}
                {sel != null ? (
                  <>
                    <Line x1={x(sel)} x2={x(sel)} y1={0} y2={alto} stroke={p.referencia} strokeWidth={1} strokeDasharray="3 3" />
                    {series.map((s) => {
                      const v = s.valores[sel]
                      return v == null ? null : (
                        <Circle key={`p-${s.nombre}`} cx={x(sel)} cy={y(v, s)} r={5} fill={s.color} stroke={t.superficie} strokeWidth={2} />
                      )
                    })}
                  </>
                ) : null}
              </Svg>
            ) : null}
            {/* El dedo recorre los dias. Si el gesto es vertical, el
                desplazamiento de la pantalla se lo lleva (pide el turno y se
                le da): el grafico no se traga el gesto de bajar. */}
            <View
              style={StyleSheet.absoluteFill}
              accessibilityLabel="Gráfico de líneas: toca o desliza para ver un día"
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderTerminationRequest={() => true}
              onResponderGrant={(e) => {
                movio.current = false
                antes.current = sel
                setActivo(indice(e.nativeEvent.locationX))
              }}
              onResponderMove={(e) => {
                movio.current = true
                setActivo(indice(e.nativeEvent.locationX))
              }}
              onResponderRelease={(e) => {
                // Un toque sobre el mismo dia ya marcado lo suelta.
                if (!movio.current && antes.current === indice(e.nativeEvent.locationX)) setActivo(null)
              }}
            />
          </View>
          <View style={g.extremos}>
            <Text style={[g.extremo, { color: t.tenue }]}>{etiquetas[0]}</Text>
            {n > 1 ? <Text style={[g.extremo, { color: t.tenue }]}>{etiquetas[n - 1]}</Text> : null}
          </View>
        </View>
        {conDerecha ? (
          <View style={{ width: anchoDer, height: alto }}>
            {ejeDer.map((e) => (
              <Text key={`${e.y}`} style={[g.eje, { top: limitar(e.y - 7, 0, alto - 14), left: 0, color: t.tenue }]} numberOfLines={1}>
                {e.texto}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
      <View style={g.leyenda}>
        {series.map((s) => (
          <Muestra key={s.nombre} color={s.color} texto={s.nombre} linea={!s.punteada} punteada={s.punteada} />
        ))}
        {pie ? <Text style={[g.pie, { color: t.tenue }]}>{pie}</Text> : null}
      </View>
    </View>
  )
}

// ── Sparkline ───────────────────────────────────────────────────────────────

/** Una linea chiquita sin ejes, bajo una cifra: "va subiendo" o "va quieta". */
export function Sparkline({ valores, color, alto = 36 }: { valores: (number | null)[]; color: string; alto?: number }) {
  const [ancho, medir] = useAncho()
  const puntos = valores.map((v, i) => [i, v] as const).filter((q): q is readonly [number, number] => q[1] != null)
  if (puntos.length < 2) return null
  const min = Math.min(...puntos.map((q) => q[1]))
  const max = Math.max(...puntos.map((q) => q[1]))
  const span = max - min || max * 0.02 || 1
  const n = valores.length
  const x = (i: number) => (i / (n - 1)) * ancho
  const y = (v: number) => ((92 - ((v - min) / span) * 84) / 100) * alto
  const d = puntos.map(([i, v], k) => `${k === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const ultimo = puntos[puntos.length - 1]
  return (
    <View style={{ height: alto }} onLayout={medir}>
      {ancho > 0 ? (
        <Svg width={ancho} height={alto}>
          <Path d={`${d} L${x(ultimo[0]).toFixed(1)},${alto} L${x(puntos[0][0]).toFixed(1)},${alto} Z`} fill={color} fillOpacity={0.1} />
          <Path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      ) : null}
    </View>
  )
}

// ── El reparto (la "dona" de la web, que ya son barras) ─────────────────────

export type ParteDona = { nombre: string; valor: number; color?: string; detalle?: string; id?: number | null }

/**
 * Un reparto: como te pagaron, que parte es comida y que parte bebida. Como
 * en la web, YA NO ES UN ANILLO: cada parte es una barra con su nombre
 * entero, su cifra y su porcentaje, de mayor a menor (Leider, 30-sep: "tiene
 * que ser barras"). En el telefono el nombre y la cifra van arriba y la
 * barra debajo, a todo el ancho. `pastel`: dos partes de un todo en una sola
 * barra (facturado / sin facturar).
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
  centro?: { valor: string; texto: string }
  pastel?: boolean
  /** Tocar una parte: bajar a verla sola (filtrar por esa categoria). */
  alTocar?: (p: ParteDona) => void
}) {
  const t = useTema()
  const p = usePaletaDatos()
  const total = partes.reduce((s, x) => s + Math.max(x.valor, 0), 0)
  if (total <= 0 || partes.length === 0) return <SinDibujo />
  const filas = partes
    .map((x, i) => ({ ...x, valor: Math.max(x.valor, 0), pct: (Math.max(x.valor, 0) / total) * 100, color: x.color ?? colorSerie(p, i) }))
    .sort((a, b) => b.valor - a.valor)
  const max = filas[0].valor

  if (pastel) {
    return (
      <View>
        <View style={[g.pastel, { backgroundColor: p.vacio }]}>
          {filas.map((f) => (
            <View key={f.nombre} style={{ width: `${f.pct}%`, backgroundColor: f.color }} />
          ))}
        </View>
        <View style={{ marginTop: 12, gap: 8 }}>
          {filas.map((f) => (
            <View key={f.nombre} style={g.pastelFila}>
              <View style={[g.cuadro, { backgroundColor: f.color }]} />
              <Text style={[g.texto, { color: t.fuerte, flex: 1 }]}>
                {f.nombre}
                {f.detalle ? <Text style={[g.nota, { color: t.tenue }]}> · {f.detalle}</Text> : null}
              </Text>
              <Text style={[g.valor, { color: t.tinta }]}>{formato(f.valor)}</Text>
              <Text style={[g.pct, { color: t.tenue }]}>{f.pct.toFixed(0)}%</Text>
            </View>
          ))}
        </View>
      </View>
    )
  }

  return (
    <View>
      {centro ? (
        <Text style={[g.texto, { color: t.suave, marginBottom: 12 }]}>
          <Text style={[g.valor, { color: t.tinta }]}>{centro.valor}</Text> {centro.texto}
        </Text>
      ) : null}
      <View style={{ gap: 12 }}>
        {filas.map((f) => {
          const tocable = alTocar != null && f.id != null
          const cuerpo = (
            <View>
              <View style={g.repartoCabeza}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[g.texto, { color: t.fuerte }]} numberOfLines={2}>
                    {f.nombre}
                  </Text>
                  {f.detalle ? (
                    <Text style={[g.nota, { color: t.tenue }]} numberOfLines={1}>
                      {f.detalle}
                    </Text>
                  ) : null}
                </View>
                <Text style={[g.valor, { color: t.tinta }]}>{formato(f.valor)}</Text>
                <Text style={[g.pct, { color: t.tenue }]}>{f.pct.toFixed(0)}%</Text>
                {tocable ? <Text style={[g.flecha, { color: t.tenue }]}>›</Text> : null}
              </View>
              <View style={[g.pista2, { backgroundColor: p.vacio }]}>
                <View style={{ height: '100%', borderRadius: 5, width: `${max > 0 ? (f.valor / max) * 100 : 0}%`, minWidth: f.valor > 0 ? 3 : 0, backgroundColor: f.color }} />
              </View>
            </View>
          )
          if (!tocable) return <View key={f.nombre}>{cuerpo}</View>
          return (
            <Pressable
              key={f.nombre}
              onPress={() => alTocar(f)}
              accessibilityRole="button"
              accessibilityLabel={`Ver solo ${f.nombre}`}
              style={({ pressed }) => [g.tocable, { backgroundColor: pressed ? t.gris100 : 'transparent' }]}
            >
              {cuerpo}
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

// ── Barras apiladas ─────────────────────────────────────────────────────────

export type ParteApilada = { nombre: string; valor: number; color: string }
export type FilaApilada = { nombre: string; partes: ParteApilada[]; detalle?: string }

/**
 * Barras acostadas y partidas: lo que mas se pierde (registrado / conteo),
 * las mercancias que mas valen. Todas a la misma escala: la mas larga llena
 * el ancho. Tocar una fila con varias partes muestra cuanto es cada una (lo
 * que en la web dice el globo).
 */
export function BarrasApiladas({
  filas,
  formato,
  leyenda,
}: {
  filas: FilaApilada[]
  formato: (n: number) => string
  leyenda?: { nombre: string; color: string }[]
}) {
  const t = useTema()
  const p = usePaletaDatos()
  const [abierta, setAbierta] = useState<string | null>(null)
  if (filas.length === 0) return <SinDibujo />
  const totales = filas.map((f) => f.partes.reduce((s, x) => s + Math.max(x.valor, 0), 0))
  const max = Math.max(...totales, 0)
  return (
    <View>
      {leyenda ? (
        <View style={[g.leyenda, { marginTop: 0, marginBottom: 12 }]}>
          {leyenda.map((l) => (
            <Muestra key={l.nombre} color={l.color} texto={l.nombre} />
          ))}
        </View>
      ) : null}
      <View style={{ gap: 12 }}>
        {filas.map((f, i) => {
          const conPartes = f.partes.filter((x) => x.valor > 0)
          const abre = conPartes.length > 1
          const cuerpo = (
            <View>
              <View style={g.repartoCabeza}>
                <Text style={[g.texto, { color: t.fuerte, flex: 1 }]} numberOfLines={2}>
                  {f.nombre}
                </Text>
                <Text style={[g.valor, { color: t.tinta }]}>
                  {formato(totales[i])}
                  {f.detalle ? <Text style={[g.nota, { color: t.tenue }]}> {f.detalle}</Text> : null}
                </Text>
              </View>
              <View style={[g.pista2, { backgroundColor: p.vacio }]}>
                <View style={{ flexDirection: 'row', height: '100%', borderRadius: 5, overflow: 'hidden', width: `${max > 0 ? (totales[i] / max) * 100 : 0}%` }}>
                  {conPartes.map((x) => (
                    <View key={x.nombre} style={{ flex: x.valor, backgroundColor: x.color }} />
                  ))}
                </View>
              </View>
              {abierta === f.nombre ? (
                <View style={{ marginTop: 6, gap: 2 }}>
                  {conPartes.map((x) => (
                    <View key={x.nombre} style={g.detalleLinea}>
                      <View style={[g.punto, { backgroundColor: x.color }]} />
                      <Text style={[g.detalleNombre, { color: t.suave }]}>{x.nombre}</Text>
                      <Text style={[g.detalleValor, { color: t.tinta }]}>{formato(x.valor)}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          )
          if (!abre) return <View key={f.nombre + i}>{cuerpo}</View>
          return (
            <Pressable
              key={f.nombre + i}
              onPress={() => setAbierta((a) => (a === f.nombre ? null : f.nombre))}
              accessibilityLabel={`${f.nombre}: ver de qué se compone`}
              style={({ pressed }) => [g.tocable, { backgroundColor: pressed ? t.gris100 : 'transparent' }]}
            >
              {cuerpo}
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

// ── Cuanto vende y cuanto deja cada producto ────────────────────────────────

export type FilaGanancia = { nombre: string; ingreso: number; costo: number | null; unidades?: number; id?: number | null }

/**
 * SIN LEYENDA (Leider, 30-sep: "no me gusta esa leyenda, en tlf se ve
 * peor"): cada fila dice en palabras lo que la barra dibuja. Gris es la
 * mercancia, verde lo que quedo, rojo lo que falto, rayado lo vendido sin
 * receta. Tocar una fila filtra por ese producto.
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
  alTocar?: (f: FilaGanancia) => void
}) {
  const t = useTema()
  const p = usePaletaDatos()
  const [todas, setTodas] = useState(false)
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  if (filas.length === 0) return <SinDibujo />
  const visibles = todas ? filas : filas.slice(0, primeros)
  const max = Math.max(...filas.map((f) => Math.max(f.ingreso, f.costo ?? 0)), 0.000001)
  const ancho = (v: number) => `${(Math.max(v, 0) / max) * 100}%` as const

  return (
    <View>
      <View style={{ gap: 14 }}>
        {visibles.map((f) => {
          const sinReceta = f.costo == null
          const costo = f.costo ?? 0
          const queda = f.ingreso - costo
          const pctQueda = f.ingreso > 0 ? (queda / f.ingreso) * 100 : 0
          const pierde = !sinReceta && queda < -0.004
          const tocable = alTocar != null && f.id != null
          const cuerpo = (
            <View>
              <View style={g.gananciaCabeza}>
                <Text style={[g.texto, { color: t.tinta, fontFamily: LETRA.textoFuerte, flexShrink: 1 }]}>
                  {f.nombre}
                  {f.unidades != null ? (
                    <Text style={[g.nota, { color: t.suave, fontFamily: LETRA.texto }]}>
                      {'  '}
                      {f.unidades} {f.unidades === 1 ? 'vendido' : 'vendidos'}
                    </Text>
                  ) : null}
                </Text>
                <Text style={[g.nota, { color: t.suave, marginLeft: 'auto' }]}>
                  <Text style={{ fontFamily: LETRA.cifra }}>{formato(f.ingreso)}</Text>
                  <Text style={{ color: t.tenue }}> · </Text>
                  {sinReceta ? (
                    <Text style={{ color: t.aviso, fontFamily: LETRA.textoFuerte }}>sin receta</Text>
                  ) : pierde ? (
                    <Text style={{ color: t.peligro, fontFamily: LETRA.textoFuerte }}>
                      pierde <Text style={{ fontFamily: LETRA.cifraFuerte }}>{formato(-queda)}</Text>
                    </Text>
                  ) : (
                    <Text style={{ color: t.exito, fontFamily: LETRA.textoFuerte }}>
                      deja <Text style={{ fontFamily: LETRA.cifraFuerte }}>{formato(queda)}</Text>{' '}
                      <Text style={{ fontFamily: LETRA.cifra }}>({pctQueda.toFixed(0)}%)</Text>
                    </Text>
                  )}
                </Text>
              </View>
              <View style={[g.pistaGanancia, { backgroundColor: p.vacio }]}>
                {sinReceta ? (
                  <View style={{ width: ancho(f.ingreso), height: '100%', borderRadius: 5, overflow: 'hidden' }}>
                    <Svg width="100%" height="100%">
                      <Defs>
                        <Pattern id={`rayas${id}`} width={10} height={10} patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
                          <Rect x={0} y={0} width={5} height={10} fill={p.incierto} />
                          <Rect x={5} y={0} width={5} height={10} fill={conAlfa(p.incierto, 0.45)} />
                        </Pattern>
                      </Defs>
                      <Rect x={0} y={0} width="100%" height="100%" fill={`url(#rayas${id})`} />
                    </Svg>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', height: '100%', borderRadius: 5, overflow: 'hidden', width: ancho(Math.max(f.ingreso, costo)) }}>
                    <View style={{ flex: Math.min(costo, f.ingreso), backgroundColor: p.neutro }} />
                    {queda > 0 ? <View style={{ flex: queda, backgroundColor: p.bien }} /> : null}
                    {pierde ? <View style={{ flex: -queda, backgroundColor: p.mal }} /> : null}
                  </View>
                )}
              </View>
            </View>
          )
          if (!tocable) return <View key={f.nombre}>{cuerpo}</View>
          return (
            <Pressable
              key={f.nombre}
              onPress={() => alTocar(f)}
              accessibilityRole="button"
              accessibilityLabel={`Ver solo ${f.nombre}`}
              style={({ pressed }) => [g.tocable, { backgroundColor: pressed ? t.gris100 : 'transparent' }]}
            >
              {cuerpo}
            </Pressable>
          )
        })}
      </View>
      {filas.length > primeros ? (
        <Pressable
          onPress={() => setTodas((v) => !v)}
          style={({ pressed }) => [g.verTodos, { backgroundColor: t.gris100, opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={[g.texto, { color: t.suave, fontFamily: LETRA.textoFuerte }]}>
            {todas ? 'Ver solo los primeros' : `Ver los ${filas.length} productos`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

// ── Mapa de calor ───────────────────────────────────────────────────────────

export type CeldaCalor = { dia: number; hora: number; pedidos: number; ventas: number }
const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

/**
 * Cuando entran los clientes: los siete dias en las columnas (abajo, como en
 * los otros dos graficos del bloque) y las horas en las filas. El color dice
 * cuantos; la casilla mas alta va marcada si es una sola. Tocar una casilla
 * dice sus cifras.
 */
export function MapaCalor({ celdas, medida, formato }: { celdas: CeldaCalor[]; medida: 'pedidos' | 'ventas'; formato: (n: number) => string }) {
  const t = useTema()
  const p = usePaletaDatos()
  const [tocada, setTocada] = useState<string | null>(null)
  if (celdas.length === 0) return <SinDibujo />
  const horas = celdas.map((c) => c.hora)
  const desde = Math.min(...horas)
  const hasta = Math.max(...horas)
  const filas = Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i)
  const valor = (c: CeldaCalor) => (medida === 'pedidos' ? c.pedidos : c.ventas)
  const max = Math.max(...celdas.map(valor), 0)
  const hayPicoUnico = max > 0 && celdas.filter((c) => valor(c) === max).length === 1
  const porCelda = new Map(celdas.map((c) => [`${c.dia}-${c.hora}`, c]))
  const dias = [0, 1, 2, 3, 4, 5, 6]
  const [diaT, horaT] = tocada ? tocada.split('-').map(Number) : [null, null]
  const celdaT = tocada ? porCelda.get(tocada) : undefined

  return (
    <View>
      <Detalle
        pista="Toca una casilla para ver sus cifras."
        titulo={tocada != null && diaT != null ? `${DIAS_CORTOS[diaT]} · ${horaT}:00` : undefined}
        nota={tocada && !celdaT ? 'Sin movimiento' : undefined}
        lineas={
          celdaT
            ? [
                { nombre: 'Pedidos', valor: String(celdaT.pedidos) },
                { nombre: 'Vendido', valor: formato(celdaT.ventas) },
              ]
            : []
        }
      />
      <View style={{ marginTop: 10, gap: 2 }}>
        {filas.map((h) => (
          <View key={h} style={g.calorFila}>
            <Text style={[g.calorHora, { color: t.tenue }]}>{h}</Text>
            {dias.map((d) => {
              const clave = `${d}-${h}`
              const c = porCelda.get(clave)
              const v = c ? valor(c) : 0
              const intensidad = max > 0 && v > 0 ? 0.12 + (v / max) * 0.88 : 0
              const esPico = hayPicoUnico && v === max
              return (
                <Pressable
                  key={d}
                  onPress={() => setTocada((x) => (x === clave ? null : clave))}
                  accessibilityLabel={`${DIAS_CORTOS[d]} a las ${h}:00`}
                  style={[
                    g.calorCelda,
                    { backgroundColor: intensidad ? conAlfa(p.serie[0], intensidad) : t.gris100 },
                    esPico && { borderWidth: 2, borderColor: t.acento },
                    tocada === clave && { borderWidth: 2, borderColor: t.tinta },
                  ]}
                />
              )
            })}
          </View>
        ))}
        <View style={g.calorFila}>
          <View style={g.calorHora} />
          {dias.map((d) => (
            <Text key={d} style={[g.calorDia, { color: t.suave }]}>
              {DIAS_CORTOS[d]}
            </Text>
          ))}
        </View>
      </View>
      <View style={g.calorEscala}>
        {hayPicoUnico ? (
          <View style={[g.muestra, { marginRight: 'auto' }]}>
            <View style={[g.cuadro, { backgroundColor: p.serie[0], borderWidth: 2, borderColor: t.acento }]} />
            <Text style={[g.muestraTexto, { color: t.tenue }]}>la hora más fuerte</Text>
          </View>
        ) : null}
        <Text style={[g.muestraTexto, { color: t.tenue }]}>menos</Text>
        {[0.15, 0.35, 0.6, 0.85, 1].map((q) => (
          <View key={q} style={[g.cuadro, { backgroundColor: conAlfa(p.serie[0], q) }]} />
        ))}
        <Text style={[g.muestraTexto, { color: t.tenue }]}>
          más · {medida === 'pedidos' ? `${max} ${max === 1 ? 'pedido' : 'pedidos'}` : formato(max)}
        </Text>
      </View>
    </View>
  )
}

// ── La cuenta, en barras ────────────────────────────────────────────────────

export type FilaCuenta = {
  nombre: string
  /** Con su signo: lo que se resta va en negativo. */
  valor: number
  tipo?: 'base' | 'subtotal' | 'resultado'
  color?: string
  nota?: string
}

/**
 * De donde sale la ganancia: ventas, menos esto, menos aquello, queda tanto;
 * con una barra en cada renglon, todas a la misma escala. Se lee como una
 * factura y se VE como un grafico (Leider, 30-sep: la cascada no se entendia).
 */
export function BarrasDeCuenta({ filas, formato }: { filas: FilaCuenta[]; formato: (n: number) => string }) {
  const t = useTema()
  const p = usePaletaDatos()
  if (filas.length === 0) return <SinDibujo />
  const max = Math.max(...filas.map((f) => Math.abs(f.valor)), 0.000001)
  return (
    <View>
      {filas.map((f, i) => {
        const resultado = f.tipo === 'resultado'
        const subtotal = f.tipo === 'subtotal'
        const negativo = f.valor < 0
        const color =
          f.color ?? (f.tipo === 'base' ? p.serie[0] : resultado || subtotal ? (negativo ? p.mal : p.bien) : negativo ? p.neutro : p.bien)
        // El signo dice que hace el renglon: se resta, suma, o es el saldo.
        const signo = f.tipo === 'base' || f.valor === 0 ? '' : negativo ? '−' : resultado || subtotal ? '' : '+'
        return (
          <View
            key={f.nombre + i}
            style={[
              g.cuentaFila,
              resultado && { borderTopWidth: 1, borderTopColor: t.gris200, marginTop: 4, paddingTop: 12 },
              subtotal && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.gris200, marginTop: 2 },
            ]}
          >
            <View style={g.repartoCabeza}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  style={[
                    resultado ? g.cuentaResultado : g.texto,
                    { color: resultado || subtotal ? t.tinta : t.fuerte },
                    subtotal && { fontFamily: LETRA.textoFuerte },
                  ]}
                  numberOfLines={2}
                >
                  {f.nombre}
                </Text>
                {f.nota ? <Text style={[g.nota, { color: t.tenue }]}>{f.nota}</Text> : null}
              </View>
              <Text
                style={[
                  resultado ? g.cuentaValorFuerte : g.valor,
                  { color: (resultado || subtotal) && negativo ? t.peligro : t.tinta },
                ]}
              >
                {signo}
                {formato(Math.abs(f.valor))}
              </Text>
            </View>
            <View style={[g.pista2, { backgroundColor: p.vacio }]}>
              <View
                style={{
                  height: '100%',
                  borderRadius: 5,
                  width: `${(Math.abs(f.valor) / max) * 100}%`,
                  minWidth: f.valor !== 0 ? 3 : 0,
                  backgroundColor: color,
                  opacity: subtotal ? 0.45 : 1,
                }}
              />
            </View>
          </View>
        )
      })}
    </View>
  )
}

const g = StyleSheet.create({
  sinDibujo: { fontFamily: LETRA.texto, fontSize: 14, textAlign: 'center', paddingVertical: 24 },
  detalle: { borderRadius: 12, borderCurve: 'continuous', paddingHorizontal: 12, paddingVertical: 9, minHeight: 56, justifyContent: 'center' },
  detalleTitulo: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
  detalleLineas: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 2, marginTop: 3 },
  detalleLinea: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  detalleNombre: { fontFamily: LETRA.texto, fontSize: 13 },
  detalleValor: { fontFamily: LETRA.cifraFuerte, fontSize: 13.5 },
  detalleNota: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 2 },
  pista: { fontFamily: LETRA.texto, fontSize: 13, textAlign: 'center' },
  punto: { width: 7, height: 7, borderRadius: 4 },
  variacion: { fontFamily: LETRA.cifraFuerte, fontSize: 12.5 },
  variacionTexto: { fontFamily: LETRA.texto, fontSize: 12.5 },
  fila: { flexDirection: 'row', gap: 6, marginTop: 12, alignItems: 'flex-start' },
  eje: { position: 'absolute', fontFamily: LETRA.cifra, fontSize: 11 },
  cifraBarra: { position: 'absolute', width: 80, textAlign: 'center', fontFamily: LETRA.cifra, fontSize: 11 },
  rotulos: { height: 18, marginTop: 4 },
  rotulo: { position: 'absolute', textAlign: 'center', fontFamily: LETRA.texto, fontSize: 11.5 },
  plano: { borderWidth: 1, borderRadius: 8, borderCurve: 'continuous' },
  extremos: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  extremo: { fontFamily: LETRA.cifra, fontSize: 11 },
  leyenda: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 6, marginTop: 10 },
  muestra: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  muestraTexto: { fontFamily: LETRA.texto, fontSize: 12.5 },
  pie: { fontFamily: LETRA.texto, fontSize: 12.5, marginLeft: 'auto' },
  pastel: { flexDirection: 'row', height: 20, borderRadius: 6, overflow: 'hidden' },
  pastelFila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cuadro: { width: 11, height: 11, borderRadius: 3 },
  texto: { fontFamily: LETRA.texto, fontSize: 14.5, lineHeight: 19 },
  nota: { fontFamily: LETRA.texto, fontSize: 13, lineHeight: 17 },
  valor: { fontFamily: LETRA.cifra, fontSize: 14 },
  pct: { fontFamily: LETRA.cifra, fontSize: 12.5, width: 38, textAlign: 'right' },
  flecha: { fontFamily: LETRA.textoFuerte, fontSize: 17, marginLeft: 2 },
  repartoCabeza: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  pista2: { height: 10, borderRadius: 5, marginTop: 6, overflow: 'hidden' },
  tocable: { borderRadius: 12, borderCurve: 'continuous', marginHorizontal: -8, paddingHorizontal: 8, paddingVertical: 4 },
  gananciaCabeza: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 10, rowGap: 2 },
  pistaGanancia: { height: 10, borderRadius: 5, marginTop: 7, overflow: 'hidden' },
  verTodos: { marginTop: 14, borderRadius: 12, borderCurve: 'continuous', minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  calorFila: { flexDirection: 'row', gap: 2, alignItems: 'center' },
  calorHora: { width: 26, textAlign: 'right', paddingRight: 4, fontFamily: LETRA.cifra, fontSize: 11 },
  calorCelda: { flex: 1, height: 24, borderRadius: 4 },
  calorDia: { flex: 1, textAlign: 'center', fontFamily: LETRA.texto, fontSize: 11.5, paddingTop: 3 },
  calorEscala: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 5, marginTop: 10 },
  cuentaFila: { paddingVertical: 7 },
  cuentaResultado: { fontFamily: LETRA.titulo, fontSize: 16 },
  cuentaValorFuerte: { fontFamily: LETRA.cifraFuerte, fontSize: 16 },
})
