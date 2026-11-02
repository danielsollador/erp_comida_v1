import * as almacen from './almacen'
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { StyleSheet, useColorScheme, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { captureScreen } from 'react-native-view-shot'
import { scheduleOnRN } from 'react-native-worklets'

/**
 * Los colores de la web (frontend/src/index.css), los mismos nombres y los
 * mismos tonos. La web los escribe en oklch; React Native no lo entiende,
 * asi que aqui van ya convertidos a hex. Si la web cambia un token, cambia
 * aqui tambien (cuando exista `paquetes/diseno`, saldran de un solo sitio).
 */
/**
 * LA MARCA DE CADA LOCAL. El cobre es el acento de Savora, no de Vertigo: el
 * hub, la demo y cualquier otro local llevan el acento de Vertigo (grafito en
 * claro, perla en oscuro), el mismo del sitio vertigopro.tech. Es la misma
 * regla que `data-marca` en la web (index.css): solo cambia el acento; papel,
 * tinta y grises son los neutros calidos de Vertigo en las dos marcas.
 */
export type Marca = 'vertigo' | 'savora'

type Acento = {
  acento: string
  acentoFuerte: string
  acento400: string
  acentoSuave: string
  acentoTinta: string
  /** Las series de los graficos (`--vp-dato-*` de la web): acento 500, 800, 300, 200 y 700. */
  dato: { s500: string; s800: string; s300: string; s200: string; s700: string }
}

export const ACENTOS: Record<Marca, { claro: Acento; oscuro: Acento }> = {
  vertigo: {
    claro: {
      acento: '#292927',
      acentoFuerte: '#1f1f1e',
      acento400: '#6d6b66',
      acentoSuave: '#f0eee9',
      acentoTinta: '#ffffff',
      dato: { s500: '#54524e', s800: '#17181b', s300: '#a8a49b', s200: '#cfcbc2', s700: '#1f1f1e' },
    },
    oscuro: {
      acento: '#d1d5dd',
      acentoFuerte: '#e3e6ec',
      acento400: '#d1d5dd',
      acentoSuave: '#1b1e26',
      acentoTinta: '#0e0f12',
      dato: { s500: '#bbc0ca', s800: '#f1f3f7', s300: '#4a505c', s200: '#333844', s700: '#eceef2' },
    },
  },
  savora: {
    claro: {
      acento: '#9d4b29',
      acentoFuerte: '#803c20',
      acento400: '#d38566',
      acentoSuave: '#fdf3ef',
      acentoTinta: '#ffffff',
      dato: { s500: '#bc6541', s800: '#642e18', s300: '#e8aa92', s200: '#f6cdbe', s700: '#803c20' },
    },
    oscuro: {
      acento: '#ba7054',
      acentoFuerte: '#dc8462',
      acento400: '#ba7054',
      acentoSuave: '#2c1e18',
      acentoTinta: '#0e0f12',
      dato: { s500: '#dc8462', s800: '#ffc5ad', s300: '#7f4c38', s200: '#543427', s700: '#f8b095' },
    },
  },
}

/** Que marca lleva un local, por su slug (`acceso.local.slug`). Sin local: Vertigo. */
export const marcaDe = (slug: string | null | undefined): Marca => (slug === 'savora' ? 'savora' : 'vertigo')

const BASE_CLARO = {
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

const BASE_OSCURO: typeof BASE_CLARO = {
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

export type Paleta = typeof BASE_CLARO & Acento
/** Compatibilidad con las pantallas que ya usan `Tema` como paleta. */
export type Tema = Paleta
export type Modo = 'claro' | 'oscuro'

/** La paleta de una marca en un modo: los neutros de siempre mas su acento. */
export function paletaDe(marca: Marca, modo: Modo): Paleta {
  return modo === 'oscuro' ? { ...BASE_OSCURO, ...ACENTOS[marca].oscuro } : { ...BASE_CLARO, ...ACENTOS[marca].claro }
}

/** Las de Vertigo, para lo que vive fuera del TemaProvider (y como valor de arranque). */
export const CLARO: Paleta = paletaDe('vertigo', 'claro')
export const OSCURO: Paleta = paletaDe('vertigo', 'oscuro')

/** Sora para titulares, Manrope para texto, JetBrains Mono para cifras: las de la web. */
export const LETRA = {
  titulo: 'Sora_600SemiBold',
  tituloFuerte: 'Sora_700Bold',
  texto: 'Manrope_500Medium',
  textoFuerte: 'Manrope_700Bold',
  cifra: 'JetBrainsMono_500Medium',
  cifraFuerte: 'JetBrainsMono_700Bold',
}

// Las mismas claves que la web (lib/tema.tsx y lib/acceso.tsx), por si algun
// dia comparten almacen. La marca se recuerda para que el proximo arranque no
// destelle con otro acento, como hace index.html en la web.
const CLAVE = 'vertigo_tema'
const CLAVE_MARCA = 'vertigo_marca'

type Ctx = {
  modo: Modo
  paleta: Paleta
  marca: Marca
  alternar: () => void
  cambiar: (m: Modo) => void
  /** La sesion la llama al saber de que local es (`acceso.local.slug`). */
  ponerMarca: (m: Marca) => void
}
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
  const [marca, setMarca] = useState<Marca>('vertigo')
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
    almacen.leer(CLAVE_MARCA)
      .then((v) => setMarca(marcaDe(v)))
      .catch(() => undefined)
  }, [])

  const ponerMarca = useCallback((m: Marca) => {
    setMarca(m)
    almacen.guardar(CLAVE_MARCA, m).catch(() => undefined)
  }, [])

  const modo: Modo = elegido ?? (sistema === 'dark' ? 'oscuro' : 'claro')
  const paleta = useMemo(() => paletaDe(marca, modo), [marca, modo])

  const quitarVelo = useCallback(() => setVelo(null), [])
  const quitarFoto = useCallback(() => {
    setFoto(null)
    ocupado.current = false
  }, [])

  const fundido = useCallback(
    (nuevo: Modo) => {
      // El velo se pinta con el papel de ANTES y se desvanece sobre el nuevo.
      setVelo(paleta.papel)
      opacidad.set(1)
      opacidad.set(withTiming(0, { duration: 260, easing: Easing.bezier(0.2, 0.7, 0.2, 1) }, (fin) => {
        if (fin) scheduleOnRN(quitarVelo)
      }))
      setElegido(nuevo)
    },
    [paleta.papel, opacidad, quitarVelo],
  )

  const cambiar = useCallback(
    async (nuevo: Modo) => {
      if (nuevo === modo || ocupado.current) return
      almacen.guardar(CLAVE, nuevo).catch(() => undefined)
      if (process.env.EXPO_OS === 'web' || !caja.ancho) return fundido(nuevo)
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
    () => ({ modo, paleta, marca, alternar, cambiar: (m: Modo) => void cambiar(m), ponerMarca }),
    [modo, paleta, marca, alternar, cambiar, ponerMarca],
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
  const c = use(Contexto)
  return c ? c.paleta : CLARO
}

/** Claro u oscuro, y como cambiarlo (el boton del encabezado, Apariencia). */
export function useModo() {
  const c = use(Contexto)
  if (!c) throw new Error('useModo fuera de TemaProvider')
  return { modo: c.modo, alternar: c.alternar, cambiar: c.cambiar }
}

/** La marca que se esta viendo y como fijarla (lo hace la sesion al entrar). */
export function useMarca() {
  const c = use(Contexto)
  if (!c) throw new Error('useMarca fuera de TemaProvider')
  return { marca: c.marca, ponerMarca: c.ponerMarca }
}
