import { Stack } from 'expo-router'
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

// Las portadas de modulo y las listas: titulo grande en iOS. Los
// formularios, las fichas y el punto de venta no (el titulo grande les
// quitaria sitio a lo que importa).
const CON_TITULO_GRANDE = [
  'ventas/index',
  'ventas/[seccion]',
  'inventario/index',
  'inventario/[seccion]',
  'inventario/preparaciones/index',
  'inventario/control',
  'compras/index',
  'compras/[seccion]',
  'menu/index',
  'menu/[seccion]',
  'reportes/index',
  'reportes/[seccion]',
  'tasa/index',
  'tasa/[seccion]',
  'caja/index',
  'caja/[seccion]',
  'notificaciones',
]

export default function Interior() {
  const t = useTema()
  return (
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
  )
}
