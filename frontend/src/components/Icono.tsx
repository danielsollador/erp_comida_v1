import type { SVGProps } from 'react'

/**
 * Iconografia del sistema: trazos de 1.75 px sobre una caja de 24, al estilo
 * Lucide. Van en linea (sin libreria) porque son veinte y el POS tiene que
 * arrancar rapido en una tablet con la conexion del local.
 *
 * Los nombres son lo que representan en el ERP, no el dibujo: `caja` es el
 * cierre de caja aunque el dibujo sea un billete.
 */
export type NombreIcono =
  | 'inicio'
  | 'pos'
  | 'cocina'
  | 'reportes'
  | 'ventas'
  | 'calendario'
  | 'menu'
  | 'recetas'
  | 'inventario'
  | 'compras'
  | 'caja'
  | 'tasa'
  | 'contabilidad'
  | 'impuestos'
  | 'usuarios'
  | 'sistema'
  | 'atras'
  | 'salir'
  | 'cuenta'
  | 'chevron'
  | 'alerta'
  | 'ok'
  | 'campana'
  | 'campana-muda'
  | 'chispa'

const TRAZOS: Record<NombreIcono, string> = {
  inicio: 'M3 10.5 12 3l9 7.5M5 9.8V21h14V9.8M10 21v-6h4v6',
  pos: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 0 1-8 0',
  cocina:
    'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z',
  reportes: 'M3 3v18h18M18 17V9M13 17V5M8 17v-3',
  // Un recibo: la lista de lo vendido, con su linea de total.
  ventas: 'M5 3h14v18l-2.3-1.5L14.3 21 12 19.5 9.7 21 7.3 19.5 5 21zM8 8h8M8 12h8M8 16h5',
  calendario: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
  menu: 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z',
  recetas: 'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7',
  inventario:
    'm7.5 4.27 9 5.15M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Zm-17.7-1 8.7 5 8.7-5M12 22V12',
  compras:
    'M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1ZM16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 17.5v-11',
  caja: 'M2 6h20v12H2zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4M6 12h.01M18 12h.01',
  tasa: 'M8 3 4 7l4 4M4 7h16m-4 14 4-4-4-4M20 17H4',
  contabilidad:
    'M4 2h16v20H4zM8 6h8M16 14v4M16 10h.01M12 10h.01M8 10h.01M12 14h.01M8 14h.01M12 18h.01M8 18h.01',
  impuestos: 'M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2l8 5H4z',
  usuarios: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  sistema:
    'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
  atras: 'm12 19-7-7 7-7M19 12H5',
  salir: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9',
  cuenta: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  chevron: 'm9 18 6-6-6-6',
  alerta: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  ok: 'M20 6 9 17l-5-5',
  campana: 'M10.3 21a1.94 1.94 0 0 0 3.4 0M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9',
  'campana-muda': 'M10.3 21a1.94 1.94 0 0 0 3.4 0M18 8a6 6 0 0 0-9.3-5M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h13M2 2l20 20',
  // El destello: lo que hoy se entiende como "esto lo calculo el sistema".
  chispa: 'M12 3v3m0 12v3M4.2 7.2l2.1 2.1m11.4 11.4-2.1-2.1M3 12h3m12 0h3M4.2 16.8l2.1-2.1M17.7 3.3l-2.1 2.1M12 8.5 13.2 11 15.5 12l-2.3 1L12 15.5 10.8 13 8.5 12l2.3-1z',
}

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
