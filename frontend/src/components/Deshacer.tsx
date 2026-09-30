import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/**
 * "Deshacer" en vez de "¿Estás seguro?".
 *
 * Una ventana de confirmación le pasa el miedo a quien la usa: hay que leer,
 * decidir y tocar otra vez, veintiocho veces por todo el sistema (Leider,
 * 30-sep: "pide demasiada confirmación"). Aquí la acción se hace de una y
 * durante unos segundos queda un aviso abajo con "Deshacer". Quien se
 * equivocó lo toca; quien no, sigue trabajando.
 *
 * Dos formas, según lo que permita el servidor:
 *
 *  - Con `revertir`: la acción corre YA y deshacer llama al reverso (archivar
 *    ↔ reactivar). Lo que se ve en pantalla es siempre lo que hay.
 *  - Sin `revertir`: la acción ESPERA unos segundos y solo corre si nadie la
 *    deshizo (borrar un gasto no tiene reverso). Mientras tanto la fila se
 *    esconde con `oculto(clave)`, así se ve como hecha sin serlo todavía.
 *    Cerrar la pestaña en esos segundos la ejecuta igual: al descargar, se
 *    disparan las pendientes.
 */
export type Pendiente = {
  /** Identifica la fila: "gasto:12". Sirve para esconderla mientras espera. */
  clave: string
  /** Lo que dice el aviso: "Gasto borrado". */
  texto: string
  ejecutar: () => Promise<unknown>
  /** El reverso, si existe. Con él, `ejecutar` corre de inmediato. */
  revertir?: () => Promise<unknown>
  /** Se llama cuando todo terminó (hecho o deshecho): para recargar la lista. */
  alTerminar?: () => void
  /** Si falla, adónde contarlo. */
  alFallar?: (e: unknown) => void
}

const ESPERA_MS = 6000

type Contexto = {
  deshacible: (p: Pendiente) => void
  oculto: (clave: string) => boolean
}

const Ctx = createContext<Contexto | null>(null)

export function useDeshacer(): Contexto {
  const c = useContext(Ctx)
  if (!c) throw new Error('useDeshacer se usa dentro de <DeshacerProvider>')
  return c
}

type Vivo = Pendiente & { hecho: boolean; timer: number }

export function DeshacerProvider({ children }: { children: ReactNode }) {
  const [vivos, setVivos] = useState<Vivo[]>([])
  // El mismo listado, sin depender del render: lo leen los temporizadores y
  // el `beforeunload`, que no ven el estado de React al momento.
  const ref = useRef<Vivo[]>([])
  ref.current = vivos

  const quitar = useCallback((clave: string) => {
    setVivos((v) => v.filter((x) => x.clave !== clave))
  }, [])

  const correr = useCallback(
    async (p: Vivo) => {
      window.clearTimeout(p.timer)
      quitar(p.clave)
      if (p.hecho) return
      try {
        await p.ejecutar()
      } catch (e) {
        p.alFallar?.(e)
      }
      p.alTerminar?.()
    },
    [quitar],
  )

  const deshacible = useCallback(
    (p: Pendiente) => {
      // Dos avisos de la misma fila no tienen sentido: manda el último.
      setVivos((v) => {
        const previo = v.find((x) => x.clave === p.clave)
        if (previo) window.clearTimeout(previo.timer)
        return v.filter((x) => x.clave !== p.clave)
      })
      if (p.revertir) {
        const vivo: Vivo = { ...p, hecho: true, timer: 0 }
        void p
          .ejecutar()
          .then(() => {
            vivo.timer = window.setTimeout(() => quitar(p.clave), ESPERA_MS)
            setVivos((v) => [...v, vivo])
            p.alTerminar?.()
          })
          .catch((e) => p.alFallar?.(e))
        return
      }
      const vivo: Vivo = { ...p, hecho: false, timer: 0 }
      vivo.timer = window.setTimeout(() => void correr(vivo), ESPERA_MS)
      setVivos((v) => [...v, vivo])
    },
    [correr, quitar],
  )

  async function deshacer(p: Vivo) {
    window.clearTimeout(p.timer)
    quitar(p.clave)
    if (p.hecho && p.revertir) {
      try {
        await p.revertir()
      } catch (e) {
        p.alFallar?.(e)
      }
      p.alTerminar?.()
    }
    // Sin `hecho`, deshacer es simplemente no ejecutar: la fila vuelve sola
    // porque deja de estar oculta.
  }

  // Lo que espera no se pierde porque se cierre la pestaña: se dispara ya.
  useEffect(() => {
    const alDescargar = () => {
      for (const p of ref.current) if (!p.hecho) void p.ejecutar()
    }
    window.addEventListener('pagehide', alDescargar)
    return () => window.removeEventListener('pagehide', alDescargar)
  }, [])

  const api = useMemo<Contexto>(
    () => ({
      deshacible,
      oculto: (clave) => ref.current.some((p) => p.clave === clave && !p.hecho),
    }),
    // `oculto` lee la ref, pero tiene que cambiar de identidad cuando cambia
    // la lista para que las pantallas vuelvan a filtrar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deshacible, vivos],
  )

  const visible = vivos[vivos.length - 1]

  return (
    <Ctx.Provider value={api}>
      {children}
      {visible && (
        <div
          key={visible.clave}
          role="status"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-full bg-neutral-900 text-white pl-5 pr-2 py-2 shadow-[0_8px_24px_rgb(0_0_0/0.25)] max-w-[calc(100vw-2rem)]"
          style={{ animation: 'vp-entrar .18s cubic-bezier(.2,.7,.2,1) both' }}
        >
          <span className="text-sm truncate">{visible.texto}</span>
          <button
            type="button"
            onClick={() => void deshacer(visible)}
            className="vp-pulsable shrink-0 rounded-full bg-white/12 px-3.5 py-1.5 text-sm font-semibold hover:bg-white/20"
          >
            Deshacer
          </button>
        </div>
      )}
    </Ctx.Provider>
  )
}
