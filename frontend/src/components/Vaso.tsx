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
const MINIMO = 22

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
            {f.h >= 18 && (
              <>
                <text x="48" y={f.y + f.h / 2 + 4} fontSize="11" fontWeight="600" fill="var(--color-neutral-50)" style={{ paintOrder: 'stroke', stroke: 'rgb(0 0 0 / 0.25)', strokeWidth: 2 }}>
                  {f.nombre.length > 18 ? f.nombre.slice(0, 17) + '…' : f.nombre}
                </text>
                <text x="212" y={f.y + f.h / 2 + 4} textAnchor="end" fontSize="11" fontWeight="600" fill="var(--color-neutral-50)" style={{ paintOrder: 'stroke', stroke: 'rgb(0 0 0 / 0.25)', strokeWidth: 2, fontVariantNumeric: 'tabular-nums' }}>
                  {formato(f.valor)}
                </text>
              </>
            )}
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
