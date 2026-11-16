# Spec: Cierre de caja como cuadre

Cierre de caja · bloque 1.10 · **Implementada** (8-nov-2026, rama `fix-2026-11-08-qa-noviembre`, sin desplegar). Aprobada por Daniel al pedir arreglar todo el QA de noviembre; D12–D15 confirmadas por él. La 1.6 (medianoche) agregará aquí su sección.

## Qué resuelve

El cierre se anulaba o corregía casi a diario (28 de 66 en producción) porque, además de cuadrar, escribía en los libros: cada tecleo de conteo o de apertura terminaba como gasto o ingreso. Lo usan la cajera, que cuenta, y el dueño, que revisa y aprueba.

## Hoy (antes de este bloque)

- Si nadie declaró el fondo al abrir, al cerrar la gaveta se daba por abierta en cero y lo que había pasaba a faltante.
- La diferencia del conteo y la de la apertura se asentaban solas, en el momento.
- Anular revertía la diferencia pero no la apertura en cero.
- Después de cerrar se podía vender y borrar gastos y retiros sin aviso; la cajera corregía y anulaba sin clave.

## Qué tiene que pasar

**Apertura**
- Sin caja abierta la pantalla no toma pedidos y dice por qué.
- Al abrir se cuenta a ciegas: lo esperado es lo que quedó en el último cierre y solo sirve para avisar si lo contado se aleja mucho.
- Si lo contado difiere de lo esperado en más de $20 y más de un 50 %, se pide confirmar antes de guardar.
- Abrir no crea asientos. La diferencia de la apertura queda «por aprobar».

**Cierre**
- El fondo de cada gaveta nunca arranca en cero por defecto: es lo que quedó en el último cierre.
- La cajera cuenta y cierra. Cerrar no crea asientos.
- La diferencia de cada forma de pago queda «por aprobar», con quién cerró y a qué hora.
- Un faltante o sobrante de más de $20 pide confirmar antes de cerrar.
- En la gaveta de bolívares, lo que viene de un cambio de tasa se separa como diferencial cambiario y no cuenta como faltante.

**Diferencias a los libros**
- Una diferencia solo va a los libros cuando alguien que autoriza la aprueba, con un motivo (D12: cada día).
- Las de menos de $0,10 se aprueban solas (D14).
- Mientras haya diferencias sin aprobar, la portada del dueño lo avisa con el total; si pasan de 3 días, el aviso sube de tono.

**Después de cerrar**
- Borrar un gasto o un retiro de un día cerrado pide la firma de quien autoriza.
- Si algo cambia en un día cerrado (una venta, un gasto, un retiro), el cierre queda marcado «por revisar» con lo que cambió.
- Corregir o anular un cierre pide la firma de quien autoriza (D13: el dueño y los roles que él marque como «autoriza»). Anular no crea asientos si la diferencia no estaba aprobada; si lo estaba, la revierte.

**Lo que no cambia**
- Ventas, gastos y pagos siguen entrando solos a los libros al momento.
- Los cierres y asientos pasados no se tocan (D15: los $321,94 de faltantes y sobrantes de sep–oct se revisan con el dueño).

## Por decidir

Nada abierto. D12–D15 confirmadas por Daniel el 8-nov: diferencias cada día, aprueba el dueño y los roles que él marque, menos de $0,10 sola, y los $321,94 de sep–oct se revisan con el dueño.

## Cómo se valida

1. Sin abrir la caja, intentar vender: no deja y dice por qué.
2. Abrir contando lo que hay, vender en efectivo $, Bs y punto, y cerrar contando exacto: ningún asiento nuevo, diferencia cero.
3. Cerrar con $5 de menos: queda «por aprobar» y la ganancia del día no cambia.
4. Aprobarla como dueño con un motivo: recién ahí aparece en los libros.
5. Abrir con $2.500 cuando en el último cierre quedaron $130: pide confirmar.
6. Vender después de cerrar: el cierre queda «por revisar».
7. Como cajera, anular un cierre: pide la firma del dueño.
