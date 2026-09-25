/**
 * El agarre de una fila que se puede arrastrar: seis puntos, que es como se
 * dibuja "esto se mueve".
 *
 * COMPARTIDO por el mismo motivo que `MenuAcciones`: arrastrar para reordenar
 * o para cambiar de cajon es el mismo gesto en el menu y en el deposito, asi
 * que tiene que dibujarse igual en los dos (Leider, 24-sep).
 */
export default function Agarre() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden>
      <circle cx="6" cy="3" r="1.3" />
      <circle cx="10" cy="3" r="1.3" />
      <circle cx="6" cy="8" r="1.3" />
      <circle cx="10" cy="8" r="1.3" />
      <circle cx="6" cy="13" r="1.3" />
      <circle cx="10" cy="13" r="1.3" />
    </svg>
  )
}
