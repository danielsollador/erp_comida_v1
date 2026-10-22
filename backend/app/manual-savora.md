# Manual del ERP — negocio de comida (Sávora)

Este manual explica para qué sirve cada pantalla y cómo se hacen las tareas de
todos los días. Está escrito para quien usa el sistema (dueño, cajero,
cocina) y también para el asistente de ayuda con IA, que responde con él.

**Cómo está ordenado:** primero el recorrido del día, después cada módulo
(para qué sirve, quién lo usa, cómo se hace lo común y qué significan sus
avisos), y al final un glosario y preguntas frecuentes reales.

Los nombres entre comillas («Cobrar», «Lo viene a buscar») son los que se ven
en la pantalla. La dirección entre paréntesis (`/pos/pedidos`) es a dónde
lleva cada sección.

---

## 0. El día en el negocio, de punta a punta

1. **Abrir la caja** (Punto de venta o Caja): se cuenta el fondo con el que se
   arranca en cada gaveta (efectivo en bolívares y en dólares).
2. **Tomar pedidos y cobrar** (Punto de venta): la comanda va a cocina; se
   cobra antes o después de que salga la comida.
3. **Cocina** marca lo que va terminando.
4. **Entregar**: cuando el pedido está cobrado y listo, se le da al cliente.
5. **Compras**: cuando llega mercancía se carga la factura del proveedor (a
   mano o con foto).
6. **Cerrar la caja** (Caja › Cierre de caja): se cuenta lo que hay en cada
   forma de pago y el sistema dice si cuadra.
7. Lo contable (asientos, IVA, libros) se arma solo con cada venta y compra.

---

## 1. Inicio (`/`)

**Para qué:** ver de un vistazo cuánto se vendió hoy, qué está esperando
(pedidos en cocina, pedidos por cobrar) y entrar a los módulos.

- «Vendido hoy»: lo cobrado hoy.
- «En cocina» y «Por cobrar» solo se encienden si hay algo esperando.
- La ficha del Punto de venta es la principal: es la que se usa todo el día.
- «¿Sabías que…?»: avisos del sistema (lo que se acaba, lo que te deben). Las
  alertas de plata --una merma muy por encima de lo normal, un insumo que subió
  de golpe, la misma referencia bancaria en dos ventas-- traen «¿Por qué?», que
  muestra los números que las prueban y qué hacer.

**La ayuda («?», arriba en todas las pantallas):** un chat con dos pestañas.
- «Cómo se hace»: responde con este manual.
- «Mis números»: preguntas sobre tus datos («¿cuánto vendí el sábado?», «¿qué
  producto vendí más este mes?», «¿cuánto le compré a cada proveedor?»). El
  número lo calcula el sistema con los mismos reportes de Reportes, y debajo de
  la respuesta sale su tabla. Cada quien ve solo lo de su rol: el costo y la
  ganancia, solo el dueño. No cambia nada.

---

## 2. Punto de venta (`/pos`)

**Quién lo usa:** caja y mostrador. Tiene dos secciones: «Tomar pedido» y
«Pedidos».

### 2.1 Abrir la caja
Si aparece «La caja no se ha abierto», toca «Abrir caja» y cuenta el fondo
con el que arrancas en cada gaveta. Hay que contar al menos una. Sirve para
que el cierre de la noche sea solo la cuenta de ese día: fondo + lo que entró
− lo que salió.

### 2.2 Tomar un pedido
1. En «Tomar pedido», toca los productos para agregarlos a la «Comanda actual».
2. Si el pedido lleva nombre del cliente, escríbelo: es lo que se usa para
   entregarlo.
3. Envía la comanda. Sale el aviso «Comanda #N enviada». Volver a tocar no
   duplica el pedido.
- **Qué va a cocina y qué es de vitrina:** cada renglón dice «vitrina» (ya
  está hecho, lo entrega la caja) o va a cocina. Se cambia con el botón
  «Cocina» de la tarjeta del pedido, renglón por renglón.
- **Venta libre:** algo que no está en el menú; necesita nombre y precio.
- **Envío (delivery):** es un producto de la categoría de envíos y necesita
  su monto.
- Un producto **sin precio** no se puede vender: hay que ponerle precio en
  Menú › Recetas.

### 2.3 Cobrar
En la tarjeta del pedido, «Cobrar». Formas de pago: Efectivo Bs, Efectivo $,
Punto de venta, Pago móvil, Transferencia, Zelle y «A crédito».
- **Referencia:** todo lo que no es efectivo pide su número de referencia.
- **Pago móvil verificado:** si el local tiene la verificación activada, el
  sistema comprueba con el banco que el pago entró.
- **Paga con más (vuelto):** «Paga con más: hay vuelto» y luego «Vuelto ·
  ¿por dónde sale?». Si el cliente no lo quiere: «No quiere el vuelto».
- **Dos formas a la vez:** «Paga con dos formas».
- **Descuento o propina:** «Descuento · propina». La propina es del empleado,
  no es venta.
- **Cortesía:** «Cerrar como cortesía (no se cobra)».
- **A crédito (fiado):** necesita el nombre del cliente. Se cobra después
  desde Ventas («Cobrar / abonar»).
- **Factura:** «Facturar esta venta» (número de factura y RIF o cédula del
  cliente).
- **Cliente contribuyente especial:** marca «El cliente retiene IVA
  (contribuyente especial)» y el porcentaje (75 % o 100 %). Solo en una venta
  facturada. Lo retenido no entra a la gaveta.

### 2.4 La pantalla «Pedidos»
Cada tarjeta es un pedido en curso, con color según dónde está:
- **Verde · «Cuenta abierta · falta cobrar»**: listo, hay que cobrarlo.
- **Ámbar · «Cuenta abierta · falta cocina»**: en cocina y sin cobrar.
- **Gris · «Cobrado · falta cocina»**: ya pagó, espera la comida.
- **Cobre · «Para entregar»**: cobrado y listo; solo falta dárselo al
  cliente (el nombre va grande).
- **Borde punteado · «Por retirar»**: el cliente lo viene a buscar después.
- «Sin cocina»: el pedido no pasó por cocina (todo era de vitrina).
- «Editado»: se le cambiaron renglones después de tomarlo.
- «X la prepara»: alguien de cocina ya lo tomó; mientras tanto no se edita.

**Entregar:** la **×** de la tarjeta marca «ya se lo di». La venta no se
borra; solo sale de la pantalla. Si nadie la toca, un pedido «Para entregar»
sale solo **60 minutos** después de estar listo.

**«Lo viene a buscar»** (cliente que dice «ahora vuelvo»): tócalo en la
tarjeta de un pedido cobrado. Si no tiene nombre, lo pide. El pedido sube a la
franja «Por retirar» y **no sale solo nunca**; cuando el cliente llega, toca
«Entregado». Si fue un error: «Ya no».

**«Entregados hoy»** (abajo, plegado): lo que ya salió hoy, entregado o por la
hora. Si salió uno que el cliente no se llevó, «No se entregó» lo devuelve a
«Por retirar».

**Editar un pedido:** «Editar». No se puede si cocina ya lo está preparando o
si otra caja lo tiene abierto. Si cambia el monto de una venta ya cobrada, hay
que cobrar o devolver la diferencia (no se puede fiar).

**Anular:** solo un pedido **sin cobrar**. Uno cobrado se devuelve desde
Ventas («Devolver»).

### 2.5 Avisos del punto de venta
| Si ves | Significa | Qué hacer |
|---|---|---|
| «No alcanza el inventario para: …» | Según las recetas no hay suficiente de algo | Si sí hay, se puede vender igual desde el aviso; o cargar la compra; o prender «Vender sin stock» en Inventario |
| ««X» todavía no tiene precio» | Ese producto no tiene precio | Menú › Recetas, ponerle precio |
| «X está editando la comanda #N» | Otra caja la tiene abierta | Esperar; el candado vence solo en 5 minutos |
| «La cocina ya terminó …» | Se intentó quitar algo que ya se cocinó | Hacer el cambio como pedido nuevo o devolución |
| «Sin nombre no se puede comandar» | Falta el nombre del cliente | Escribirlo |
| «Para fiar hace falta el nombre del cliente» | Venta a crédito sin nombre | Escribir a nombre de quién queda la deuda |

---

## 3. Cocina (`/cocina`)

**Quién la usa:** la cocina. Muestra lo que falta por preparar, cobrado o no.
- Tocar una comanda la marca como «mía»: el resto de la cocina lo ve y la caja
  ya no puede cambiarle los renglones.
- «Todo listo» la marca terminada; en la caja pasa a «Para entregar» (si ya se
  cobró).
- «Activar aviso»: suena cuando llega una comanda nueva.
- Si una acción sale rechazada es porque la caja tiene la comanda abierta para
  editarla.

---

## 4. Menú (`/menu`)

**Para qué:** qué se vende, a cuánto y qué lleva cada cosa. Dos secciones: «El
menú» y «Recetas».

### 4.1 El menú
- Las categorías a la izquierda y los productos de la elegida a la derecha.
  En el teléfono, las categorías son una tira que se desliza de lado.
- **Mover un producto a otra categoría:** arrastrarlo a la categoría, o en su
  menú «⋯» › «Mover a otra categoría…».
- **Ordenar:** arrastrar las categorías, o «Subir» / «Bajar» en el «⋯» del
  producto.
- **Menú «⋯» de una categoría:** color, «Renombrar», «Va a cocina» / «No va a
  cocina» (la sugerencia al comandar) y «Quitar del menú».
- **Quitar del menú** no borra: las ventas viejas siguen nombrando el
  producto. Se recupera desde «Fuera del menú».
- El nombre y el precio se cambian tocándolos ahí mismo.

### 4.2 Recetas
Qué lleva **un** producto, cuánto cuesta hacerlo y cuánto deja.
- El dibujo es un **vaso**: cada mercancía ocupa una franja según lo que
  cuesta; lo que queda hasta el borde (el precio) es la ganancia, en verde. Si
  se desborda, el producto da pérdida.
- **Precio ⇄ margen:** se puede escribir el precio o el margen que se quiere, y
  el otro se calcula (atajos de 60 % a 75 %).
- **Combos:** la receta de un combo sale sola de los productos que lleva; no se
  edita a mano.
- No van en recetas: los **desechables** (servilletas, bolsas) y el **aceite de
  freír**, que se reparte aparte (ver Inventario › Control).

---

## 5. Inventario (`/inventario`)

### 5.1 Los cuatro almacenes
| Almacén | Qué es | Recorrido |
|---|---|---|
| Materia prima | Lo que se cocina: carne, harina, queso | compra → crudo → preparado → menú |
| Reventa | Se vende tal cual: refresco, agua | compra → inventario → menú → venta |
| Consumible | Empaque que va con el producto: vaso, pitillo, caja | compra → inventario → receta |
| Desechable | Servilletas, bolsas, cloro | compra → gasto (no lleva stock) |

La portada muestra los cuatro; se entra tocando su ficha. Arriba están «Qué
comprar» y «Control».

### 5.2 Botones de la portada
- **«Vender sin stock»:** prendido, ninguna venta se traba por falta de
  inventario, aunque el producto tenga receta. Lo vendido igual se descuenta
  (el stock puede quedar en negativo). Pide confirmación. Mientras está
  prendido, arriba sale «Vendiendo sin stock» con el botón «Apagar».
- **«Conteo físico»:** se recorre el depósito y se anota lo que hay. Lo que se
  deja en blanco no se toca. Cada diferencia se registra como merma o sobrante.
  También se puede subir la planilla: respeta su columna de unidad (850 g
  entra como 0,85 kg).
- **«Cargar con IA»:** ver 5.6.
- **«Pedir a proveedores»** (en «Qué comprar»): arma el mensaje de WhatsApp para cada
  proveedor con lo que falta, en la presentación en que él lo vende (bultos,
  cajas). Se revisa y se manda con «Abrir WhatsApp» o «Copiar».
- **«Nueva mercancía»**.
- En «⋯»: «Administrar categorías».

### 5.3 La ficha de una mercancía
Arriba, cuánto hay, para cuánto alcanza y cuánto cuesta. Debajo, lo que se le
anota: «Llegó mercancía», «Se dañó o se botó» (merma), consumo personal, y lo
último que le pasó. Los datos fijos (unidad, mínimo, exento de IVA) quedan
cerrados en un renglón.
- **Merma mayor a lo que hay:** el sistema pregunta si eran gramos («Hay X…
  ¿Eran g?»).
- **Pasar a Desechable con stock:** pregunta, porque lo que queda pasa a gasto
  del mes. Si va en una receta no deja: hay que quitarla de ahí primero.
- **Archivar algo que va en una receta:** avisa en cuáles está; archivada se
  sigue descontando al vender pero ya no aparece para comprar.
- **Dos fichas que son la misma:** «Ya existe «X»… fusiónalas desde su ficha».
  Fusionar junta stock, recetas, compras y memoria del proveedor.

### 5.4 Preparaciones (la cara «Preparado» de la materia prima)
El guiso, la mechada, la salsa. Es un almacén **imaginario**: no dice cuánto
guiso hay en la nevera, dice cuánto se **podría** hacer con el crudo que hay.
Al vender un pastelito, el sistema baja por la receta hasta el pollo crudo.
- **La receta es por uno:** lo que lleva 1 kg (o 1 lt, o 1 unidad) de la
  preparación. Para hacer 2 kg el sistema multiplica.
- **«Sobró hoy»:** al cierre se dice qué se hace con lo que sobró (guardar o
  botar).
- Si dos preparaciones usan el mismo crudo, el sistema reparte lo que hay según
  lo vendido en los últimos 14 días.
- Producir una tanda que usa más crudo del que hay pide confirmación.
- Si el rendimiento real de las últimas tandas se aleja del de la receta,
  sugiere ajustarlo.

### 5.5 Control
Lo que no depende de que la cocina anote:
- **Teórico vs real:** lo que debió salir según las recetas contra lo que
  encontró el conteo.
- **Pérdidas:** lo que se botó y los faltantes de conteo, por separado.
- **Conteos:** cuándo se contó y quién.
- **Aceite de freír por pieza:** lo cargado a la freidora en los últimos 30
  días, dividido entre las piezas fritas vendidas. Para activarlo: marcar el
  aceite como «costo indirecto» en su ficha, marcar los productos que «se
  fríen» y anotar cada carga con «Cargar a la freidora».
- **Con qué costo se fijan precios:** reposición (lo último pagado), promedio
  o el mayor.
- **Cambios de hoy:** «hoy no hay pollo, se usa pavo». Mientras esté vigente
  (hasta el cierre del día) lo vendido descuenta el sustituto, sin tocar
  recetas.

### 5.6 Cargar con IA
Para arrancar de cero sin teclear ficha por ficha.
1. «Cargar con IA», y se escribe (o se dicta con el micrófono del teclado) lo
   que se usa, lo que se prepara y lo que lleva cada producto, o se mandan
   fotos del cuaderno (hasta 6).
2. La IA propone la mercancía, las preparaciones (con lo que rinde cada tanda)
   y las recetas del menú, y pregunta lo que no esté claro.
3. Se revisa: lo que ya existe se usa y no se duplica; los nombres parecidos
   se ofrecen («¿Es «Disco (Masa)»?»); las unidades se convierten solas; lo
   que no cuadra sale en rojo y no deja guardar.
4. «Guardar» carga todo junto, o nada si algo falla.
- Todo nace **sin stock**: lo que hay se carga con el conteo físico o entra con
  la compra.

---

## 6. Compras (`/compras`)

Secciones: «Facturas», «Cargar factura», «Alertas», «Proveedores».

### 6.1 Cargar una factura
Tres pasos que se pliegan al terminarlos: la factura (proveedor, número,
fecha), qué trae y cómo se pagó.
- **Desde foto o PDF:** la IA lee la factura y **prellena**; la persona revisa
  y guarda.
- **Cada renglón dice qué es:** primero «Qué es» (materia prima, reventa,
  consumible, desechable, o un gasto: flete, servicio, equipo, otro) y después
  la mercancía. Eso decide si la plata va al inventario o a gasto.
- **Caja de 24 maltas:** se carga como caja y entra como 24 maltas. El sistema
  recuerda cómo trae cada proveedor cada cosa.
- **Flete:** es un renglón propio (concepto Flete).
- **Recargo / Descuento:** junto al total, en positivo.
- **Factura en bolívares:** necesita la tasa con que se pasó a dólares.
- **Factura repetida:** avisa «Ya está cargada…» y permite seguir si de verdad
  es otra.
- **Cantidad rara:** si un renglón es mucho más de lo habitual (5 veces o más),
  avisa antes de guardar.
- El RIF del proveedor es obligatorio (letra J/G/V/E/P/C + números).

### 6.2 Pagar, abonar y reclamar
- **Cuentas por pagar / «Debemos»:** lo que se le debe a cada proveedor.
  «Abonar» registra un pago parcial; el saldo resta las notas de crédito y los
  abonos.
- **Nota de crédito:** «Devolución al proveedor», «Descuento del proveedor» o
  «Lo que no llegó» (faltante).
- **«Lo que los proveedores deben» / «Nos deben»:** los faltantes reclamados.
  Con los días que llevan; si no se recupera, «Dar por perdido».
- Una factura que ya movió el stock, o que tiene pagos o abonos, no se borra.

### 6.3 Alertas
Precios fuera de lo normal: cuando un proveedor cobra bastante más (o menos)
de lo que se venía pagando.

---

## 7. Caja (`/caja`)

Secciones: «Cierre de caja», «Gastos y retiros», «Historial».

### 7.1 Cerrar la caja
Se cuadra **un día**; si anoche no dio tiempo, se elige la fecha. El orden es
el de la cabeza del dueño: qué vendí, qué salió, por dónde entró, ¿cuadra?, y
contar.

**El desglose por forma de pago** (siempre salen todas, aunque estén en cero):
- **Entró:** lo cobrado por esa vía.
- **Salió:** gastos, retiros y otros pagos por esa vía.
- **Debes tener:** fondo + entró − salió. La fila suma a la vista.
- Después de cerrar aparecen **«Reportado por cajero»** y **«Diferencia»**:
  «cuadra», «sobran $X» (en ámbar) o «faltan $X» (en rojo).
- **Efectivo:** arranca con lo contado al abrir, o con lo que quedó de días
  anteriores si no se abrió.
- **Punto, pago móvil, transferencia, Zelle:** se cotejan contra el movimiento
  del día (el lote del punto, el banco).
- Lo que quedó «sin verificar» no entra en el total de la comparación.

**Al contar:** escribe lo que hay **de verdad** en cada sitio. Lo que dejes en
blanco no se verifica. Se puede escribir en bolívares o en dólares según la
forma; abajo muestra el equivalente para notar si se tecleó en la moneda
equivocada. Al cerrar, cada diferencia queda en los libros.

- Si quedan pedidos «Por retirar», avisa: «Quedan N pedidos por retirar…».
- **Corregir un conteo mal tecleado:** «Corregir el conteo». El cierre viejo
  queda anulado con su rastro y se guarda el nuevo.
- **Anular un cierre:** desde Historial, «Anular este cierre», y se vuelve a
  cerrar el día.

### 7.2 Gastos y retiros
«Registrar uno»: un gasto del local (gas, luz) o un retiro del dueño, y de
dónde salió la plata (Efectivo Bs, Efectivo $ o Banco). Baja lo que se debe
tener en esa forma de pago.

### 7.3 Cajas
Un local puede tener varias cajas físicas (una gaveta por piso) para cerrarlas
aparte.

---

## 8. Ventas (`/ventas`)

**Para qué:** la lista de **todas** las ventas del período (cobradas, fiadas,
devueltas, anuladas, abiertas), con quién la cobró y cómo. Abre en «este mes».
Secciones: «Historial», «Resumen», «Pérdidas».

En cada venta:
- «Facturar ahora», «Imprimir ticket».
- «Editar pago» (la forma de pago estuvo mal registrada) y «Editar renglones».
- «Cobrar / abonar» una venta a crédito; «Ya saldado» cuando se pagó.
- **«Devolver»:** el cliente trajo la comida y se le devuelve la plata.
  Pregunta si «Se preparó (pérdida real)» o «No se llegó a preparar». Devolver
  revierte el ingreso y el IVA.
- Una venta de otro día que ya entró al cierre de caja no se le cambia el
  monto; una facturada tampoco sin pasar por la factura.

---

## 9. Reportes (`/reportes`)

Secciones: «Resumen», «Ventas», «Pérdidas», «Inventario» y «A medida». Los
filtros van en una fila arriba: el período y, al lado, de qué parte del
negocio (categoría o producto en Resumen y Ventas; cajón o mercancía en
Pérdidas e Inventario).
- **Resumen:** las cifras básicas, la serie de ventas, cómo pagaron, el
  resultado.
- **Ventas:** cuándo se vende (días y horas), qué se vende y qué se vende
  junto. Tocar una categoría o un producto en un gráfico filtra toda la
  pantalla.
- **Pérdidas:** la merma registrada (se cayó, se quemó, se venció) separada de
  la que apareció en un conteo, y quién la anotó.
- **Inventario:** dónde está la plata del depósito, para cuántos días alcanza
  cada cosa, qué no se mueve.
- **A medida:** la tabla dinámica: qué mirar, por qué agrupar y qué medir, y
  se guarda con nombre.
- Avisos de cocina y proveedores: preparaciones vencidas, rendimientos fuera
  de lo normal, reclamos a proveedores de más de 7 días.

---

## 10. Tasa (`/tasa`)

Secciones: «Tasa de hoy», «Calculadora», «Análisis», «Historial».
- **BCV (oficial):** la que manda para facturar y declarar.
- **Paralelo / Binance:** a la que se repone la mercancía.
- **Euro BCV:** algunos mayoristas cotizan en euros.
- La tasa del BCV que se publica en la tarde es la del día hábil siguiente
  (su «fecha valor»): no reemplaza la de hoy.

---

## 11. Contador: Contabilidad e Impuestos

El dueño no opera esto: cada venta y compra deja su asiento, su IVA y su tasa.
Lo que importa es que esté listo cuando el contador lo pida.

**Contabilidad** (`/contabilidad`): «Plan de cuentas», «Asientos» (con
filtros por texto, cuenta y origen), «Balance de comprobación», «Estado de
resultados», «Balance general», «Equipos» (activos fijos y su depreciación,
que se asienta sola) y «Respaldos».

**Impuestos** (`/impuestos`): «Libro de ventas», «Libro de compras»,
«Retenciones IVA» (lo retenido a cada proveedor y el TXT para el portal del
SENIAT) y «Declaraciones» (declarar un mes cierra el IVA contra el crédito
fiscal).
- El período del Libro de Compras va por la **fecha de registro** de la
  factura; la de emisión solo se muestra.
- Un año cerrado no admite facturas nuevas con fecha de ese año.

**Respaldos:** la copia automática corre sola en el servidor. Desde aquí se
genera uno, se baja o se restaura (la palanca de emergencia).

---

## 12. Configuración (`/configuracion`)

- **Mi cuenta:** nombre, contraseña y PIN (si el rol lo autoriza). Cambiar la
  contraseña o el PIN pide la contraseña actual.
- **Lenguaje:** palabras sencillas (las del negocio) o técnicas (las contables).
- **Apariencia:** el tema y cómo se escribe en esta tablet.
- **Usuarios** (quien administra): quién entra al local y con qué rol.
- **Roles** (quien administra): a qué módulos entra cada rol. A los de fábrica
  se les recorta la lista para este local; «Restaurar» los devuelve como
  vienen.
- **Pago móvil** (quien administra): las cuentas del banco contra las que se
  verifica que un pago móvil entró. Una es la principal.

---

## 13. Glosario corto

| Término | Qué es |
|---|---|
| Base | El precio sin IVA |
| Costo (de la mercancía) | Lo que costó, en promedio, lo que tienes guardado; no es el último precio |
| Reponer | Lo que pagaste la última vez: lo que te va a costar comprar más |
| Rendimiento / aprovechable | Cuánto de lo comprado queda utilizable después de limpiar o cocinar |
| Rinde (preparación) | Cuánto sale de una tanda |
| Merma | Lo que se botó, se dañó o faltó en un conteo |
| Margen | Qué porcentaje del precio te queda después de pagar la mercancía |
| Fiado / a crédito | Venta entregada que se paga después |
| Cortesía | Venta que se regala: no se cobra |
| Devolver | El cliente trajo la comida y se le devolvió la plata |
| Anular | Botar un pedido que nunca se cobró |
| Fondo | Lo que había en la gaveta al abrir |
| Faltante / sobrante | Lo que falta o sobra al contar contra lo que el sistema esperaba |
| Costo indirecto | El aceite de freír (o el gas): no va en recetas, se reparte por pieza |
| Tasa BCV / paralelo | El dólar oficial (para facturar) / el del mercado (para reponer) |

El glosario completo de cada columna y cifra está en el propio sistema: al
posar el dedo o el cursor sobre el título de una columna o tarjeta se abre su
explicación.

---

## 14. Preguntas frecuentes (reales)

**¿Qué significa «Para entregar»?**
Que el pedido ya está cobrado y la comida lista: solo falta dárselo al
cliente. Al dárselo, toca la ×. Si nadie la toca, sale solo a los 60 minutos.

**El cliente dijo «ahora vuelvo» y se le perdió el pedido. ¿Cómo se evita?**
Toca «Lo viene a buscar» en su tarjeta. Pasa a «Por retirar» y no sale solo
hasta que alguien toque «Entregado». Si ya salió, búscalo en «Entregados hoy»
y toca «No se entregó».

**¿Dónde se vende sin stock?**
Inventario, botón «Vender sin stock» en la portada. Pide confirmación. Se
apaga con «Apagar» en el aviso de arriba.

**El cierre dice que Zelle «cuadra» pero faltaba plata.**
Era un error de la pantalla de cierres ya hechos, corregido el 19-oct: hoy un
cierre guardado muestra el faltante real. Si una forma de pago falta y otra
sobra por un monto parecido (faltan $10 en Zelle y sobran $9,55 en el punto),
lo más probable es un cobro registrado en la forma equivocada: se corrige en
Ventas con «Editar pago».

**El efectivo en bolívares dice que debería haber mucho más (o menos) de lo
que hay.**
Si nunca se contó, arrastra el saldo de los libros desde el principio. Cuenta
lo que hay de verdad en el cierre de hoy: la diferencia se registra una vez y
desde ahí arranca real.

**¿Cómo se activa el aceite de freír?**
En la ficha del aceite, marcarlo como costo indirecto; marcar los productos
que se fríen; y cada vez que se carga la freidora, «Cargar a la freidora» con
los litros. El costo por pieza aparece en Inventario › Control.

**Vendí y no descontó inventario.**
El producto no tiene receta. Ponle receta en Menú › Recetas (o con «Cargar con
IA» en Inventario).

**Los tres puntos «⋯» no abren en el teléfono.**
Era un error corregido el 13-oct. Recarga la página para tomar la versión
nueva.

**Pasé una mercancía a Desechable y me pide confirmar.**
Lo que queda en el depósito pasa a gasto del mes, porque un desechable no se
cuenta. Si va en una receta, no deja: quítala de la receta primero.
