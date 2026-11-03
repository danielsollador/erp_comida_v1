# Spec: Ventas

> Requisitos de `CLAUDE.md` que cubre: FASE 1, "Dos tablets cobrando a la vez" y "Vender sin conexion".
> Bloques del plan: 1.4 y 1.5. Estado: **borrador** (2-nov), falta la aprobacion de Leider.

## Para que sirve

Que el local venda con dos tablets al mismo tiempo, y que siga vendiendo aunque
se caiga el internet, sin que se repita una comanda, un numero, un cobro o un
descuento de inventario, y sin que la caja deje de cuadrar.

Lo usan la caja (toma y cobra), la cocina (recibe las comandas) y el dueno (cierra
y revisa).

## Como funciona hoy

- **Numero de comanda:** el servidor toma el ultimo numero del dia y le suma uno.
  Si dos tablets mandan una comanda en el mismo instante, las dos pueden recibir
  el mismo numero.
- **Comanda repetida:** cada comanda lleva una clave que pone la tablet. Si la
  tablet reintenta por un corte, el servidor reconoce la clave y no la duplica.
  Esto ya funciona.
- **Inventario:** se descuenta al crear la comanda (no al cobrar), porque la
  cocina empieza a gastar apenas la recibe.
- **Cobro:** si el pedido ya esta cobrado, se rechaza. Pero se comprueba sin
  bloqueo: dos cobros del mismo pedido en el mismo instante pueden pasar los dos.
- **Edicion:** mientras una tablet edita un pedido, la otra ve "{quien} esta
  editando la comanda #N" durante 5 minutos.
- **Caja:** hay **una sola caja por dia** con dos gavetas (bolivares y divisas).
  Se abre una vez, todos cobran en ella y se cierra una vez.
- **Sin conexion:** la pantalla abre sin internet, pero no se puede tomar ni
  cobrar nada hasta que vuelva.

## Parte A: dos tablets cobrando a la vez (bloque 1.4)

### Requisitos

- R1. Nunca hay dos comandas con el mismo numero en el mismo dia, aunque dos
  tablets las manden en el mismo instante.
- R2. Los numeros siguen sin huecos raros: si una comanda se anula, su numero no
  se reutiliza.
- R3. Un pedido se cobra una sola vez. Si dos tablets lo cobran a la vez, una
  lo logra y la otra ve "Este pedido ya lo cobro {quien} en {caja}".
- R4. El inventario de una comanda se descuenta una sola vez, aunque la comanda
  llegue repetida o dos tablets la toquen a la vez.
- R5. Un abono a un fiado se registra una sola vez, aunque se toque dos veces el
  boton o dos tablets abonen a la vez.
- R6. Dos tablets no pueden editar el mismo pedido a la vez (ya existe; se
  mantiene).
- R7. Cada tablet trabaja con **su** caja: la abre, cobra en ella, y la cierra
  (segun D10, abajo).
- R8. Cada tablet recuerda que caja es. Si se reinicia, vuelve a la misma caja
  sin preguntar.

### Reglas de negocio

- La caja de cada tablet tiene sus dos gavetas (bolivares y divisas), su fondo
  al abrir y su cierre con sus diferencias.
- Cada cobro, vuelto, propina, gasto y retiro dice en que caja ocurrio.
- El cierre de una caja solo cuenta lo de esa caja. El resumen del dia suma
  todas las cajas.
- En contabilidad no cambian las cuentas: las gavetas siguen siendo 1010
  (bolivares) y 1011 (divisas). Lo que se agrega es de que caja es cada
  movimiento, para poder cuadrar cada una.
- Una caja cerrada no recibe cobros. Si una tablet intenta cobrar en una caja
  cerrada, se le dice y se le ofrece abrir la suya.
- El dueno ve todas las cajas; la cajera solo la suya.

### Casos borde

- Las dos tablets cobran el mismo pedido al mismo tiempo: R3.
- Una tablet se queda sin bateria con la caja abierta: el dueno puede cerrar esa
  caja desde otra tablet o desde la PC.
- Un pedido tomado en la tablet 1 se cobra en la tablet 2: el cobro va a la caja
  de la tablet 2 (quien recibe la plata).
- Se agrega una tercera tablet: se crea una caja nueva desde Configuracion. No
  hay limite de cajas.
- Pasada la medianoche: lo resuelve el bloque 1.6 (D1).

### Pantallas y textos

- Punto de venta: arriba se ve el nombre de la caja ("Caja 1") y si esta
  abierta.
- Abrir caja: "Abrir Caja 1" con las dos gavetas, igual que hoy.
- Cierre de caja: una pestana por caja y "Todas" para el resumen del dia.
- Configuracion > Cajas: lista de cajas con su nombre; la tablet elige la suya
  la primera vez.
- Cada cifra nueva del cierre por caja lleva su explicacion en el glosario.

## Parte B: vender sin conexion (bloque 1.5)

### Requisitos

- R9. Sin internet se puede tomar, editar y cobrar pedidos (efectivo, divisas,
  punto, pago mixto, vuelto, propina, descuento y fiado a un cliente ya
  registrado) e imprimir el ticket.
- R10. Cada operacion guarda la hora y la tasa del momento en que se hizo; al
  sincronizar el servidor usa esas, no las de ese momento.
- R11. Al volver la conexion, todo se envia solo, en el orden en que se hizo, y
  ninguna operacion se duplica.
- R12. Mientras no se envia, la comanda se ve con un numero provisional
  ("P-1"); al llegar al servidor toma su numero real.
- R13. Una barra fija dice: "N operaciones sin enviar. La cocina no ha recibido N
  comandas: avisale en voz alta o imprime la comanda."
- R14. Lo que necesita el servidor (abrir y cerrar caja, devoluciones, gastos,
  retiros y crear un cliente de fiado nuevo) se ve deshabilitado con el motivo.
- R15. Una operacion que el servidor rechaza al sincronizar (producto retirado,
  caja ya cerrada, pago movil no confirmado) **nunca se pierde en silencio**: va
  a "Requiere atencion" con la explicacion y que hacer.
- R16. Solo el punto de venta funciona sin conexion. Los demas modulos dicen que
  hace falta conexion.

### Reglas de negocio

- **Pago movil sin conexion:** se anota con su referencia y queda "por
  verificar". Al volver la conexion se verifica con el banco (Pabilo). Si se
  confirma, queda cobrado. Si no, el pedido sale en "Requiere atencion" y la caja
  **no cierra** hasta resolverlo.
- **Fiado sin conexion:** la venta ya ocurrio, asi que se acepta aunque pase el
  limite del cliente, con un aviso al dueno.
- **Precios:** se usan los del menu guardado en la tablet. Se muestra "Precios de
  hace X h" para que la cajera sepa de cuando son.
- **Hora:** una operacion con mas de 72 h o con hora en el futuro se rechaza al
  sincronizar y va a "Requiere atencion".
- **Tasa:** si la tasa que trae la operacion no coincide con la del BCV de ese
  dia (con 0,5 % de margen), se rechaza y va a "Requiere atencion".
- **Caja ya cerrada:** si se cobro sin conexion y cuando llega la caja ya se
  cerro, entra como **venta tardia**: el cierre la muestra aparte ("Ventas
  recibidas despues del cierre") con su diferencia. La caja no se reabre sola.
- **Periodo cerrado:** si la operacion cae en un ejercicio cerrado o en un mes de
  IVA ya declarado, se rechaza con la explicacion.

### Casos borde

- Se cae el internet a mitad de un cobro: el cobro queda en la tablet y se
  envia despues; no se cobra dos veces.
- Se edita sin conexion un pedido que tampoco se ha enviado: viaja como una sola
  comanda ya editada.
- Un producto se retira del menu mientras la tablet estaba sin conexion: la
  comanda va a "Requiere atencion".
- La tablet se apaga sin conexion: lo pendiente sigue guardado al encenderla.
- Dos tablets sin conexion al mismo tiempo: cada una manda lo suyo al volver, y
  los numeros los pone el servidor (Parte A).
- Se borran los datos del navegador con operaciones pendientes: el sistema avisa
  antes de que se pueda perder algo (no se puede evitar del todo).

### Pantallas y textos

- Barra de pendientes (R13), visible en todo el punto de venta.
- "Requiere atencion": lista con cada operacion rechazada, por que y que hacer.
- Comanda provisional: "P-3 · pendiente de enviar".
- Botones deshabilitados con su motivo: "Para cerrar la caja hace falta conexion
  y enviar las 4 operaciones pendientes."

## Fuera de alcance

- Que la cocina reciba las comandas sin internet (la pantalla de cocina necesita
  el servidor). Por eso la barra pide avisar en voz alta o imprimir.
- Vender sin conexion en la app del telefono (por ahora solo el punto de venta
  de la tablet).
- El cambio de turno (FASE 3).

## Decisiones pendientes

- **D10.** ¿Cada tablet es una caja con sus propias gavetas, o las dos cobran
  en la misma caja?
  - **Una caja por tablet** (propuesta): cada cajera cuadra lo suyo y se sabe
    quien tiene un faltante. Cambia apertura, cobro y cierre.
  - **Una caja compartida:** las dos tablets cobran en las mismas gavetas y se
    cierra una vez al dia, como hoy. Mas simple, pero un faltante no tiene
    dueno. En ese caso, R7 y R8 no aplican.

## Aceptacion

**Parte A, con dos tablets reales en el local (o dos navegadores en local):**
1. Abrir la Caja 1 en la tablet 1 y la Caja 2 en la tablet 2.
2. Tomar 20 comandas alternando las tablets, varias al mismo tiempo: ningun
   numero se repite y no hay huecos.
3. Tocar "Cobrar" en el mismo pedido desde las dos tablets a la vez: se cobra una
   sola vez y la otra tablet dice quien lo cobro.
4. Revisar el inventario de un producto vendido: bajo una sola vez por comanda.
5. Cerrar cada caja: cada cierre solo tiene lo suyo y el resumen del dia suma
   las dos.

**Parte B, con el wifi apagado:**
1. Tomar 5 comandas, editar una, cobrar 4 (efectivo, divisas, punto y pago movil)
   y dejar una en fiado.
2. La barra dice cuantas faltan por enviar y los botones de caja dicen por que
   no se pueden usar.
3. Encender el wifi: las comandas llegan a cocina en orden y sin duplicados, cada
   una toma su numero real y el pago movil se verifica.
4. Cerrar la caja: cuadra.
