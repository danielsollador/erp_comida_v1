import * as SecureStore from 'expo-secure-store'

/**
 * LO QUE EL TELEFONO RECUERDA: el token, el tema, la moneda elegida.
 *
 * En el telefono va al almacen cifrado (Keychain en iOS, Keystore en
 * Android). En el navegador --la vista web con la que se revisan las
 * pantallas mientras se construyen-- SecureStore no existe y se usa
 * localStorage. Las pantallas no se enteran: leen y guardan aqui.
 */
const web = process.env.EXPO_OS === 'web'

export async function leer(clave: string): Promise<string | null> {
  if (web) {
    try {
      return globalThis.localStorage?.getItem(clave) ?? null
    } catch {
      return null
    }
  }
  return SecureStore.getItemAsync(clave)
}

export async function guardar(clave: string, valor: string): Promise<void> {
  if (web) {
    try {
      globalThis.localStorage?.setItem(clave, valor)
    } catch {
      // Navegador sin almacenamiento (modo privado): se recuerda solo mientras dure la pagina.
    }
    return
  }
  await SecureStore.setItemAsync(clave, valor)
}

export async function borrar(clave: string): Promise<void> {
  if (web) {
    try {
      globalThis.localStorage?.removeItem(clave)
    } catch {
      // sin almacenamiento: nada que borrar
    }
    return
  }
  await SecureStore.deleteItemAsync(clave)
}
