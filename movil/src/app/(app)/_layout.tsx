import Feather from '@expo/vector-icons/Feather'
import { Tabs } from 'expo-router'
import { LETRA, useTema } from '../../lib/tema'

/**
 * Tres pestañas, en el orden en que se preguntan: como va hoy, como van los
 * numeros del mes, y la cuenta. Lo que crezca (autorizaciones, factura con la
 * camara, inventario rapido) entra aqui como pestaña o desde la portada.
 */
export default function Pestanas() {
  const t = useTema()
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.acento,
        tabBarInactiveTintColor: t.tenue,
        tabBarStyle: { backgroundColor: t.superficie, borderTopColor: t.linea },
        tabBarLabelStyle: { fontFamily: LETRA.textoFuerte, fontSize: 12 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Hoy', tabBarIcon: ({ color, size }) => <Feather name="sun" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="numeros"
        options={{ title: 'Números', tabBarIcon: ({ color, size }) => <Feather name="bar-chart-2" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="cuenta"
        options={{ title: 'Cuenta', tabBarIcon: ({ color, size }) => <Feather name="user" size={size} color={color} /> }}
      />
    </Tabs>
  )
}
