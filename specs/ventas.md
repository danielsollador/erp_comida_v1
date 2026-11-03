# Spec: dos tablets y venta sin conexión

Ventas · bloques 1.4 y 1.5 · **Borrador**, falta la aprobación de Leider.

## Qué resuelve

Vender con dos tablets a la vez y sin internet, sin repetir comandas, números, cobros ni descuentos de stock, y con la caja cuadrando.

## Hoy

- El número de comanda es "el último + 1": dos tablets al mismo tiempo pueden repetirlo.
- Dos cobros del mismo pedido al mismo instante pueden pasar los dos.
- Hay una sola caja por día para todas las tablets.
- Sin internet la pantalla abre, pero no se puede tomar ni cobrar.

## Dos tablets

- Ningún número de comanda se repite. Uno anulado no se reutiliza.
- Un pedido se cobra una sola vez; la otra tablet ve quién lo cobró.
- El stock y los abonos de fiado se descuentan una sola vez.
- Cada tablet abre, cobra y cierra su propia caja (si D10 sale así). Si un pedido se cobra en otra tablet, el cobro va a la caja de quien recibe la plata.
- El cierre del día suma todas las cajas. Si una tablet se apaga con la caja abierta, el dueño la cierra desde otro equipo.

## Sin conexión

- Se puede tomar, editar y cobrar pedidos (todos los métodos, y fiado a clientes ya registrados) e imprimir el ticket.
- Cada operación guarda su hora y su tasa. Al volver la conexión se envía sola, en orden y sin duplicarse.
- Mientras tanto, la comanda es provisional ("P-3") y una barra dice cuántas faltan por enviar. Como la cocina no las recibe, la barra pide avisar en voz alta o imprimir.
- Abrir y cerrar caja, devoluciones, gastos, retiros y clientes nuevos esperan la conexión, y el botón dice por qué.
- **Pago móvil:** queda "por verificar" hasta que el banco lo confirme. La caja no cierra con pagos sin verificar.
- **Rechazos:** lo que el servidor no acepta (producto retirado, hora o tasa imposibles, mes de IVA ya declarado) va a "Requiere atención" con qué hacer. Nunca se pierde en silencio.
- **Caja ya cerrada:** la venta entra como "venta tardía", aparte en el cierre. La caja no se reabre sola.
- **Fiado sobre el límite:** se acepta con aviso al dueño, porque la venta ya ocurrió.
- Solo el punto de venta de la tablet funciona sin conexión; el resto de los módulos la pide.

## Por decidir

**D10.** ¿Cada tablet tiene su caja o las dos cobran en la misma?
- **Una por tablet** (propuesta): cada cajera cuadra lo suyo y un faltante tiene responsable.
- **Compartida:** como hoy, más simple, pero un faltante no tiene responsable.

## Cómo se valida

**Dos tablets:** abrir una caja en cada una, tomar 20 comandas alternadas (ningún número se repite), cobrar el mismo pedido desde las dos a la vez (se cobra una vez) y cerrar cada caja (cada una cuadra y el día suma las dos).

**Sin internet:** tomar 5 comandas, editar una, cobrar 4 (efectivo, divisas, punto y pago móvil) y dejar una en fiado. Al volver el wifi llegan a cocina en orden y sin duplicados, el pago móvil se verifica y la caja cuadra.
