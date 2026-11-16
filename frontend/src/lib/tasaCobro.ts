/**
 * Con qué tasa se pasan a dólares los bolívares que la cajera cuenta en la
 * gaveta (specs/tasa.md).
 *
 * Si hoy se cobró a dos tasas (el dueño cambió de dólar a euro a media jornada),
 * la gaveta tiene bolívares de las dos. Convertirlos todos a una sola tasa
 * inventa un faltante o un sobrante: $5,80 cobrados, 5.581,28 Bs en la gaveta
 * y $0,28 de "faltante" falso. El servidor manda en `tasa_cobros` los Bs que
 * entraron por cada dólar cobrado hoy; con ella lo contado cuadra exacto. Sin
 * cobros del día, o sin ese dato (servidor viejo), se usa la tasa de cobro de
 * hoy.
 */
export function tasaDeConteo(linea: { tasa_cobros?: number | null }, tasaCobro: number | null | undefined): number {
  if (linea.tasa_cobros && linea.tasa_cobros > 0) return linea.tasa_cobros
  return tasaCobro && tasaCobro > 0 ? tasaCobro : 0
}
