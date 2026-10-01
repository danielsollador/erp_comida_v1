import type { ReactNode } from 'react'
import { FiltroFechas } from './Fechas'
import type { Rango } from '../lib/fechas'

/**
 * LA FILA DE FILTROS DE UN MODULO. Una sola, la misma en todas las pantallas,
 * arriba del contenido: el periodo primero y, al lado, lo que cada pantalla
 * filtra (la categoria, el producto, el cajon del deposito).
 *
 * POR QUE AQUI Y NO EN EL ENCABEZADO. El periodo vivia arriba a la derecha,
 * entre la moneda, la campana y el tema: un filtro metido entre ajustes.
 * Leider (30-sep): "no tiene sentido que el filtro de fecha este en el mismo
 * lugar de configuraciones, deberia ser un lugar exacto para los filtros...
 * y ese lugar lo bajas para todos los modulos". Un filtro cambia LO QUE SE
 * VE; un ajuste cambia COMO se ve. Van en sitios distintos.
 *
 * A la derecha, lo que resulta del filtro ("Septiembre 2026 · 15 pedidos"):
 * es la respuesta a lo que se pidio a la izquierda, en la misma linea. Antes
 * ese rotulo era un parrafo suelto bajo el encabezado.
 *
 * Sin caja: las pastillas ya son superficies, y una caja alrededor de tres
 * pastillas es una caja mas que leer.
 */
export default function BarraFiltros({
  rango,
  alCambiar,
  children,
  resumen,
  alLimpiar,
}: {
  rango?: Rango
  alCambiar?: (r: Rango) => void
  /** Los demas filtros de la pantalla (`FiltroDesplegable`), a la derecha del periodo. */
  children?: ReactNode
  /** Lo que resulta: el nombre del periodo, cuantos pedidos. */
  resumen?: ReactNode
  /** Si hay algun filtro puesto aparte del periodo: el boton para soltarlos. */
  alLimpiar?: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {rango && alCambiar && <FiltroFechas rango={rango} alCambiar={alCambiar} />}
      {children}
      {alLimpiar && (
        <button
          type="button"
          onClick={alLimpiar}
          className="h-9 px-2 rounded-full text-sm text-neutral-500 hover:text-neutral-900 hover:bg-neutral-500/10"
        >
          Quitar filtros
        </button>
      )}
      {resumen && (
        <p className="ml-auto min-w-0 text-sm text-neutral-500 tabular-nums truncate max-sm:basis-full max-sm:ml-0">
          {resumen}
        </p>
      )}
    </div>
  )
}
