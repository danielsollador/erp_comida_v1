import { useColorScheme } from 'react-native'

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
  suave: '#6d6b66',
  tenue: '#98948b',
  linea: 'rgba(23,24,27,0.07)',
  barra: '#e2ded5',
  acento: '#9d4b29',
  acentoFuerte: '#803c20',
  acentoSuave: '#fdf3ef',
  acentoTinta: '#ffffff',
  exito: '#007c3a',
  exitoSuave: '#eff8f1',
  aviso: '#9a5200',
  avisoSuave: '#fcf4ea',
  avisoLinea: '#f3d1a8',
  peligro: '#b7242d',
  peligroSuave: '#fff1ef',
}

export const OSCURO: Tema = {
  papel: '#0e1014',
  superficie: '#161920',
  tinta: '#f1f3f7',
  suave: '#a1a7b4',
  tenue: '#7c8290',
  linea: 'rgba(255,255,255,0.06)',
  barra: '#262a33',
  acento: '#ba7054',
  acentoFuerte: '#dc8462',
  acentoSuave: '#2c1e18',
  acentoTinta: '#0e0f12',
  exito: '#6ecc8a',
  exitoSuave: '#16261a',
  aviso: '#eca43b',
  avisoSuave: '#2b1f0f',
  avisoLinea: '#52370f',
  peligro: '#ff837e',
  peligroSuave: '#321a18',
}

export type Tema = typeof CLARO

/** Claro u oscuro segun el telefono, como la web segun el sistema. */
export function useTema(): Tema {
  return useColorScheme() === 'dark' ? OSCURO : CLARO
}

/** Sora para titulares, Manrope para texto, JetBrains Mono para cifras: las de la web. */
export const LETRA = {
  titulo: 'Sora_600SemiBold',
  tituloFuerte: 'Sora_700Bold',
  texto: 'Manrope_500Medium',
  textoFuerte: 'Manrope_700Bold',
  cifra: 'JetBrainsMono_500Medium',
  cifraFuerte: 'JetBrainsMono_700Bold',
}
