import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { NOMBRE_ROL, irAlHub, useAcceso } from '../lib/acceso'
import Icono from './Icono'

/**
 * Quien esta dentro, arriba a la derecha: su inicial, su nombre y un menu con
 * "Mi cuenta", "Usuarios" (solo quien administra), la administracion de
 * Vertigo (solo Vertigo) y "Salir". Mismo patron de apertura y cierre que el
 * selector de moneda.
 */
export default function UsuarioMenu({ dark = false }: { dark?: boolean }) {
  const { estado, salir } = useAcceso()
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', escape)
    }
  }, [abierto])

  const usuario = estado.usuario ?? ''
  const inicial = usuario.slice(0, 1).toUpperCase() || '?'
  const rol = NOMBRE_ROL[estado.rol ?? ''] ?? estado.rol ?? ''

  const item = `flex items-center gap-2.5 w-full text-left px-3 py-2 text-sm rounded-lg ${
    dark ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100'
  }`

  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={abierto}
        className={`h-9 pl-1 pr-3 rounded-full border flex items-center gap-2 text-sm font-medium ${
          dark ? 'border-neutral-700 hover:border-neutral-500' : 'border-neutral-200 hover:border-neutral-400 bg-white'
        }`}
      >
        <span
          className={`w-7 h-7 rounded-full grid place-items-center text-xs font-bold font-display ${
            dark ? 'bg-neutral-100 text-neutral-900' : 'bg-neutral-900 text-white'
          }`}
        >
          {inicial}
        </span>
        <span className="hidden sm:inline max-w-[9rem] truncate">{usuario}</span>
      </button>

      {abierto && (
        <div
          role="menu"
          className={`absolute right-0 mt-2 w-60 rounded-2xl border shadow-lg p-1.5 z-30 ${
            dark ? 'bg-neutral-900 border-neutral-700 text-white' : 'bg-white border-neutral-200'
          }`}
          style={{ animation: 'vp-entrar .18s cubic-bezier(.2,.7,.2,1) both' }}
        >
          <div className="px-3 pt-2 pb-2">
            <div className="text-sm font-semibold truncate font-display">{usuario}</div>
            <div className={`text-xs ${dark ? 'text-neutral-400' : 'text-neutral-500'}`}>
              {rol} · {estado.local.nombre}
            </div>
          </div>
          <div className={`h-px mx-1 mb-1 ${dark ? 'bg-neutral-800' : 'bg-neutral-100'}`} />
          <Link to="/mi-cuenta" className={item} onClick={() => setAbierto(false)}>
            <Icono nombre="cuenta" size={16} className="text-neutral-400" /> Mi cuenta
          </Link>
          {estado.puede.administrar && (
            <Link to="/usuarios" className={item} onClick={() => setAbierto(false)}>
              <Icono nombre="usuarios" size={16} className="text-neutral-400" /> Usuarios
            </Link>
          )}
          {estado.hub_url && estado.puede.vertigo && (
            // Solo Vertigo: el hub es la cartera de la plataforma. Va con pase
            // para no volver a poner la clave en el otro dominio.
            <button type="button" onClick={() => void irAlHub(estado.hub_url)} className={item}>
              <span className="vp-rombo scale-75 mx-0.5" /> Administración Vertigo
            </button>
          )}
          <div className={`h-px mx-1 my-1 ${dark ? 'bg-neutral-800' : 'bg-neutral-100'}`} />
          <button type="button" onClick={() => void salir()} className={`${item} text-peligro-600`}>
            <Icono nombre="salir" size={16} /> Salir
          </button>
        </div>
      )}
    </div>
  )
}
