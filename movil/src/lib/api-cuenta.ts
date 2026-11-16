import { req } from './api'
import type { Usuario } from './tipos'

/**
 * MI CUENTA: las mismas cuatro llamadas de la web (frontend/src/lib/api.ts),
 * con los mismos cuerpos. Todas son sobre quien esta dentro (`/usuarios/mi/`):
 * el servidor sabe quien es por la sesion, no se manda el usuario.
 *
 * La contrasena y el PIN piden la contrasena actual aunque haya sesion: si
 * alguien deja el telefono desbloqueado, otro no puede quedarse con la cuenta
 * ni ponerse un PIN a su nombre.
 */
export const apiCuenta = {
  cambiarMiNombre: (nombre: string, apellido: string) =>
    req<Usuario>('/usuarios/mi/nombre', { method: 'PUT', body: JSON.stringify({ nombre, apellido }) }),

  ponerMiPin: (clave_actual: string, pin: string) =>
    req<Usuario>('/usuarios/mi/pin', { method: 'POST', body: JSON.stringify({ clave_actual, pin }) }),

  quitarMiPin: () => req<Usuario>('/usuarios/mi/pin', { method: 'DELETE' }),

  /** Borra la cuenta propia (App Store 5.1.1(v)). Pide la clave. */
  eliminarMiCuenta: (clave: string) =>
    req<{ ok: boolean }>('/usuarios/mi/eliminar', { method: 'POST', body: JSON.stringify({ clave }) }),

  cambiarMiClave: (clave_actual: string, clave_nueva: string) =>
    req<{ ok: boolean }>('/usuarios/mi/clave', {
      method: 'POST',
      body: JSON.stringify({ clave_actual, clave_nueva }),
    }),
}
