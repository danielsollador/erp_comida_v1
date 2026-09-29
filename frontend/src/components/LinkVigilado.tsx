import { Link, useNavigate, type LinkProps } from 'react-router-dom'
import { puedoSalir } from '../lib/sinGuardar'

/**
 * Un <Link> que pregunta antes de irse si la pantalla actual tiene cambios
 * sin guardar (ver lib/sinGuardar). Lo usan la flecha de volver, la miga y la
 * barra lateral: todo lo que saca de un modulo.
 */
export default function LinkVigilado({ to, onClick, ...resto }: LinkProps) {
  const navigate = useNavigate()
  return (
    <Link
      to={to}
      {...resto}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        void puedoSalir().then((ok) => {
          if (ok) navigate(to)
        })
      }}
    />
  )
}
