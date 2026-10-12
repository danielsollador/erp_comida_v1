import { useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Barra } from '../../../../componentes/Encabezado'
import Olla from '../../../../componentes/preparaciones/Olla'
import { Cargando, Pantalla, Problema } from '../../../../componentes/ui'
import { apiPreparaciones } from '../../../../lib/api-preparaciones'
import type { Ingrediente, Preparacion } from '../../../../lib/tipos'

/**
 * /inventario/preparaciones/[id]: la olla de una preparacion, o `nueva` para
 * crear una. Se carga UNA vez al entrar (la mercancia y la receta) y no se
 * refresca sola: lo que se esta escribiendo no se puede pisar con lo que
 * diga el servidor un minuto despues.
 */
export default function PantallaOlla() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const nueva = id === 'nueva'
  const [datos, setDatos] = useState<{ ingredientes: Ingrediente[]; prep: Preparacion | null } | null>(null)
  const [error, setError] = useState('')

  // Solo toca el estado cuando el servidor contesta: el efecto de abajo no
  // redibuja en cascada al montar.
  const pedir = useCallback(() => {
    Promise.all([apiPreparaciones.ingredientes(), nueva ? Promise.resolve([] as Preparacion[]) : apiPreparaciones.preparaciones()])
      .then(([ingredientes, preps]) => {
        const prep = nueva ? null : (preps.find((p) => String(p.id) === id) ?? null)
        if (!nueva && !prep) {
          setError('Esa preparación ya no está: puede que la hayan archivado.')
          return
        }
        setError('')
        setDatos({ ingredientes, prep })
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo traer la receta'))
  }, [id, nueva])

  useEffect(() => {
    pedir()
  }, [pedir])

  function reintentar() {
    setError('')
    pedir()
  }

  if (!datos) {
    return (
      <Pantalla arriba={<Barra titulo={nueva ? 'Nueva preparación' : 'Receta'} />}>
        {error ? <Problema mensaje={error} alReintentar={reintentar} /> : <Cargando />}
      </Pantalla>
    )
  }
  // `key`: otra preparacion (o volver a "nueva") arranca la olla de cero.
  return <Olla key={id} prep={datos.prep} ingredientes={datos.ingredientes} />
}
