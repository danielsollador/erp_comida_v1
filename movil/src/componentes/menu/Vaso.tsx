import { useId, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Svg, { ClipPath, Defs, G, Line, Path, Rect, Text as TextoSvg } from 'react-native-svg'
import { LETRA, useTema } from '../../lib/tema'

/**
 * EL VASO (components/Vaso.tsx de la web), dibujado con react-native-svg: un
 * recipiente que se llena, de abajo hacia arriba, con lo que cuesta el
 * producto, y lo que queda hasta el borde --el precio-- es el margen, en
 * verde. Cada mercancia es una franja de su color, proporcional a lo que
 * cuesta. Si el costo se pasa del precio, el vaso se llena de costo y la
 * linea del precio queda por debajo: la perdida se ve antes de leerla.
 *
 * NINGUNA FRANJA DESAPARECE: cada una mide al menos lo que hace falta para
 * leerla; lo que crece se lo come el verde, y si entre todas se pasan del
 * vaso se encogen parejo.
 *
 * CADA FRANJA EXPLICA LO SUYO AL TOCARLA (se queda hasta tocarla otra vez u
 * otra cosa): cuanto cuesta, que parte del costo y que parte del precio es.
 */
export type ParteVaso = { id: number | string; nombre: string; valor: number; color: string; clara?: boolean }

// Geometria del recipiente (viewBox 260 x 400): boca en y=60, fondo en y=370.
const BOCA = 60
const FONDO = 370
const ALTO = FONDO - BOCA
const SILUETA = 'M36 60H224Q232 60 231 68L214 356Q213 370 199 370H61Q47 370 46 356L29 68Q28 60 36 60Z'
// Dos renglones de texto caben en 34 px: el nombre completo arriba y la cifra abajo.
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

export default function Vaso({
  tope,
  topeTitulo,
  partes,
  restoNombre,
  desbordeTexto,
  vacioTexto,
  formato,
  resaltado = null,
  alResaltar,
  anchoMaximo = 260,
}: {
  /** El borde: el precio. */
  tope: number
  /** Lo que dice arriba de la cifra: "se vende a". */
  topeTitulo: string
  partes: ParteVaso[]
  /** Como se llama lo que queda: "margen". */
  restoNombre: string
  /** La linea que marca el borde cuando el costo se pasa. */
  desbordeTexto: string
  vacioTexto?: string
  formato: (n: number) => string
  /** La franja señalada desde afuera (al tocar un renglon de la receta). */
  resaltado?: number | string | null
  alResaltar?: (id: number | string | null) => void
  anchoMaximo?: number
}) {
  const t = useTema()
  const recorte = `vaso${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const [fijado, setFijado] = useState<number | string | null>(null)

  const costo = partes.reduce((s, p) => s + p.valor, 0)
  const escala = Math.max(tope, costo, 0.000001)
  const px = (v: number) => (v / escala) * ALTO
  const desbordado = costo > tope + 0.0001
  let alturas = partes.map((p) => Math.max(px(p.valor), MINIMO))
  const suma = alturas.reduce((s, h) => s + h, 0)
  if (suma > ALTO) alturas = alturas.map((h) => (h * ALTO) / suma)
  // Cada franja se apoya sobre la anterior, desde el fondo hacia la boca.
  const franjas = partes.map((p, i) => {
    const h = alturas[i]
    const y = FONDO - alturas.slice(0, i + 1).reduce((s, x) => s + x, 0)
    return { ...p, y, h }
  })
  const y = FONDO - alturas.reduce((s, x) => s + x, 0)
  const margenH = desbordado ? 0 : Math.max(ALTO - alturas.reduce((s, h) => s + h, 0), 0)
  const yMargen = y - margenH
  const yTope = FONDO - px(tope)

  // Lo que se toco se queda señalado hasta tocar otra cosa; lo de afuera
  // (el renglon de la receta) tambien señala.
  const mostrado = fijado ?? resaltado
  const pct = (parte: number, de: number) => (de > 0 ? (parte / de) * 100 : 0)
  const tocar = (id: number | string) => {
    const nuevo = mostrado === id ? null : id
    setFijado(nuevo)
    alResaltar?.(nuevo)
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

  const tituloTope = formato(tope)

  return (
    <View style={[estilos.caja, { maxWidth: anchoMaximo }]} accessibilityLabel={`Cuánto de lo que ${topeTitulo} se lleva cada parte`}>
      <Svg width="100%" height="100%" viewBox="0 0 260 400">
        <Defs>
          <ClipPath id={recorte}>
            <Path d={SILUETA} />
          </ClipPath>
        </Defs>

        {/* El borde, arriba del vaso: hasta donde se puede llenar. */}
        <TextoSvg x={130} y={22} textAnchor="middle" fontSize={12} fontFamily={LETRA.texto} fill={t.suave}>
          {topeTitulo}
        </TextoSvg>
        <TextoSvg
          x={130}
          y={50}
          textAnchor="middle"
          fontSize={tituloTope.length > 10 ? 22 : 28}
          fontFamily={LETRA.tituloFuerte}
          letterSpacing={-0.5}
          fill={t.tinta}
        >
          {tituloTope}
        </TextoSvg>

        {/* Fondo del recipiente: vacio. Tocarlo suelta lo señalado. */}
        <Path d={SILUETA} fill={t.gris100} onPress={() => (mostrado !== null ? tocar(mostrado) : undefined)} />

        <G clipPath={`url(#${recorte})`}>
          {margenH > 0.5 && partes.length > 0 ? (
            <Rect
              x={0}
              y={yMargen}
              width={260}
              height={margenH}
              fill={t.exito500}
              opacity={mostrado === null || mostrado === 'margen' ? 0.85 : 0.45}
              onPress={() => tocar('margen')}
            />
          ) : null}
          {franjas.map((f) => (
            <G key={f.id} onPress={() => tocar(f.id)}>
              <Rect x={0} y={f.y} width={260} height={f.h} fill={f.color} opacity={mostrado === null ? 0.9 : mostrado === f.id ? 1 : 0.45} />
              {/* Un hilo del color de la superficie entre franja y franja:
                  aunque dos tonos se parezcan, se ve donde termina una. */}
              <Line x1={0} x2={260} y1={f.y} y2={f.y} stroke={t.superficie} strokeWidth={2} opacity={0.8} />
              {f.h >= 18 ? <Rotulo f={f} texto={formato(f.valor)} tinta={f.clara ? '#17181b' : '#ffffff'} /> : null}
            </G>
          ))}
          {desbordado ? (
            <>
              <Line x1={20} x2={240} y1={yTope} y2={yTope} stroke={t.peligro} strokeWidth={2} strokeDasharray="6 4" />
              <TextoSvg x={130} y={yTope - 6} textAnchor="middle" fontSize={11} fontFamily={LETRA.textoFuerte} fill={t.peligro}>
                {desbordeTexto}
              </TextoSvg>
            </>
          ) : null}
        </G>

        {/* El contorno, encima de todo: un pelo, no un marco. */}
        <Path d={SILUETA} fill="none" stroke={t.tinta} strokeOpacity={0.22} strokeWidth={2} strokeLinejoin="round" pointerEvents="none" />

        {partes.length === 0 && vacioTexto ? (
          <TextoSvg x={130} y={220} textAnchor="middle" fontSize={13} fontFamily={LETRA.texto} fill={t.suave}>
            {vacioTexto}
          </TextoSvg>
        ) : null}
        {margenH >= 22 && partes.length > 0 ? (
          <TextoSvg
            x={130}
            y={yMargen + margenH / 2 + 5}
            textAnchor="middle"
            fontSize={13}
            fontFamily={LETRA.textoFuerte}
            fill="#ffffff"
            pointerEvents="none"
          >
            {`${restoNombre} ${formato(tope - costo)}`}
          </TextoSvg>
        ) : null}
      </Svg>

      {/* El globo: que es esa franja y que parte se lleva, encima del dibujo
          y a la altura de la franja. */}
      {globo ? (
        <View pointerEvents="none" style={[estilos.globoCaja, { bottom: `${100 - (globo.y / 400) * 100}%` }]}>
          <View style={[estilos.globo, { backgroundColor: t.superficie, borderColor: t.gris200 }]}>
            <Text style={[estilos.globoTitulo, { color: t.tinta }]}>{globo.titulo}</Text>
            {globo.lineas.map((l) => (
              <Text key={l} style={[estilos.globoLinea, { color: t.suave }]}>
                {l}
              </Text>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  )
}

/**
 * El nombre y la cifra dentro de la franja. Si la franja es alta, el nombre
 * va entero (hasta dos renglones) y la cifra debajo; si es baja, todo en un
 * renglon.
 */
function Rotulo({ f, texto, tinta }: { f: { y: number; h: number; nombre: string }; texto: string; tinta: string }) {
  const comun = { fontSize: 11, fontFamily: LETRA.textoFuerte, fill: tinta, pointerEvents: 'none' as const }
  const lineas = renglones(f.nombre)
  const corto = f.nombre.length <= 16
  if (f.h < 34 || (lineas.length === 1 && corto)) {
    const nombre = f.h < 34 && !corto ? lineas[0] : f.nombre
    return (
      <>
        <TextoSvg x={48} y={f.y + f.h / 2 + 4} {...comun}>
          {nombre}
        </TextoSvg>
        {corto || f.h >= 34 ? (
          <TextoSvg x={212} y={f.y + f.h / 2 + 4} textAnchor="end" {...comun}>
            {texto}
          </TextoSvg>
        ) : null}
      </>
    )
  }
  const tres = lineas.length === 2 && f.h >= 48
  const paso = 14
  const total = (tres ? 3 : 2) * paso
  const y0 = f.y + f.h / 2 - total / 2 + 11
  return (
    <>
      <TextoSvg x={130} y={y0} textAnchor="middle" {...comun}>
        {tres ? lineas[0] : lineas.join(' ')}
      </TextoSvg>
      {tres ? (
        <TextoSvg x={130} y={y0 + paso} textAnchor="middle" {...comun}>
          {lineas[1]}
        </TextoSvg>
      ) : null}
      <TextoSvg x={130} y={y0 + (tres ? 2 : 1) * paso} textAnchor="middle" {...comun}>
        {texto}
      </TextoSvg>
    </>
  )
}

/**
 * La frase de abajo del vaso: cuanto queda y que parte del precio es. Verde
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
  queda: string
  pierde: string
  de: string
}) {
  const t = useTema()
  const resto = tope - costo
  const pct = tope > 0 ? (resto / tope) * 100 : 0
  const mal = resto < 0
  const color = mal ? t.peligro : t.exito
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={[estilos.resumen, { color }]}>{mal ? `${pierde} ${formato(Math.abs(resto))}` : `${queda} ${formato(resto)}`}</Text>
      <Text style={[estilos.resumenDetalle, { color }]}>
        {mal ? `el costo se pasa un ${Math.abs(pct).toFixed(0)}%` : `el ${pct.toFixed(0)}% ${de}`}
      </Text>
    </View>
  )
}

const estilos = StyleSheet.create({
  caja: { width: '100%', aspectRatio: 260 / 400, alignSelf: 'center' },
  globoCaja: { position: 'absolute', left: -20, right: -20, alignItems: 'center', marginBottom: 10 },
  globo: {
    borderWidth: 1,
    borderRadius: 14, borderCurve: 'continuous',
    paddingHorizontal: 12,
    paddingVertical: 8,
    boxShadow: '0 6px 14px rgba(0,0,0,0.18)',
  },
  globoTitulo: { fontFamily: LETRA.textoFuerte, fontSize: 13.5, marginBottom: 2 },
  globoLinea: { fontFamily: LETRA.texto, fontSize: 13 },
  resumen: { fontFamily: LETRA.titulo, fontSize: 19, letterSpacing: -0.3, textAlign: 'center' },
  resumenDetalle: { fontFamily: LETRA.textoFuerte, fontSize: 14, marginTop: 2, textAlign: 'center' },
})
