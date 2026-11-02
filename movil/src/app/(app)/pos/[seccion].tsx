import PuntoDeVenta from '../../../componentes/pos/PuntoDeVenta'

/**
 * /pos/pedidos (y /pos/tomar): la misma pantalla, abierta en la seccion de
 * la ruta. Cambiar de seccion adentro no la remonta: la comanda a medio
 * tomar sigue ahi.
 */
export default function PosSeccion() {
  return <PuntoDeVenta />
}
