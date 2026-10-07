import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, cargarToken, cuandoCaduque } from './api'
import type { EstadoAcceso } from './tipos'

type Fase = 'cargando' | 'fuera' | 'dentro'

type Sesion = {
  fase: Fase
  acceso: EstadoAcceso | null
  entrar: (usuario: string, clave: string) => Promise<void>
  salir: () => Promise<void>
}

const Contexto = createContext<Sesion | null>(null)

/**
 * Quien esta dentro. Al abrir la app se prueba el token guardado contra el
 * servidor (`/acceso/estado`): si ya no vale, se pide entrar de nuevo, sin
 * mostrar una portada vacia por un instante.
 */
export function SesionProvider({ children }: { children: ReactNode }) {
  const [fase, setFase] = useState<Fase>('cargando')
  const [acceso, setAcceso] = useState<EstadoAcceso | null>(null)

  useEffect(() => {
    cuandoCaduque(() => {
      setAcceso(null)
      setFase('fuera')
    })
    ;(async () => {
      try {
        if (!(await cargarToken())) {
          setFase('fuera')
          return
        }
        const a = await api.estado()
        if (a.autenticado) {
          setAcceso(a)
          setFase('dentro')
        } else {
          await api.olvidar()
          setFase('fuera')
        }
      } catch {
        // Sin internet al abrir: se pide entrar; al reintentar se vera el motivo.
        setFase('fuera')
      }
    })()
  }, [])

  const entrar = useCallback(async (usuario: string, clave: string) => {
    await api.entrar(usuario, clave)
    const a = await api.estado()
    setAcceso(a)
    setFase('dentro')
  }, [])

  const salir = useCallback(async () => {
    try {
      await api.salir()
    } catch {
      // Aunque el servidor no conteste, en el telefono la sesion se cierra.
    }
    setAcceso(null)
    setFase('fuera')
  }, [])

  const valor = useMemo(() => ({ fase, acceso, entrar, salir }), [fase, acceso, entrar, salir])
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useSesion(): Sesion {
  const s = useContext(Contexto)
  if (!s) throw new Error('useSesion fuera de SesionProvider')
  return s
}
