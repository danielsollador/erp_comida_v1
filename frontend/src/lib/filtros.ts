import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * LOS FILTROS DE UNA PANTALLA, EN LA URL.
 *
 * Igual que el rango de fechas (`?r=`, `lib/fechas.ts`) y la seccion (`?s=`,
 * `Secciones.tsx`): `?c=3&p=12` es "la categoria 3, el producto 12". Volver
 * atras vuelve al filtro anterior, recargar no lo pierde, y un enlace a
 * "las ventas de los refrescos en agosto" es un enlace de verdad.
 *
 * VARIOS A LA VEZ, en una sola escritura. Elegir una categoria tiene que
 * soltar el producto que no es de ella: dos `set` seguidos sobre la misma
 * URL se pisan (cada uno parte de los parametros con que se dibujo la
 * pantalla), asi que `fijar` recibe todos los cambios juntos.
 */
export function useFiltrosUrl<const N extends readonly string[]>(
  nombres: N,
): [Record<N[number], string>, (cambios: Partial<Record<N[number], string>>) => void] {
  const [params, setParams] = useSearchParams()

  const valores = useMemo(() => {
    const v = {} as Record<N[number], string>
    for (const n of nombres) v[n as N[number]] = params.get(n) ?? ''
    return v
    // `nombres` es una constante de la pantalla; los valores cambian con la URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const fijar = useCallback(
    (cambios: Partial<Record<N[number], string>>) => {
      const p = new URLSearchParams(params)
      for (const [n, valor] of Object.entries(cambios) as [string, string | undefined][]) {
        if (valor) p.set(n, valor)
        else p.delete(n)
      }
      setParams(p, { replace: true })
    },
    [params, setParams],
  )

  return [valores, fijar]
}

/** `'12'` -> 12; `''` o cualquier cosa que no sea un numero -> undefined. */
export function idDe(valor: string): number | undefined {
  const n = Number(valor)
  return valor && Number.isInteger(n) && n > 0 ? n : undefined
}

/** Para buscar sin que importen las tildes ni las mayusculas. */
export function llano(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}
