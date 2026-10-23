import { router, usePathname, type Href } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { PasoGuia } from '../../lib/api-ia'
import { cerrarGuia, pasoAtras, registrosDe, rutaApp, siguientePaso, useGuia } from '../../lib/guia'
import { LETRA, useTema } from '../../lib/tema'
import { SelloIA } from '../ia'

/**
 * La capa de la guía: oscurece la pantalla menos el elemento del paso, lo
 * rodea con un anillo y muestra la tarjeta (paso n de N, qué hacer, Atrás /
 * Siguiente / Salir). Nada de la capa toma los toques salvo la tarjeta: el
 * dueño toca el botón resaltado y lo hace él mismo, como en la web.
 *
 * Se monta en el Stack (`hoja` = null) y dentro de cada hoja (Modal) con el
 * id de la hoja: cada capa resalta solo las anclas montadas en su mismo
 * sitio, y si el elemento del paso está en otra, se calla.
 */
export function CapaGuia({ hoja = null }: { hoja?: string | null }) {
  const { pasos, i } = useGuia()
  if (!pasos.length) return null
  // Un paso nuevo es un recorrido nuevo: se monta de cero y no arrastra la
  // caja ni el "no lo veo" del anterior.
  return <Recorrido key={i} paso={pasos[i]} n={i} total={pasos.length} hoja={hoja} />
}

type Caja = { x: number; y: number; w: number; h: number }
const M = 8
const ESPERA_MS = 4000
const VELO = 'rgba(0,0,0,0.55)'

function Recorrido({ paso, n, total, hoja }: { paso: PasoGuia; n: number; total: number; hoja: string | null }) {
  const t = useTema()
  const borde = useSafeAreaInsets()
  const pathname = usePathname()
  const marco = useRef<View>(null)
  const [alto, setAlto] = useState(0)
  const [caja, setCaja] = useState<Caja | null>(null)
  const [enOtra, setEnOtra] = useState(false)
  const [perdido, setPerdido] = useState(false)
  const tocar = (paso.accion ?? 'tocar') === 'tocar'

  // 1. Llevar a la pantalla del paso si no estamos ya en ella o en una de sus
  //    pestañas (/compras/nueva cuenta como /compras). Solo lo hace la capa
  //    de fondo: las hojas no navegan.
  useEffect(() => {
    if (hoja !== null) return
    const ruta = rutaApp(paso.ruta)
    if (ruta && pathname !== ruta && !pathname.startsWith(ruta + '/')) router.push(ruta as Href)
  }, [paso.ruta, pathname, hoja])

  // 2. Buscar el elemento cada rato (puede aparecer cuando el dueño haga el
  //    paso anterior, o moverse si desplaza la lista) y medirlo contra esta
  //    capa, que en una hoja no empieza en el borde de la ventana.
  useEffect(() => {
    const inicio = Date.now()
    let vivo = true
    const medir = () => {
      const todos = registrosDe(paso.ancla)
      const mios = todos.filter((r) => r.hoja === hoja && r.ref.current)
      if (!mios.length) {
        setCaja(null)
        setEnOtra(todos.length > 0)
        if (Date.now() - inicio > ESPERA_MS) setPerdido(true)
        return
      }
      mios[0].ref.current?.measureInWindow((x, y, w, h) => {
        if (!vivo || !(w > 0 && h > 0)) return
        marco.current?.measureInWindow((mx, my) => {
          if (!vivo) return
          const nueva = { x: x - mx, y: y - my, w, h }
          setCaja((antes) => (antes && antes.x === nueva.x && antes.y === nueva.y && antes.w === nueva.w && antes.h === nueva.h ? antes : nueva))
          setEnOtra(false)
          setPerdido(false)
        })
      })
    }
    const primero = setTimeout(medir, 150)
    const cada = setInterval(medir, 300)
    return () => {
      vivo = false
      clearTimeout(primero)
      clearInterval(cada)
    }
  }, [paso.ancla, hoja])

  // El anillo late en los pasos de tocar: "aquí".
  const pulso = useSharedValue(1)
  useEffect(() => {
    pulso.value = tocar ? withRepeat(withTiming(0.35, { duration: 700, easing: Easing.inOut(Easing.quad) }), -1, true) : 1
  }, [tocar, pulso])
  const estiloAnillo = useAnimatedStyle(() => ({ opacity: pulso.value }))

  if (enOtra) return null

  // La tarjeta va abajo; arriba si lo señalado está en la mitad de abajo.
  const arriba = !!caja && alto > 0 && caja.y + caja.h / 2 > alto * 0.55
  const ultimo = n + 1 >= total

  return (
    <View
      ref={marco}
      collapsable={false}
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
      onLayout={(e) => setAlto(e.nativeEvent.layout.height)}
    >
      {caja ? (
        <>
          <View pointerEvents="none" style={[c.velo, { top: 0, left: 0, right: 0, height: Math.max(0, caja.y - M) }]} />
          <View pointerEvents="none" style={[c.velo, { top: caja.y + caja.h + M, left: 0, right: 0, bottom: 0 }]} />
          <View pointerEvents="none" style={[c.velo, { top: caja.y - M, left: 0, width: Math.max(0, caja.x - M), height: caja.h + M * 2 }]} />
          <View pointerEvents="none" style={[c.velo, { top: caja.y - M, left: caja.x + caja.w + M, right: 0, height: caja.h + M * 2 }]} />
          <Animated.View
            pointerEvents="none"
            style={[c.anillo, { top: caja.y - M, left: caja.x - M, width: caja.w + M * 2, height: caja.h + M * 2 }, estiloAnillo]}
          />
        </>
      ) : (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: VELO }]} />
      )}

      <View
        accessibilityRole="alert"
        accessibilityLabel={`Paso ${n + 1} de ${total}: ${paso.titulo}`}
        style={[c.tarjeta, { backgroundColor: t.superficie }, arriba ? { top: 12 + borde.top } : { bottom: 12 + borde.bottom }]}
      >
        <View style={c.cabeza}>
          <SelloIA tam={26} />
          <Text style={[c.contador, { color: t.suave }]}>
            Paso {n + 1} de {total}
          </Text>
        </View>
        <View style={c.barras}>
          {Array.from({ length: total }, (_, k) => (
            <View key={k} style={[c.barra, { backgroundColor: k <= n ? t.acento : t.gris200 }]} />
          ))}
        </View>
        <Text style={[c.titulo, { color: t.tinta }]}>{paso.titulo}</Text>
        <Text style={[c.texto, { color: t.fuerte }]}>{paso.texto}</Text>
        {perdido && !caja ? (
          <View style={[c.aviso, { backgroundColor: t.avisoSuave }]}>
            <Text style={[c.avisoTexto, { color: t.avisoFuerte }]}>
              {n > 0
                ? 'Esto aparece cuando haces el paso anterior. Si ya lo hiciste y no lo ves, toca Atrás.'
                : 'No veo ese botón en esta pantalla. Puede que tu usuario no tenga ese permiso.'}
            </Text>
          </View>
        ) : null}
        {tocar && caja ? <Text style={[c.pista, { color: t.tinta }]}>Tócalo tú para seguir</Text> : null}
        <View style={c.botones}>
          <Pressable onPress={cerrarGuia} style={({ pressed }) => [c.boton, pressed && { backgroundColor: t.gris100 }]} accessibilityRole="button">
            <Text style={[c.botonTexto, { color: t.suave }]}>Salir</Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          {n > 0 ? (
            <Pressable onPress={pasoAtras} style={({ pressed }) => [c.boton, pressed && { backgroundColor: t.gris100 }]} accessibilityRole="button">
              <Text style={[c.botonTexto, { color: t.fuerte }]}>Atrás</Text>
            </Pressable>
          ) : null}
          {/* En un paso de tocar el avance lo da el toque; el botón queda para saltarlo, más discreto. */}
          {tocar && caja ? (
            <Pressable onPress={siguientePaso} style={({ pressed }) => [c.boton, pressed && { backgroundColor: t.gris100 }]} accessibilityRole="button">
              <Text style={[c.botonTexto, { color: t.suave }]}>{ultimo ? 'Listo' : 'Saltar'}</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={siguientePaso}
              style={({ pressed }) => [c.boton, c.botonLleno, { backgroundColor: t.tinta, opacity: pressed ? 0.85 : 1 }]}
              accessibilityRole="button"
            >
              <Text style={[c.botonTexto, { color: t.papel }]}>{ultimo ? 'Listo' : 'Siguiente'}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  )
}

const c = StyleSheet.create({
  velo: { position: 'absolute', backgroundColor: VELO },
  anillo: { position: 'absolute', borderRadius: 16, borderWidth: 2, borderColor: '#fff' },
  tarjeta: {
    position: 'absolute',
    left: 12,
    right: 12,
    borderRadius: 24,
    padding: 20,
    boxShadow: '0 1px 2px rgba(0,0,0,0.06), 0 16px 40px rgba(0,0,0,0.22)',
  },
  cabeza: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  contador: { fontFamily: LETRA.cifra, fontSize: 12 },
  barras: { flexDirection: 'row', gap: 4, marginTop: 10 },
  barra: { flex: 1, height: 4, borderRadius: 2 },
  titulo: { fontFamily: LETRA.tituloFuerte, fontSize: 18, lineHeight: 22, marginTop: 12 },
  texto: { fontFamily: LETRA.texto, fontSize: 15, lineHeight: 21, marginTop: 6 },
  aviso: { marginTop: 8, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  avisoTexto: { fontFamily: LETRA.texto, fontSize: 13, lineHeight: 18 },
  pista: { fontFamily: LETRA.textoFuerte, fontSize: 13, marginTop: 8 },
  botones: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  boton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12 },
  botonLleno: { paddingHorizontal: 20 },
  botonTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14 },
})
