import { Alert, Platform } from 'react-native'

/**
 * LAS PREGUNTAS DE SI O NO, iguales en el telefono y en el navegador.
 *
 * `Alert` de React Native no hace nada en la web (la vista con que se revisan
 * las pantallas): ahi se usa el confirm del navegador. Las pantallas
 * preguntan por aqui y esperan la respuesta con `await`, como la web
 * (`dialogo.confirmar` de frontend/src/components/dialogo.tsx).
 */
export function confirmar({
  titulo,
  texto = '',
  aceptar = 'Aceptar',
  cancelar = 'Cancelar',
  peligro = false,
}: {
  titulo: string
  texto?: string
  aceptar?: string
  cancelar?: string
  peligro?: boolean
}): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(globalThis.confirm(texto ? `${titulo}\n\n${texto}` : titulo))
  }
  return new Promise((resolver) => {
    Alert.alert(
      titulo,
      texto || undefined,
      [
        { text: cancelar, style: 'cancel', onPress: () => resolver(false) },
        { text: aceptar, style: peligro ? 'destructive' : 'default', onPress: () => resolver(true) },
      ],
      { cancelable: true, onDismiss: () => resolver(false) },
    )
  })
}

/** Un aviso con un solo boton ("No se pudo guardar", "Listo"). */
export function avisar(titulo: string, texto = ''): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.alert(texto ? `${titulo}\n\n${texto}` : titulo)
    return Promise.resolve()
  }
  return new Promise((resolver) => {
    Alert.alert(titulo, texto || undefined, [{ text: 'Entendido', onPress: () => resolver() }], {
      cancelable: true,
      onDismiss: () => resolver(),
    })
  })
}

/**
 * Elegir entre varias acciones ("Tomar foto", "Elegir de la galería",
 * "Subir PDF"). En el telefono, el dialogo del sistema; en el navegador,
 * la primera opcion (es solo para revisar pantallas).
 */
export function elegir<T extends string>(
  titulo: string,
  opciones: { valor: T; texto: string; peligro?: boolean }[],
  texto = '',
): Promise<T | null> {
  if (Platform.OS === 'web') {
    const i = globalThis.prompt(`${titulo}\n${opciones.map((o, n) => `${n + 1}. ${o.texto}`).join('\n')}`, '1')
    const n = Number(i) - 1
    return Promise.resolve(opciones[n]?.valor ?? null)
  }
  return new Promise((resolver) => {
    Alert.alert(
      titulo,
      texto || undefined,
      [
        ...opciones.map((o) => ({
          text: o.texto,
          style: (o.peligro ? 'destructive' : 'default') as 'destructive' | 'default',
          onPress: () => resolver(o.valor),
        })),
        { text: 'Cancelar', style: 'cancel' as const, onPress: () => resolver(null) },
      ],
      { cancelable: true, onDismiss: () => resolver(null) },
    )
  })
}
