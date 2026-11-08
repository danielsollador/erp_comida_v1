# Spec: Hallazgos del QA de noviembre

Transversal · bloque 1.3 · **Aprobada** (Daniel, 8-nov-2026: «corregir todos los hallazgos del PDF»). Origen: `Savora-QA-resumen-noviembre.pdf` (32 hallazgos sobre la versión 5f39cf2, probados en una copia de producción). El cierre de caja tiene su propia spec: `specs/caja.md`.

## Qué resuelve

Errores de dinero, permisos y operación que el dueño ya sufre: montos que se leen mil veces menores, pagos dobles, meses declarados que cambian, cajeras que hacen lo que solo el dueño debería, y una IA que afirma cifras falsas.

## Qué tiene que pasar

**Reglas generales (sirven a todo cliente)**
- R1 · Un monto se escribe como en Venezuela y se lee igual en toda la app y la app móvil: «17.922,45», «17922,45», «17922.45» y «5.000» significan lo mismo en cualquier casilla. Una sola función lo lee.
- R2 · Nada que mueva plata se registra dos veces por un doble toque o un reintento: el botón se bloquea mientras guarda, y el servidor rechaza el segundo envío del mismo pago.
- R3 · Un mes con IVA declarado queda congelado: ninguna factura, pago, gasto, retiro, devolución ni cierre con fecha (o registro) en ese mes se crea, cambia ni borra. El mensaje dice por qué y qué hacer (anotarlo en el mes abierto).
- R4 · Lo que mueve plata y se sale de lo normal pide confirmar antes de guardar: un monto 5 veces mayor que el habitual de ese pago, una fecha de más de 31 días atrás, un gasto de caja mayor a lo que hay en la gaveta.
- R5 · Anular, dar de baja, corregir un cierre, borrar algo de un día cerrado y cambiar la tasa piden la firma de quien autoriza (PIN o aprobación desde la app). Quien autoriza no firma nada extra.

**Por hallazgo** (número del PDF → regla)

| # | Qué tiene que pasar |
|---|---|
| 1 | R1 en cierre, Compras, cobro y pagos. |
| 2 | R2 en pagar factura, pagar fijo, abonar y retirar. |
| 3 | Ver `specs/caja.md`. |
| 4 | R3. Declarar avisa antes si hay ventas sin facturar con débito $0 o faltan RIF y razón social, y pide confirmar. |
| 5 | La tasa se lee con R1 («1.001,18» es mil). Un salto de más de 30 % contra la tasa anterior no se guarda solo: queda la anterior y se avisa. |
| 6 | Balance y Estado de resultados dicen lo mismo que los asientos: el resumen de un día se rehace si no coincide. |
| 7 | Un retiro o gasto de efectivo mayor a lo que hay en esa gaveta no se guarda. |
| 8 | La portada dice el faltante o sobrante de todas las gavetas y bancos del día, no solo bolívares. |
| 9 | La cajera no ve ganancia, margen ni costo en Reportes; no cambia la tasa sin firma; dar de baja, corregir y anular cierres y borrar de días cerrados piden firma (R5). |
| 10, 11 | Ver `specs/caja.md`. |
| 12 | R4. |
| 13 | Dona nunca suma a mano: toda cifra sale de una herramienta; si no la tiene, dice que no lo sabe. Gastos del mes = Estado de resultados. |
| 14 | Cada cierre, anulación y corrección guarda la persona de turno (operador con PIN) además del usuario. |
| 15 | Los Bs de la gaveta no «faltan» al subir la tasa (ver `specs/caja.md`). |
| 16 | Un pago en Bs a tasa distinta de la BCV se asienta a la BCV y la diferencia va a diferencial cambiario, para que el banco en libros cuadre con el real. |
| 17 | Una factura con mercancía se puede anular entera: devuelve inventario, IVA y la plata (banco o proveedor), si su mes no está declarado. |
| 18 | Guardar una factura de un proveedor nuevo lo crea en Proveedores con su RIF. |
| 19 | La portada avisa los días con ventas sin cierre del último mes. |
| 20 | «Pago menor» no acepta sueldos: si el concepto parece sueldo, lo manda a Pagos como sueldo. |
| 21 | El explicador del descuadre mira primero si la apertura tuvo la misma diferencia. |
| 22 | El vuelto en dólares se redondea a billetes; los centavos se dan en Bs. |
| 23 | Una referencia de pago móvil ya usada avisa al cobrar y pide confirmar. |
| 24 | Producir una preparación tolera el redondeo (0,1 %). El «rinde» de la API se sigue ignorando: la receta es por uno desde el 8-oct (decisión de Leider). |
| 25 | El botón kg / g queda separado de la cantidad en el teléfono. |
| 26 | «Te deben…» lleva a Cuentas por cobrar; el historial de cobros muestra también los abonos hechos desde Ventas y Caja. |
| 27 | Dona y Reportes dan a la cajera lo mismo: ventas sí, ganancia no. |
| 28 | La factura a medio cargar se guarda como borrador en el aparato y vuelve al regresar. |
| 29 | Las tablas de Caja › Historial, Contabilidad, Pagos y Cuentas por cobrar se exportan a CSV y Excel. |
| 30 | La portada responde en menos de medio segundo con un mes de datos. |
| 31 | Si faltan RIF o razón social, Impuestos lo avisa arriba con el botón para cargarlos (es dato, no código). |
| 32 | El pago menor de la gaveta Bs se escribe en Bs; la fila «Fiado» del cierre guarda lo fiado ese día. |

## Por decidir

Nada abierto: los umbrales (5 veces, 31 días, 30 %, $20, $0,10) son la propuesta y se ajustan en un solo lugar.

## Cómo se valida

1. Escribir «17.922» Bs en Compras, en el cierre y en un cobro: en los tres se lee diecisiete mil.
2. Tocar dos veces seguidas «Pagar» en una factura a crédito y en el alquiler: un solo pago.
3. Declarar octubre y luego intentar cargar una factura, un pago y una devolución de octubre: no deja y dice por qué.
4. Como cajera: Reportes sin ganancia, tasa y anulaciones piden firma.
5. Retirar $5.000 con $133 en la gaveta: no deja.
6. Preguntar a Dona «¿cuánto fueron los gastos de octubre?»: misma cifra que el Estado de resultados.
