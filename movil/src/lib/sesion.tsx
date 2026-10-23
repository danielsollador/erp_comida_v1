import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, cargarServidor, cargarToken, cuandoCaduque } from './api'
import { vaciarCache } from './cache'
import { olvidarTelefono, registrarTelefono } from './push'
import { marcaDe, useMarca } from './tema'
import type { EstadoAcceso } from './tipos'

type Fase = 'cargando' | 'fuera' | 'dentro'

type Sesion = {
  fase: Fase
  acceso: EstadoAcceso | null
  entrar: (usuario: string, clave: string) => Promise<void>
  salir: () => Promise<void>
  /** Vuelve a pedir quien esta dentro (despues de cambiar el nombre, el PIN, el rol). */
  recargar: () => Promise<void>
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
  const { ponerMarca } = useMarca()

  // Al saber de que local es la sesion, la app se viste de su marca (el cobre
  // es solo de Savora; lo demas, Vertigo). Igual que `data-marca` en la web.
  useEffect(() => {
    if (acceso) ponerMarca(acceso.es_hub ? 'vertigo' : marcaDe(acceso.local?.slug))
  }, [acceso, ponerMarca])

  // Notificaciones push (lib/push.ts): solo a quien autoriza, que es a quien
  // le llegan los dos avisos (permisos de la caja y caja sin cerrar).
  const autoriza = fase === 'dentro' && Boolean(acceso?.puede.autoriza)
  useEffect(() => {
    if (autoriza) void registrarTelefono()
  }, [autoriza])

  useEffect(() => {
    cuandoCaduque(() => {
      setAcceso(null)
      setFase('fuera')
    })
    ;(async () => {
      try {
        // Primero A QUE negocio: el token es de ese servidor.
        await cargarServidor()
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
    await olvidarTelefono()
    vaciarCache()
    try {
      await api.salir()
    } catch {
      // Aunque el servidor no conteste, en el telefono la sesion se cierra.
    }
    setAcceso(null)
    setFase('fuera')
  }, [])

  const recargar = useCallback(async () => {
    const a = await api.estado()
    if (a.autenticado) setAcceso(a)
  }, [])

  const valor = useMemo(() => ({ fase, acceso, entrar, salir, recargar }), [fase, acceso, entrar, salir, recargar])
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useSesion(): Sesion {
  const s = use(Contexto)
  if (!s) throw new Error('useSesion fuera de SesionProvider')
  return s
}
