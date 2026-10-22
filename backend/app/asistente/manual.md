# Manual de Vertigo Pro

Este manual lo lee el asistente de soporte para contestar a los dueños y a las cajeras. Los nombres de botones, pestañas y campos van entre «» tal como salen en pantalla. Las rutas (por ejemplo `/caja/historial`) son la dirección que se ve en el navegador y sirven para ubicar la pestaña.

Cómo contestar: con las palabras del negocio («te quedó», «se botó», «lo que hay»), en pocas líneas, y diciendo dónde tocar. Si algo no está en este manual, mejor decir que no se sabe que inventarlo.

## Antes de empezar: cómo está armado el sistema

**Inicio (`/`).** La portada muestra:

- «Vendido hoy» y los pedidos del día (quien no tiene permiso de ver cifras ve un guion).
- «En cocina» y «Por cobrar», en ámbar cuando no están en cero.
- «Para arrancar» (solo el dueño): cinco misiones, de «Carga lo que vendes» a «Cierra tu primera caja».
- «¿Sabías que…?»: hasta 4 avisos, como «Te quedaste sin X», «Te deben $X de N ventas a crédito» o «N productos que vendes no tienen receta». Cada uno lleva a donde se resuelve.
- «Tu negocio hoy»: Compras › Inventario › Menú › Ventas › Cierre de caja, cada parada con lo que falta («La caja de ayer no se cerró», «Hace N días que no se cuenta») y un enlace.

**El menú lateral.** Son íconos agrupados: vender (Punto de venta, Cocina), el negocio (Compras, Inventario, Menú), los números (Cierre de caja, Ventas, Reportes) y, más tenue, lo del contador (Contabilidad, Impuestos, Tasa de cambio). El círculo con la inicial lleva a Mi cuenta. **Cada quien solo ve los módulos de su rol.** En el Punto de venta y en Cocina la barra no aparece; se sale con la flecha de arriba.

**Selector de moneda** («Ver todos los montos como»): «Bolívares», «Dólares BCV» (por defecto), «Dólares Paralelo» o «Euro BCV». Solo cambia cómo se *ven* los montos: todo se guarda en dólares. Se recuerda por equipo.

**Deshacer.** Quitar algo del menú, archivar mercancía o proveedor, borrar una factura sin mercancía, una categoría de inventario, un gasto o un retiro, o quitar una cuenta de pago móvil muestra abajo «Deshacer» durante unos 6 segundos. Lo de Contabilidad, Impuestos y Usuarios no tiene Deshacer.

**Sin internet.** Sale una barra roja: «Sin conexión. Lo que hagas ahora no se está guardando.» El sistema no trabaja sin conexión.

**La campana** junta los pasos de arranque, los avisos y las solicitudes de autorización; se pone roja solo con solicitudes pendientes.

**Las ayudas.** Pasando el cursor por el título de una columna o cifra (en tablet, dejando el dedo apretado) sale qué es, de dónde sale y cómo se calcula.

## Punto de venta

**Para qué sirve:** tomar la comanda, mandarla a cocina y cobrar.

**Dónde está:** `/pos`. Tiene dos pestañas:

- «Tomar pedido»: los productos a la izquierda y la «Comanda actual» a la derecha.
- «Pedidos» (`/pos/pedidos`): los pedidos en curso, el botón «Ventas de hoy», el plegable «Entregados hoy» y, abajo, el selector «Caja».

### Tomar una comanda
1. En «Tomar pedido», filtra por categoría con las pastillas de arriba. «Todas» viene marcada.
2. Toca un producto para sumar 1. Si tiene tamaños, dice «N variantes»: al tocarlo se abre una lista y cada toque en una variante suma 1. La lista se cierra tocando fuera.
3. En la «Comanda actual», cada renglón tiene «−», «+» y «×» para quitar. La pastilla «Cortesía» lo marca como regalo (queda «✓ Cortesía»). «Vaciar» borra toda la comanda.
4. Para cobrar un envío, usa «+ Delivery». Pide cuánto cobra el envío, en $.
5. Escribe el nombre en «¿A nombre de quién?». **Es obligatorio.**
6. Toca «Enviar comanda». Sale el cuadro «¿Qué va a cocina?», donde cada renglón dice «A cocina» o «De vitrina» y se cambia tocándolo. «Todo a cocina» los pone todos para cocina. Confirma con el botón «Enviar · …».
7. Sale «✓ Comanda #N enviada».

No hay campo para notas por renglón («sin cebolla»). Hay que decírselo a la cocina de palabra.

### Cobrar
1. En «Pedidos», toca «Cobrar» en la tarjeta. Se puede cobrar antes de que la cocina termine («Cobrado · falta cocina»).
2. Elige: «Efectivo Bs», «Efectivo $», «Pago movil», «Punto de venta», «Transferencia», «Zelle» o «A crédito». La tarjeta se cobra con «Punto de venta» (es el mismo terminal).
3. **Efectivo:** «Paga exacto» o «Paga con más: hay vuelto». Con vuelto, escribe el billete que dio el cliente y elige por dónde sale el vuelto («Efectivo $», «Efectivo Bs» o «Pago movil»). Si lo deja, «No quiere el vuelto» lo pasa a propina.
4. **Pago movil, Punto de venta, Transferencia y Zelle** piden la referencia. Con el verificador activo, el pago móvil y la transferencia se verifican con el banco (abajo).
5. **Dos formas:** «Paga con dos formas». Cada parte pregunta «¿Cuánto paga con X?» hasta cubrir el total; termina con «Cobrar $X en N forma(s)». En el mixto no hay vuelto.
6. **«Descuento · propina»:** el descuento no puede pasar del total; la propina se cobra pero no es venta, es del empleado.
7. **Facturar:** marca «Facturar esta venta» y llena «N.º de factura», «N.º de control», «RIF o cédula» y «Nombre o razón social» (todo opcional: sin datos va como consumidor final). Contribuyente especial: «El cliente retiene IVA». También se factura después desde Ventas con «Facturar ahora».
8. **A crédito:** necesita el nombre del cliente; se confirma con «Fiar». Se cobra después desde Ventas.
9. Sale «✓ Cobrado #N» con «Imprimir» unos 20 segundos.

### Verificar un pago móvil con el banco
Solo si el dueño conectó una cuenta en Configuración › Pago móvil. Escribe el «Monto que entró» (viene con la cuenta a la tasa del día) y la «Referencia del pago» (según el banco, también teléfono, cédula o banco) y toca «Verificar con el banco»:

- **«Pago confirmado»** → «Cobrar por Pago movil».
- **«Entró Bs X de más»** → «Cobrar y sumar Bs X a la propina» (menos de un centavo de dólar va a «Redondeo de pagos»).
- **«Entró menos: faltan Bs X»** → cobrar lo que falta con otro pago móvil, con otra forma de pago, o dejarlo de descuento.
- **«El banco no lo encuentra»** → revisar dígitos o esperar y «Consultar otra vez».
- **«Esa referencia ya se usó»** → no deja cobrar: pedir otro comprobante.

«Cobrar sin verificar» siempre está: anota la referencia y cobra.

### Abrir caja
Con la franja «La caja no se ha abierto», toca «Abrir caja», cuenta los billetes de «Efectivo Bs» y «Efectivo $» (más «Monedas y sueltos») y confirma con «Abrir caja». No abrirla **no impide vender**, pero si se abre, el cierre parte de lo contado.

### Editar, anular y devolver
- **Editar:** «Editar» en la tarjeta; el pedido vuelve a «Tomar pedido» («Editando el pedido #N»). Cambia y toca «Guardar cambios». Lo que la cocina ya terminó no se quita. Si estaba cobrado y cambia el total, sale «Pedido #N: cambia lo cobrado» para cobrar o devolver la diferencia, y **hace falta autorización**.
- **Anular:** solo pedidos **sin cobrar**. «Anular» pregunta: «Se preparó: es pérdida» (queda como merma) o «No se preparó: vuelve al inventario». No pide PIN.
- **Devolver:** lo cobrado no se anula; se devuelve desde Ventas.
- **«Cocina»** en la tarjeta corrige qué va a cocina y qué sale de vitrina, sin mover plata ni inventario.

### Autorización con PIN
Hace falta para editar una venta **ya cobrada** cuando cambia el total, y para corregir un pago que mueve plata de gaveta o de monto. Autorizan siempre el dueño y Vertigo; Caja y Cocina solo si el dueño lo activó en Roles. Si quien cobra ya autoriza, no se le pide nada.

- **«Con PIN»:** quien autoriza escribe su PIN (4 a 6 números).
- **«Pedir permiso»** → «Enviar solicitud»: le llega una tarjeta con «Aprobar» y «Rechazar» (si no tiene la aplicación abierta, la ve al abrirla). Vence a los 15 minutos y sirve una sola vez.

### Entregar
En «Para entregar», la «×» lo saca del mostrador. «Lo viene a buscar» lo deja en «Por retirar» hasta tocar «Entregado». En «Entregados hoy», «No se entregó» lo devuelve a «Por retirar».

### Reglas que confunden
- **El inventario baja cuando se envía la comanda, no cuando se cobra.** Las cortesías también descuentan inventario.
- **Si no alcanza el inventario** sale «No alcanza el inventario para: …», con el botón «Vender igual». Si en Inventario está encendido «Vender sin stock», no se pregunta nada y el stock puede quedar en negativo.
- **Un producto con precio $0 no se puede vender.** Sale «todavía no tiene precio: pónselo en Recetas antes de venderlo». Esto no aplica a cortesías ni a envíos.
- **Las comandas se numeran por día.** Cada día empiezan en #1.
- **La tasa de cambio** es la del BCV más reciente hasta hoy. Se congela en la venta en el momento de cobrar.
- **La misma referencia no cobra dos pedidos.** Se compara por los últimos dígitos.
- **Los mensajes de error de cobrar o editar salen en el panel de «Tomar pedido».** Si al cobrar «no pasa nada», hay que mirar esa pestaña.

## Cocina

**Para qué sirve:** ver las comandas que llegan, prepararlas y marcarlas listas.

**Dónde está:** `/cocina`. Es una sola pantalla a pantalla completa. Arriba está el botón de sonido: «Activar aviso» o «Aviso activo».

### Cómo se trabaja
1. Las comandas llegan solas, por número, con el cliente y los minutos de espera (verde menos de 6, ámbar de 6 a 11, rojo desde 12). La nueva suena y dice «Nuevo».
2. «Preparar» agarra la comanda; la caja ve que la estás preparando.
3. Toca cada renglón hecho (queda tachado; otro toque lo desmarca). «Todo listo» marca todos y el pedido pasa a «Para entregar».

### Reglas que confunden
- **En cocina solo sale lo que va a cocina.** Lo que la cajera marcó «De vitrina» y los envíos no aparecen.
- **Un producto sin receta sí va a cocina.** Si una categoría no debería ir a cocina, el dueño la marca «No va a cocina» en el Menú.
- **Para que suene, hay que tocar la pantalla una vez.** El navegador no deja sonar nada antes de ese primer toque.
- **Si la caja está editando una comanda**, la tarjeta queda bloqueada hasta 5 minutos con el aviso «… está editando esta comanda».
- **Una comanda vieja desaparece sola.** Las que tienen más de 12 horas salen de la pantalla.
- **El tamaño de la letra** se cambia en Configuración › Apariencia › «Texto en Cocina».
- **El rol Cocina no puede anular.** Ve el botón «Anular», pero el sistema responde «Tu rol no tiene permiso para esto.»

## Compras

**Para qué sirve:** registrar lo que entra (facturas de proveedores) y lo que se paga o se debe.

**Dónde está:** `/compras`. Tiene cuatro pestañas:

- «Facturas»: arriba las cifras «Comprado», «Al inventario», «A gasto» y «Por pagar»; abajo «Cuentas por pagar» y la lista de facturas. Muestra los últimos 90 días si no se cambia el período.
- «Cargar factura» (`/compras/nueva`).
- «Alertas» (`/compras/alertas`).
- «Proveedores» (`/compras/proveedores`).

### Cargar una factura por foto o PDF
1. Entra a «Cargar factura» y toca «Foto o archivo». En el teléfono aparecen «Tomar foto de la factura» y «Elegir de la galería». En la computadora se arrastra el archivo o se pega.
2. Se aceptan hasta 8 fotos por factura, una por hoja, con «Otra página». Un PDF va solo. Los formatos son JPG, PNG, WEBP o PDF, de máximo 8 MB.
3. Si la foto salió movida u oscura, el sistema avisa «Esta foto puede leerse mal». Puedes tocar «Leer igual» o «Volver» para tomarla de nuevo.
4. Toca «Leer factura». La IA lee el proveedor y su RIF, el número de factura y de control, la fecha, la moneda, los renglones y los totales.
5. Revisa el formulario al lado de la foto:
   - Lo que llenó la IA lleva la marca «IA».
   - El cuadro de totales dice «Cuadra con el papel» o «No cuadra con el papel».
   - **Cada renglón necesita su mercancía.** Si el sistema ya la conoce de ese proveedor, viene puesta («Recordado de este proveedor»). Si no, elígela o toca «Crear mercancía nueva».
6. Toca «Guardar factura». Hasta que no se guarda, no se registra nada.

### Cargar una factura a mano
1. «Cargar factura» → «A mano».
2. «Información de la factura»: «Proveedor», «RIF», «N.º de factura», «Fecha de la factura», «N.º de control», «Montos en» (Dólares o Bolívares) y «Tasa» (sale sola con la del BCV de esa fecha). «Listo».
3. «Qué trae», por renglón: «Qué es…» (Materia prima, Reventa, Consumible, Desechable; o Flete, Servicio, Equipo, Otro gasto), la mercancía, «Cantidad», «Costo total» del renglón **sin IVA** e IVA (16 % o Exento). Cada renglón se cierra con «Listo»; «Otro renglón» agrega otro.
4. Pago: «Efectivo Bs», «Efectivo $», «Banco» (pide referencia), «A crédito» (vencimiento opcional) o «Mixto» (cada parte con «Con qué», «Cuánto» y referencia si es Banco; deben sumar lo que se le paga al proveedor).
5. «Guardar factura».

**Empaques** (bulto de 20 kg, caja de 24): si la ficha de la mercancía dice «Viene en empaque de», el renglón pide «Cuántos», «Cada uno trae» y «Costo total», y dice cuánto entra y a cuánto sale cada unidad. Si esa vez llegó suelta: «Esta vez vino suelta».

### Pagar una factura a crédito
En «Facturas» › «Cuentas por pagar» (las vencidas en rojo), elige «Con qué se paga» y toca «Abonar» o «Marcar pagada» («Pagar el resto» si ya hay abonos). Al completar el total queda pagada sola.

### Corregir una factura: nota de crédito
**Una factura con mercancía no se edita ni se borra.** Tócala en la lista → «Nota de crédito»:
- **«Llegó menos de lo facturado»:** lo que faltó sale del inventario y queda como reclamo en «Lo que los proveedores deben» (no es pérdida). Si nunca llega la nota, «Dar por perdido».
- **«Llegó la nota por lo que faltó»:** cierra el reclamo.
- **«Devolución»:** la mercancía vuelve al proveedor y sale del inventario.
- **«Descuento»:** te quedas la mercancía y baja el costo promedio.

«Borrar» solo existe para facturas **sin mercancía** (flete, servicio, equipo, otro gasto) y sin pagos registrados.

### Proveedores y alertas
- **Proveedores:** «Nuevo proveedor» (Nombre, RIF, Teléfono…) y «Guardar». «Ver ficha» muestra lo comprado, lo que se le debe y sus últimas facturas. «Archivar» lo deja de sugerir. En «Lo que se recuerda de sus facturas», «Olvidar» borra una asociación mal aprendida.
- **Alertas:** si algo llegó 15 % o más caro, al guardar sale «Llegó algo más caro» y queda en la pestaña «Alertas», con los platos que quedan a pérdida o con poco margen y si otro proveedor lo vendió más barato. También avisa «posible error de unidad» cuando el precio es 3 veces mayor o menor de lo normal.

### Reglas que confunden
- **El costo va sin IVA.** El IVA de la compra no es costo: se descuenta en Impuestos.
- **La tasa es obligatoria aunque la factura esté en dólares.** El libro de compras va en bolívares.
- **La fecha de la factura no puede ser futura.** Si la IA leyó mal el año, sale «La fecha de la factura no puede ser futura».
- **Factura repetida.** Si el número y el RIF ya existen, sale «Esta factura parece ya cargada». Se puede «Guardar igual», pero eso **suma el stock otra vez**.
- **Recargo y descuento al pie** se reparten entre todos los renglones y cambian el costo de cada uno.
- **Desechables** (servilletas, bolsas, cloro): van directo a gasto y no suman inventario.
- **Equipo** (una nevera, un horno): entra como bien del negocio y se va gastando en meses.
- **«Llegó» en Qué comprar y «Llegó mercancía» en la ficha** registran una compra suelta, sin factura. Esa compra no da crédito de IVA.

## Inventario

**Para qué sirve:** saber qué hay, cuánto vale, qué se perdió y qué hay que comprar.

**Dónde está:** `/inventario`, pestañas «Almacenes» (la portada: «Pérdidas · últimos 30 días», «Último conteo», «Por comprar» y las 4 fichas de almacén), «Qué comprar» (`/inventario/comprar`) y «Control» (`/inventario/control`). En la portada también están «Conteo físico», «Nueva mercancía», «Vender sin stock» y, en «⋯», «Administrar categorías».

### Los 4 almacenes
| Almacén | Qué va | Qué pasa con la plata |
|---|---|---|
| Materia prima (`/inventario/materia-prima`) | carne, pollo, harina, queso. Tiene dos caras: «Crudo» y «Preparado» (las preparaciones) | inventario, sale con las recetas |
| Reventa (`/inventario/reventa`) | refrescos, malta, agua, chucherías | inventario, se vende tal cual |
| Consumibles (`/inventario/consumibles`) | vaso, tapa, pitillo, caja del pastelito | inventario, sale con la receta |
| Desechables (`/inventario/desechables`) | servilletas, bolsas, cloro, papel | va directo a gasto; no lleva stock, solo muestra lo gastado |

Se entra a un almacén tocando su ficha. Para volver a la portada se toca el botón «Almacenes».

### Crear una mercancía
«Nueva mercancía» → «Nombre», «Qué es» (el almacén), «Se mide en» (kg, lt o unidad), «Cuánto hay hoy» y «Lo que pagas por kg, sin IVA». En «Más detalles»: «Categoría», «Avísame cuando quede menos de» (el mínimo), «Lo ideal tener», «Viene en empaque de», «Lo que se aprovecha (%)» (materia prima) y «No paga IVA». Termina con «Crear mercancía».

### La ficha de una mercancía
Se abre tocando el nombre. Muestra «Hay», «Te alcanza para» y «Te cuesta». En «Anotar»:
- **«Llegó mercancía»:** compra sin factura.
- **«Se dañó o se botó»:** merma («Cuánto se perdió», «Motivo», «Registrar merma»).
- **«La usó el personal»:** consumo de empleados; no cuenta como pérdida.
- **«Contar lo que hay»:** conteo de esa sola mercancía.

En «Cambiar los datos» están el mínimo, el empaque, «Venderla en el menú» (reventa), «Es la misma que otra: fusionarlas» y «Ya no la uso: archivarla».

### Conteo físico
«Conteo físico» → escribe lo que hay de verdad. «Contar a ciegas» viene encendido y esconde lo que dice el sistema. También sirve «Descargar planilla» y «Subir planilla llena» (con la columna «Contado»). Lo que quede en blanco no se toca. «Guardar conteo» y confirmar.

### Qué comprar y Control
- **Qué comprar:** entra lo que está en el mínimo o por debajo, y lo que alcanza para 7 días o menos según lo vendido en los últimos 14 días. Sugiere completar lo ideal, el mínimo o 14 días de consumo (el mayor). «Llegó» registra la compra.
- **Control:** «Debió salir vs. hay» (recetas contra conteo), «Pérdidas» (se pueden «Revertir»), «Conteos» y «Aceite y precios», donde está «Con qué costo fijar precios»: «Último costo» (por defecto), «Promedio» o «El mayor».

### Reglas que confunden
- **El stock no se escribe a mano:** sube con las compras y baja solo con cada comanda enviada (según la receta), las mermas, el consumo del personal y la producción de preparaciones. El conteo lo corrige.
- **Conteo con menos de lo esperado:** la diferencia queda como merma «por conteo». No es que se botó comida ese día: el sistema venía mal.
- **«Costo promedio» ≠ «Costo última compra»:** el promedio es lo que costó lo que tienes (10 kg a $1 más 10 kg a $2 dan $1,50). Para poner precios, mira la última compra.
- **«Aprovechable»** es cuánto de lo comprado se puede usar (pollo con hueso: 88 %). El «Costo real» = costo promedio ÷ aprovechable; las recetas usan ese costo y al vender se descuenta un poco más del depósito.
- **Stock en negativo:** «Vender sin stock» encendido, «Vender igual», una merma mayor que lo que había, o recetas con cantidades de más. Se arregla contando.
- **«Vender sin stock»** es general: encendido, ninguna venta se frena y arriba sale «Vendiendo sin stock» con «Apagar».
- **«Cambiar los datos» no convierte nada:** si 5 kg pasan a «unidad», quedan 5 unidades; si escribes otro costo, pisa el promedio.
- **Una mercancía archivada que va en una receta se sigue descontando al vender**; solo deja de aparecer para comprar.
- **Un desechable no va en recetas**, y lo que está en una receta no se puede pasar a desechable.

## Menú y recetas

**Para qué sirve:** decidir qué se vende, a cuánto, qué lleva cada producto y cuánto te deja.

**Dónde está:** `/menu`. Tiene dos pestañas:

- «El menú».
- «Recetas» (`/menu/recetas`).

Las **preparaciones** (guiso, mechada, salsas) no están aquí: están en Inventario › Materia prima › «Preparado».

### Categorías y productos
1. **Categoría:** «+ Categoría» («Crear la primera categoría» si no hay). «Nombre», «Color en el mostrador» y «Al comandar»: «Va a cocina» o «No va a cocina» (solo lo que viene marcado; la cajera lo cambia en cada pedido). «Crear categoría».
2. **Producto:** «+ Producto» → «Nombre», «Precio (opcional)», «Categoría» → «Crear producto» («Crear y armar la receta» si no hay precio). Se abre su receta.
3. **Tamaños o sabores:** «+ Variante», nombre y precio, «Agregar». **Ojo:** si el producto solo tiene «Regular», la nueva la *reemplaza*; para vender las dos, vuelve a agregar «Regular». Cada variante tiene su precio y su receta.
4. **Precio:** toca el precio y escribe el «Nuevo precio» en $. El cuadro dice cuánto cuesta producirlo y qué margen deja; por debajo del costo pide «Ponerlo igual».
5. **Mover y ordenar:** arrastrar, o «⋯» → «Mover a otra categoría…», «Subir», «Bajar».
6. **Quitar:** «⋯» → «Quitar del menú» (con «Deshacer»). Se devuelve desde «Lo que quitaste · N» → «Devolver al menú». Nada se borra: las ventas viejas lo siguen nombrando. Quitar una categoría quita sus productos.

No hay «agotado» en el menú: lo que se acabó se quita y se devuelve. Los productos no llevan foto.

### Armar la receta de un producto
1. «Ponle lo que lleva» (o «Editar receta») en «El menú», o tocar la fila en «Recetas».
2. «Buscar mercancía» y «+» en cada cosa que lleva.
3. Cantidad para **UNA unidad vendida**. En kg o lt la casilla abre en g o ml (tocando la unidad se cambia). Vaso, tapa o empaque van en «Por unidad», en enteros.
4. A la izquierda: precio, «Cuesta hacerlo» y margen («Pierdes por unidad» si se vende bajo el costo). Escribiendo el «Margen (% del precio)» el sistema calcula el precio, redondeado hacia arriba a la décima.
5. «Guardar receta».

**Qué puede ir en una receta:** materia prima, reventa, consumibles y preparaciones. **Qué no:** desechables ni el aceite de freír.

**Combos.** En una receta vacía aparece «¿Es un combo? Ármalo con productos del menú…». Ahí agregas productos con «Agregar producto» y dices «Cuántos lleva». La receta del combo es la suma de las recetas de esos productos.

**Reventa al menú.** En la ficha de una mercancía de reventa, toca «Venderla en el menú». Pon el nombre, la categoría y el precio, y toca «Agregar al menú». Cada venta descuenta una unidad.

### Preparaciones (sub-recetas por 1 kg)
Una preparación es algo que la cocina hace con el crudo, como un guiso o una salsa, y que después va dentro de los productos.

1. Inventario › Materia prima › «Preparado» → «Nueva preparación».
2. Nombre y unidad (kg, litro o unidad).
3. La materia prima de **1 kilo ya hecho**: «Entra» es el crudo como se compra; «Queda», lo que queda cocinado.
4. «Queda cocido» tiene que dar 1. Si da más no deja guardar: «Ajustar al kilo» reparte las cantidades. Si da menos, avisa pero guarda.
5. «Crear preparación». En la receta del producto se agrega como cualquier mercancía (ej. 50 g de guiso).

En cada tarjeta: **«Sobró hoy»** («Lo guardo» no mueve nada; «Lo boto» lo registra como pérdida) y **«Anotar tanda»** (solo en preparaciones que se producen por tandas: descuenta el crudo y suma lo hecho).

### Reglas que confunden
- **Cómo se calcula el margen:** (precio − costo) ÷ precio. Es lo que te queda del precio, no lo que le subes al costo.
- **Sin receta, el producto no tiene costo.** Por eso en Reportes sale con 100 % de ganancia, y además no descuenta inventario al venderse.
- **El costo de cada venta se congela al vender.** Cambiar o cargar la receta hoy no cambia las ventas de ayer.
- **El margen puede salir distinto en «El menú» y en «Recetas».**
  - «El menú» usa el costo promedio.
  - «Recetas» usa lo elegido en Inventario › Control › «Con qué costo fijar precios» (por defecto, el último costo) y le suma el aceite si el producto se fríe.
  - Con precios subiendo, «Recetas» da un margen más bajo y más realista.
- **Un producto con preparación descuenta la materia prima, no la preparación.** Si se vende una empanada con 50 g de guiso, bajan del inventario el pollo, la cebolla y lo demás del guiso, en proporción.
- **Los precios se guardan en dólares.** En bolívares cambian solos cuando cambia la tasa.
- **Al cambiar el porcentaje que se aprovecha de un crudo** dentro de una preparación, se cambia en la ficha de esa mercancía. Eso afecta a todo lo que la use.

## Cierre de caja

**Para qué sirve:** al final del día, contar lo que hay en cada gaveta y en el banco, y ver si cuadra con lo que se vendió.

**Dónde está:** `/caja`, pestañas «Cierre de caja» (la portada), «Gastos y retiros» (`/caja/movimientos`) e «Historial» (`/caja/historial`).

### Hacer el cierre
1. En «Cuadrando el día», elige la fecha. Viene puesto hoy y se puede elegir un día pasado.
2. Revisa la tabla «Desglose por forma de pago». Tiene las columnas «Entró», «Salió» y «Debes tener», para cada forma: Efectivo Bs, Efectivo $, Punto de venta, Pago movil, Transferencia, Zelle y A crédito.
   - Con «Ver N cobros» se ve cada cobro con su referencia.
3. Toca «Hacer cierre de caja». Se abre «Contar la caja».
4. Escribe lo que hay **de verdad** en cada sitio:
   - el efectivo, contando los billetes;
   - el punto, el pago móvil y la transferencia, mirando el lote o el banco, en bolívares;
   - el Zelle, en dólares.
   El cuadro está a ciegas. «Ver lo que dice el sistema» muestra lo esperado, pero lo correcto es contar primero.
5. Si hace falta, escribe una «Nota»: por qué faltó, quién contó.
6. Toca «Cerrar y conciliar».
7. La tabla agrega «Reportado por cajero» y «Diferencia». En cada forma dice «cuadra», «sobran $X», «faltan $X» o «sin verificar».

### Cómo se calcula «Debes tener»
- **Efectivo (Bs y $):** fondo + lo cobrado en esa gaveta − gastos y retiros pagados de esa gaveta ± otros movimientos de esa gaveta.
  - Los otros movimientos son, por ejemplo, un fiado cobrado en efectivo, un pago a proveedor en efectivo o el vuelto que salió de otra gaveta.
  - El **fondo** es lo que se contó al abrir la caja. Si no se abrió, es lo que traía esa gaveta de días anteriores.
- **Punto, pago móvil, transferencia y Zelle:** se coteja solo lo que entró ese día, sin fondo.
- **Pago mixto:** cada parte cuenta en su forma.
- **Propina:** entra con el pago, así que está en la gaveta.
- **Vuelto:** se resta de la gaveta por donde salió. Si el cliente pagó en $ y se le dio vuelto en Bs, la gaveta de $ recibe el billete entero y la de Bs da el vuelto.
- **A crédito:** no se cuenta, porque no entró plata.

### Gastos y retiros
En «Gastos y retiros», elige «Gasto» (con descripción, ej. «Bombona de gas», y categoría: Insumos, Servicios, Sueldos u Otros) o «Retiro del dueño». Elige de dónde sale («De Efectivo Bs», «De Efectivo $», «De Pago movil»…), escribe el monto **en dólares** y toca «Registrar»; queda con la hora de ese momento. La «x» lo borra (con «Deshacer»). La mercancía no va aquí: va por Compras.

### Corregir un cierre
- **Se tecleó mal:** en el día cerrado, «Corregir el conteo» → cambiar → «Guardar el conteo». El cierre viejo queda anulado con su rastro.
- **Rehacerlo:** «Historial» → abrir el cierre → «Anular este cierre», motivo, «Anular cierre», y volver a cerrar.

### Reglas que confunden
- **Un cierre por día para todo el local**, no por caja ni por cajera. No se cierra dos veces el mismo día.
- **En blanco** = no se verificó. **0** = conté y no había nada: anota faltante por todo lo esperado.
- **El día va de medianoche a medianoche** y la venta cuenta el día en que se *cobró*. Los pedidos sin cobrar no cuentan.
- **Faltantes y sobrantes van a los libros** y afectan la ganancia de Reportes.
- **Retiros del dueño** bajan la gaveta pero no son gasto. **Propinas** están en la gaveta pero son del empleado.
- **Pago mal registrado en un día ya cerrado:** anular el cierre, corregir el pago, volver a cerrar.
- **Los bolívares contados** se pasan a dólares con la tasa de hoy.

## Ventas

**Para qué sirve:** ver cada venta y lo que pasó con ella, cobrar fiados, devolver y corregir pagos.

**Dónde está:** `/ventas`, pestañas «Historial», «Resumen» (`/ventas/resumen`) y «Pérdidas» (`/ventas/perdidas`). El período viene en «Este mes» y se cambia con la pastilla «Período».

### Historial
Filtros «Qué pasó» (Cobradas, A crédito, Devueltas, «Anuladas: pérdida», «Anuladas: sin tocar», Abiertas) y «Factura» (Con factura, Sin factura); el buscador encuentra por número, cliente, producto o quién cobró. Al tocar una venta se ven renglones, descuento, propina, tasa de ese día, cómo se pagó, quién cobró y la factura; «Imprimir ticket» la reimprime. Los números de comanda se repiten cada día: la #12 de hoy no es la de ayer.

### Cobrar un fiado (venta a crédito)
1. Filtra «Qué pasó» → «A crédito» y toca la venta.
2. Junto a «Debe todavía», «Cobrar / abonar».
3. En «Cuánto entrega», lo que paga hoy. Si es menos, queda abonado («Entregó $X y queda debiendo $Y»).
4. La forma de pago (y la referencia si no es efectivo).

### Devolver una venta cobrada
«Devolver» → «Qué pasó» → «La comida se puede volver a vender»: «No, se bota (se registra como merma)» o «Sí, vuelve al inventario». Si estaba facturada, pide el número de la nota de crédito. No pide PIN; la venta queda «Devuelta» en el día en que se vendió.

### Corregir el pago o los renglones
- **«Editar pago»:** cambia forma, monto o referencia de cada pago; deben sumar lo cobrado. Si la plata cambia de gaveta, pide autorización. Un pago con vuelto solo admite cambiar la referencia.
- **«Editar renglones»:** cambia lo vendido; si cambia el total de una venta cobrada, pide autorización.
- **«Facturar ahora»:** factura una venta cobrada sin factura (el número es obligatorio).

### Resumen y Pérdidas
- **Resumen:** «Ventas», «Ventas por día», «Pedidos», «Ticket promedio» («Gasta en promedio cada cliente») y «Contra el período anterior», más cómo te pagaron y quién cobró.
- **Pérdidas:** «Dinero perdido» = devuelto + descuentos + merma. Las anuladas se muestran pero no se suman (nunca entraron), ni lo fiado (todavía se cobra).

### Reglas que confunden
- **En Ventas no se anula:** anular es para pedidos sin cobrar, en el Punto de venta.
- **«Contra el período anterior»** compara con un tramo del mismo largo justo antes: del 1 al 22 de octubre contra los 22 días anteriores, no contra septiembre completo.
- **Venta cobrada de otro día o facturada con cambio de monto:** no se edita; se devuelve y se vuelve a cobrar.

## Reportes

**Para qué sirve:** ver cómo va el negocio: cuánto se vende, cuánto te queda, qué se pierde y qué hay en inventario.

**Dónde está:** `/reportes`, pestañas «Resumen», «Ventas» (`/reportes/ventas`), «Pérdidas» (`/reportes/perdidas`), «Inventario» (`/reportes/inventario`) y «A medida» (`/reportes/a_medida`).

El período viene en «Este mes», que va del día 1 a hoy. Resumen y Ventas se filtran también por «Categoría» y «Producto»; Pérdidas e Inventario, por «Cajón» y «Mercancía». «Quitar filtros» limpia todo.

### Qué hay en cada pestaña
- **Resumen:** «Ventas», «Ganancia neta» («Te quedó»), «Pedidos» y «Ticket promedio». Con un producto o categoría filtrada cambia a «Deja», «Pedidos que lo llevan» y «Unidades». Abajo, «De dónde sale la ganancia» y el «Análisis del negocio».
- **Ventas:** cuándo se vende (hora y día), «Producto por producto» (Vendidos, Ingresos, Ganancia, Margen) y «Qué se vende junto».
- **Pérdidas:** merma del período, su peso sobre la venta, faltantes de conteo y consumo del personal.
- **Inventario:** «Plata en mercancía», para cuántos días alcanza, qué comprar y qué subió.

### Armar un reporte a medida
1. «Período» y, en «Ver», qué mirar (Ventas, Menú, Caja, Compras, Inventario, Cocina, Contabilidad o Tasa de cambio).
2. «Por» (cómo agrupar, y opcional «y por»), «Medir» (qué contar), «Comparar» (un dato en columnas) y «Filtrar».
3. En «Reporte» hay listos para usar: «Lo más vendido», «Cobros por forma de pago», «Compras por proveedor», entre otros.
4. «Guardar o descargar»: «Guardar este reporte» (con nombre), «Descargar en Excel» (baja un CSV que Excel abre) o «Borrar este reporte» (se borra para todos).

Los reportes guardados los ven todos los que entran a Reportes. Solo los cambia quien los creó o el dueño. El costo y la ganancia en «A medida» solo los ve el dueño.

### Cómo se calculan los números
- **Ventas:** lo cobrado en el período, con descuentos aplicados y sin propina. Incluye lo vendido a crédito y no incluye lo devuelto ni lo anulado.
- **Ganancia neta («Te quedó»):** ventas sin IVA − costo de la mercancía − gastos. En los gastos entran merma, faltantes de caja, cortesías y equipos que se van gastando. Los retiros del dueño no restan.
- **Margen:** (ventas − costo de la mercancía) ÷ ventas.
- **Ticket promedio:** ventas ÷ pedidos. Al lado sale lo que gastó «el cliente típico», que es la mediana. Un pedido grande no la mueve.

### Reglas que confunden
- **Margen de 100 % o casi:** casi siempre son productos sin receta o mercancía con costo 0.
  - En la tabla por producto, esos productos salen marcados «sin receta». El análisis avisa: «N producto(s) sin receta: su ganancia no es real».
  - Como el costo se congela al vender, cargar la receta hoy arregla las ventas de hoy en adelante, no las pasadas.
- **«Ventas» es lo que entró, no lo que ganaste.** Para lo que ganaste, mira «Ganancia neta».
- **La merma de Reportes › Pérdidas puede no coincidir exactamente con la de Ventas › Pérdidas.** Una sale de los registros de merma y la otra de los libros.

## Para el contador: Contabilidad, Impuestos y Tasa

**Para qué sirve:** aquí no hay que cargar nada. Cada venta, compra, gasto y merma ya deja su asiento, su IVA y su tasa. Se entra cuando el contador lo pide.

**Dónde está:** la portada `/contador` («Zona contable») junta tres módulos: Contabilidad, Impuestos y Tasa de cambio. De fábrica, Contabilidad e Impuestos solo los ve el dueño; Tasa la ven el dueño y Caja.

### Contabilidad (`/contabilidad`)
**Pestañas:** «Plan de cuentas», «Asientos», «Balance de comprobación», «Estado de resultados», «Balance general», «Equipos» y «Respaldos». Todo va en dólares.

- **Plan de cuentas:** tocar una cuenta abre su libro mayor; «+ Nueva cuenta» crea una.
- **Asientos:** el libro diario, con filtro de período, cuenta y origen. «Asiento manual» pide descripción y al menos dos cuentas con el debe igual al haber. Solo los manuales se pueden borrar, y se borran sin confirmar.
- **Estado de resultados** sigue el período; **Balance de comprobación** y **Balance general** son a hoy. El general dice «Los libros cuadran» o «Los libros no cuadran – revisa los asientos manuales».
- **Equipos:** nacen de los renglones «Equipo» de Compras; uno anterior al sistema se agrega con «+ ya lo tenia». También «Cambiar duración», «Dar de baja» y «Cerrar ejercicio» (cierra el año anterior).
- **Respaldos:** ver Configuración.

### Impuestos (`/impuestos`)
**Pestañas:** «Libro de ventas», «Libro de compras», «Retenciones IVA» y «Declaraciones».

Arriba de todas está **«Datos fiscales»**: razón social, RIF, «Alícuota IVA (%)» (16 % por defecto), dirección fiscal y la casilla de agente de retención. Debajo, las tarjetas «IVA débito (ventas)», «IVA crédito (compras)» e «IVA a pagar» (o «IVA a favor»).

**Cómo bajar los libros:** en Libro de ventas o Libro de compras, toca «Descargar libro (formato SENIAT)» (Excel en bolívares) o «CSV en dólares».

**Cómo declarar el mes:** en «Declaraciones», ve a «Meses cerrados sin declarar» y toca «Declarar». Después, si hay IVA por pagar, toca «Registrar pago»: «Por banco» o «En efectivo».

**Reglas:**
- **Los precios del menú incluyen IVA.** La base es el total ÷ 1,16.
- **Al libro de ventas solo entran las ventas marcadas para facturar.** Lo que no se facturó se vendió igual, pero no aparece en el libro.
- **El número de factura no lo pone el sistema.** Se copia del talonario o de la máquina fiscal. Si la venta se facturó sin número, en el libro sale como «P-» más el número del pedido. No se puede repetir un número.
- **Libro de compras.** Las facturas entran por la fecha en que se registraron, no por la del papel. Se muestran las dos.
- **Documento sin tasa.** Si a una venta o compra le falta la tasa, sale «cargar tasa» y ese mes no se puede declarar hasta cargarla.
- **Mes ya declarado.** Queda cerrado: no se cambian tasas ni se factura tarde en ese mes. Solo se puede anular la última declaración.
- **No se declara el mes en curso.** Sale «Ese mes todavía no termina».
- **Crédito fiscal a favor.** Si en el mes pagaste más IVA del que cobraste, el sobrante pasa al mes siguiente.
- **Devolución de una venta facturada en otro mes.** La factura se queda en su mes y la nota de crédito entra en negativo en el mes de la devolución.

### Tasa de cambio (`/tasa`)
**Pestañas:** «Tasa de hoy», «Calculadora», «Análisis» e «Historial».

- **Se actualiza sola:** consulta el BCV cada 30 minutos (dólar y euro); el paralelo de referencia sale de Binance. La tasa de hoy dice «Automática» o «Cargada a mano». Si el BCV publica en la tarde la del día siguiente, se guarda con esa fecha y hoy se sigue cobrando con la de hoy.
- **Cargar a mano:** en «Cargar la tasa a mano», escribe la «Tasa manual» y toca «Fijar». «Volver a la automática» la quita.
- **Si hoy no hay tasa** se usa la última que haya (el lunes feriado, la del viernes). **Cada venta guarda la tasa de su día**, así que un reporte viejo no cambia.
- **Calculadora** convierte entre bolívares, BCV, paralelo y euro, y dice cuánto pierdes si cobras al oficial y repones al paralelo. **Análisis** muestra la brecha y cuánto se llevó de lo cobrado en bolívares.

## Configuración

**Para qué sirve:** lo que se ajusta una vez y se deja: tu cuenta, las palabras, la apariencia, los usuarios, los roles y el pago móvil.

**Dónde está:** `/configuracion`. Tiene seis pestañas:

- «Mi cuenta», «Lenguaje» y «Apariencia»: las ve todo el mundo.
- «Usuarios» y «Roles» (`/configuracion/usuarios`, `/configuracion/roles`) y «Pago móvil» (`/configuracion/pago-movil`): solo el dueño.

### Mi cuenta
Aquí se cambia el nombre y la contraseña. Si tu rol autoriza, también está «Crear mi PIN» o «Cambiar PIN»: pide tu contraseña y el PIN nuevo dos veces. El PIN es de 4 a 6 números y no puede ser igual al de otra persona.

### Usuarios
1. «Crear usuario»: «Nombre», «Apellido», «Usuario (para entrar)» (3 a 32 caracteres, minúsculas, sin espacios ni acentos), «Rol», «Contraseña» y «Repetir contraseña» (mínimo 8). El cuadro muestra a qué módulos entrará. «Crear usuario».
2. **Cambiar el rol:** selector en la fila. Le cierra sus sesiones abiertas.
3. **Olvidó la clave:** «Editar» → «Nueva contraseña» → «Guardar». No pide la anterior y le cierra las sesiones.
4. **PIN de otra persona:** en «Editar», campo «PIN» o «Quitarle el PIN» (solo si su rol autoriza).
5. **Borrar:** lo que hizo queda en el historial. Nadie se borra ni se cambia el rol a sí mismo.

Cada quien con su cuenta: así cada venta, anulación y cierre queda a nombre de quien lo hizo.

### Roles
**Roles de fábrica:**

| Rol | A qué entra |
|---|---|
| Dueño | Todo, incluidos Contabilidad, Impuestos, Respaldos, Usuarios y Pago móvil. Autoriza y ve las cifras del día siempre. |
| Caja | Punto de venta, Cocina, Reportes, Ventas, Menú, Recetas, Inventario, Compras, Cierre de caja y Tasa de cambio. De fábrica no autoriza y no ve las cifras del día. |
| Cocina | Solo la pantalla de Cocina. No crea pedidos ni cobra. |

En la pestaña «Roles»:
- **Recortar Caja o Cocina:** «Editar», marcar o desmarcar módulos y las casillas «Autoriza operaciones delicadas» y «Ve las cifras del día en el inicio», «Guardar». Queda «a tu medida»; «Restaurar el de fábrica» lo devuelve. Dueño no se recorta.
- **Rol propio** (ej. un mesonero que solo toma pedidos): «+ Crear rol», nombre, módulos y casillas, «Crear rol». Ningún rol propio incluye Configuración: repartir cuentas es solo del dueño. Se borra solo si nadie lo tiene.
- La persona ve el cambio **al recargar la página**.

### Lenguaje y Apariencia
- **Lenguaje:** «Sencillo» (por defecto) o «Técnico». Cambia los nombres, no los números: «Te quedó» = Ganancia neta, «Hay» = Stock, «Te deben» = A crédito por cobrar, «Plata en mercancía» = Valor en inventario, «Gasta en promedio cada cliente» = Ticket promedio. Lista completa en «Todo lo que tiene dos nombres». Vale por equipo.
- **Apariencia** (por equipo): «Tema» Claro u Oscuro, «Texto en Cocina» y, en tablets, el teclado en pantalla.

### Pago móvil
Sirve para que el mostrador verifique los pagos móviles con el banco antes de cobrar. El servicio lo activa Vertigo. Si no está activado, el dueño ve «Verificación de pagos móviles» con esa explicación.

Con el servicio activado:

- **Conectar:** «Conectar una cuenta», elegir el «Banco», usuario y clave de la banca en línea, «Nombre para reconocerla» y «Conectar». La clave del banco no se guarda en el sistema.
- **Varias cuentas:** «Hacer principal» elige la que se usa por defecto.
- **Cambiaste la clave en el banco:** «Clave del banco» → la nueva (se prueba antes de guardarse).
- **Marcas:** «principal», «bloqueada por el banco» o «fuera de servicio».
- **Vuelto automático por pago móvil:** solo con cuentas jurídicas (de empresa). Con cuenta de persona natural, el vuelto se manda desde el banco y se anota la referencia.

### Respaldos (Contabilidad › Respaldos)
Solo los maneja el dueño, o un rol al que se le dio Contabilidad.

- **Automáticos.** El sistema hace un respaldo cada 6 horas. Guarda los 8 más recientes y uno por día de los últimos 30 días.
- **Manual.** «Generar respaldo ahora» hace uno en el momento. «Descargar» guarda una copia fuera del servidor; se recomienda una por semana. La tarjeta se pone roja si pasan 7 días sin descargar.
- **Restaurar.** Toca «Restaurar» en la fila y confirma. **Restaurar devuelve el negocio entero a ese momento:** se pierden las ventas, compras, gastos y mermas que vinieron después. La ventana dice cuántos pedidos y cuánta plata se pierden. Antes de restaurar, el sistema guarda la base como estaba.

## Problemas comunes

**¿Por qué no me cuadra la caja?**
- Faltante chico y repetido: casi siempre vueltos mal dados.
- Faltante grande y aislado: un cobro sin registrar, o registrado con otra forma (entró por pago móvil y se marcó efectivo). Revisa «Ver N cobros» de cada forma y corrige con «Editar pago» en Ventas (si el día ya se cerró, anula el cierre primero).
- Sobrante repetido: una venta cobrada que nunca se cargó.
- Se puso 0 en algo que no se contó: el 0 anota faltante por todo lo esperado. Lo no contado va en blanco; se arregla con «Corregir el conteo».
- Un gasto pagado de la gaveta sin anotar: regístralo en «Gastos y retiros» con la gaveta de donde salió.
- No se abrió la caja: el sistema arranca de lo que traía la gaveta de días anteriores, con los descuadres viejos.

**¿Por qué el margen sale 100 % (o la ganancia igual a las ventas)?**
El producto no tiene receta o su mercancía tiene costo 0. Arma la receta en Menú › Recetas («Sin receta (N)» dice cuáles faltan) y revisa el costo de la mercancía. Las ventas ya hechas conservan su costo: se arregla de ahí en adelante.

**Vendí algo y no bajó el inventario.**
El producto no tiene receta, o fue un delivery o venta libre sin receta. Si la receta usa una preparación, baja la materia prima de la preparación, no la preparación. Y el inventario baja al **enviar la comanda**, no al cobrar.

**El inventario quedó en negativo.**
Se vendió o se mermó más de lo que el sistema creía: «Vender sin stock» encendido, «Vender igual», o recetas con cantidades de más. Haz un conteo físico y revisa las recetas.

**¿Por qué no puedo anular una venta?**
Solo se anula lo que **no se ha cobrado**. Lo cobrado se devuelve: Ventas › la venta › «Devolver». El rol Cocina no puede anular («Tu rol no tiene permiso para esto.»).

**No me deja editar una venta.**
Es de otro día y ya entró al cierre (devuélvela y vuelve a cobrarla); está facturada y cambia el monto (igual: devolver con nota de crédito y volver a cobrar); está fiada con saldo pendiente; o quieres quitar algo que la cocina ya terminó. Si cambia lo cobrado, hace falta PIN o una solicitud aprobada.

**Me pide PIN y no hay nadie que autorice.**
«Pedir permiso» → «Enviar solicitud»: le llega al dueño cuando abra la aplicación; vence a los 15 minutos. Si pasa seguido, el dueño puede marcar «Autoriza operaciones delicadas» en el rol Caja y ponerle PIN a la encargada.

**«PIN incorrecto».**
PIN mal escrito, o de alguien cuyo rol no autoriza. Tras 10 intentos fallidos hay que esperar unos minutos.

**La factura por foto leyó mal.**
Nada se guarda hasta «Guardar factura»: corrige a mano. Si dice «No cuadra con el papel», revisa cantidades y precios por renglón. Un año mal leído deja la fecha futura y no deja guardar. Una mercancía mal asociada se borra en Proveedores › «Lo que se recuerda de sus facturas» › «Olvidar». Foto borrosa: repetirla con luz, una hoja por foto. Si el lector no responde, «Mejor la anoto a mano».

**Cargué una factura dos veces (o con un error).**
Las facturas con mercancía no se borran: «Nota de crédito» → «Devolución» si sobra mercancía, «Descuento» si el precio quedó alto. Si el stock quedó mal, haz un conteo.

**No me deja entrar a un módulo / no veo un ícono.**
Tu rol no tiene ese módulo: el ícono no sale y la dirección te devuelve al Inicio. El dueño lo agrega en Configuración › Roles; luego recarga la página. «Tu rol no tiene permiso para esto» es lo mismo dentro de una pantalla.

**Me sacó del sistema / me pide la clave otra vez.**
La sesión se cierra tras unas 4 horas sin uso o 12 horas en total, y cuando el dueño te cambia la clave o el rol. Entra de nuevo.

**«Usuario o contraseña incorrectos».**
Revisa que el usuario esté en minúsculas y sin espacios. Si olvidaste la clave, el dueño pone una nueva en Configuración › Usuarios › «Editar». Tras muchos intentos hay que esperar unos minutos.

**Al cobrar dice «Sin tasa de cambio cargada» o la tasa está vieja.**
Tasa de cambio › «Tasa de hoy»: «Consultar BCV ahora», o cárgala con «Fijar». Si dice «Cargada a mano» y ya hay internet, «Volver a la automática».

**Pago móvil: «El banco no lo encuentra».**
El banco a veces tarda: espera y «Consultar otra vez», o revisa los dígitos. Si el comprobante es bueno y no aparece, «Cobrar sin verificar».

**Pago móvil: «Esa referencia ya se usó».**
Ya cobró otro pedido. Pide otro comprobante.

**Pago móvil: «La clave del banco ya no sirve» o «Se agotaron las consultas de verificación».**
Lo primero: el dueño actualiza la clave en Configuración › Pago móvil › «Clave del banco». Lo segundo: avisar a Vertigo y, mientras, cobrar anotando la referencia.

**El fiado de un cliente no aparece en la caja.**
Los fiados se cobran en Ventas › Historial › filtro «A crédito» › «Cobrar / abonar».

**«La caja de ese día ya se cerró».**
Cierre de caja › Historial › «Anular este cierre», corrige el pago en Ventas y vuelve a cerrar.

**No puedo borrar una mercancía.**
No se borran: «Ya no la uso: archivarla». Si es la misma que otra, «Es la misma que otra: fusionarlas» (el stock y las recetas pasan a la que queda).

**El margen sale distinto en «El menú» y en «Recetas».**
«El menú» usa el costo promedio; «Recetas», el último costo (o lo elegido en Inventario › Control) más el aceite si se fríe. Para fijar precios con inflación, guíate por «Recetas».

**La cocina no suena.**
Toca la pantalla de Cocina una vez, revisa que diga «Aviso activo» y el volumen de la tablet.

**No me deja declarar el IVA del mes / una venta no sale en el Libro de ventas.**
No se declara el mes en curso, ni un mes con documentos sin tasa («cargar tasa»), ni uno ya declarado. Una venta no aparece en el libro si no se marcó «Facturar esta venta»: se factura después con «Facturar ahora» mientras el mes no esté declarado.
