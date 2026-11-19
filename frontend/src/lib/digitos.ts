export function agregarDigito(valor: string, digito: string, conservarCeros: boolean): string {
  return (valor === '0' && !conservarCeros ? '' : valor) + digito
}
