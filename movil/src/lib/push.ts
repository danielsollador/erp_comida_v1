import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { router, type Href } from 'expo-router'
import { useEffect } from 'react'
import * as almacen from './almacen'
import { req } from './api'

/**
 * NOTIFICACIONES PUSH: que el telefono suene aunque la app este cerrada.
 * Leider (22-oct) pidio dos: cuando la caja pide permiso, y cuando la caja
 * del dia sigue sin cerrar. Las manda el servidor (backend/app/push.py); aqui
 * solo se pide el permiso, se registra el telefono y se abre la pantalla
 * correcta al tocar el aviso.
 *
 * El permiso se pide solo a quien autoriza (dueño, Vertigo): a la cajera no le
 * llega ninguno de los dos avisos y pedirselo seria ruido.
 */
const CLAVE = 'vp_push_token'

// Con la app abierta tambien se muestra el aviso arriba: la campana interna
// puede no estar a la vista.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

/** Pide el permiso (una vez) y le dice al servidor a que telefono avisar. */
export async function registrarTelefono(): Promise<void> {
  if (process.env.EXPO_OS === 'web') return
  try {
    // Android 13+: sin canal no aparece la pregunta del permiso.
    if (process.env.EXPO_OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Avisos del negocio',
        importance: Notifications.AndroidImportance.HIGH,
      })
    }
    let permiso = await Notifications.getPermissionsAsync()
    if (!permiso.granted && permiso.canAskAgain) {
      permiso = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } })
    }
    if (!permiso.granted) return
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data
    await req('/push/dispositivo', { method: 'POST', body: JSON.stringify({ token, plataforma: process.env.EXPO_OS }) })
    await almacen.guardar(CLAVE, token)
  } catch {
    // Sin internet, Expo Go en Android o simulador: se intenta en la proxima entrada.
  }
}

/** Al salir: este telefono deja de recibir los avisos de esta persona. */
export async function olvidarTelefono(): Promise<void> {
  try {
    const token = await almacen.leer(CLAVE)
    if (!token) return
    await req('/push/dispositivo/quitar', { method: 'POST', body: JSON.stringify({ token }) })
    await almacen.borrar(CLAVE)
  } catch {
    // Si el servidor no contesta, el aviso seguira llegando hasta que Expo lo descarte.
  }
}

/** Tocar el aviso abre lo que dice (`data.ruta`): /notificaciones o /caja. */
export function useAbrirAlTocar(activo: boolean) {
  useEffect(() => {
    if (!activo || process.env.EXPO_OS === 'web') return
    const ir = (r: Notifications.NotificationResponse | null) => {
      const ruta = r?.notification.request.content.data?.ruta
      if (typeof ruta === 'string' && ruta.startsWith('/')) router.push(ruta as Href)
    }
    // La que abrio la app estando cerrada.
    ir(Notifications.getLastNotificationResponse())
    const sub = Notifications.addNotificationResponseReceivedListener(ir)
    return () => sub.remove()
  }, [activo])
}
