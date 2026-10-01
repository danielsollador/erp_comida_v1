import { useState, type PointerEvent } from 'react'
import { PALETA } from '../lib/paleta'

/**
 * El vaso: un recipiente que se llena, de abajo hacia arriba, con lo que
 * cuesta algo, y lo que queda hasta el borde --el precio, lo vendido-- es lo
 * que se gana, en verde.
 *
 * Es UN dibujo para todo (Leider, 29-sep: "algo general, si haces uno para
 * cada uno tendremos que estar dibujando para cada cliente"): la receta de
 * una empanada lo llena con harina y carne y el borde es el precio; el
 * resultado del mes lo llena con mercancia, gastos e IVA y el borde son las
 * ventas. Lo que importa no es la forma sino cuanto del borde se lleva cada
 * cosa.
 *
 * NINGUNA FRANJA DESAPARECE. Cada una mide al menos lo que hace falta para
 * leerla; lo que crece se lo come el verde, y si entre todas se pasan del
 * vaso se encogen parejo. Si el costo se pasa del borde, el vaso se llena de
 * costo y la linea del borde queda por debajo: la perdida se ve antes de
 * leerla.
 *
 * CADA FRANJA EXPLICA LO SUYO al posar el cursor o, en el telefono, al
 * tocarla (se queda hasta tocar otra o fuera): cuanto cuesta, que parte del
 * costo es y que parte del precio; el margen, que parte del precio es
 * (Leider, 1-oct). Los colores salen de la paleta de datos, suaves.
 */
export type ParteVaso = { id: number | string; nombre: string; valor: number; color: string }

// Geometria del recipiente (viewBox 260 x 400): boca en y=60, fondo en y=370.
const BOCA = 60
const FONDO = 370
const ALTO = FONDO - BOCA
const SILUETA = 'M36 60H224Q232 60 231 68L214 356Q213 370 199 370H61Q47 370 46 356L29 68Q28 60 36 60Z'
// Dos renglones de texto caben en 34 px: el nombre completo arriba y la
// cifra abajo, en vez de "Refresco concentr…" (Leider, 29-sep).
const MINIMO = 34

/** Parte un nombre en hasta dos renglones de ~26 letras, por palabras. */
function renglones(nombre: string): string[] {
  const MAX = 26
  if (nombre.length <= MAX) return [nombre]
  const corte = nombre.lastIndexOf(' ', MAX)
  const a = corte > 8 ? nombre.slice(0, corte) : nombre.slice(0, MAX)
  let b = nombre.slice(a.length).trim()
  if (b.length > MAX) b = b.slice(0, MAX - 1) + '…'
  return [a, b]
}

let contador = 0

export default function Vaso({
  tope,
  topeTitulo,
  partes,
  restoNombre,
  desbordeTexto,
  vacioTexto,
  formato,
  resaltado = null,
  onResaltar,
  className = '',
}: {
  /** El borde: el precio, lo vendido. */
  tope: number
  /** Lo que dice arriba de la cifra: "se vende a", "vendiste". */
  topeTitulo: string
  partes: ParteVaso[]
  /** Como se llama lo que queda: "margen", "ganancia". */
  restoNombre: string
  /** La linea que marca el borde cuando el costo se pasa: "hasta aquí llega el precio". */
  desbordeTexto: string
  vacioTexto?: string
  formato: (n: number) => string
  resaltado?: number | string | null
  onResaltar?: (id: number | string | null) => void
  className?: string
}) {
  const costo = partes.reduce((t, p) => t + p.valor, 0)
  const escala = Math.max(tope, costo, 0.000001)
  const px = (v: number) => (v / escala) * ALTO
  const desbordado = costo > tope + 0.0001
  let alturas = partes.map((p) => Math.max(px(p.valor), MINIMO))
  const suma = alturas.reduce((t, h) => t + h, 0)
  if (suma > ALTO) alturas = alturas.map((h) => (h * ALTO) / suma)
  let y = FONDO
  const franjas = partes.map((p, i) => {
    const h = alturas[i]
    y -= h
    return { ...p, y, h }
  })
  const margenH = desbordado ? 0 : Math.max(ALTO - alturas.reduce((t, h) => t + h, 0), 0)
  const yMargen = y - margenH
  const yTope = FONDO - px(tope)
  // Un id por vaso: dos en la misma pagina no pueden compartir el recorte.
  const [id] = useIdEstable()

  // Lo que se toco con el dedo se queda señalado hasta tocar otra cosa; el
  // cursor señala mientras pasa. El globo sale para lo uno o lo otro.
  const [fijado, setFijado] = useState<number | string | null>(null)
  const mostrado = fijado ?? resaltado
  const pct = (parte: number, de: number) => (de > 0 ? (parte / de) * 100 : 0)
  const alTocar = (e: PointerEvent, idParte: number | string) => {
    if (e.pointerType === 'mouse') return
    e.preventDefault()
    const nuevo = fijado === idParte ? null : idParte
    setFijado(nuevo)
    onResaltar?.(nuevo)
  }
  const franjaMostrada = franjas.find((x) => x.id === mostrado)
  const globo =
    mostrado === 'margen' && margenH > 0.5
      ? {
          y: yMargen + margenH / 2,
          titulo: restoNombre[0].toUpperCase() + restoNombre.slice(1),
          lineas: [`${formato(tope - costo)} por cada uno`, `El ${pct(tope - costo, tope).toFixed(0)}% del precio es ${restoNombre}`],
        }
      : franjaMostrada
        ? {
            y: franjaMostrada.y + franjaMostrada.h / 2,
            titulo: franjaMostrada.nombre,
            lineas: [
              `Cuesta ${formato(franjaMostrada.valor)} por cada uno`,
              `Es el ${pct(franjaMostrada.valor, costo).toFixed(0)}% del costo`,
              `Se lleva el ${pct(franjaMostrada.valor, tope).toFixed(0)}% del precio`,
            ],
          }
        : null

  return (
    <div
      className={`relative mx-auto ${className || 'w-full max-w-[280px]'}`}
      onPointerDown={(e) => {
        // Tocar fuera de las franjas suelta lo fijado.
        if (e.pointerType !== 'mouse' && e.target === e.currentTarget) {
          setFijado(null)
          onResaltar?.(null)
        }
      }}
    >
    <svg viewBox="0 0 260 400" className="block w-full h-full" role="img" aria-label={`Cuánto de ${topeTitulo} se lleva cada parte`}>
      <defs>
        <clipPath id={id}>
          <path d={SILUETA} />
        </clipPath>
      </defs>

      {/* El borde, arriba del vaso: hasta donde se puede llenar. */}
      <text x="130" y="22" textAnchor="middle" fontSize="11" fill="var(--color-neutral-500)">
        {topeTitulo}
      </text>
      <text
        x="130"
        y="50"
        textAnchor="middle"
        fontSize={formato(tope).length > 10 ? 22 : 28}
        fontWeight="600"
        fill="var(--vp-tinta)"
        style={{ fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}
      >
        {formato(tope)}
      </text>

      {/* Fondo del recipiente: vacio. */}
      <path d={SILUETA} fill={PALETA.vacio} />

      <g clipPath={`url(#${id})`}>
        {margenH > 0.5 && partes.length > 0 && (
          <rect
            x="0"
            y={yMargen}
            width="260"
            height={margenH}
            fill={PALETA.bien}
            opacity={mostrado === null || mostrado === 'margen' ? 0.85 : 0.45}
            onMouseEnter={() => onResaltar?.('margen')}
            onMouseLeave={() => onResaltar?.(null)}
            onPointerDown={(e) => alTocar(e, 'margen')}
            style={{ cursor: 'default', transition: 'opacity .15s' }}
          />
        )}
        {franjas.map((f) => (
          <g
            key={f.id}
            onMouseEnter={() => onResaltar?.(f.id)}
            onMouseLeave={() => onResaltar?.(null)}
            onPointerDown={(e) => alTocar(e, f.id)}
            style={{ cursor: 'default' }}
          >
            {/* Suave: las franjas van un poco transparentes y la que se
                señala sube; las demas bajan. */}
            <rect
              x="0"
              y={f.y}
              width="260"
              height={f.h}
              fill={f.color}
              opacity={mostrado === null ? 0.85 : mostrado === f.id ? 1 : 0.45}
              style={{ transition: 'opacity .15s' }}
            />
            {/* Un hilo del color de la superficie entre franja y franja:
                aunque dos tonos se parezcan, se ve donde termina una y
                empieza la otra. */}
            <line x1="0" x2="260" y1={f.y} y2={f.y} stroke="var(--vp-superficie)" strokeWidth="2" opacity="0.8" />
            {f.h >= 18 && <Rotulo f={f} texto={formato(f.valor)} />}
          </g>
        ))}
        {desbordado && (
          <>
            <line x1="20" x2="240" y1={yTope} y2={yTope} stroke="var(--color-peligro-600)" strokeWidth="2" strokeDasharray="6 4" />
            <text x="130" y={yTope - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--color-peligro-600)">
              {desbordeTexto}
            </text>
          </>
        )}
      </g>

      {/* El contorno, encima de todo: un pelo, no un marco. */}
      <path d={SILUETA} fill="none" stroke="var(--vp-tinta)" strokeOpacity="0.22" strokeWidth="2" strokeLinejoin="round" />

      {partes.length === 0 && vacioTexto && (
        <text x="130" y="220" textAnchor="middle" fontSize="13" fill="var(--color-neutral-500)">
          {vacioTexto}
        </text>
      )}
      {margenH >= 22 && partes.length > 0 && (
        <text x="130" y={yMargen + margenH / 2 + 5} textAnchor="middle" fontSize="13" fontWeight="700" fill="#ffffff" style={{ paintOrder: 'stroke', stroke: 'rgb(0 0 0 / 0.18)', strokeWidth: 2, pointerEvents: 'none' }}>
          {restoNombre} {formato(tope - costo)}
        </text>
      )}
    </svg>

      {/* El globo: que es esa franja y que parte se lleva. Va en HTML encima
          del dibujo, a la altura de la franja, para que se lea igual en el
          telefono, donde no hay cursor. */}
      {globo && (
        <div
          className="pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 -translate-y-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs shadow-lg whitespace-nowrap"
          style={{ top: `calc(${(globo.y / 400) * 100}% - 10px)` }}
        >
          <div className="mb-0.5 font-semibold text-neutral-700">{globo.titulo}</div>
          {globo.lineas.map((l) => (
            <div key={l} className="text-neutral-500 tabular-nums">
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const TEXTO = {
  fontSize: 11,
  fontWeight: 600,
  fill: '#ffffff',
  style: { paintOrder: 'stroke' as const, stroke: 'rgb(0 0 0 / 0.18)', strokeWidth: 2, pointerEvents: 'none' as const },
}

/**
 * El nombre y la cifra dentro de la franja. Si la franja es alta, el nombre
 * va entero (hasta dos renglones) y la cifra debajo; si es baja, todo en un
 * renglon y el nombre se corta solo cuando de verdad no cabe.
 */
function Rotulo({ f, texto }: { f: { y: number; h: number; nombre: string }; texto: string }) {
  const lineas = renglones(f.nombre)
  const cortoParaUnaLinea = f.nombre.length <= 16
  if (f.h < 34 || (lineas.length === 1 && cortoParaUnaLinea)) {
    const nombre = f.h < 34 && !cortoParaUnaLinea ? lineas[0] : f.nombre
    return (
      <>
        <text x="48" y={f.y + f.h / 2 + 4} {...TEXTO}>
          {cortoParaUnaLinea ? nombre : f.h < 34 ? nombre : f.nombre}
        </text>
        {(cortoParaUnaLinea || f.h >= 34) && (
          <text x="212" y={f.y + f.h / 2 + 4} textAnchor="end" {...TEXTO} style={{ ...TEXTO.style, fontVariantNumeric: 'tabular-nums' }}>
            {texto}
          </text>
        )}
      </>
    )
  }
  // Alta: nombre entero arriba (uno o dos renglones), cifra abajo a la derecha.
  const tres = lineas.length === 2 && f.h >= 48
  const paso = 14
  const total = (tres ? 3 : 2) * paso
  const y0 = f.y + f.h / 2 - total / 2 + 11
  // Centrado, como el rotulo del margen: con espacio de sobra, nombre y
  // cifra uno debajo del otro en el medio de la franja.
  return (
    <>
      <text x="130" y={y0} textAnchor="middle" {...TEXTO}>
        {tres ? lineas[0] : lineas.length === 2 ? lineas[0] + ' ' + lineas[1] : lineas[0]}
      </text>
      {tres && (
        <text x="130" y={y0 + paso} textAnchor="middle" {...TEXTO}>
          {lineas[1]}
        </text>
      )}
      <text x="130" y={y0 + (tres ? 2 : 1) * paso} textAnchor="middle" {...TEXTO} style={{ ...TEXTO.style, fontVariantNumeric: 'tabular-nums' }}>
        {texto}
      </text>
    </>
  )
}

function useIdEstable(): [string] {
  const [id] = useState(() => `vaso-${++contador}`)
  return [id]
}

/**
 * La frase de abajo del vaso: cuanto queda y que parte del borde es. Verde
 * si queda, rojo si el costo se paso.
 */
export function ResumenVaso({
  tope,
  costo,
  formato,
  queda,
  pierde,
  de,
}: {
  tope: number
  costo: number
  formato: (n: number) => string
  /** "Tu margen es", "Te queda" */
  queda: string
  /** "Pierdes … por unidad", "Perdiste" */
  pierde: string
  /** "de este producto", "de lo vendido" */
  de: string
}) {
  const resto = tope - costo
  const pct = tope > 0 ? (resto / tope) * 100 : 0
  const mal = resto < 0
  return (
    <p className={`text-center font-display text-lg font-semibold tracking-tight ${mal ? 'text-peligro-600' : 'text-exito-700'}`}>
      {mal ? (
        <>
          {pierde} {formato(Math.abs(resto))}
          <span className="block text-sm font-medium">el costo se pasa un {Math.abs(pct).toFixed(0)}%</span>
        </>
      ) : (
        <>
          {queda} {formato(resto)}
          <span className="block text-sm font-medium">
            el {pct.toFixed(0)}% {de}
          </span>
        </>
      )}
    </p>
  )
}
