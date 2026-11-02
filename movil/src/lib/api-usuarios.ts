import { req } from './api'
import type { DatosRol, ListaUsuarios, Rol, RolInfo, Usuario } from './tipos'

/**
 * Usuarios y roles: las MISMAS llamadas de la web (frontend/src/lib/api.ts),
 * con los mismos cuerpos. Si alguna cambia alla, cambia aqui: el backend no
 * distingue si le habla la tablet o el telefono.
 */
const ruta = (usuario: string) => `/usuarios/${encodeURIComponent(usuario)}`

export const apiUsuarios = {
  listarUsuarios: () => req<ListaUsuarios>('/usuarios'),

  crearRol: (r: DatosRol) => req<RolInfo>('/usuarios/roles', { method: 'POST', body: JSON.stringify(r) }),
  editarRol: (id: string, r: DatosRol) =>
    req<RolInfo>(`/usuarios/roles/${id}`, { method: 'PUT', body: JSON.stringify(r) }),
  borrarRol: (id: string) => req<{ ok: boolean }>(`/usuarios/roles/${id}`, { method: 'DELETE' }),
  /** Devuelve un rol de fabrica a los modulos con los que viene. */
  restaurarRol: (id: string) => req<RolInfo>(`/usuarios/roles/${id}/ajuste`, { method: 'DELETE' }),

  crearUsuario: (u: { usuario: string; clave: string; rol: Rol; nombre?: string; apellido?: string; locales?: string[] }) =>
    req<Usuario>('/usuarios', { method: 'POST', body: JSON.stringify(u) }),
  cambiarRol: (usuario: string, rol: Rol) =>
    req<Usuario>(`${ruta(usuario)}/rol`, { method: 'PUT', body: JSON.stringify({ rol }) }),
  borrarUsuario: (usuario: string) => req<{ ok: boolean }>(ruta(usuario), { method: 'DELETE' }),
  reiniciarClave: (usuario: string, clave: string) =>
    req<{ ok: boolean }>(`${ruta(usuario)}/clave`, { method: 'POST', body: JSON.stringify({ clave }) }),
  cambiarNombre: (usuario: string, nombre: string, apellido: string) =>
    req<Usuario>(`${ruta(usuario)}/nombre`, { method: 'PUT', body: JSON.stringify({ nombre, apellido }) }),
  ponerPin: (usuario: string, pin: string) =>
    req<Usuario>(`${ruta(usuario)}/pin`, { method: 'POST', body: JSON.stringify({ pin }) }),
  quitarPin: (usuario: string) => req<Usuario>(`${ruta(usuario)}/pin`, { method: 'DELETE' }),
}
