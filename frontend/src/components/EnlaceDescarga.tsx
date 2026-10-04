import type { MouseEvent, ReactNode } from 'react'
import { descargar, esApp } from '../lib/plataforma'

/**
 * Un enlace para bajar un archivo del servidor (Excel, planillas, respaldos).
 *
 * En la web es un enlace de siempre: la cookie de la sesion viaja sola. En la
 * app un enlace no lleva el token, asi que se baja con el y se abre el menu de
 * compartir del telefono (ver `descargar` en lib/plataforma.ts).
 */
export default function EnlaceDescarga({
  ruta,
  nombre,
  className,
  onClick,
  children,
}: {
  /** La ruta del servidor: `/api/...`. */
  ruta: string
  /** El nombre del archivo si el servidor no lo dice. */
  nombre: string
  className?: string
  onClick?: () => void
  children: ReactNode
}) {
  const alTocar = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.()
    if (!esApp) return
    e.preventDefault()
    descargar(ruta, nombre).catch(() => window.alert('No se pudo descargar el archivo. Intenta otra vez.'))
  }
  return (
    <a href={ruta} onClick={alTocar} className={className}>
      {children}
    </a>
  )
}
