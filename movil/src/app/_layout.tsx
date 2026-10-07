import { JetBrainsMono_500Medium, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono'
import { Manrope_500Medium, Manrope_700Bold } from '@expo-google-fonts/manrope'
import { Sora_600SemiBold, Sora_700Bold } from '@expo-google-fonts/sora'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { View } from 'react-native'
import { SesionProvider, useSesion } from '../lib/sesion'
import { useTema } from '../lib/tema'

/**
 * La raiz: las letras de la marca, la sesion y dos puertas. Sin sesion solo
 * existe `entrar`; con sesion, las pestañas. `Stack.Protected` hace que un
 * enlace a la portada sin sesion termine en el login, y al reves.
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
    <SesionProvider>
      <Puertas listas={letras} />
    </SesionProvider>
  )
}

function Puertas({ listas }: { listas: boolean }) {
  const { fase } = useSesion()
  const t = useTema()
  // Mientras cargan las letras o se prueba la sesion guardada: el fondo, y
  // nada que salte despues.
  if (!listas || fase === 'cargando') return <View style={{ flex: 1, backgroundColor: t.papel }} />
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.papel } }}>
        <Stack.Protected guard={fase === 'dentro'}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={fase !== 'dentro'}>
          <Stack.Screen name="entrar" />
        </Stack.Protected>
      </Stack>
    </>
  )
}
