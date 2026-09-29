import { useState } from 'react'

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

  return (
    <svg viewBox="0 0 260 400" className={`w-full max-w-[280px] mx-auto block ${className}`} role="img" aria-label={`Cuánto de ${topeTitulo} se lleva cada parte`}>
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
      <path d={SILUETA} fill="var(--color-neutral-100)" />

      <g clipPath={`url(#${id})`}>
        {margenH > 0.5 && partes.length > 0 && (
          <rect x="0" y={yMargen} width="260" height={margenH} fill="var(--color-exito-500)" opacity="0.9" />
        )}
        {franjas.map((f) => (
          <g
            key={f.id}
            onMouseEnter={() => onResaltar?.(f.id)}
            onMouseLeave={() => onResaltar?.(null)}
            style={{ cursor: 'default' }}
          >
            <rect x="0" y={f.y} width="260" height={f.h} fill={f.color} opacity={resaltado === null || resaltado === f.id ? 1 : 0.55} />
            {/* Un hilo del color del papel entre franja y franja: aunque dos
                tonos se parezcan, se ve donde termina una y empieza la otra. */}
            <line x1="0" x2="260" y1={f.y} y2={f.y} stroke="var(--vp-papel)" strokeWidth="1.5" />
            {f.h >= 18 && <Rotulo f={f} texto={formato(f.valor)} />}
            {resaltado === f.id && <rect x="0" y={f.y} width="260" height={f.h} fill="none" stroke="var(--vp-tinta)" strokeWidth="2" />}
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

      {/* El contorno, encima de todo. */}
      <path d={SILUETA} fill="none" stroke="var(--vp-tinta)" strokeOpacity="0.55" strokeWidth="2.5" strokeLinejoin="round" />

      {partes.length === 0 && vacioTexto && (
        <text x="130" y="220" textAnchor="middle" fontSize="13" fill="var(--color-neutral-500)">
          {vacioTexto}
        </text>
      )}
      {margenH >= 22 && partes.length > 0 && (
        <text x="130" y={yMargen + margenH / 2 + 5} textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--color-neutral-50)" style={{ paintOrder: 'stroke', stroke: 'rgb(0 0 0 / 0.2)', strokeWidth: 2 }}>
          {restoNombre} {formato(tope - costo)}
        </text>
      )}
    </svg>
  )
}

const TEXTO = {
  fontSize: 11,
  fontWeight: 600,
  fill: 'var(--color-neutral-50)',
  style: { paintOrder: 'stroke' as const, stroke: 'rgb(0 0 0 / 0.25)', strokeWidth: 2 },
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
  return (
    <>
      <text x="48" y={y0} {...TEXTO}>
        {tres ? lineas[0] : lineas.length === 2 ? lineas[0] + ' ' + lineas[1] : lineas[0]}
      </text>
      {tres && (
        <text x="48" y={y0 + paso} {...TEXTO}>
          {lineas[1]}
        </text>
      )}
      <text x="212" y={y0 + (tres ? 2 : 1) * paso} textAnchor="end" {...TEXTO} style={{ ...TEXTO.style, fontVariantNumeric: 'tabular-nums' }}>
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
