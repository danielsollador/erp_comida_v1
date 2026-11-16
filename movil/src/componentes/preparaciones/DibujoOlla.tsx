import { Fragment, type ReactNode } from 'react'
import { Text, View } from 'react-native'
import Svg, { ClipPath, Defs, G, Path, Rect, Text as TextoSvg, TSpan } from 'react-native-svg'
import { unidadDe } from '../../../../frontend/src/lib/inventario'
import { LETRA, useTema } from '../../lib/tema'
import { fmtCant } from './cuentas'

/** Una franja de la olla. `detalle`: cuanto entra ("1 kg", "500 g", "2 unidades"); `medida`: cuanto queda ya cocido, en la unidad de la preparacion (null si no se mide como ella). */
export type FranjaOlla = { id: number; nombre: string; detalle: string; valor: number; medida: number | null; color: string }

// Geometria de la web (viewBox 260 x 400): boca en y=90, fondo en y=360.
const BOCA = 90
const FONDO = 360
const ALTO = FONDO - BOCA
const FINA = 26
const CUERPO = 'M40 90H220Q228 90 228 98V330Q228 360 198 360H62Q32 360 32 330V98Q32 90 40 90Z'
// El texto va en blanco sobre la franja, con un halo oscuro para que se lea
// sobre los tonos claros (en la web es `paint-order: stroke`, que el SVG del
// telefono no tiene: se dibuja dos veces, el halo debajo). Las franjas son
// las mismas en claro y en oscuro, asi que el blanco tambien.
const BLANCO = '#ffffff'
const HALO = 'rgba(0,0,0,0.25)'

// En la vista web, react-native-svg pasa los eventos de toque al <g> y React
// los rechaza (avisos en rojo): ahi la franja se resalta desde su renglon.
const tocable = process.env.EXPO_OS !== 'web'

const corto = (texto: string, max: number) => (texto.length > max ? `${texto.slice(0, max - 1)}…` : texto)

/**
 * LA OLLA DIBUJADA ES EL KILO (o el litro, o la unidad): llena = 1. Cada
 * franja mide lo que queda ya cocido de ese crudo, asi que con 1 kg de pernil
 * al 70 % la olla va por 0,7 y el resto lo llenan la tocineta y el maiz
 * (Leider, 11-oct: "limite un kg, para que se entienda la receta"). Lo que no
 * se mide como la preparacion (una crema en un guiso en kilos) va como franja
 * fina. El costo va a la derecha de cada franja. Sin margen, porque una
 * preparacion no se vende: solo cuesta.
 *
 * En la web se pasa el cursor por una franja para ver su detalle; aqui se
 * toca (y otro toque la suelta). La linea de abajo va fuera del dibujo, como
 * texto de la pantalla: asi se parte en dos renglones si hace falta y no
 * baja de 13 px.
 */
export default function DibujoOlla({
  partes,
  total,
  unidad,
  formato,
  resaltado,
  alResaltar,
  ancho,
  agregarAbajo = false,
}: {
  partes: FranjaOlla[]
  total: number
  unidad: string
  formato: (n: number) => string
  resaltado: number | null
  alResaltar: (id: number | null) => void
  /** El ancho en pantalla; el alto sale de la proporcion de la olla. */
  ancho: number
  /** Donde esta la lista para agregar: a la derecha en la tablet (como la web), abajo en el telefono. */
  agregarAbajo?: boolean
}) {
  const t = useTema()
  const medibles = partes.filter((x) => x.medida !== null)
  const sumaMedida = medibles.reduce((s, x) => s + (x.medida ?? 0), 0)
  // Las franjas finas se reservan primero; el resto de la olla es el kilo.
  const disponible = ALTO - (partes.length - medibles.length) * FINA
  // Si lo que queda se pasa del kilo, se aprieta todo para que quepa y abajo se avisa.
  const porUnidad = sumaMedida > 1 ? disponible / sumaMedida : disponible
  const alturas = partes.map((x) => (x.medida === null ? FINA : x.medida > 0 ? Math.max(x.medida * porUnidad, 6) : 0))
  // De abajo hacia arriba: cada franja empieza donde termina la anterior.
  const franjas = partes.map((x, i) => {
    const h = alturas[i]
    const y = FONDO - alturas.slice(0, i + 1).reduce((s, a) => s + a, 0)
    return { ...x, y, h }
  })
  const vacia = partes.length === 0
  const mostrada = franjas.find((f) => f.id === resaltado)
  const sePasa = sumaMedida > 1.02
  const pie = sePasa
    ? `se pasa: queda ${fmtCant(sumaMedida)} ${unidadDe(sumaMedida, unidad)} y la olla es 1 ${unidad}`
    : mostrada
      ? mostrada.medida !== null
        ? `${mostrada.nombre}: ${fmtCant(mostrada.medida)} ${unidadDe(mostrada.medida, unidad)} del ${unidad} · ${formato(mostrada.valor)}`
        : `${mostrada.nombre}: ${formato(mostrada.valor)}`
      : `1 ${unidad} cuesta ${formato(total)}`

  /** Un texto blanco con su halo: primero el halo, encima la letra. */
  const rotulo = (clave: string, props: { x: number; y: number; ancla?: 'end' }, contenido: () => ReactNode, letra: string, tam: number) => (
    <Fragment key={clave}>
      {[true, false].map((halo) => (
        <TextoSvg
          key={halo ? 'h' : 'l'}
          x={props.x}
          y={props.y}
          textAnchor={props.ancla ?? 'start'}
          fontFamily={letra}
          fontSize={tam}
          fill={halo ? HALO : BLANCO}
          stroke={halo ? HALO : undefined}
          strokeWidth={halo ? 2.4 : undefined}
          strokeLinejoin="round"
        >
          {contenido()}
        </TextoSvg>
      ))}
    </Fragment>
  )

  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <Svg
        width={ancho}
        height={(ancho * 400) / 260}
        viewBox="0 0 260 400"
        accessibilityLabel={`Lo que lleva 1 ${unidad}, por lo que cuesta cada ingrediente`}
      >
        <Defs>
          <ClipPath id="olla-cuerpo">
            <Path d={CUERPO} />
          </ClipPath>
        </Defs>
        {/* Las asas */}
        <Path d="M32 150H14Q6 150 6 158V190Q6 198 14 198H32" fill="none" stroke={t.barra} strokeWidth={6} strokeLinecap="round" />
        <Path d="M228 150H246Q254 150 254 158V190Q254 198 246 198H228" fill="none" stroke={t.barra} strokeWidth={6} strokeLinecap="round" />
        {/* El cuerpo */}
        <Path d={CUERPO} fill={t.gris100} />
        <G clipPath="url(#olla-cuerpo)">
          {franjas.map((f) => (
            <G key={f.id} {...(tocable ? { onPress: () => alResaltar(resaltado === f.id ? null : f.id) } : {})}>
              <Rect x={32} y={f.y} width={196} height={f.h} fill={f.color} opacity={resaltado !== null && resaltado !== f.id ? 0.45 : 1} />
              {/* El nombre y, debajo, cuanto entra; si la franja es baja, en
                  una sola linea. El costo va a la derecha. */}
              {f.h >= 42
                ? rotulo(
                    `n${f.id}`,
                    { x: 44, y: f.y + f.h / 2 - 3 },
                    () => (
                      <>
                        <TSpan>{corto(f.nombre, 19)}</TSpan>
                        {f.detalle ? (
                          <TSpan x={44} dy={15} fontFamily={LETRA.texto} fontSize={11.5}>
                            {f.detalle}
                          </TSpan>
                        ) : null}
                      </>
                    ),
                    LETRA.textoFuerte,
                    12.5,
                  )
                : f.h >= 26
                  ? rotulo(`n${f.id}`, { x: 44, y: f.y + f.h / 2 + 4.5 }, () => corto(f.detalle ? `${f.nombre} · ${f.detalle}` : f.nombre, 21), LETRA.textoFuerte, 12)
                  : null}
              {f.h >= 26 ? rotulo(`c${f.id}`, { x: 216, y: f.y + f.h / 2 + 4.5, ancla: 'end' }, () => formato(f.valor), LETRA.cifraFuerte, 11.5) : null}
            </G>
          ))}
        </G>
        <Path d={CUERPO} fill="none" stroke={t.barra} strokeWidth={2} />
        {/* La tapa: la receta es para 1 */}
        <Rect x={26} y={78} width={208} height={12} rx={6} fill={t.barra} />
        <TextoSvg x={130} y={40} textAnchor="middle" fontSize={13} fontFamily={LETRA.texto} fill={t.suave}>
          para
        </TextoSvg>
        <TextoSvg x={130} y={68} textAnchor="middle" fontSize={26} fontFamily={LETRA.tituloFuerte} fill={t.tinta}>
          {`1 ${unidad}`}
        </TextoSvg>
        {vacia ? (
          <TextoSvg x={130} y={230} textAnchor="middle" fontSize={13} fontFamily={LETRA.texto} fill={t.tenue}>
            {agregarAbajo ? 'Toca abajo lo que lleva' : 'Toca a la derecha lo que lleva'}
          </TextoSvg>
        ) : null}
      </Svg>
      {!vacia ? (
        <Text style={{ fontFamily: LETRA.texto, fontSize: 13.5, textAlign: 'center', color: sePasa ? t.aviso : t.suave }}>{pie}</Text>
      ) : null}
    </View>
  )
}
