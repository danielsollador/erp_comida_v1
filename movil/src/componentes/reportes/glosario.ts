/**
 * QUE SIGNIFICA CADA CIFRA DE REPORTES Y DE TASA: la "i" de la esquina de
 * cada tarjeta, igual que en la web (Leider, 30-sep: "si le doy toque que
 * salte la info, para los de laptop y telefono").
 *
 * Los textos son los de frontend/src/lib/glosario.ts, copiados: ese archivo
 * lee lib/palabras.ts, que toca el navegador, y la app solo importa de la web
 * archivos de datos puros. Si la web cambia una explicacion, cambia aqui.
 *
 * Las cuatro partes responden siempre lo mismo: que es, de donde sale, como
 * se calcula y para que sirve.
 */
export type Explicacion = { que: string; origen?: string; calculo?: string; ejemplo?: string }

export const GLOSARIO: Record<string, Explicacion> = {
  // Reportes
  'kpi.ventas': {
    que: 'Todo lo que se cobró en el período.',
    origen: 'Los pedidos cobrados, sin los anulados ni los devueltos.',
    calculo: 'Suma de las ventas del período, con los descuentos ya aplicados.',
    ejemplo: 'Es el número grande que todo el mundo mira. No dice nada de si ganaste: para eso está la Ganancia neta.',
  },
  'kpi.ganancia_neta': {
    que: 'Lo que de verdad te quedó después de todo.',
    origen: 'Los mismos números del Estado de Resultados en Contabilidad.',
    calculo: 'Ventas − costo de la mercancía − gastos, mermas y faltantes.',
    ejemplo:
      'Puede ser negativa con ventas altas: es exactamente la situación que hay que detectar a tiempo. Este es el número que dice si el negocio funciona.',
  },
  'kpi.pedidos': {
    que: 'Cuántos pedidos se cobraron en el período.',
    origen: 'El conteo de pedidos cerrados.',
    ejemplo: 'Puesto al lado de las ventas explica de dónde viene un mes bueno: de más clientes, o de que cada uno gastó más.',
  },
  'kpi.ticket_promedio': {
    que: 'Cuánto gasta un cliente en promedio.',
    origen: 'Las ventas y los pedidos del período.',
    calculo: 'Ventas ÷ número de pedidos. Al lado se muestra la mediana cuando difieren.',
    ejemplo:
      'Un catering de $300 sube el promedio a un número que ningún cliente gasta; por eso al lado aparece "el cliente típico gastó X", que es sobre el que hay que decidir.',
  },
  'kpi.unidades': {
    que: 'Cuántas cosas se vendieron en el período.',
    origen: 'Los renglones de los pedidos cobrados, sumando cantidades. Las cortesías no entran.',
    ejemplo:
      'Con un producto elegido en los filtros, es cuántas de ese se vendieron: el número que sirve para saber cuánto preparar.',
  },
  'kpi.deja': {
    que: 'Lo que queda de lo vendido después de pagar la mercancía que lleva.',
    origen: 'Las ventas de lo que estás mirando y el costo de su receta en cada venta.',
    calculo: 'Ventas − costo de la mercancía. Sin gastos ni IVA: eso es del negocio entero, no de un producto.',
    ejemplo:
      'Si vendes $100 de empanadas y la carne, la harina y el aceite de esas empanadas costaron $38, te dejan $62: un 62% de margen.',
  },
  'kpi.dia_tipico': {
    que: 'Lo que vende un día de la semana normal, no la suma de todos.',
    origen: 'Las ventas de cada día de la semana, divididas entre las veces que ese día cayó en el período.',
    ejemplo: 'Un mes con cinco sábados sumaría más que uno con cuatro; el promedio por sábado compara lo mismo.',
  },
  'kpi.perdidas': {
    que: 'La plata que se te fue en el período.',
    origen: 'Las devoluciones, los descuentos y la merma de inventario (cuenta 6020 del libro).',
    calculo:
      'Devuelto + descuentos + merma. Lo anulado no se suma (nunca entró) ni lo vendido a crédito (todavía se puede cobrar).',
    ejemplo: 'Por encima de 3–4% de lo vendido, en comida, algo se está botando o se está yendo por la puerta.',
  },
  'kpi.merma_inventario': {
    que: 'El valor de lo que se botó, se dañó o faltó en un conteo.',
    origen: 'La cuenta 6020 del libro contable, que Inventario mueve con cada merma.',
    ejemplo: 'Se pagó como cualquier mercancía, pero no dejó ingreso. Los detalles están en Inventario › Pérdidas.',
  },
  'kpi.anuladas': {
    que: 'Pedidos que se anularon antes de venderse.',
    origen: 'Los pedidos en estado anulado del período.',
    ejemplo: 'No es plata perdida (nunca entró), pero sí trabajo perdido. Si crece, revisa cómo se toman los pedidos.',
  },
  'kpi.devueltas': {
    que: 'Ventas que el cliente trajo de vuelta y se le devolvió la plata.',
    origen: 'Las devoluciones registradas en el período (por la fecha en que se devolvieron).',
    ejemplo: 'Cada una salió de la caja después de haber entrado. Si se facturó, lleva su nota de crédito.',
  },
  'kpi.descuentos': {
    que: 'Lo que se dejó de cobrar por rebajas a clientes.',
    origen: 'El descuento de cada venta cobrada.',
    ejemplo: 'Un descuento razonable fideliza; muchos descuentos son un precio de lista que nadie paga.',
  },
  'kpi.valor_deposito': {
    que: 'Cuánta plata tienes guardada en forma de mercancía.',
    origen: 'Todo lo que hay en el inventario, valorado al costo.',
    calculo: 'Suma de (stock × costo promedio) de cada mercancía, sin IVA.',
    ejemplo:
      'Es plata quieta: no está en la gaveta ni en el banco, está en el estante. Si crece mientras las ventas no, estás comprando de más.',
  },
  'kpi.bajo_minimo': {
    que: 'Cuánta mercancía ya cruzó su punto de reposición.',
    origen: 'La mercancía cuyo stock cayó al mínimo o por debajo.',
    calculo: 'Cuenta de mercancías con stock ≤ mínimo.',
    ejemplo: 'Es la lista de compras de hoy. En cero significa que no vas a quedarte sin nada mañana.',
  },

  // Tasa
  'kpi.paralelo': {
    que: 'A cuánto está el dólar en el mercado paralelo.',
    origen: 'Binance P2P, consultado por el sistema.',
    ejemplo: 'No se factura con ella, pero es la que te va a costar reponer la mercancía.',
  },
  'kpi.euro': {
    que: 'A cuántos bolívares está el euro oficial hoy.',
    origen: 'Del BCV, que publica el euro aparte del dólar.',
    calculo: 'No sale de convertir el dólar: el BCV fija los dos por separado y no coinciden. Por eso se lee de la fuente.',
    ejemplo:
      'Eligiendo "Euro BCV" arriba, todos los montos del sistema se ven en euros a esa tasa. Útil si cobras o pagas en euros; lo que se factura sigue siendo el dólar oficial.',
  },
  'kpi.brecha': {
    que: 'Cuánto más caro está el dólar paralelo que el oficial.',
    origen: 'Se calcula con las dos tasas del día.',
    calculo: '(paralelo ÷ oficial − 1) × 100.',
    ejemplo:
      'Con una brecha de 20%, si facturas al oficial y compras al paralelo, esa diferencia sale de tu margen. Es el momento de revisar precios.',
  },
  'kpi.variacion_semana': {
    que: 'Cuánto se movió la tasa oficial en la última semana.',
    origen: 'Compara la tasa de hoy con la de hace siete días.',
    calculo: '(tasa de hoy ÷ tasa de hace 7 días − 1) × 100.',
    ejemplo:
      'Si subió 10% y tus precios en bolívares siguen iguales, cada venta de esta semana te deja 10% menos en dólares que la semana pasada.',
  },
  'kpi.variacion_periodo': {
    que: 'Cuánto se movió el dólar oficial dentro del período que elegiste arriba.',
    origen: 'La primera y la última tasa guardadas en ese tramo.',
    calculo: '(última ÷ primera − 1) × 100.',
    ejemplo:
      'Si subió 10% y el menú sigue igual, cada plato deja 10% menos de lo que dice la carta: la mercancía se reponen a la tasa nueva.',
  },
  'kpi.brecha_media': {
    que: 'La brecha promedio del período, no solo la de hoy.',
    origen: 'Se promedian las brechas de cada día con tasa guardada.',
    calculo: 'Media de (paralelo ÷ oficial − 1) × 100 de cada día.',
    ejemplo:
      'La de hoy puede ser un pico; la media dice con qué brecha vienes operando. Si la media sube mes a mes, el problema no es un día malo.',
  },
  'kpi.cobrado_bs': {
    que: 'Cuánto de lo que cobraste entró en bolívares, expresado en dólares.',
    origen: 'Los pagos del período hechos en efectivo Bs, pago móvil, transferencia, tarjeta o banco.',
    calculo: 'Se suma pago por pago, no venta por venta: en una venta mixta solo cuenta la parte que entró en bolívares.',
    ejemplo: 'Es la parte de tu venta que está expuesta a la brecha. Lo que te pagan en efectivo en dólares no lo está.',
  },
  'kpi.costo_brecha': {
    que: 'Lo que la brecha se llevó de lo que cobraste en bolívares.',
    origen: 'Lo cobrado en bolívares y la brecha vigente.',
    calculo: 'Cobrado en Bs × (1 − 1 ÷ (1 + brecha)). Con 11% de brecha, de cada $100 quedan $90.',
    ejemplo:
      'Es el número para comparar con un gasto: si se llevó $180 en el mes, es como una factura que pagaste sin verla. Se reduce cobrando más en divisas o ajustando precios.',
  },
  'kpi.exposicion': {
    que: 'Qué parte de lo que cobraste entró en bolívares.',
    origen:
      'Los pagos del período, método por método. Efectivo Bs, pago móvil, transferencia y tarjeta cuentan; efectivo en dólares y Zelle no.',
    calculo: 'Cobrado en bolívares ÷ cobrado total.',
    ejemplo:
      'Con 70% de exposición y 10% de brecha, pierdes 7% de toda la venta al reponer comprando divisas. Lo que entra en divisas no pierde nada.',
  },
  'kpi.proyeccion_30d': {
    que: 'Dónde estaría el dólar en 30 días si siguiera al ritmo de este período.',
    origen: 'La primera y la última tasa oficial del período.',
    calculo: 'Ritmo diario compuesto, proyectado 30 días hacia adelante.',
    ejemplo:
      'No es un pronóstico: nadie sabe qué hará el BCV. Sirve para dimensionar cuánto se encarece reponer si no cambia nada.',
  },
}

/** La clave de la explicacion: "bajo mínimo o agotadas" usa la de "bajo mínimo", como en la web. */
export function explicar(clave: string | undefined): Explicacion | undefined {
  if (!clave) return undefined
  return GLOSARIO[clave === 'kpi.bajo_minimo_agotadas' ? 'kpi.bajo_minimo' : clave]
}
