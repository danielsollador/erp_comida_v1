import { Stack } from 'expo-router'
import { View } from 'react-native'
import { CapaGuia } from '../../componentes/guia/Capa'
import { ControlesCabecera } from '../../componentes/Encabezado'
import { LETRA, useTema } from '../../lib/tema'

/**
 * Como la web: el inicio es la puerta y desde ahi se entra a cada parte
 * (contabilidad, impuestos, tasa, reportes, notificaciones, configuracion).
 * Sin pestañas abajo: la web no las tiene, y el inicio ya las lleva todas.
 *
 * Las pantallas de adentro llevan el encabezado nativo del Stack, no uno
 * pintado a mano: asi iOS da el titulo grande que se encoge al desplazar,
 * el gesto de volver desde el borde y tocar la hora para subir, y Android
 * su barra Material. Cada pantalla pone su titulo con `Stack.Screen`; los
 * colores salen del tema para que el encabezado cambie con el claro y el
 * oscuro. A la derecha, los mismos controles de siempre (moneda, campana,
 * tema). El inicio es el unico que conserva su cabecera propia: lleva la
 * marca del local.
 */

// Titulo grande en iOS solo donde la lista es lo primero de la pantalla. Los
// modulos con pestañas las llevan fijas arriba del desplazamiento (Leider,
// 22-oct: que no se escondan al bajar), y con algo fijo encima iOS no
// encoge el titulo grande: ahi va el compacto. Formularios, fichas y el
// punto de venta tampoco (el titulo grande les quitaria sitio).
const CON_TITULO_GRANDE = ['inventario/preparaciones/index', 'inventario/control', 'notificaciones']

export default function Interior() {
  const t = useTema()
  // La capa de la guia paso a paso va encima del Stack entero (y cada hoja
  // lleva la suya adentro, porque un Modal se dibuja por encima de esto).
  return (
    <View style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerShown: true,
          headerBackButtonDisplayMode: 'minimal',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: t.papel },
          headerTintColor: t.tinta,
          headerTitleStyle: { fontFamily: LETRA.titulo, fontSize: 17, color: t.tinta },
          headerLargeStyle: { backgroundColor: t.papel },
          headerLargeTitleStyle: { fontFamily: LETRA.tituloFuerte, color: t.tinta },
          headerLargeTitleShadowVisible: false,
          headerRight: () => <ControlesCabecera />,
          contentStyle: { backgroundColor: t.papel },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        {CON_TITULO_GRANDE.map((nombre) => (
          <Stack.Screen key={nombre} name={nombre} options={{ headerLargeTitleEnabled: true }} />
        ))}
      </Stack>
      <CapaGuia />
    </View>
  )
}
