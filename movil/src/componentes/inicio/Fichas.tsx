import * as almacen from '../../lib/almacen'
import { useEffect, useState } from 'react'
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native'
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg'
import { abrir } from '../../lib/modulos'
import { LETRA, useModo, useTema } from '../../lib/tema'
import type { ArranqueLocal, Aviso } from '../../lib/tipos'
import Icono, { type NombreIcono } from '../Icono'
import { Ficha } from '../ui'

/*
 * Las fichas del inicio, copiadas de pages/Inicio.tsx, components/Avisos.tsx y
 * components/Arranque.tsx de la web.
 */

/** Lo que espera a alguien: en cero se queda callada; con algo dentro se enciende. */
export function Espera({ titulo, valor, nota, to }: { titulo: string; valor: number | null; nota: string; to?: string }) {
  const t = useTema()
  const hay = (valor ?? 0) > 0
  const cuerpo = (
    <Ficha
      tono={hay ? 'aviso' : undefined}
      style={[{ padding: 16, flex: 1, justifyContent: 'center' }, hay && { boxShadow: '0 10px 22px rgba(185,108,0,0.3)' }]}
    >
      <Text style={[estilos.esperaTitulo, { color: hay ? t.avisoFuerte : t.suave }]}>{titulo}</Text>
      <Text style={[estilos.esperaValor, { color: hay ? t.avisoFuerte : t.tinta }]}>{valor === null ? '—' : valor}</Text>
      <Text style={[estilos.esperaNota, { color: hay ? t.aviso : t.tenue }]}>{nota}</Text>
    </Ficha>
  )
  if (!to) return <View style={{ flex: 1 }}>{cuerpo}</View>
  return (
    <Pressable
      onPress={() => abrir(to)}
      accessibilityRole="button"
      accessibilityLabel={titulo}
      style={({ pressed }) => [{ flex: 1, transform: [{ scale: pressed ? 0.985 : 1 }] }]}
    >
      {cuerpo}
    </Pressable>
  )
}

/**
 * "¿Sabías que…?": lo que el sistema avisa solo. Cada aviso se quita
 * deslizandolo de lado (Leider, 22-oct: "son tan invasivos"). Lo quitado se
 * recuerda en el telefono por su texto: si el aviso cambia (otro monto,
 * otras mercancias), vuelve a salir, porque ya es otra noticia.
 */
const CLAVE_QUITADOS = 'vp_avisos_quitados'
const claveAviso = (a: Aviso) => `${a.id}|${a.titulo}`

export function Avisos({ lista }: { lista: Aviso[] }) {
  const t = useTema()
  const [quitados, setQuitados] = useState<string[] | null>(null)
  useEffect(() => {
    almacen
      .leer(CLAVE_QUITADOS)
      .then((v) => setQuitados(v ? (JSON.parse(v) as string[]) : []))
      .catch(() => setQuitados([]))
  }, [])
  if (quitados === null) return null
  const visibles = lista.filter((a) => !quitados.includes(claveAviso(a)))
  if (visibles.length === 0) return null
  const quitar = (a: Aviso) => {
    // Solo se guardan los de la lista de hoy: lo viejo no se acumula.
    const hoy = new Set(lista.map(claveAviso))
    const nuevos = [...quitados.filter((k) => hoy.has(k)), claveAviso(a)]
    setQuitados(nuevos)
    almacen.guardar(CLAVE_QUITADOS, JSON.stringify(nuevos)).catch(() => undefined)
  }
  return (
    <View style={{ gap: 10 }}>
      <Text style={[estilos.etiqueta, { color: t.tenue, marginTop: 2 }]}>¿Sabías que…? · desliza para quitar</Text>
      {visibles.map((a) => (
        <AvisoDeslizable key={claveAviso(a)} a={a} alQuitar={() => quitar(a)} />
      ))}
    </View>
  )
}

/** Un aviso que sigue al dedo de lado; pasado un cuarto del ancho (o con un toque rapido), se va. */
function AvisoDeslizable({ a, alQuitar }: { a: Aviso; alQuitar: () => void }) {
  const t = useTema()
  const { width } = useWindowDimensions()
  const x = useSharedValue(0)
  // El gesto (que se arma una sola vez) solo marca que se fue; el aviso se
  // quita de la lista despues de que termina de salir.
  const [ido, setIdo] = useState(false)
  useEffect(() => {
    if (!ido) return
    const id = setTimeout(alQuitar, 190)
    return () => clearTimeout(id)
  }, [ido, alQuitar])
  const [pan] = useState(() =>
    PanResponder.create({
      // Solo un gesto claramente de lado: el desplazamiento vertical sigue siendo de la lista.
      // Basta un gesto mas de lado que de arriba abajo, y se toma ANTES que la
      // lista (capture): si no, el desplazamiento vertical se quedaba con el
      // dedo y habia que deslizar "casi perfecto" (Leider, 22-oct).
      onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
      // Una vez de lado, la lista no se lo quita a medio camino.
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => x.set(g.dx),
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dx) > width / 4 || Math.abs(g.vx) > 0.35) {
          x.set(withTiming(Math.sign(g.dx || 1) * width, { duration: 180 }))
          setIdo(true)
        } else {
          x.set(withSpring(0))
        }
      },
      onPanResponderTerminate: () => x.set(withSpring(0)),
    }),
  )
  const estilo = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
    opacity: 1 - Math.min(Math.abs(x.value) / width, 1),
  }))

  const tono = a.tono === 'ojo' ? 'aviso' : undefined
  const fondo = a.tono === 'bien' ? { backgroundColor: t.exitoSuave, borderColor: t.exitoSuave } : undefined
  const punto = a.tono === 'ojo' ? t.aviso : a.tono === 'bien' ? t.exito500 : t.acento
  const tinta = a.tono === 'ojo' ? t.avisoFuerte : a.tono === 'bien' ? t.exito : t.tinta
  return (
    <Animated.View {...pan.panHandlers} style={estilo}>
      <Pressable
        onPress={() => a.a && abrir(a.a)}
        accessibilityRole="button"
        accessibilityLabel={a.titulo}
        accessibilityHint="Desliza de lado para quitar este aviso"
        accessibilityActions={[{ name: 'quitar', label: 'Quitar aviso' }]}
        onAccessibilityAction={(e) => e.nativeEvent.actionName === 'quitar' && alQuitar()}
        style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.985 : 1 }] }]}
      >
        <Ficha tono={tono} style={[estilos.aviso, fondo]}>
          <View style={[estilos.avisoPunto, { backgroundColor: punto }]} />
          <View style={{ flex: 1 }}>
            <Text style={[estilos.avisoTitulo, { color: tinta }]}>{a.titulo}</Text>
            {a.detalle ? <Text style={[estilos.avisoDetalle, { color: tinta }]}>{a.detalle}</Text> : null}
          </View>
          <View style={[estilos.avisoFlecha, { backgroundColor: 'rgba(0,0,0,0.05)' }]}>
            <Icono nombre="chevron" size={14} color={tinta} />
          </View>
        </Ficha>
      </Pressable>
    </Animated.View>
  )
}

/** Las misiones de arranque: solo mientras el local se arma, y se pueden ocultar. */
const CLAVE_OCULTO = 'vp-arranque-oculto'

function pasos(a: ArranqueLocal) {
  return [
    { id: 'productos', titulo: 'Carga lo que vendes', detalle: a.productos >= 5 ? `${a.productos} productos en el menú` : `${a.productos} de 5 productos para empezar`, a: '/menu', hecho: a.productos >= 5 },
    { id: 'mercancia', titulo: 'Anota tu mercancía', detalle: a.mercancias ? `${a.mercancias} en el depósito` : 'Harina, queso, vasos: con lo que cocinas', a: '/inventario', hecho: a.mercancias >= 1 },
    { id: 'receta', titulo: 'Ponle receta a un producto', detalle: a.con_receta ? `${a.con_receta} con receta` : 'Y descubre cuánto te deja cada uno', a: '/menu/recetas', hecho: a.con_receta >= 1 },
    { id: 'venta', titulo: 'Haz tu primera venta', detalle: a.ventas ? `${a.ventas} vendidas` : 'Desde el punto de venta', a: '/pos', hecho: a.ventas >= 1 },
    { id: 'caja', titulo: 'Cierra tu primera caja', detalle: a.cierres ? `${a.cierres} cierres` : 'Cuenta la gaveta y cuadra el día', a: '/caja', hecho: a.cierres >= 1 },
  ]
}

export function Arranque({ datos }: { datos: ArranqueLocal | null }) {
  const t = useTema()
  const [oculto, setOculto] = useState<boolean | null>(null)
  useEffect(() => {
    almacen.leer(CLAVE_OCULTO)
      .then((v) => setOculto(v === '1'))
      .catch(() => setOculto(false))
  }, [])
  if (!datos || oculto !== false) return null
  const lista = pasos(datos)
  const hechos = lista.filter((p) => p.hecho).length
  if (hechos === lista.length) return null
  const siguiente = lista.find((p) => !p.hecho)!
  return (
    <Ficha>
      <Text style={[estilos.etiqueta, { color: t.tenue }]}>Para arrancar</Text>
      <Text style={[estilos.arranqueTitulo, { color: t.tinta }]}>{siguiente.titulo}</Text>
      <Text style={[estilos.esperaNota, { color: t.suave, marginTop: 4 }]}>
        {hechos} de {lista.length} pasos · {siguiente.detalle}
      </Text>
      <View style={[estilos.arranqueBarra, { backgroundColor: t.gris100 }]}>
        <View style={{ width: `${(hechos / lista.length) * 100}%`, height: '100%', borderRadius: 4, backgroundColor: t.exito500 }} />
      </View>
      <View style={{ gap: 6, marginTop: 14 }}>
        {lista.map((p, i) => {
          const actual = p.id === siguiente.id
          return (
            <Pressable
              key={p.id}
              onPress={() => abrir(p.a)}
              accessibilityRole="button"
              accessibilityLabel={p.titulo}
              style={[estilos.paso, actual && { backgroundColor: t.acentoSuave }]}
            >
              <View
                style={[
                  estilos.pasoPunto,
                  { backgroundColor: p.hecho ? t.exito500 : actual ? t.acento400 : t.gris100 },
                ]}
              >
                {p.hecho ? (
                  <Icono nombre="ok" size={13} color={t.acentoTinta} grosor={3} />
                ) : (
                  <Text style={[estilos.pasoNumero, { color: actual ? t.acentoTinta : t.suave }]}>{i + 1}</Text>
                )}
              </View>
              <Text
                style={[
                  estilos.pasoTexto,
                  { color: p.hecho ? t.tenue : t.tinta, textDecorationLine: p.hecho ? 'line-through' : 'none' },
                  actual && { fontFamily: LETRA.textoFuerte },
                ]}
              >
                {p.titulo}
              </Text>
            </Pressable>
          )
        })}
      </View>
      <View style={estilos.arranquePie}>
        <Pressable
          onPress={() => abrir(siguiente.a)}
          accessibilityRole="button"
          accessibilityLabel={`Ir a ${siguiente.titulo}`}
          style={[estilos.ir, { backgroundColor: t.tinta }]}
        >
          <Text style={[estilos.irTexto, { color: t.papel }]}>Ir</Text>
          <View style={[estilos.irFlecha, { backgroundColor: 'rgba(255,255,255,0.12)' }]}>
            <Icono nombre="chevron" size={14} color={t.papel} />
          </View>
        </Pressable>
        <Pressable
          onPress={() => {
            setOculto(true)
            almacen.guardar(CLAVE_OCULTO, '1').catch(() => undefined)
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Ocultar"
        >
          <Text style={[estilos.esperaNota, { color: t.suave }]}>Ocultar</Text>
        </Pressable>
      </View>
    </Ficha>
  )
}

/**
 * Ficha de "vender". La primera --el punto de venta-- va en tinta llena con
 * la luz de la marca detras, y la luz sigue al dedo mientras se toca (en la
 * web sigue al raton). La de Cocina tiene su llama: se mueve como fuego
 * mientras se toca, y una luz calida aparece detras.
 */
export function TarjetaVender({
  to,
  icono,
  titulo,
  desc,
  principal,
}: {
  to: string
  icono: NombreIcono
  titulo: string
  desc: string
  principal: boolean
}) {
  const t = useTema()
  const { modo } = useModo()
  const [caja, setCaja] = useState({ w: 1, h: 1 })
  const luzX = useSharedValue(0)
  const luzY = useSharedValue(0)
  const encendida = useSharedValue(0)
  const llama = useSharedValue(0)
  const esCocina = icono === 'cocina'

  const seguir = (e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent
    const x = locationX / caja.w - 0.5
    const y = locationY / caja.h - 0.5
    luzX.set(withSpring(Math.round(x * caja.w * 0.45), { damping: 18 }))
    luzY.set(withSpring(Math.round(y * caja.h * 0.55), { damping: 18 }))
  }
  const empezar = (e: GestureResponderEvent) => {
    seguir(e)
    encendida.set(withTiming(1, { duration: 220 }))
    if (esCocina) {
      llama.set(0)
      llama.set(withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }), -1, false))
    }
  }
  const soltar = () => {
    luzX.set(withSpring(0, { damping: 16 }))
    luzY.set(withSpring(0, { damping: 16 }))
    encendida.set(withTiming(0, { duration: 400 }))
    if (esCocina) {
      cancelAnimation(llama)
      llama.set(withTiming(0, { duration: 250 }))
    }
  }

  const estiloLuz = useAnimatedStyle(() => ({
    transform: [{ translateX: luzX.value }, { translateY: luzY.value }],
    opacity: principal ? 0.45 + encendida.value * 0.2 : encendida.value * (modo === 'oscuro' ? 0.16 : 0.22) * 4,
  }))
  // vp-llama: gira y se estira como fuego (0 → 25 → 50 → 75 → 100 %).
  const estiloLlama = useAnimatedStyle(() => {
    const v = llama.value
    const tramo = (a: number, b: number, desde: number, hasta: number) => a + ((v - desde) / (hasta - desde)) * (b - a)
    let rot = 0
    let sx = 1
    let sy = 1
    if (v <= 0.25) {
      rot = tramo(0, -5, 0, 0.25)
      sx = tramo(1, 0.97, 0, 0.25)
      sy = tramo(1, 1.05, 0, 0.25)
    } else if (v <= 0.5) {
      rot = tramo(-5, 3, 0.25, 0.5)
      sx = tramo(0.97, 1.02, 0.25, 0.5)
      sy = tramo(1.05, 0.97, 0.25, 0.5)
    } else if (v <= 0.75) {
      rot = tramo(3, -2, 0.5, 0.75)
      sx = tramo(1.02, 0.98, 0.5, 0.75)
      sy = tramo(0.97, 1.04, 0.5, 0.75)
    } else {
      rot = tramo(-2, 0, 0.75, 1)
      sx = tramo(0.98, 1, 0.75, 1)
      sy = tramo(1.04, 1, 0.75, 1)
    }
    return { transform: [{ rotate: `${rot}deg` }, { scaleX: sx }, { scaleY: sy }] }
  })

  const fondo = principal ? t.fichaPrincipal : t.superficie
  const tinta = principal ? t.fichaPrincipalTinta : t.tinta
  const tintaSuave = principal ? (modo === 'oscuro' ? 'rgba(14,16,20,0.6)' : 'rgba(255,255,255,0.65)') : t.suave
  const colorLuz = principal ? t.acento : t.acento400

  return (
    <Pressable
      onPress={() => abrir(to)}
      onPressIn={empezar}
      onTouchMove={seguir}
      onPressOut={soltar}
      onLayout={(e: LayoutChangeEvent) => setCaja({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      accessibilityRole="button"
      accessibilityLabel={`${titulo}. ${desc}`}
      style={({ pressed }) => [
        estilos.vender,
        {
          backgroundColor: fondo,
          borderColor: principal ? 'transparent' : modo === 'oscuro' ? 'rgba(255,255,255,0.06)' : t.linea,
          boxShadow: `0 14px 24px rgba(23,24,27,${principal ? 0.45 : 0.12})`,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}
    >
      {/* La luz de la marca (punto de venta, arriba a la derecha) o la calida de cocina (arriba a la izquierda). */}
      <Animated.View
        pointerEvents="none"
        style={[principal ? estilos.luzPrincipal : estilos.luzCocina, estiloLuz]}
      >
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id={`luz-${icono}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={colorLuz} stopOpacity={1} />
              <Stop offset="0.55" stopColor={colorLuz} stopOpacity={0.45} />
              <Stop offset="1" stopColor={colorLuz} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#luz-${icono})`} />
        </Svg>
      </Animated.View>

      <View
        style={[
          estilos.venderIcono,
          principal
            ? { backgroundColor: modo === 'oscuro' ? 'rgba(14,16,20,0.08)' : 'rgba(255,255,255,0.1)', borderColor: modo === 'oscuro' ? 'transparent' : 'rgba(255,255,255,0.18)', borderTopWidth: 1 }
            : { backgroundColor: t.acentoSuave },
        ]}
      >
        <Animated.View style={[{ transformOrigin: '50% 85%' }, esCocina && estiloLlama]}>
          <Icono nombre={icono} size={22} color={principal ? tinta : t.acento} />
        </Animated.View>
      </View>
      <View>
        <Text style={[estilos.venderTitulo, { color: tinta }]}>{titulo}</Text>
        <Text style={[estilos.venderDesc, { color: tintaSuave }]}>{desc}</Text>
      </View>
      <View style={estilos.abrir}>
        <View
          style={[
            estilos.abrirFlecha,
            { backgroundColor: principal ? (modo === 'oscuro' ? 'rgba(14,16,20,0.08)' : 'rgba(255,255,255,0.12)') : t.gris100 },
          ]}
        >
          <Icono nombre="chevron" size={14} color={principal ? tinta : t.suave} />
        </View>
        <Text style={[estilos.abrirTexto, { color: principal ? tintaSuave : t.tenue }]}>Abrir</Text>
      </View>
    </Pressable>
  )
}


const estilos = StyleSheet.create({
  etiqueta: { fontFamily: LETRA.textoFuerte, fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase' },
  esperaTitulo: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
  esperaValor: { fontFamily: LETRA.tituloFuerte, fontSize: 32, letterSpacing: -0.6, marginTop: 6, lineHeight: 36 },
  esperaNota: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 6, lineHeight: 18 },
  aviso: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 16 },
  avisoPunto: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  avisoTitulo: { fontFamily: LETRA.titulo, fontSize: 15, lineHeight: 21 },
  avisoDetalle: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 4, lineHeight: 18, opacity: 0.75 },
  avisoFlecha: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', opacity: 0.6 },
  arranqueTitulo: { fontFamily: LETRA.tituloFuerte, fontSize: 20, marginTop: 4, letterSpacing: -0.4 },
  arranqueBarra: { height: 8, borderRadius: 4, marginTop: 14, overflow: 'hidden' },
  paso: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 14, borderCurve: 'continuous' },
  pasoPunto: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  pasoNumero: { fontFamily: LETRA.textoFuerte, fontSize: 12 },
  pasoTexto: { fontFamily: LETRA.texto, fontSize: 14.5 },
  arranquePie: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 14 },
  ir: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, paddingLeft: 16, paddingRight: 6, paddingVertical: 6 },
  irTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14 },
  irFlecha: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  vender: {
    borderRadius: 24, borderCurve: 'continuous',
    padding: 20,
    minHeight: 150,
    gap: 14,
    overflow: 'hidden',
    borderWidth: 1,
  },
  luzPrincipal: { position: 'absolute', right: -60, top: -60, width: 220, height: 220 },
  luzCocina: { position: 'absolute', left: -50, top: -50, width: 200, height: 200 },
  venderIcono: { width: 46, height: 46, borderRadius: 15, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  venderTitulo: { fontFamily: LETRA.titulo, fontSize: 19, letterSpacing: -0.3 },
  venderDesc: { fontFamily: LETRA.texto, fontSize: 14, marginTop: 3 },
  abrir: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 'auto' },
  abrirFlecha: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  abrirTexto: { fontFamily: LETRA.textoFuerte, fontSize: 12 },
  contador: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderCurve: 'continuous', paddingHorizontal: 12, paddingVertical: 10, minHeight: 52, borderWidth: 1 },
  contadorIcono: { width: 36, height: 36, borderRadius: 11, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  contadorTitulo: { fontFamily: LETRA.titulo, fontSize: 14 },
  contadorDesc: { fontFamily: LETRA.texto, fontSize: 12.5, marginTop: 1 },
})
