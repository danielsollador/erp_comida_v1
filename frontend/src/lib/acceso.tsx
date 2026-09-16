import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from './api'
import type { EstadoAcceso } from './types'

/**
 * Quien esta dentro y que puede hacer.
 *
 * La cookie de sesion es HttpOnly --JavaScript no la ve--, asi que se le
 * pregunta al servidor una vez al cargar. Si no hay sesion, al login: nginx ya
 * lo habria hecho antes de servir este codigo, asi que aqui es la red de
 * seguridad para el caso de una sesion que caduco con la pestaña abierta.
 *
 * `puede` lo dice el servidor. El frontend no deduce permisos de
 * `rol === 'admin'`: esconder un boton es comodidad, la cerradura esta en el
 * middleware del backend.
 */
type Contexto = {
  estado: EstadoAcceso
  recargar: () => void
  salir: () => Promise<void>
}

const Ctx = createContext<Contexto | null>(null)

export function AccesoProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoAcceso | null>(null)

  const recargar = useCallback(() => {
    api
      .estadoAcceso()
      .then((d) => {
        if (!d.autenticado) {
          window.location.replace('/login.html')
          return
        }
        setEstado(d)
      })
      .catch(() => window.location.replace('/login.html?fallo=servidor'))
  }, [])

  useEffect(() => {
    recargar()
  }, [recargar])

  const salir = useCallback(async () => {
    try {
      await api.salir()
    } catch {
      // aunque falle, se va al login: la cookie se borra alli al recargar
    }
    // Hub y panel son dominios distintos con cookies distintas. Cerrar aqui no
    // cierra la del hub, asi que se encadena: el hub cierra la suya y devuelve
    // al login de este local. Un salto visible y no una llamada de fondo,
    // porque una cookie de otro dominio solo la borra ese dominio.
    const hub = estado?.hub_url
    if (hub && estado?.local.slug) {
      window.location.replace(`${hub}/api/acceso/salir?volver=${encodeURIComponent(estado.local.slug)}`)
    } else {
      window.location.replace('/login.html')
    }
  }, [estado])

  // Hasta saber quien es no se pinta nada: pintar el ERP y despues rebotar al
  // login es peor que medio segundo en blanco.
  if (!estado) return null

  return <Ctx.Provider value={{ estado, recargar, salir }}>{children}</Ctx.Provider>
}

export function useAcceso(): Contexto {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAcceso fuera de AccesoProvider')
  return ctx
}

export const NOMBRE_ROL: Record<string, string> = {
  admin: 'Vertigo',
  dueno: 'Dueño',
  caja: 'Caja',
  cocina: 'Cocina',
}

/**
 * Ir al hub sin volver a poner la clave: se pide un pase para `__hub__` y el
 * hub lo canjea por su propia cookie. Si algo falla se va igual: alli habra un
 * login, que es lo correcto.
 */
export async function irAlHub(hubUrl: string) {
  try {
    const { pase } = await api.pedirPase('__hub__')
    window.location.href = `${hubUrl}/api/acceso/entrar?pase=${encodeURIComponent(pase)}`
  } catch {
    window.location.href = hubUrl
  }
}
