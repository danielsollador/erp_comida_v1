import { useAcceso } from '../lib/acceso'

/**
 * La marca del local: su logo si la ficha lo declara (`locales/<slug>.json`,
 * servido por nginx sin sesion), y si no, el rombo con el nombre.
 *
 * Es lo que va arriba de cada pantalla en vez del nombre escrito: quien entra
 * al ERP de Savora tiene que ver a Savora, no un rotulo en mayusculas. Y como
 * el logo sale de la ficha del local, el siguiente local trae el suyo sin
 * tocar el codigo.
 */
export default function Marca({
  sobreOscuro = false,
  className = 'h-6',
}: {
  /** Sobre un fondo oscuro fijo (la barra oscura del POS) el logo se aclara
   *  aunque el tema sea claro. */
  sobreOscuro?: boolean
  /** El alto lo pone quien lo usa (`h-6`, `h-8 lg:h-12`...); el ancho sale de
   *  la proporcion del archivo. */
  className?: string
}) {
  const { estado } = useAcceso()
  if (estado.local.logo) {
    return (
      <img
        src={estado.local.logo}
        alt={estado.local.nombre}
        className={`vp-logo ${sobreOscuro ? 'vp-logo-claro' : ''} ${className}`}
      />
    )
  }
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="vp-rombo" />
      <span className="vp-etiqueta">{estado.local.nombre}</span>
    </span>
  )
}
