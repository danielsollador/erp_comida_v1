import * as almacen from './almacen'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Platform, StyleSheet, useColorScheme, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { captureScreen } from 'react-native-view-shot'
import { scheduleOnRN } from 'react-native-worklets'

/**
 * Los colores de la web (frontend/src/index.css), los mismos nombres y los
 * mismos tonos. La web los escribe en oklch; React Native no lo entiende,
 * asi que aqui van ya convertidos a hex. Si la web cambia un token, cambia
 * aqui tambien (cuando exista `paquetes/diseno`, saldran de un solo sitio).
 */
export const CLARO = {
  papel: '#f6f4ef',
  superficie: '#ffffff',
  tinta: '#17181b',
  fuerte: '#292927',
  suave: '#6d6b66',
  tenue: '#98948b',
  gris100: '#eeebe4',
  gris200: '#e2ded5',
  linea: 'rgba(23,24,27,0.05)',
  barra: '#cdc7bc',
  acento: '#9d4b29',
  acentoFuerte: '#803c20',
  acento400: '#d38566',
  acentoSuave: '#fdf3ef',
  acentoTinta: '#ffffff',
  exito: '#007c3a',
  exitoSuave: '#eff8f1',
  exito500: '#239852',
  aviso: '#9a5200',
  avisoFuerte: '#7d4200',
  avisoSuave: '#fcf4ea',
  avisoLinea: '#f3d1a8',
  peligro: '#b7242d',
  peligroSuave: '#fff1ef',
  /** La ficha del punto de venta: tinta llena en claro, superficie en oscuro. */
  fichaPrincipal: '#17181b',
  fichaPrincipalTinta: '#ffffff',
  sombra: 'rgba(23,24,27,0.14)',
}

export const OSCURO: Paleta = {
  papel: '#0e1014',
  superficie: '#161920',
  tinta: '#f1f3f7',
  fuerte: '#e3e6ec',
  suave: '#a1a7b4',
  tenue: '#7c8290',
  gris100: '#1b1e26',
  gris200: '#262a33',
  linea: 'rgba(255,255,255,0.045)',
  barra: '#333844',
  acento: '#ba7054',
  acentoFuerte: '#dc8462',
  acento400: '#ba7054',
  acentoSuave: '#2c1e18',
  acentoTinta: '#0e0f12',
  exito: '#6ecc8a',
  exitoSuave: '#16261a',
  exito500: '#4fb772',
  aviso: '#eca43b',
  avisoFuerte: '#f5b767',
  avisoSuave: '#2b1f0f',
  avisoLinea: '#52370f',
  peligro: '#ff837e',
  peligroSuave: '#321a18',
  fichaPrincipal: '#f1f3f7',
  fichaPrincipalTinta: '#0e1014',
  sombra: 'rgba(0,0,0,0.5)',
}

export type Paleta = typeof CLARO
/** Compatibilidad con las pantallas que ya usan `Tema` como paleta. */
export type Tema = Paleta
export type Modo = 'claro' | 'oscuro'

/** Sora para titulares, Manrope para texto, JetBrains Mono para cifras: las de la web. */
export const LETRA = {
  titulo: 'Sora_600SemiBold',
  tituloFuerte: 'Sora_700Bold',
  texto: 'Manrope_500Medium',
  textoFuerte: 'Manrope_700Bold',
  cifra: 'JetBrainsMono_500Medium',
  cifraFuerte: 'JetBrainsMono_700Bold',
}

// La misma clave que la web (lib/tema.tsx), por si algun dia comparten almacen.
const CLAVE = 'vertigo_tema'

type Ctx = { modo: Modo; paleta: Paleta; alternar: () => void; cambiar: (m: Modo) => void }
const Contexto = createContext<Ctx | null>(null)

/**
 * CLARO U OSCURO, COMO EN LA WEB: el boton de la luna y el sol cambia el
 * tema, y la eleccion se recuerda en el telefono. Mientras nadie elija, sigue
 * al telefono.
 *
 * El cambio es el mismo barrido de la web (index.css, `vp-barrido`): una
 * linea diagonal cruza de derecha a izquierda en 640 ms, con la parte de
 * arriba 45 % por delante, y deja ver el tema nuevo detras. Para eso se toma
 * una foto de la pantalla, se pone encima, se cambia el tema por debajo y la
 * foto se recorta en diagonal mientras se corre a la izquierda; solo se
 * mueve el borde, la foto queda quieta. Todo con transform, en el hilo de la
 * interfaz. Si la foto no se puede tomar (la
 * vista web), queda el fundido corto de antes.
 */
const BARRIDO_MS = 640
const ADELANTO = 0.45 // la parte de arriba va 45 % del ancho por delante

export function TemaProvider({ children }: { children: ReactNode }) {
  const sistema = useColorScheme()
  const [elegido, setElegido] = useState<Modo | null>(null)
  const [velo, setVelo] = useState<string | null>(null)
  const [foto, setFoto] = useState<{ uri: string; nuevo: Modo } | null>(null)
  const [caja, setCaja] = useState({ ancho: 0, alto: 0 })
  const opacidad = useSharedValue(0)
  const corrido = useSharedValue(0)
  const ocupado = useRef(false)

  useEffect(() => {
    almacen.leer(CLAVE)
      .then((v) => {
        if (v === 'claro' || v === 'oscuro') setElegido(v)
      })
      .catch(() => undefined)
  }, [])

  const modo: Modo = elegido ?? (sistema === 'dark' ? 'oscuro' : 'claro')
  const paleta = modo === 'oscuro' ? OSCURO : CLARO

  const quitarVelo = useCallback(() => setVelo(null), [])
  const quitarFoto = useCallback(() => {
    setFoto(null)
    ocupado.current = false
  }, [])

  const fundido = useCallback(
    (nuevo: Modo) => {
      // El velo se pinta con el papel de ANTES y se desvanece sobre el nuevo.
      setVelo((modo === 'oscuro' ? OSCURO : CLARO).papel)
      opacidad.set(1)
      opacidad.set(withTiming(0, { duration: 260, easing: Easing.bezier(0.2, 0.7, 0.2, 1) }, (fin) => {
        if (fin) scheduleOnRN(quitarVelo)
      }))
      setElegido(nuevo)
    },
    [modo, opacidad, quitarVelo],
  )

  const cambiar = useCallback(
    async (nuevo: Modo) => {
      if (nuevo === modo || ocupado.current) return
      almacen.guardar(CLAVE, nuevo).catch(() => undefined)
      if (Platform.OS === 'web' || !caja.ancho) return fundido(nuevo)
      ocupado.current = true
      try {
        const uri = await captureScreen({ format: 'jpg', quality: 0.92, result: 'tmpfile' })
        corrido.set(0)
        setFoto({ uri, nuevo })
      } catch {
        ocupado.current = false
        fundido(nuevo)
      }
    },
    [modo, caja.ancho, corrido, fundido],
  )

  // La foto ya esta pintada encima: se cambia el tema por debajo y, un
  // instante despues (para que el tema nuevo alcance a dibujarse), arranca el
  // barrido.
  const fotoLista = useCallback(() => {
    if (!foto) return
    setElegido(foto.nuevo)
    const recorrido = caja.ancho * (1 + ADELANTO)
    setTimeout(() => {
      corrido.set(withTiming(-recorrido, { duration: BARRIDO_MS, easing: Easing.bezier(0.4, 0, 0.12, 1) }, (fin) => {
        if (fin) scheduleOnRN(quitarFoto)
      }))
    }, 50)
  }, [foto, caja.ancho, corrido, quitarFoto])

  const alternar = useCallback(() => {
    void cambiar(modo === 'oscuro' ? 'claro' : 'oscuro')
  }, [cambiar, modo])
  const estiloVelo = useAnimatedStyle(() => ({ opacity: opacidad.value }))

  // Una caja muy grande, centrada en la pantalla y girada: su borde derecho
  // es la linea diagonal. La foto va adentro, centrada en el mismo punto y
  // girada al reves, asi que queda quieta mientras la caja se corre. (Android
  // no aplica skewX a las vistas: por eso giro y no inclinacion.)
  const { ancho, alto } = caja
  const lado = 3 * Math.max(ancho, alto, 1)
  const giro = alto ? Math.atan((ancho * ADELANTO) / alto) : 0
  const inicio = ancho * (0.5 + ADELANTO / 2) - lado / (2 * Math.cos(giro))
  const estiloRecorte = useAnimatedStyle(() => ({
    transform: [{ translateX: inicio + corrido.value }, { rotate: `${-giro}rad` }],
  }))
  const estiloFoto = useAnimatedStyle(() => ({
    transform: [{ rotate: `${giro}rad` }, { translateX: -(inicio + corrido.value) }],
  }))

  const valor = useMemo(
    () => ({ modo, paleta, alternar, cambiar: (m: Modo) => void cambiar(m) }),
    [modo, paleta, alternar, cambiar],
  )

  return (
    <Contexto.Provider value={valor}>
      <View style={{ flex: 1 }} onLayout={(e) => setCaja({ ancho: e.nativeEvent.layout.width, alto: e.nativeEvent.layout.height })}>
        {children}
        {foto && (
          <Animated.View
            pointerEvents="none"
            style={[{ position: 'absolute', top: (alto - lado) / 2, left: (ancho - lado) / 2, width: lado, height: lado, overflow: 'hidden' }, estiloRecorte]}
          >
            <Animated.Image
              source={{ uri: foto.uri }}
              fadeDuration={0}
              onLoad={fotoLista}
              style={[{ position: 'absolute', top: (lado - alto) / 2, left: (lado - ancho) / 2, width: ancho, height: alto }, estiloFoto]}
            />
          </Animated.View>
        )}
        {velo && (
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: velo }, estiloVelo]} />
        )}
      </View>
    </Contexto.Provider>
  )
}

/** La paleta del tema que se esta viendo. */
export function useTema(): Paleta {
  const c = useContext(Contexto)
  return c ? c.paleta : CLARO
}

/** Claro u oscuro, y como cambiarlo (el boton del encabezado, Apariencia). */
export function useModo() {
  const c = useContext(Contexto)
  if (!c) throw new Error('useModo fuera de TemaProvider')
  return { modo: c.modo, alternar: c.alternar, cambiar: c.cambiar }
}
