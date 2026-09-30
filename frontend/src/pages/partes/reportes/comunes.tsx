import type { ReactNode } from 'react'
import { Ayuda, BotonAyuda } from '../../../components/Ayuda'
import { explicar } from '../../../lib/glosario'

/**
 * Lo que comparten las cuatro secciones de Reportes.
 *
 * POR QUE UN ARCHIVO APARTE. El modulo se reorganizo en Resumen, Ventas,
 * Perdidas e Inventario (Leider, 22-sep: "mi principal requerimiento es que
 * todo este mejor ordenado"). Cada seccion sigue el MISMO esqueleto --las
 * cifras arriba, las lecturas, y despues bloques con nombre--, y ese
 * esqueleto vive aqui para que las cuatro se lean igual.
 */

export type Dinero = (x: number, d?: number) => string

// El backend etiqueta los dias en corto ("Sab") para que quepan bajo una
// barra; en una frase se dice entero.
export const DIA_LARGO: Record<string, string> = {
  Lun: 'lunes',
  Mar: 'martes',
  Mie: 'miércoles',
  Jue: 'jueves',
  Vie: 'viernes',
  Sab: 'sábado',
  Dom: 'domingo',
}

/**
 * Un bloque con nombre dentro de una seccion: la pestaña dice DONDE estas
 * (Ventas), el bloque dice QUE estas mirando (Cuando se vende). Sin esto las
 * tarjetas iban una tras otra y habia que leerlas todas para saber que habia.
 */
export function Bloque({
  titulo,
  descripcion,
  children,
}: {
  titulo: string
  descripcion?: string
  children: ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-0.5">
        <h2 className="vp-etiqueta text-neutral-500">{titulo}</h2>
        {descripcion && <p className="text-xs text-neutral-400">{descripcion}</p>}
      </div>
      {children}
    </section>
  )
}

export function Kpi({
  titulo,
  valor,
  ayuda,
  destacado = false,
  tono,
  nota,
  delta,
}: {
  titulo: string
  valor: string
  /** Clave del glosario: la explicacion al posar el cursor en el titulo. */
  ayuda?: string
  destacado?: boolean
  tono?: 'bueno' | 'malo'
  /** Aclaracion bajo el numero, cuando el numero solo puede enganar. */
  nota?: string
  /** El cambio contra el periodo anterior, ya dibujado. */
  delta?: ReactNode
}) {
  const color = tono === 'malo' ? 'text-peligro-600' : tono === 'bueno' ? 'text-exito-600' : ''
  return (
    <div className="relative bg-white rounded-2xl border border-neutral-200 p-4 sm:p-5">
      {ayuda && <BotonAyuda explica={explicar(ayuda)} titulo={titulo} className="absolute top-3 right-3" />}
      <div className={`text-xs text-neutral-500 ${ayuda ? 'pr-7' : ''}`}>
        <Ayuda explica={explicar(ayuda)} titulo={titulo}>
          {titulo}
        </Ayuda>
      </div>
      {/* La misma cifra que `Cifra` en `components/ui.tsx`: tipografia de
          titulares, interletrado apretado y cifras tabulares. Son dos
          componentes distintos por historia --este nacio dentro de Reportes--
          pero tienen que verse iguales, porque el dueño pasa de Reportes a
          Ventas y espera leer el mismo numero de la misma forma. */}
      <div
        className={`font-display font-semibold tracking-tight tabular-nums leading-none mt-1.5 ${
          destacado ? 'text-[26px] lg:text-[30px]' : 'text-2xl'
        } ${color}`}
      >
        {valor}
      </div>
      {delta && <div className="mt-2">{delta}</div>}
      {nota && <div className="mt-2 text-[11px] leading-snug text-neutral-500">{nota}</div>}
    </div>
  )
}

export function Linea({
  etiqueta,
  monto,
  dinero,
  subtotal = false,
  total = false,
}: {
  etiqueta: string
  monto: number
  /** Formatea en la vista cambiaria elegida, a la tasa del periodo. */
  dinero: (x: number) => string
  subtotal?: boolean
  total?: boolean
}) {
  return (
    <div
      className={`flex justify-between py-1.5 ${
        subtotal || total ? 'border-t border-neutral-200 mt-1 pt-2' : ''
      } ${total ? 'font-bold text-base' : subtotal ? 'font-semibold' : 'text-sm'}`}
    >
      <span className={monto < 0 ? 'text-neutral-600' : ''}>{etiqueta}</span>
      <span
        className={`tabular-nums ${
          total && monto < 0 ? 'text-peligro-600' : monto < 0 ? 'text-neutral-600' : ''
        }`}
      >
        {monto < 0 ? '-' : ''}
        {dinero(Math.abs(monto))}
      </span>
    </div>
  )
}

/** Una tarjeta que dice que no hay nada que dibujar, sin dejar el hueco. */
export function Vacio({ children }: { children: ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4">
      <p className="text-sm text-neutral-500">{children}</p>
    </div>
  )
}


/**
 * La serie sin los tramos vacios de los extremos.
 *
 * SOLO LOS EXTREMOS. Un tramo en cero EN MEDIO es informacion --el martes no
 * se vendio nada, eso hay que verlo-- y por eso el servidor rellena los
 * huecos. Pero los ceros de ANTES del primer pedido y DESPUES del ultimo no
 * dicen nada del negocio: son el periodo que se pidio, nada mas. Con un rango
 * de nueve meses y ventas en la ultima semana, el grafico eran doscientos
 * sesenta dias de raya plana y un pico pegado al borde derecho (Leider,
 * 24-sep).
 *
 * La serie anterior se corta por los MISMOS indices: es tramo a tramo contra
 * la actual, y recortarlas por separado las desalinearia.
 *
 * VIVE AQUI y no dentro de una pantalla porque lo usan el Resumen y Ventas, y
 * ya paso una vez que se arreglara en una sola y quedaran distintas.
 */
export function recortarSerie<T extends { pedidos: number; ventas: number }>(
  serie: T[],
  anterior: T[],
): { serie: T[]; anterior: T[] } {
  const conDato = serie.map((p) => p.pedidos > 0 || p.ventas !== 0)
  const desde = conDato.indexOf(true)
  if (desde === -1) return { serie, anterior }
  const hasta = conDato.lastIndexOf(true)
  return {
    serie: serie.slice(desde, hasta + 1),
    anterior: anterior.length === serie.length ? anterior.slice(desde, hasta + 1) : anterior,
  }
}
