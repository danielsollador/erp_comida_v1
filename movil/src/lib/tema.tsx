import * as SecureStore from 'expo-secure-store'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { StyleSheet, useColorScheme } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
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
 * al telefono. El cambio no es un golpe: el color de antes se desvanece
 * sobre el nuevo en un cuarto de segundo (en la web es el circulo que se
 * abre desde el boton; aqui, un fundido, que es lo que React Native permite
 * sin capturar la pantalla).
 */
export function TemaProvider({ children }: { children: ReactNode }) {
  const sistema = useColorScheme()
  const [elegido, setElegido] = useState<Modo | null>(null)
  const [velo, setVelo] = useState<string | null>(null)
  const opacidad = useSharedValue(0)

  useEffect(() => {
    SecureStore.getItemAsync(CLAVE)
      .then((v) => {
        if (v === 'claro' || v === 'oscuro') setElegido(v)
      })
      .catch(() => undefined)
  }, [])

  const modo: Modo = elegido ?? (sistema === 'dark' ? 'oscuro' : 'claro')
  const paleta = modo === 'oscuro' ? OSCURO : CLARO

  const quitarVelo = useCallback(() => setVelo(null), [])

  const cambiar = useCallback(
    (nuevo: Modo) => {
      if (nuevo === modo) return
      // El velo se pinta con el papel de ANTES y se desvanece sobre el nuevo.
      setVelo((modo === 'oscuro' ? OSCURO : CLARO).papel)
      opacidad.set(1)
      opacidad.set(withTiming(0, { duration: 260, easing: Easing.bezier(0.2, 0.7, 0.2, 1) }, (fin) => {
        if (fin) scheduleOnRN(quitarVelo)
      }))
      setElegido(nuevo)
      SecureStore.setItemAsync(CLAVE, nuevo).catch(() => undefined)
    },
    [modo, opacidad, quitarVelo],
  )

  const alternar = useCallback(() => cambiar(modo === 'oscuro' ? 'claro' : 'oscuro'), [cambiar, modo])
  const estiloVelo = useAnimatedStyle(() => ({ opacity: opacidad.value }))
  const valor = useMemo(() => ({ modo, paleta, alternar, cambiar }), [modo, paleta, alternar, cambiar])

  return (
    <Contexto.Provider value={valor}>
      {children}
      {velo && (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: velo }, estiloVelo]} />
      )}
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
