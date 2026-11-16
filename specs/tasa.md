# Spec: Tasa de cobro

Tasa de cambio · bloque 1.11 · **Aprobada** por Daniel (16-nov)

## Qué resuelve

Savora cobra en bolívares, pero con los precios en divisa. Yeimer quiere elegir con qué tasa se pasan a bolívares al cobrar: el dólar BCV o el euro BCV. Hoy lo logra pegando el euro en la casilla del dólar, y eso rompe el encabezado y todo lo que lee esa casilla.

## Hoy

- Hay una sola tasa de cobro: el dólar BCV, o una cifra manual que se guarda en su lugar y manda ese día.
- Cada pedido congela la tasa con la que se cobró. El Libro de Ventas, el IVA y las retenciones salen de esos bolívares.
- El euro BCV se guarda aparte, solo para verlo.

## Qué tiene que pasar

- En Tasa de cambio, una sección «Con qué tasa cobro en Bolívares» con tres opciones: Dólar BCV (la de siempre), Euro BCV y Manual.
- Elegir una no cambia las otras: el dólar y el euro se guardan siempre como los publica el BCV. La tasa manual ya no se guarda en la casilla del dólar.
- Con Dólar o Euro, la tasa de cobro sigue al BCV cada día. Con Manual, dura hasta que se cambie, y avisa si es de otro día.
- Lo que se cobra después del cambio congela la tasa elegida. Lo ya cobrado no cambia nunca.
- Los precios, costos y recetas siguen en divisa. Ejemplo: $2,90 son 2.650,66 Bs con el dólar (914,0218) y 2.930,62 Bs con el euro (1.010,56).
- Lo que va al SENIAT son los bolívares cobrados: el Libro de Ventas, el IVA, las retenciones y Cuentas por cobrar leen la tasa congelada del pedido.
- El cierre de caja espera los bolívares que entraron de verdad, cada cobro a su tasa, no los dólares pasados a la tasa del momento. Con dos tasas en el mismo día y los $5,80 cobrados (5.581,28 Bs en la gaveta), el cierre no marca faltante ni sobrante.
- Los vueltos en bolívares y los pagos en bolívares a proveedores usan la tasa de cobro vigente (decisión de Daniel, 16-nov).
- Cambiarla pide la firma de quien autoriza (R5 de `specs/qa.md`) y queda en el historial con quién y cuándo. Un salto de más de 30 % pide confirmar.
- El encabezado dice qué tasa se usa («Bs · Euro BCV 1.010,56»), y el cobro del punto de venta lo repite en una línea junto al total. La app móvil igual.
- Vista en euros: con la tasa de cobro en euro, un precio de $2,90 se ve €2,90. Las ventas viejas se ven con su tasa congelada.
- Sin conexión: la venta guardada lleva la tasa con la que se tomó, y la regla de la tasa histórica (bloque 1.5) compara contra la tasa de cobro de ese día.
- Cada cifra y cada opción se explican en `lib/glosario.ts`, en las dos formas de lenguaje.

## Por decidir

- **D16 (no bloquea):** los libros siguen en dólares y no cambian. Una factura de compra en dólares se pasa a bolívares para el Libro de Compras con el dólar BCV de su fecha, pero su pago en bolívares sale a la tasa de cobro. La diferencia, la ve el contador después; no se programa nada contable.
- **D17 (resuelta, se programa):** al cambiar de tasa a mitad del día, la gaveta de bolívares queda a dos tasas. Hoy el cierre cuenta en dólares y la pantalla convierte con una sola tasa: probado en local con 5.581,28 Bs exactos, da un faltante falso de $0,28 por aprobar. El cierre espera los Bs de cada cobro a su tasa.
- **D18:** ¿la tasa manual vence a medianoche o dura hasta que se cambie? Se asume que dura y avisa.
- **D19 (del contador, no bloquea el código):** ¿cobrar a tasa euro y declararlo así es válido ante el SENIAT?

## Cómo se valida

1. En Tasa de cambio, elegir Euro BCV: pide firma, y el encabezado y el cobro dicen «Euro BCV 1.010,56».
2. Cobrar un pastelito de $2,90 en efectivo en bolívares: son 2.930,62 Bs. Con Dólar BCV son 2.650,66 Bs.
3. En el Libro de Ventas, esa venta lleva 2.930,62 Bs con su IVA, y una venta de antes del cambio conserva su tasa.
4. El dólar BCV de la pantalla sigue en 914,0218 mientras se cobra a euro.
5. Dar un vuelto en bolívares y pagar a un proveedor en bolívares usan la tasa elegida.
6. Cobrar con las dos tasas el mismo día y cerrar la caja contando los bolívares reales: cuadra sin diferencia.
7. Con Manual, escribir una cifra con un salto de más de 30 % pide confirmar.
