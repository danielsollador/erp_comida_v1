import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { inicialDelDia } from '../../lib/formato'
import { abrir, moduloDe } from '../../lib/modulos'
import { useMoneda } from '../../lib/moneda'
import { LETRA, useModo, useTema } from '../../lib/tema'
import type { PasoRecorrido, Recorrido as DatosRecorrido } from '../../lib/tipos'
import Icono from '../Icono'
import { Ficha } from '../ui'

/*
 * EL RECORRIDO DEL NEGOCIO, como components/Recorrido.tsx de la web: las cinco
 * estaciones en el orden en que se mueven la mercancia y la plata, una
 * pregunta y una frase por estacion, lo pendiente en ambar con su halo, y la
 * marca de "listo" en tinta. En el telefono la linea es vertical, como en la
 * web por debajo de 640 px. La entrada es la misma: la linea se llena y las
 * estaciones se encienden en fila. Solo la primera vez de la sesion.
 */

const ESTACIONES: { id: PasoRecorrido['id']; to: string }[] = [
  { id: 'compras', to: '/compras' },
  { id: 'inventario', to: '/inventario' },
  { id: 'menu', to: '/menu' },
  { id: 'ventas', to: '/ventas' },
  { id: 'caja', to: '/caja' },
]

const NODO = 46
const CURVA = Easing.bezier(0.2, 0.7, 0.2, 1)

// Una vez por sesion de la app: volver al inicio no repite la animacion.
let entradaContada = false

export default function Recorrido({
  datos,
  modulos,
}: {
  /** null = cargando; undefined = este rol no ve las frases. */
  datos: DatosRecorrido | null | undefined
  /** Las rutas a las que este usuario puede entrar. */
  modulos: string[]
}) {
  const t = useTema()
  const { fmt } = useMoneda()
  const [animar] = useState(() => !entradaContada)
  // Donde quedo el centro de cada punto: la via va del primero al ultimo,
  // aunque cada estacion tenga un alto distinto segun su texto.
  const [centros, setCentros] = useState<Record<number, number>>({})
  const listo = datos !== null
  useEffect(() => {
    if (listo && animar) entradaContada = true
  }, [listo, animar])

  const visibles = ESTACIONES.filter((e) => modulos.includes(e.to))
  if (visibles.length === 0) return null
  const pasoDe = (id: string) => datos?.pasos.find((p) => p.id === id)
  const pendientes = visibles.filter((e) => pasoDe(e.id)?.pendiente).length

  return (
    <Ficha style={estilos.ficha}>
      <View style={estilos.cabeza}>
        <Text style={[estilos.titulo, { color: t.tinta }]}>Tu negocio hoy</Text>
        {datos ? (
          <Text style={[estilos.pendientes, { color: pendientes ? t.avisoFuerte : t.suave }]}>
            {pendientes ? `${pendientes} ${pendientes === 1 ? 'cosa' : 'cosas'} por hacer` : 'Todo al día'}
          </Text>
        ) : null}
      </View>

      <View style={{ marginTop: 14 }}>
        {Object.keys(centros).length === visibles.length && (
          <Via desde={centros[0]} hasta={centros[visibles.length - 1]} animar={animar && listo} />
        )}
        {visibles.map((e, i) => {
          const m = moduloDe(e.to)!
          const p = pasoDe(e.id)
          return (
            <Estacion
              key={e.id}
              i={i}
              icono={m.icono}
              titulo={m.titulo}
              pregunta={m.pregunta}
              frase={p ? p.frase.replace('{monto}', fmt(p.monto ?? 0)) : ''}
              accion={p?.accion ?? ''}
              ojo={Boolean(p?.pendiente)}
              listo={listo}
              conMarca={Boolean(p && !p.pendiente)}
              animar={animar && listo}
              alMedir={(y) => setCentros((c) => (c[i] === y ? c : { ...c, [i]: y }))}
              alTocar={() => abrir(p?.a && p.a !== e.to ? p.a : e.to)}
            />
          )
        })}
      </View>
    </Ficha>
  )
}

/** La via vertical que une los puntos, y lo que se llena al entrar. */
function Via({ desde, hasta, animar }: { desde: number; hasta: number; animar: boolean }) {
  const t = useTema()
  const lleno = useSharedValue(animar ? 0 : 1)
  useEffect(() => {
    if (animar) lleno.set(withTiming(1, { duration: 1150, easing: CURVA }))
  }, [animar, lleno])
  const estilo = useAnimatedStyle(() => ({ transform: [{ scaleY: lleno.value }] }))
  // Del centro del primer punto al centro del ultimo.
  return (
    <View pointerEvents="none" style={[estilos.via, { top: desde, height: Math.max(hasta - desde, 0), backgroundColor: `${t.tinta}1f` }]}>
      <Animated.View style={[StyleSheet.absoluteFill, estilos.viaLleno, { backgroundColor: t.tinta }, estilo]} />
    </View>
  )
}


function Estacion({
  i,
  icono,
  titulo,
  pregunta,
  frase,
  accion,
  ojo,
  listo,
  conMarca,
  animar,
  alMedir,
  alTocar,
}: {
  i: number
  icono: import('../Icono').NombreIcono
  titulo: string
  pregunta: string
  frase: string
  accion: string
  ojo: boolean
  listo: boolean
  conMarca: boolean
  animar: boolean
  alMedir: (centro: number) => void
  alTocar: () => void
}) {
  const t = useTema()
  const { modo } = useModo()
  const enciende = useSharedValue(animar ? 0 : 1)
  const marca = useSharedValue(animar ? 0 : 1)

  useEffect(() => {
    if (!animar) return
    const retraso = 80 + i * 90
    enciende.set(withDelay(retraso, withTiming(1, { duration: 520, easing: CURVA })))
    marca.set(withDelay(retraso + 300, withSequence(withTiming(1.2, { duration: 280, easing: CURVA }), withTiming(1, { duration: 120 }))))
  }, [animar, i, enciende, marca])

  // vp-rec-enciende: de 0.8 a 1.06 y de vuelta a 1, de media luz a toda luz.
  const estiloNodo = useAnimatedStyle(() => {
    const v = enciende.value
    const escala = v < 0.6 ? 0.8 + (v / 0.6) * 0.26 : 1.06 - ((v - 0.6) / 0.4) * 0.06
    return { transform: [{ scale: escala }], opacity: 0.35 + Math.min(v / 0.6, 1) * 0.65 }
  })
  // vp-rec-texto: sube 5 px y se aclara.
  const estiloTexto = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - enciende.value) * 5 }],
    opacity: 0.3 + enciende.value * 0.7,
  }))
  const estiloMarca = useAnimatedStyle(() => ({ transform: [{ scale: marca.value }] }))

  const fondoNodo = ojo ? t.avisoSuave : modo === 'oscuro' ? '#1d2028' : '#f7f6f3'
  const bordeNodo = ojo ? '#cf8b21' : `${t.tinta}1f`

  return (
    <Pressable
      onPress={alTocar}
      onLayout={(e) => alMedir(Math.round(e.nativeEvent.layout.y + e.nativeEvent.layout.height / 2))}
      accessibilityLabel={`${titulo}. ${pregunta}${frase ? ` ${frase}` : ''}`}
      style={({ pressed }) => [estilos.estacion, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}
    >
      <Animated.View style={[estiloNodo, { opacity: listo ? undefined : 0.55 }]}>
        <View
          style={[
            estilos.nodo,
            { backgroundColor: fondoNodo, borderColor: bordeNodo },
            ojo && { shadowColor: '#cf8b21', shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
          ]}
        >
          <Icono nombre={icono} size={20} color={ojo ? t.aviso : t.fuerte} />
          {conMarca && (
            <Animated.View style={[estilos.marca, { backgroundColor: t.tinta, borderColor: t.superficie }, estiloMarca]}>
              <Icono nombre="ok" size={11} color={t.superficie} grosor={3} />
            </Animated.View>
          )}
        </View>
      </Animated.View>
      <Animated.View style={[{ flex: 1 }, estiloTexto]}>
        <Text style={[estilos.estacionTitulo, { color: t.tinta }]}>{titulo}</Text>
        <Text style={[estilos.pregunta, { color: t.suave }]}>{pregunta}</Text>
        {frase ? (
          <Text style={[estilos.frase, ojo ? { color: t.avisoFuerte, fontFamily: LETRA.textoFuerte } : { color: t.fuerte }]}>{frase}</Text>
        ) : null}
        {accion ? <Text style={[estilos.accion, { color: t.fuerte }]}>{accion} ›</Text> : null}
      </Animated.View>
    </Pressable>
  )
}

/**
 * Reportes en su propia fila, con la semana en barras al lado (como
 * FilaReportes de la web). Las barras crecen en ola al entrar, y el icono
 * hace de ecualizador al tocar.
 */
export function FilaReportes({ dias }: { dias?: { fecha: string; ventas: number }[] }) {
  const t = useTema()
  const { width } = useWindowDimensions()
  const conBarras = width >= 360 && dias && dias.length > 0
  const max = Math.max(...(dias ?? []).map((d) => d.ventas), 0)
  const [animar] = useState(() => !entradaFila)
  useEffect(() => {
    if (dias) entradaFila = true
  }, [dias])
  const toque = useSharedValue(0)

  return (
    <Pressable
      onPress={() => {
        toque.set(0)
        toque.set(withTiming(1, { duration: 520 }))
        abrir('/reportes')
      }}
      style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.985 : 1 }] }]}
    >
      <Ficha style={estilos.reportes}>
        <View style={[estilos.reportesIcono, { backgroundColor: t.acentoSuave }]}>
          <Ecualizador toque={toque} color={t.acento} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[estilos.reportesTitulo, { color: t.tinta }]}>Reportes</Text>
          <Text style={[estilos.pregunta, { color: t.suave }]}>¿Cómo va el negocio?</Text>
        </View>
        {conBarras && (
          <View>
            <View style={estilos.semana}>
              {dias!.map((d, i) => (
                <BarraDia
                  key={d.fecha}
                  i={i}
                  alto={max > 0 ? Math.max((d.ventas / max) * 34, d.ventas > 0 ? 3 : 2) : 2}
                  color={i === dias!.length - 1 ? '#bc6541' : t.barra}
                  animar={animar}
                />
              ))}
            </View>
            <View style={[estilos.semana, { height: undefined, marginTop: 4 }]}>
              {dias!.map((d, i) => (
                <Text key={d.fecha} style={[estilos.semanaLetra, { color: t.tenue }]} numberOfLines={1} adjustsFontSizeToFit>
                  {i === dias!.length - 1 ? 'Hoy' : inicialDelDia(d.fecha)}
                </Text>
              ))}
            </View>
          </View>
        )}
        <View style={[estilos.flecha, { backgroundColor: t.gris100 }]}>
          <Icono nombre="chevron" size={14} color={t.suave} />
        </View>
      </Ficha>
    </Pressable>
  )
}

let entradaFila = false

function BarraDia({ i, alto, color, animar }: { i: number; alto: number; color: string; animar: boolean }) {
  const crece = useSharedValue(animar ? 0 : 1)
  useEffect(() => {
    if (animar) crece.set(withDelay(550 + i * 60, withTiming(1, { duration: 550, easing: CURVA })))
  }, [animar, i, crece])
  const estilo = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - crece.value) * alto }], opacity: crece.value > 0 ? 1 : 0 }))
  return (
    <View style={{ flex: 1, height: 36, justifyContent: 'flex-end', overflow: 'hidden' }}>
      <Animated.View style={[{ height: alto, backgroundColor: color, borderTopLeftRadius: 3, borderTopRightRadius: 3, borderBottomLeftRadius: 1, borderBottomRightRadius: 1 }, estilo]} />
    </View>
  )
}

/** El icono de reportes: tres barras que bajan y suben al tocar (vp-rb-ecualiza). */
function Ecualizador({ toque, color }: { toque: { value: number }; color: string }) {
  const barras = [3, 12, 8]
  return (
    <View style={{ width: 20, height: 18, flexDirection: 'row', alignItems: 'flex-end', gap: 3 }}>
      {barras.map((h, k) => (
        <BarraEcualizador key={k} k={k} alto={h + 4} toque={toque} color={color} />
      ))}
    </View>
  )
}

function BarraEcualizador({ k, alto, toque, color }: { k: number; alto: number; toque: { value: number }; color: string }) {
  const estilo = useAnimatedStyle(() => {
    // Cada barra con su desfase: baja a 0.35, sube a 1.18 y se asienta.
    const v = Math.min(Math.max(toque.value * 1.3 - k * 0.12, 0), 1)
    const e = v === 0 || v === 1 ? 1 : v < 0.3 ? 1 - (v / 0.3) * 0.65 : v < 0.65 ? 0.35 + ((v - 0.3) / 0.35) * 0.83 : 1.18 - ((v - 0.65) / 0.35) * 0.18
    return { height: alto * e }
  })
  return <Animated.View style={[{ width: 3.5, borderRadius: 2, backgroundColor: color }, estilo]} />
}

const estilos = StyleSheet.create({
  ficha: { paddingHorizontal: 12, paddingTop: 16, paddingBottom: 10 },
  cabeza: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, paddingHorizontal: 4 },
  titulo: { fontFamily: LETRA.titulo, fontSize: 17, letterSpacing: -0.25 },
  pendientes: { fontFamily: LETRA.texto, fontSize: 13 },
  via: { position: 'absolute', left: 6 + NODO / 2 - 1.5, width: 3, borderRadius: 3, overflow: 'hidden' },
  viaLleno: { opacity: 0.28, transformOrigin: 'top' },
  estacion: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8, paddingHorizontal: 6 },
  nodo: { width: NODO, height: NODO, borderRadius: NODO / 2, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  marca: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 19,
    height: 19,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  estacionTitulo: { fontFamily: LETRA.titulo, fontSize: 14.5 },
  pregunta: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 1, lineHeight: 18 },
  frase: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 4, lineHeight: 18 },
  accion: { fontFamily: LETRA.textoFuerte, fontSize: 12, marginTop: 3 },
  reportes: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16 },
  reportesIcono: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  reportesTitulo: { fontFamily: LETRA.titulo, fontSize: 15 },
  semana: { flexDirection: 'row', gap: 5, width: 132, height: 36, alignItems: 'flex-end' },
  semanaLetra: { flex: 1, textAlign: 'center', fontFamily: LETRA.texto, fontSize: 10.5 },
  flecha: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
})
