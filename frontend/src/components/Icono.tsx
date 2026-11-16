import type { SVGProps } from 'react'
import { TRAZOS, type NombreIcono } from '../lib/iconos'

export type { NombreIcono }

/**
 * Iconografia del sistema: trazos de 1.75 px sobre una caja de 24, al estilo
 * Lucide. Van en linea (sin libreria) porque son veinte y el POS tiene que
 * arrancar rapido en una tablet con la conexion del local.
 *
 * Los nombres son lo que representan en el ERP, no el dibujo: `caja` es el
 * cierre de caja aunque el dibujo sea un billete.
 */
export default function Icono({
  nombre,
  size = 20,
  className = '',
  ...resto
}: { nombre: NombreIcono; size?: number; className?: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...resto}
    >
      <path d={TRAZOS[nombre]} />
    </svg>
  )
}
