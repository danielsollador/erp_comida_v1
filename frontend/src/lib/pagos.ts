// 'Fiado' sigue siendo el valor que se guarda y se compara en toda la
// contabilidad (cambiarlo rompe reportes de ventas ya cerradas); esto solo
// traduce como se le llama delante del cliente. Un pago mixto llega como
// "Efectivo $ + Fiado", asi que hay que traducir cada parte por separado.
export function etiquetaMetodo(metodo: string): string {
  return metodo
    .split(' + ')
    .map((parte) => (parte === 'Fiado' ? 'A crédito' : parte))
    .join(' + ')
}
