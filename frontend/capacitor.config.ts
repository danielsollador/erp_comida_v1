import type { CapacitorConfig } from '@capacitor/cli'

/**
 * La app de Android y iOS. Las pantallas van DENTRO del paquete (`dist`,
 * compilado con `npm run build:app`): abre al instante, sin cargar una pagina
 * de internet. El servidor es el del local (`VITE_API_BASE` en `.env.app`).
 */
const config: CapacitorConfig = {
  appId: 'tech.vertigopro.savora',
  appName: 'Sávora',
  webDir: 'dist',
  server: {
    // https://localhost en Android: el mismo esquema seguro que el servidor.
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      // Se quita a mano al primer pintado (lib/nativo.ts), con fundido.
      launchAutoHide: false,
      backgroundColor: '#0e1014',
      showSpinner: false,
    },
    Keyboard: {
      resize: 'body',
    },
  },
}

export default config
