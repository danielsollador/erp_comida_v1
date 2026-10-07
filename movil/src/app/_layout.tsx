import { JetBrainsMono_500Medium, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono'
import { Manrope_500Medium, Manrope_700Bold } from '@expo-google-fonts/manrope'
import { Sora_600SemiBold, Sora_700Bold } from '@expo-google-fonts/sora'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { View } from 'react-native'
import { MonedaProvider } from '../lib/moneda'
import { SesionProvider, useSesion } from '../lib/sesion'
import { TemaProvider, useModo, useTema } from '../lib/tema'

/**
 * La raiz: las letras de la marca, el tema (claro u oscuro, como la web), la
 * sesion, la moneda y dos puertas. Sin sesion solo existe `entrar`; con
 * sesion, el inicio y lo que cuelga de el. `Stack.Protected` hace que un
 * enlace adentro sin sesion termine en el login, y al reves.
 */
export default function Raiz() {
  const [letras] = useFonts({
    Sora_600SemiBold,
    Sora_700Bold,
    Manrope_500Medium,
    Manrope_700Bold,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
  })
  return (
    <TemaProvider>
      <SesionProvider>
        <Puertas listas={letras} />
      </SesionProvider>
    </TemaProvider>
  )
}

function Puertas({ listas }: { listas: boolean }) {
  const { fase } = useSesion()
  const { modo } = useModo()
  const t = useTema()
  // Mientras cargan las letras o se prueba la sesion guardada: el fondo, y
  // nada que salte despues.
  if (!listas || fase === 'cargando') return <View style={{ flex: 1, backgroundColor: t.papel }} />
  return (
    <MonedaProvider activa={fase === 'dentro'}>
      <StatusBar style={modo === 'oscuro' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.papel } }}>
        <Stack.Protected guard={fase === 'dentro'}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={fase !== 'dentro'}>
          <Stack.Screen name="entrar" />
        </Stack.Protected>
      </Stack>
    </MonedaProvider>
  )
}
