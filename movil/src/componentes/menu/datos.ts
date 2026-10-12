import { useFocusEffect } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import { etiquetaVariante } from '../../../../frontend/src/lib/menu'
import { apiMenu } from '../../lib/api-menu'
import type { Categoria, CostoVariante, Variante } from '../../lib/tipos'
import { llano } from '../kit'

/*
 * LO QUE COMPARTEN EL MENU, LAS RECETAS Y EL EDITOR DE UNA RECETA: el menu
 * con lo que cuesta cada variante, y las reglas de la web para leerlo
 * (pages/Menu.tsx y pages/partes/Recetas.tsx).
 */

export type DatosMenu = { categorias: Categoria[]; costos: Map<number, CostoVariante> }

/**
 * El menu y sus costos, de una vez (como `cargar()` de la web: dos llamadas
 * en paralelo). Se vuelve a pedir al volver a la pantalla --la receta que se
 * acaba de guardar cambia el costo y el margen de todo-- y despues de cada
 * cambio, sin poner la pantalla en "cargando": lo de antes se queda a la
 * vista mientras llega lo nuevo.
 */
export function useDatosMenu() {
  const [datos, setDatos] = useState<DatosMenu | null>(null)
  const [error, setError] = useState('')
  const [refrescando, setRefrescando] = useState(false)
  const vivo = useRef(true)

  const recargar = useCallback(async () => {
    try {
      const [categorias, costos] = await Promise.all([apiMenu.listarCategorias(), apiMenu.costosVariantes()])
      if (!vivo.current) return
      setDatos({ categorias, costos: new Map(costos.map((c) => [c.variante_id, c])) })
      setError('')
    } catch (e) {
      if (vivo.current) setError(e instanceof Error ? e.message : 'No se pudo cargar el menú.')
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      vivo.current = true
      void recargar()
      return () => {
        vivo.current = false
      }
    }, [recargar]),
  )

  const refrescar = useCallback(async () => {
    setRefrescando(true)
    await recargar()
    setRefrescando(false)
  }, [recargar])

  return { datos, error, refrescando, recargar, refrescar }
}

/** "1 producto", "4 productos": nada de "producto(s)". */
export function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`
}

/** El mensaje de un error de la API, ya en palabras. */
export function mensajeDe(e: unknown, siNo = 'No se pudo.'): string {
  return e instanceof Error && e.message ? e.message : siNo
}

/** Las palabras de una busqueda, sin tildes ni mayusculas (`palabrasDe` de la web). */
export function palabrasDe(texto: string): string[] {
  return llano(texto).split(/\s+/).filter(Boolean)
}

/** Si el texto tiene TODAS las palabras, en cualquier orden (`contiene` de la web). */
export function contiene(texto: string, palabras: string[]): boolean {
  const t = llano(texto)
  return palabras.every((p) => t.includes(p))
}

/** Cuantas cosas hay fuera del menu: categorias, productos y variantes. */
export function cuantosRetirados(categorias: Categoria[]): number {
  let n = 0
  for (const c of categorias) {
    if (!c.activo) {
      n += 1
      continue
    }
    for (const p of c.productos) {
      if (!p.activo) {
        n += 1
        continue
      }
      n += p.variantes.filter((v) => !v.activo).length
    }
  }
  return n
}

// ── Recetas ─────────────────────────────────────────────────────────────────

/** Una variante del menu, con lo que hace falta para la lista de recetas. */
export type RenglonReceta = {
  variante: Variante
  /** "Empanada - Carne", o "Malta" a secas si tiene una sola variante. */
  nombre: string
  categoria: string
  info?: CostoVariante
  productoId: number
  producto: string
  varianteNombre: string
}

/**
 * LO QUE SE VE ES LO QUE SE USA PARA DECIDIR EL PRECIO (web, 8-oct): el costo
 * con el metodo elegido en Configuracion (ultimo costo, promedio o el mayor)
 * y con su parte del aceite si se frie. Antes era siempre el promedio y sin
 * aceite: un pastelito frito salia con 93 % de margen cuando dejaba 56 %.
 */
export function paraPrecio(c: CostoVariante | undefined): CostoVariante | undefined {
  if (!c || c.costo_para_precio == null) return c
  return { ...c, costo: c.costo_para_precio, margen_pct: c.margen_para_precio_pct ?? c.margen_pct }
}

/**
 * Lo que sigue EN el menu y se cocina. Los envios no llevan receta: contarlos
 * como "sin receta" hacia que esta cifra y la de la portada no coincidieran.
 */
export function renglonesDe(datos: DatosMenu): RenglonReceta[] {
  return datos.categorias
    .filter((c) => c.activo && llano(c.nombre) !== 'envios')
    .flatMap((c) =>
      c.productos
        .filter((p) => p.activo)
        .flatMap((p) =>
          p.variantes
            .filter((v) => v.activo)
            .map((v) => ({
              variante: v,
              nombre: etiquetaVariante(p, v),
              categoria: c.nombre,
              info: paraPrecio(datos.costos.get(v.id)),
              productoId: p.id,
              producto: p.nombre,
              varianteNombre: v.nombre,
            })),
        ),
    )
}
