import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ErrorApi } from './api'
import { guardarCache, leerCache } from './cache'

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
export function useCarga<T>(cargar: () => Promise<T>, cadaSegundos = 60, clave?: string, cache?: string) {
  // Con `cache`, lo ultimo que llego se guarda en el telefono y la proxima
  // vez la pantalla arranca con eso mientras llega lo nuevo (lib/cache.ts).
  const [datos, setDatos] = useState<T | null>(() => (cache ? leerCache<T>(cache) : null))
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
      const nuevos = await cargarRef.current()
      setDatos(nuevos)
      setError('')
      if (cache) guardarCache(cache, nuevos)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar.')
    } finally {
      setRefrescando(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `cache` es fijo por pantalla
  }, [])

  useFocusEffect(
    useCallback(() => {
      correr(false)
      const id = setInterval(() => correr(false), cadaSegundos * 1000)
      return () => clearInterval(id)
    }, [correr, cadaSegundos]),
  )

  // Cambio lo que se pide (otro periodo, otro filtro): se vuelve a cargar ya,
  // dejando lo anterior en pantalla mientras llega.
  const primera = useRef(true)
  useEffect(() => {
    if (primera.current) {
      primera.current = false
      return
    }
    correr(false)
  }, [clave, correr])

  return { datos, error, refrescando, refrescar: () => correr(true) }
}
