import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ErrorApi } from './api'

/** Un pedazo de la pantalla: llego, o fallo con su motivo (403 = el rol no lo ve). */
export type Parte<T> = { ok: true; valor: T } | { ok: false; error: string; estado: number }

export async function parte<T>(promesa: Promise<T>): Promise<Parte<T>> {
  try {
    return { ok: true, valor: await promesa }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'No se pudo cargar.',
      estado: e instanceof ErrorApi ? e.estado : 0,
    }
  }
}

/**
 * Carga al entrar a la pantalla, cada minuto mientras se mira, y al tirar
 * hacia abajo. Lo ultimo que llego se queda en pantalla mientras se refresca:
 * nada de parpadear a "cargando" cada minuto.
 */
export function useCarga<T>(cargar: () => Promise<T>, cadaSegundos = 60) {
  const [datos, setDatos] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [refrescando, setRefrescando] = useState(false)
  // La ultima version de `cargar` (puede depender de la sesion), sin que el
  // intervalo se reinicie con cada render.
  const cargarRef = useRef(cargar)
  useEffect(() => {
    cargarRef.current = cargar
  })

  const correr = useCallback(async (manual: boolean) => {
    if (manual) setRefrescando(true)
    try {
      setDatos(await cargarRef.current())
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar.')
    } finally {
      setRefrescando(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      correr(false)
      const id = setInterval(() => correr(false), cadaSegundos * 1000)
      return () => clearInterval(id)
    }, [correr, cadaSegundos]),
  )

  return { datos, error, refrescando, refrescar: () => correr(true) }
}
