import type { Explicacion } from '../components/Ayuda'

/**
 * QUÉ SIGNIFICA CADA NÚMERO DEL ERP.
 *
 * Una entrada por columna de tabla y por cifra de tarjeta. Sale al pasar el
 * cursor por encima del título (ver `components/Ayuda.tsx`) y, en una tablet
 * --donde no hay cursor--, manteniendo el dedo sobre el título.
 *
 * Las cuatro partes de cada entrada responden siempre lo mismo: qué es, de
 * dónde sale el dato, cómo se calcula y para qué sirve. Escribir una
 * definición sin poder llenar "de dónde sale" suele ser la señal de que la
 * columna no debería existir.
 *
 * LA CLAVE ES `<tabla>.<columna>`: la tabla la declara con `glosario="..."` y
 * la columna es la misma `clave` con la que ya se ordena, así que no hay una
 * segunda lista que mantener en paralelo. `npm run glosario` avisa si una
 * columna quedó sin explicación.
 */

/** Base, IVA y Total son las mismas tres columnas en compras y en ventas. */
function baseIvaTotal(lado: 'compra' | 'venta'): Record<string, Explicacion> {
  const doc = lado === 'compra' ? 'la factura del proveedor' : 'la factura que le diste al cliente'
  return {
    base: {
      que: 'El precio sin IVA. En la ley se llama "base imponible": es sobre este número que se calcula el impuesto.',
      origen: `Se toma de ${doc}. Si la cargaste con el total, el sistema le quita el IVA hacia atrás.`,
      calculo: 'Total ÷ 1,16 cuando la alícuota es 16%. Al revés: base × 16% = IVA.',
      ejemplo:
        lado === 'compra'
          ? 'Un saco facturado en $116 tiene $100 de base. Ese $100 es el costo real de la mercancía; los $16 no son costo, son impuesto que vas a descontar.'
          : 'Una venta de $116 tiene $100 de base. Esos $100 son tu ingreso; los $16 los cobraste para el SENIAT, no son tuyos.',
    },
    iva: {
      que:
        lado === 'compra'
          ? 'El IVA que pagaste al proveedor. Es "crédito fiscal": se descuenta del que cobraste.'
          : 'El IVA que le cobraste al cliente. Es "débito fiscal": se lo debes al SENIAT.',
      origen: `De ${doc}, congelado con la alícuota vigente el día de la operación.`,
      calculo: 'Base × alícuota (16%). La alícuota se guarda en cada operación, así que cambiarla no altera los meses ya cerrados.',
      ejemplo:
        lado === 'compra'
          ? 'Pagaste $16 de IVA en compras y cobraste $50 en ventas: al SENIAT le pagas $34, no $50.'
          : 'Es la mitad que suma en "IVA a pagar" del mes. Cobrar sin registrarlo aquí es declarar de menos.',
    },
    total: {
      que: 'Lo que se pagó de verdad: base + IVA.',
      origen: `El monto que aparece al pie de ${doc}.`,
      calculo: 'Base + IVA. Con 16%, base × 1,16.',
      ejemplo:
        lado === 'compra'
          ? 'Es lo que salió de la caja o lo que le debes al proveedor. Para costear usa la Base, no este número.'
          : 'Es lo que entró a la caja. Para medir ventas y márgenes se usa la Base.',
    },
  }
}

const fecha = (que: string, origen: string, ejemplo: string): Explicacion => ({
  que,
  origen,
  ejemplo,
})

export const GLOSARIO: Record<string, Explicacion> = {
  // ── Inventario: la tabla de mercancía ──────────────────────────────────────
  'inventario.nombre': {
    que: 'La mercancía: la materia prima con la que cocinas, o lo que revendes tal cual.',
    origen: 'Lo creas tú con "+ Nueva mercancía". Toca el nombre para abrir su ficha completa.',
    ejemplo:
      'Harina y Queso son materia prima: entran en las recetas. Un refresco en lata es "reventa": se compra y se vende sin cocinar.',
  },
  'inventario.stock': {
    que: 'Cuánto hay ahora mismo, según el sistema.',
    origen:
      'No se teclea: sube con cada compra y baja sola con cada venta (descontando lo que dice la receta), con las mermas y con el consumo del personal. El conteo físico lo corrige.',
    calculo: 'Lo que entró menos lo que salió, desde el último conteo.',
    ejemplo:
      'Si la empanada lleva 0,05 kg de harina y vendes 10, bajan 0,5 kg sin que nadie toque nada. Cuando queda por debajo del mínimo aparece la etiqueta "Bajo".',
  },
  'inventario.minimo': {
    que: 'El punto en el que hay que volver a comprar.',
    origen: 'Lo pones tú en la ficha de la mercancía.',
    calculo: 'Cuando el stock cae a este número o por debajo, la mercancía se marca "Bajo" y entra en la lista de "Qué comprar".',
    ejemplo:
      'Si gastas 3 kg de harina al día y al proveedor le toma dos días traerla, un mínimo de 6 kg te avisa justo a tiempo.',
  },
  'inventario.costo': {
    que: 'Lo que te costó, en promedio, lo que tienes guardado. No es el último precio.',
    origen: 'Se recalcula solo en cada compra; también lo puedes fijar a mano en la ficha.',
    calculo:
      'Promedio ponderado: (stock viejo × costo viejo + lo que entra × lo que pagaste) ÷ stock total. Por eso no salta de golpe cuando el proveedor sube el precio.',
    ejemplo:
      'Tenías 10 kg a $1 y compras 10 kg a $2: el costo queda en $1,50, no en $2. Es lo correcto para valorar el depósito, pero para poner precios mira "Reponer".',
  },
  'inventario.reponer': {
    que: 'Lo que pagaste la última vez. Es lo que te va a costar comprar más.',
    origen: 'La última compra registrada de esa mercancía, venga de una factura o de una compra suelta.',
    calculo: 'El costo unitario de la compra más reciente. Si está muy por encima del promedio, sale el porcentaje en naranja.',
    ejemplo:
      'Con el promedio en $1,50 y reponer en $2, un producto que parece dejarte 40% de margen en realidad te deja 25%. Para fijar precios manda este número, no el promedio.',
  },
  'inventario.rendimiento': {
    que: 'Cuánto de lo que compras queda realmente utilizable después de limpiar, pelar o cocinar.',
    origen: 'Lo pones tú en la ficha. 100% = no se pierde nada (harina, azúcar). La mercancía de reventa no lo usa.',
    calculo: 'Es una merma normal del proceso, distinta de la Merma que registras cuando algo se daña o se bota.',
    ejemplo:
      'Del pollo con hueso aprovechas 88%: de 1 kg comprado cocinas 0,88 kg. Si costeas con el kilo comprado, cada plato te sale más barato en el papel que en la realidad.',
  },
  'inventario.real': {
    que: 'Lo que de verdad cuesta una unidad aprovechable. Es el número que usan las recetas y los márgenes.',
    origen: 'Lo calcula el sistema con las dos columnas anteriores.',
    calculo: 'Costo de compra ÷ rendimiento. Con 100% de rendimiento son iguales.',
    ejemplo:
      'Pollo a $4,50 el kilo con 88% de rendimiento cuesta en realidad $5,11 por kilo usable ($4,50 ÷ 0,88). Costear con $4,50 te haría creer que ganas 60 centavos de más en cada plato.',
  },
  'inventario.acciones': {
    que: 'Los movimientos que puedes registrar sobre esa mercancía.',
    origen: 'Cada uno deja su asiento contable: nada mueve el stock en silencio.',
    ejemplo:
      '"+ Compra" entra mercancía y actualiza el costo promedio. "− Merma" registra lo que se dañó o se botó. En "Más" está la ficha: consumo del personal, conteo, historial y edición.',
  },

  // ── Inventario: pérdidas registradas ─────────────────────────────────────
  // El extracto de una mercancía: el libro de movimientos del deposito.
  'movimientos.fecha': fecha(
    'Cuándo se movió la mercancía.',
    'La hora del local en que entró o salió: una venta, una compra, una merma, un conteo.',
    'Los movimientos van del más nuevo al más viejo, como el extracto del banco.',
  ),
  'movimientos.movimiento': {
    que: 'Qué pasó con la mercancía.',
    origen:
      'Lo pone el sistema según la operación: Venta descuenta al mandar la comanda a cocina, Compra suma, Merma es lo que se botó, Ajuste por conteo es lo que encontró la balanza, Reverso deshace algo mal cargado.',
    ejemplo:
      'Un "Ajuste por conteo" grande dice que el sistema venía mal desde hace rato, no que se perdió comida ese día.',
  },
  'movimientos.quien': {
    que: 'Quién hizo el movimiento.',
    origen: 'La cuenta con la que se entró al sistema. Las ventas lo toman de quien tomó la comanda.',
    ejemplo:
      'Vacío en los movimientos viejos: son anteriores a que el sistema pidiera clave, y ahí no hay a quién atribuirlos.',
  },
  'movimientos.cantidad': {
    que: 'Cuánto entró o salió.',
    origen: 'La cantidad del movimiento, con signo: en verde lo que entra, en rojo lo que sale.',
    ejemplo: 'Una venta de 40 empanadas saca de la carne lo que dice la receta, ya ajustado por el rendimiento.',
  },
  'movimientos.saldo': {
    que: 'Cuánto quedó después de ese movimiento.',
    origen: 'Se guarda en el momento, no se recalcula.',
    calculo: 'El saldo anterior más lo que entró, o menos lo que salió.',
    ejemplo:
      'Si el último saldo de esta lista no coincide con la existencia de la mercancía, algo movió el stock sin anotarlo y el sistema lo avisa arriba en rojo.',
  },
  'movimientos.valor': {
    que: 'A cuánto equivale ese movimiento en plata.',
    origen: 'Cantidad × el costo al que entró o salió, congelado en el momento.',
    calculo: 'En una compra, el precio de esa compra puntual. En una venta o merma, el costo promedio de la mercancía cuando se movió, no el de hoy.',
    ejemplo: '0.025 kg de café no dice mucho; $0.30 sí dice cuánto costó ese cafecito.',
  },
  'perdidas.fecha': fecha(
    'Cuándo se registró la pérdida.',
    'La hora del local en que alguien cargó la merma, o en que un conteo físico encontró el faltante.',
    'Si ves varias mermas de la misma mercancía el mismo día, suele ser un registro duplicado: revisa antes de revertir.',
  ),
  'perdidas.insumo': {
    que: 'Qué se perdió.',
    origen: 'La mercancía que se eligió al registrar la merma o al contar.',
    ejemplo: 'La mercancía que aparece siempre en esta lista es la que hay que vigilar: o se maneja mal, o se está yendo.',
  },
  'perdidas.cantidad': {
    que: 'Cuánto se perdió, en la unidad de la mercancía.',
    origen: 'Lo escribiste al registrar la merma, o es la diferencia que encontró un conteo físico.',
    calculo: 'En un conteo: lo que dice el sistema menos lo que contaste. Si falta, entra aquí como merma.',
    ejemplo: 'El sistema decía 10 kg y contaste 8: esos 2 kg quedan registrados como pérdida, no desaparecen sin rastro.',
  },
  'perdidas.motivo': {
    que: 'Por qué se perdió.',
    origen: 'Lo escribes al registrar la merma. En un conteo queda como "Conteo físico".',
    ejemplo:
      'Separar "se quemó" de "se cayó" es lo que después te dice si el problema es la cocina o el manejo. Sin motivo, la lista solo dice que perdiste plata.',
  },
  'perdidas.valor': {
    que: 'Cuánta plata se perdió.',
    origen: 'Lo calcula el sistema con el costo de la mercancía.',
    calculo: 'Cantidad × costo promedio actual de la mercancía.',
    ejemplo:
      'Dos kilos de queso a $6,50 son $13 que no vas a recuperar. La suma del mes es el número de "Pérdidas 30 días" y sale del Estado de Resultados.',
  },

  // ── Inventario: historial de costos de una mercancía ─────────────────────────
  'costos.fecha': fecha(
    'El día de esa compra.',
    'La fecha de la factura, o del día en que registraste la compra suelta.',
    'Puesto en orden, dice cada cuánto te toca reponer y cada cuánto te suben el precio.',
  ),
  'costos.cantidad': {
    que: 'Cuánto entró en esa compra.',
    origen: 'La cantidad que cargaste, de una factura o de una compra suelta.',
    ejemplo:
      'Sirve para detectar el error de tecleo más común: un saco de 50 kg cargado como 1 deja el costo unitario cincuenta veces inflado.',
  },
  'costos.costo': {
    que: 'Lo que costó una unidad en esa compra concreta.',
    origen: 'Lo que pagaste dividido entre lo que entró, siempre sin IVA.',
    calculo: 'Total pagado sin IVA ÷ cantidad.',
    ejemplo: 'La compra más reciente de esta lista es la que aparece como "Reponer" en la tabla de mercancía.',
  },
  'costos.cambio': {
    que: 'Cuánto subió o bajó el precio respecto a la compra anterior.',
    origen: 'Lo calcula el sistema comparando cada compra con la anterior EN EL TIEMPO, no con la fila de arriba.',
    calculo: '(costo de esta compra ÷ costo de la compra anterior − 1) × 100.',
    ejemplo:
      'Tres compras seguidas con +15% son 52% acumulado: si tu precio de venta no se movió parecido, llevas semanas vendiendo con el margen de antes.',
  },

  // ── Compras: facturas del proveedor ──────────────────────────────────────
  'compras.fecha': fecha(
    'La fecha de emisión de la factura del proveedor.',
    'La escribes al cargar la factura. Es la que manda para el Libro de Compras, no el día en que la cargaste.',
    'Una factura con fecha de otro mes entra en la declaración de ESE mes: por eso se carga la fecha real y no la de hoy.',
  ),
  'compras.factura': {
    que: 'El número de control de la factura del proveedor.',
    origen: 'Lo escribes al cargarla, tal como viene impreso.',
    ejemplo:
      'Es lo que te permite encontrar el papel cuando el SENIAT pregunta por una compra. Sin número no hay crédito fiscal que defender.',
  },
  'compras.proveedor': {
    que: 'A quién le compraste.',
    origen: 'Lo eliges o lo creas al cargar la factura, con su RIF.',
    ejemplo: 'Ordenando por proveedor ves cuánto le compras a cada uno: es el dato con el que se negocia un mejor precio.',
  },
  'compras.detalle': {
    que: 'Qué mercancías trajo esa factura y en qué cantidad.',
    origen: 'Las líneas que cargaste. Cada una sumó stock y recalculó el costo promedio de su mercancía.',
    ejemplo:
      'Si el stock de una mercancía no cuadra, aquí se ve qué factura la movió y por cuánto. Una factura con líneas ya no se puede borrar: se corrige con una nota de crédito.',
  },
  ...Object.fromEntries(Object.entries(baseIvaTotal('compra')).map(([k, v]) => [`compras.${k}`, v])),
  'compras.estado': {
    que: 'Si la factura ya se pagó o todavía se debe.',
    origen: 'Las de contado nacen pagadas; las de crédito quedan pendientes hasta que registres el pago.',
    calculo: 'Pendiente = todavía está en tus cuentas por pagar y forma parte de lo que debes.',
    ejemplo:
      'La suma de las pendientes es la plata comprometida que todavía tienes en la gaveta: contarla como ganancia es la forma más común de quedarse sin efectivo a fin de mes.',
  },

  // ── Impuestos: libro de ventas ───────────────────────────────────────────
  'libroventas.fecha': fecha(
    'El día en que se emitió la factura de venta.',
    'El momento del cobro: la factura se congela al cobrar el pedido, con la alícuota y la tasa de ese día.',
    'Define en qué mes declara esa venta. Por eso un pedido cobrado el día 1 no se puede mover al mes anterior.',
  ),
  'libroventas.factura': {
    que: 'El número de la factura que emitiste.',
    origen: 'Lo asigna el sistema, correlativo y sin saltos, al facturar el pedido.',
    ejemplo:
      'El Libro de Ventas se presenta en orden de este número y no puede tener huecos: una factura anulada se muestra anulada, nunca se borra.',
  },
  'libroventas.cliente': {
    que: 'A nombre de quién salió la factura.',
    origen: 'Lo que se escribió al facturar. "Contado" cuando el cliente no dio datos.',
    ejemplo: 'Una empresa que te compra necesita su nombre y RIF en la factura para descontar el IVA; un cliente de mostrador, no.',
  },
  ...Object.fromEntries(Object.entries(baseIvaTotal('venta')).map(([k, v]) => [`libroventas.${k}`, v])),

  // ── Impuestos: libro de compras ──────────────────────────────────────────
  'librocompras.fecha': fecha(
    'La fecha de la factura del proveedor.',
    'La que cargaste en Compras.',
    'Determina en qué declaración entra ese crédito fiscal.',
  ),
  'librocompras.factura': {
    que: 'El número de control de la factura del proveedor.',
    origen: 'De la factura física, cargada en Compras.',
    ejemplo: 'Es el respaldo del crédito fiscal: sin factura válida, ese IVA no se puede descontar.',
  },
  'librocompras.proveedor': {
    que: 'Quién te vendió.',
    origen: 'La ficha del proveedor asociada a la factura.',
    ejemplo: 'El libro se presenta con proveedor y RIF: son los datos que el SENIAT cruza con lo que ese proveedor declaró.',
  },
  'librocompras.rif': {
    que: 'El RIF del proveedor.',
    origen: 'La ficha del proveedor, cargada una vez y reutilizada en cada factura suya.',
    ejemplo:
      'Un RIF mal escrito hace que el cruce del SENIAT no encuentre la operación y te pueden objetar ese crédito fiscal.',
  },
  ...Object.fromEntries(Object.entries(baseIvaTotal('compra')).map(([k, v]) => [`librocompras.${k}`, v])),

  // ── Reportes: qué se vendió ──────────────────────────────────────────────
  'productos.producto': {
    que: 'El producto del menú que se vendió, con su variante.',
    origen: 'Las ventas cobradas del período que estés mirando.',
    ejemplo: 'Ordenando por esta columna comparas variantes: la empanada grande y la pequeña casi nunca dejan lo mismo.',
  },
  'productos.uds': {
    que: 'Cuántas unidades se vendieron en el período.',
    origen: 'La suma de ese producto en los pedidos cobrados. Los anulados y devueltos no cuentan.',
    ejemplo:
      'Lo más vendido no es lo que más deja: un producto con muchas unidades y margen flaco puede estar ocupando la cocina sin dejar plata.',
  },
  'productos.ingresos': {
    que: 'Cuánta plata entró por ese producto.',
    origen: 'Lo que se cobró de verdad, con los descuentos ya aplicados y sin IVA.',
    calculo: 'Unidades × precio cobrado.',
    ejemplo: 'La suma de esta columna es la venta del período. Es el "cuánto vendí", no el "cuánto gané".',
  },
  'productos.ganancia': {
    que: 'Lo que quedó después de pagar la mercancía de ese producto.',
    origen: 'La receta del producto, valorada al costo real de cada mercancía.',
    calculo: 'Ingresos − (costo real de la mercancía × unidades vendidas).',
    ejemplo:
      'Es la columna con la que se decide qué empujar. Un producto sin receta cargada aparece con ganancia igual a los ingresos: no es que sea buenísimo, es que no sabe cuánto cuesta.',
  },
  'productos.margen': {
    que: 'Qué porcentaje de lo que cobras te queda como ganancia.',
    origen: 'Se calcula con las dos columnas anteriores.',
    calculo: 'Ganancia ÷ ingresos × 100.',
    ejemplo:
      'En comida rápida un margen sano ronda 65-70%. Por debajo de 50% el producto se está comiendo la cocina; por debajo de 0% pierdes plata en cada venta.',
  },

  // ── Reportes: combinaciones ──────────────────────────────────────────────
  'combos.combinacion': {
    que: 'Dos productos que la gente se lleva junta.',
    origen: 'Se saca de los pedidos cobrados, mirando qué cayó en la misma comanda.',
    ejemplo: 'Es la base de un combo: si ya se venden juntos, empaquetarlos con un precio conjunto sube el ticket sin publicidad.',
  },
  'combos.veces': {
    que: 'Cuántas comandas llevaron los dos productos a la vez.',
    origen: 'El conteo directo sobre los pedidos del período.',
    ejemplo:
      'Es el peso de la evidencia. Dos productos que coincidieron tres veces no son un patrón; cuarenta veces sí.',
  },
  'combos.confianza': {
    que: 'De los clientes que pidieron el primer producto, qué porcentaje pidió también el segundo.',
    origen: 'Se calcula sobre las comandas del período.',
    calculo: 'Veces que fueron juntos ÷ veces que se pidió el primero, en porcentaje.',
    ejemplo:
      'Café con 70% de confianza hacia el pastelito significa que 7 de cada 10 cafés se van con pastelito. A los 3 restantes les falta que el cajero se lo ofrezca: esa es la venta que estás dejando en el mostrador.',
  },

  // ── Caja: historial de cierres ───────────────────────────────────────────
  'cierres.fecha': fecha(
    'Cuándo se cerró la caja, con quién y en qué punto de venta.',
    'El momento en que alguien contó la gaveta y guardó el cierre.',
    'Dos pisos son dos gavetas: cada una cierra la suya, y por eso aquí aparece el punto de venta.',
  ),
  'cierres.sistema': {
    que: 'Cuánto efectivo debería haber en la gaveta según el sistema.',
    origen: 'Lo calcula el ERP con todo lo que pasó desde el cierre anterior.',
    calculo: 'Fondo inicial + cobros en efectivo − gastos pagados en efectivo − retiros del dueño.',
    ejemplo: 'Es el número contra el que se compara el conteo. Si el sistema dice $250, eso es lo que debería aparecer al contar.',
  },
  'cierres.contado': {
    que: 'Cuánto efectivo había de verdad al contar los billetes.',
    origen: 'Lo escribe quien cierra la caja, después de contar.',
    ejemplo:
      'Se cuenta antes de mirar lo que dice el sistema. Contar sabiendo el resultado esperado es la manera más fácil de no encontrar nunca un faltante.',
  },
  'cierres.diferencia': {
    que: 'Lo que sobró o faltó en la gaveta.',
    origen: 'La resta de las dos columnas anteriores.',
    calculo: 'Contado − sistema. Negativo = falta plata; positivo = sobra.',
    ejemplo:
      'Faltantes chicos y constantes suelen ser vueltos mal dados; uno grande y aislado, un cobro que no se registró. Un sobrante repetido casi siempre es una venta cobrada y nunca cargada.',
  },

  // ── Contabilidad: plan de cuentas ────────────────────────────────────────
  'plan.codigo': {
    que: 'El número de la cuenta contable.',
    origen: 'Del plan de cuentas que trae el sistema, ordenado por grupos.',
    calculo: 'El primer dígito dice el grupo: 1 activo, 2 pasivo, 3 patrimonio, 4 ingresos, 5 costos, 6 gastos.',
    ejemplo: 'Ordenando por código el plan se lee como el balance: primero lo que tienes, después lo que debes.',
  },
  'plan.nombre': {
    que: 'Qué guarda esa cuenta.',
    origen: 'Del plan de cuentas.',
    ejemplo: '"Inventario de mercancía" acumula el valor de tu depósito; "Ventas", todo lo que facturaste.',
  },
  'plan.tipo': {
    que: 'A qué parte del negocio pertenece la cuenta.',
    origen: 'Lo define el plan de cuentas.',
    calculo: 'Activo, pasivo y patrimonio arman el Balance. Ingresos, costos y gastos arman el Estado de Resultados.',
    ejemplo:
      'Comprar un horno es activo (lo tienes); pagar la luz es gasto (se consumió). Meter el horno como gasto hunde la ganancia de ese mes y desaparece el horno del balance.',
  },
  'plan.naturaleza': {
    que: 'De qué lado crece la cuenta.',
    origen: 'Lo define el plan de cuentas.',
    calculo: 'Deudora: crece con el Debe (activos, costos, gastos). Acreedora: crece con el Haber (pasivos, patrimonio, ingresos).',
    ejemplo:
      'Es lo que hace que el saldo se muestre con el signo correcto: una venta de $100 deja Ventas en $100 a favor, no en −$100.',
  },

  // ── Contabilidad: mayor de una cuenta ────────────────────────────────────
  'mayor.fecha': fecha(
    'Cuándo ocurrió el movimiento.',
    'La fecha del asiento que lo generó.',
    'Sirve para encontrar el día en que un saldo se salió de lo normal.',
  ),
  'mayor.descripcion': {
    que: 'Qué operación movió esta cuenta.',
    origen: 'El texto del asiento: la venta, la compra o el ajuste que lo generó.',
    ejemplo: 'Desde aquí se rastrea cualquier saldo raro hasta el pedido o la factura que lo causó.',
  },
  'mayor.debe': {
    que: 'Lo que entró por el lado izquierdo del asiento.',
    origen: 'Cada asiento reparte el mismo monto entre Debe y Haber.',
    calculo: 'En una cuenta deudora (caja, inventario) el Debe la aumenta; en una acreedora la disminuye.',
    ejemplo: 'Cobrar $100 en efectivo pone $100 en el Debe de Caja y $100 en el Haber de Ventas.',
  },
  'mayor.haber': {
    que: 'Lo que salió por el lado derecho del asiento.',
    origen: 'La contrapartida del Debe: todo asiento cuadra.',
    calculo: 'En una cuenta acreedora (ventas, proveedores) el Haber la aumenta; en una deudora la disminuye.',
    ejemplo: 'Pagar una factura de $50 pone $50 en el Debe de Proveedores (debes menos) y $50 en el Haber de Caja (tienes menos).',
  },
  'mayor.saldo': {
    que: 'Cómo va quedando la cuenta después de cada movimiento.',
    origen: 'Lo acumula el sistema línea por línea.',
    calculo: 'Saldo anterior ± el movimiento, con el signo que le toca según la naturaleza de la cuenta.',
    ejemplo: 'El último saldo de esta lista es el que aparece en el Balance para esa cuenta.',
  },

  // ── Contabilidad: libro diario ───────────────────────────────────────────
  'diario.fecha': fecha(
    'El día del asiento.',
    'La fecha de la operación que lo generó, no la de carga.',
    'El diario se lee en orden de fecha: es el relato cronológico de todo lo que pasó en el negocio.',
  ),
  'diario.descripcion': {
    que: 'Qué se registró.',
    origen: 'Lo arma el sistema con la operación de origen, o lo escribes tú en un asiento manual.',
    ejemplo: '"Venta pedido #42" o "Compra de mercancía factura 0012": el asiento dice qué pasó, no solo cuánto.',
  },
  'diario.origen': {
    que: 'Qué parte del ERP generó el asiento.',
    origen: 'Lo marca el sistema: una venta del POS, una factura de compra, un cierre de caja, una merma, o un asiento manual.',
    ejemplo:
      'Casi todo debería decir que vino de una operación real. Muchos asientos manuales son señal de que algo se está corrigiendo a mano en vez de registrarse bien.',
  },
  'diario.movimientos': {
    que: 'Las cuentas que tocó el asiento, con su Debe y su Haber.',
    origen: 'Las líneas del asiento.',
    calculo: 'La suma del Debe siempre es igual a la del Haber. Si no cuadra, el asiento no se guarda.',
    ejemplo: 'Una venta a crédito mueve tres cuentas: Cuentas por cobrar, Ventas e IVA débito fiscal.',
  },

  // ── Contabilidad: balance de comprobación ────────────────────────────────
  'balance.cuenta': {
    que: 'La cuenta contable con movimientos en el período.',
    origen: 'Todas las cuentas del plan que se movieron.',
    ejemplo: 'El balance de comprobación es la radiografía rápida: si algo está mal, aquí se ve el bulto antes que en ningún otro lado.',
  },
  'balance.debe': {
    que: 'Todo lo que se cargó al Debe de esa cuenta en el período.',
    origen: 'La suma de los asientos del período.',
    calculo: 'Suma de la columna Debe de todos sus movimientos.',
    ejemplo: 'El total de esta columna debe ser idéntico al del Haber. Si difieren, hay un asiento descuadrado.',
  },
  'balance.haber': {
    que: 'Todo lo que se abonó al Haber de esa cuenta en el período.',
    origen: 'La suma de los asientos del período.',
    calculo: 'Suma de la columna Haber de todos sus movimientos.',
    ejemplo: 'Junto con el Debe es la prueba de que la contabilidad cuadra: los dos totales tienen que dar igual.',
  },
  'balance.saldo': {
    que: 'Con cuánto quedó la cuenta.',
    origen: 'La diferencia entre las dos columnas anteriores.',
    calculo: 'Debe − Haber en las cuentas deudoras; Haber − Debe en las acreedoras.',
    ejemplo: 'Es el número que pasa al Balance General y al Estado de Resultados.',
  },

  // ── Tasa de cambio ───────────────────────────────────────────────────────
  'tasas.fecha': fecha(
    'El día de esa tasa.',
    'Se guarda una por día: la que estuvo vigente para las ventas de esa jornada.',
    'Cada venta guarda la tasa de su día, así que un reporte viejo no cambia porque hoy el dólar esté en otro precio.',
  ),
  'tasas.oficial': {
    que: 'La tasa del BCV: la que manda para facturar y declarar.',
    origen: 'La trae el sistema del BCV; si no hay conexión, la cargas a mano.',
    ejemplo: 'Es la que el SENIAT espera ver en tus libros. Facturar con otra tasa es un problema fiscal, no una decisión comercial.',
  },
  'tasas.euro': {
    que: 'El euro oficial del BCV de ese día: cuántos bolívares vale un euro.',
    origen: 'Se lee del BCV, que lo publica aparte del dólar.',
    calculo:
      'No se calcula: NO es el dólar pasado por el cambio euro/dólar. El BCV fija cada uno por su lado y dan distinto, así que derivarlo daría un número parecido y equivocado.',
    ejemplo: 'Sirve si a alguien le pagan o le cobran en euros; para facturar manda el dólar oficial.',
  },
  'tasas.paralelo': {
    que: 'La tasa del mercado paralelo, de referencia.',
    origen: 'Se toma de Binance P2P.',
    ejemplo:
      'No se factura con ella, pero es a la que vas a reponer la mercancía. Si tus precios siguen al oficial y compras al paralelo, pierdes en cada venta.',
  },
  'tasas.origen': {
    que: 'Si la tasa la trajo el sistema o la escribió una persona.',
    origen: 'Lo marca el propio sistema al guardarla.',
    calculo: '"auto" = consultada al BCV o a Binance. "manual" = la cargaste tú.',
    ejemplo: 'Varias tasas manuales seguidas significan que la consulta automática está fallando y alguien la está tapando a mano.',
  },

  // ── Usuarios ─────────────────────────────────────────────────────────────
  'usuarios.usuario': {
    que: 'Con qué nombre entra esa persona al sistema.',
    origen: 'Lo creas tú al dar de alta la cuenta.',
    ejemplo:
      'Cada quien entra con el suyo: así cada pedido, anulación y cierre queda a nombre de quien lo hizo. Una cuenta compartida borra ese rastro.',
  },
  'usuarios.rol': {
    que: 'Qué puede hacer dentro del sistema.',
    origen: 'Lo eliges al crear la cuenta y lo puedes cambiar después.',
    calculo:
      'Dueño: todo en su local. Caja: vender, cobrar, cerrar caja, inventario y compras. Cocina: solo la pantalla de comandas.',
    ejemplo: 'A quien atiende el mostrador no le hace falta ver la contabilidad; darle el rol Caja le evita a él un error y a ti un disgusto.',
  },
  'usuarios.acceso': {
    que: 'Cuándo entró esa persona por última vez.',
    origen: 'Lo registra el sistema en cada inicio de sesión.',
    ejemplo: 'Una cuenta que no se usa hace meses es una puerta abierta sin necesidad: bórrala. Lo que hizo queda en el historial igual.',
  },

  // ── Sistema: respaldos ───────────────────────────────────────────────────
  'respaldos.fecha': fecha(
    'Cuándo se tomó ese respaldo.',
    'El sistema lo hace solo cada 6 horas; también puedes pedir uno cuando quieras.',
    'Restaurar uno devuelve el negocio a ese momento exacto: todo lo vendido después se pierde. Por eso interesa el más reciente.',
  ),
  'respaldos.tamano': {
    que: 'Cuánto ocupa el archivo del respaldo.',
    origen: 'El tamaño del archivo comprimido en el servidor.',
    ejemplo:
      'Debería crecer despacio y parejo. Un respaldo mucho más chico que los anteriores es la señal de que algo salió mal al generarlo: no confíes en él.',
  },

  // ═══ Tarjetas de cifras ═══════════════════════════════════════════════════

  // Inicio
  'kpi.vendido_hoy': {
    que: 'Lo que llevas cobrado hoy.',
    origen: 'Los pedidos cobrados desde que abrió el día, en la moneda que elijas arriba.',
    calculo: 'Suma de las ventas cobradas de hoy. Lo pendiente de cobro no entra.',
    ejemplo: 'Es el pulso del día. Para saber cuánto GANASTE, ese número está en Reportes: esto es lo que entró, no lo que queda.',
  },
  'kpi.pedidos_hoy': {
    que: 'Cuántos pedidos se cobraron hoy.',
    origen: 'El conteo de pedidos cerrados del día.',
    ejemplo:
      'Junto con lo vendido te da el ticket promedio de hoy. Si vendes igual con menos pedidos, estás vendiendo más caro; con más pedidos, estás vendiendo más barato.',
  },
  'kpi.en_cocina': {
    que: 'Cuántas comandas están esperando que la cocina las prepare.',
    origen:
      'Las mismas que ves en la pantalla de Cocina: pedidos con algún producto sin marcar como preparado, cobrados o no, de las últimas 12 horas. Que ya esté pagado no significa que esté hecho.',
    ejemplo:
      'Si este número crece y no baja, la cocina se está quedando atrás y el cliente lo va a notar antes que tú. Toca la tarjeta para ver la pantalla de cocina.',
  },
  'kpi.por_cobrar': {
    que: 'Pedidos ya listos que todavía no se han cobrado.',
    origen: 'Los pedidos que la cocina marcó listos y siguen sin pago registrado.',
    ejemplo:
      'Al cerrar el día esto debería estar en cero. Un pedido que se queda aquí es comida que salió sin que entrara la plata.',
  },

  // Inventario
  'kpi.insumos': {
    que: 'Cuánta mercancía activa maneja el local.',
    origen: 'La mercancía dada de alta que no está archivada.',
    calculo: 'Se separan en materia prima (entra en recetas) y reventa (se vende tal cual).',
    ejemplo: 'Si tienes veinte y el menú solo usa doce, hay ocho que compras sin saber bien para qué.',
  },
  'kpi.bajo_minimo': {
    que: 'Cuánta mercancía ya cruzó su punto de reposición.',
    origen: 'La mercancía cuyo stock cayó al mínimo o por debajo.',
    calculo: 'Cuenta de mercancías con stock ≤ mínimo.',
    ejemplo: 'Es la lista de compras de hoy. En cero significa que no vas a quedarte sin nada mañana.',
  },
  'kpi.valor_deposito': {
    que: 'Cuánta plata tienes guardada en forma de mercancía.',
    origen: 'Todo lo que hay en el depósito, valorado al costo.',
    calculo: 'Suma de (stock × costo promedio) de cada mercancía, sin IVA.',
    ejemplo:
      'Es plata quieta: no está en la gaveta ni en el banco, está en el estante. Si crece mientras las ventas no, estás comprando de más.',
  },
  'kpi.perdidas_30': {
    que: 'Cuánto se perdió en el período elegido arriba (30 días si no tocaste el filtro).',
    origen: 'Las mermas registradas y los faltantes que encontraron los conteos.',
    calculo: 'Suma del valor de las mermas no revertidas del período.',
    ejemplo:
      'Comparado con las ventas del mes te da el % de merma. Por encima de 3-4% en comida, o se está botando mucho o se está yendo por la puerta.',
  },

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

  // Impuestos
  'kpi.iva_debito': {
    que: 'El IVA que cobraste en tus ventas del período.',
    origen: 'Las facturas de venta del Libro de Ventas.',
    calculo: 'Suma del IVA de todas las ventas facturadas del período.',
    ejemplo: 'Esta plata nunca fue tuya: la cobraste por cuenta del SENIAT y está en tu caja de paso.',
  },
  'kpi.iva_credito': {
    que: 'El IVA que pagaste en tus compras del período.',
    origen: 'Las facturas de compra cargadas en Compras.',
    calculo: 'Suma del IVA de las facturas de compra del período.',
    ejemplo:
      'Se descuenta de lo que debes. Una factura de compra que no cargues es IVA que pagaste y terminas regalando.',
  },
  'kpi.iva_a_pagar': {
    que: 'Lo que le queda debiendo al SENIAT este período, o lo que te queda a favor.',
    origen: 'La diferencia entre los dos anteriores.',
    calculo: 'IVA débito − IVA crédito. Si da negativo queda a tu favor y se arrastra al mes siguiente.',
    ejemplo:
      'Cobraste $50 de IVA y pagaste $16: declaras y pagas $34. Si el mes que viene compras más de lo que vendes, el crédito que sobra no se pierde.',
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
    calculo:
      'No sale de convertir el dólar: el BCV fija los dos por separado y no coinciden. Por eso se lee de la fuente.',
    ejemplo:
      'Eligiendo "Euro BCV" arriba, todos los montos del sistema se ven en euros a esa tasa. Útil si cobras o pagas en euros; lo que se factura sigue siendo el dólar oficial.',
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
    calculo:
      'Se suma pago por pago, no venta por venta: en una venta mixta solo cuenta la parte que entró en bolívares.',
    ejemplo:
      'Es la parte de tu venta que está expuesta a la brecha. Lo que te pagan en efectivo en dólares no lo está.',
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
    origen: 'Los pagos del período, método por método. Efectivo Bs, pago móvil, transferencia y tarjeta cuentan; efectivo en dólares y Zelle no.',
    calculo: 'Cobrado en bolívares ÷ cobrado total.',
    ejemplo: 'Con 70% de exposición y 10% de brecha, pierdes 7% de toda la venta al reponer comprando divisas. Lo que entra en divisas no pierde nada.',
  },
  'kpi.proyeccion_30d': {
    que: 'Dónde estaría el dólar en 30 días si siguiera al ritmo de este período.',
    origen: 'La primera y la última tasa oficial del período.',
    calculo: 'Ritmo diario compuesto, proyectado 30 días hacia adelante.',
    ejemplo: 'No es un pronóstico: nadie sabe qué hará el BCV. Sirve para dimensionar cuánto se encarece reponer si no cambia nada.',
  },
  'kpi.dia_tipico': {
    que: 'Lo que vende un día de la semana normal, no la suma de todos.',
    origen: 'Las ventas de cada día de la semana, divididas entre las veces que ese día cayó en el período.',
    ejemplo: 'Un mes con cinco sábados sumaría más que uno con cuatro; el promedio por sábado compara lo mismo.',
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
  // ── Ventas: el historial ─────────────────────────────────────────────────
  'ventas.numero': {
    que: 'El número de comanda: el que salió en el ticket y el que gritó la cocina.',
    origen: 'Lo asigna el punto de venta al crear el pedido. Empieza en 1 cada día.',
    ejemplo: 'Se repite de un día a otro: la #12 de hoy y la #12 de ayer son ventas distintas. Con la fecha al lado no hay confusión.',
  },
  'ventas.fecha': fecha(
    'Cuándo se cobró la venta. Si se anuló o sigue abierta, cuándo se tomó la comanda.',
    'La hora del cobro, con el reloj del servidor del local.',
    'Una venta devuelta sigue en el día en que se vendió (marcada como devuelta): quien busca "la venta del martes" la encuentra el martes.',
  ),
  'ventas.detalle': {
    que: 'Lo que se vendió, resumido: cantidad y producto de cada renglón.',
    origen: 'Los renglones del pedido con el nombre que tenía el producto ese día.',
    ejemplo: '"2× Empanada, 1× Jugo". Toca la fila para ver cada renglón con su precio, la nota de cocina y el desglose del total.',
  },
  'ventas.estado': {
    que: 'Qué pasó con la venta.',
    origen: 'Del pedido y sus pagos.',
    calculo:
      'Cobrada: se pagó. Fiada: se entregó y todavía se debe. Devuelta: se cobró y el cliente trajo la comida de vuelta. Anulada: no llegó a venderse. Abierta: sigue en cocina o lista sin cobrar.',
    ejemplo: 'Muchas anuladas es un problema de toma de pedidos; muchas fiadas, un problema de cobro. Cada estado apunta a otra cosa.',
  },
  'ventas.pago': {
    que: 'Con qué se pagó.',
    origen: 'Los pagos registrados al cobrar. Con pago mixto aparecen las dos formas.',
    ejemplo: '"Efectivo $ + Pago móvil": el cliente dio unos dólares y completó por el teléfono. Es lo que hace que el cierre de caja cuadre por gaveta.',
  },
  'ventas.quien': {
    que: 'Quién cobró, y desde qué caja.',
    origen: 'El operador y el punto de venta elegidos al cobrar.',
    ejemplo: 'Con dos tablets, saber cuánto vendió cada cajero y cuánto entró por cada gaveta. Si nadie eligió operador, queda vacío.',
  },
  'ventas.total': {
    que: 'Lo que pagó el cliente por la comida, con el descuento ya aplicado.',
    origen: 'La suma de los renglones menos la rebaja de esa venta.',
    calculo: 'Precio de lista − descuento. La propina no entra: es plata del empleado.',
    ejemplo: 'Tachado en las anuladas y devueltas: ese dinero no es venta. En bolívares, a la tasa del día en que se cobró, no a la de hoy.',
  },

  // ── Ventas: lo que se perdió ─────────────────────────────────────────────
  'ventas_perdidas.numero': {
    que: 'El número de comanda de la venta afectada.',
    origen: 'El mismo número del historial.',
    ejemplo: 'Sirve para ir a buscarla en el Historial y ver el detalle completo.',
  },
  'ventas_perdidas.fecha': fecha(
    'Cuándo ocurrió la venta.',
    'La hora del cobro o de la comanda.',
    'Si las devoluciones se agrupan en el mismo turno, hay algo que revisar en cocina ese turno.',
  ),
  'ventas_perdidas.tipo': {
    que: 'Qué clase de pérdida es.',
    origen: 'Del estado de la venta.',
    calculo:
      'Devuelta: plata que salió de la caja. Descuento: rebaja concedida. Anulada: venta que nunca entró (se muestra, no se suma). A crédito por cobrar: se entregó y aún se debe.',
    ejemplo: 'Solo devuelto + descuentos + merma cuentan como "Dinero perdido": lo anulado nunca fue tuyo y lo vendido a crédito todavía se puede cobrar.',
  },
  'ventas_perdidas.detalle': {
    que: 'Lo que se vendió en esa venta.',
    origen: 'Los renglones del pedido.',
    ejemplo: 'Si el mismo producto se devuelve seguido, el problema es el producto, no el cliente.',
  },
  'ventas_perdidas.quien': {
    que: 'Quién estaba en la caja. En las anuladas, quién la anuló.',
    origen: 'El operador registrado al cobrar o al anular.',
    ejemplo: 'Anulaciones concentradas en una persona merecen una conversación, no una acusación: puede ser que le toque el turno difícil.',
  },
  'ventas_perdidas.monto': {
    que: 'Cuánto dinero representa esa fila.',
    origen: 'El total de la venta (devueltas y anuladas), la rebaja (descuentos) o lo que falta por pagar (a crédito).',
    ejemplo: 'Ordena por esta columna para ver dónde está la plata grande.',
  },

  // Ventas: las cifras
  'kpi.promedio_diario': {
    que: 'Cuánto vendes al día, en promedio, en el período.',
    origen: 'Las ventas cobradas y las vendidas a crédito del período.',
    calculo:
      'Ventas ÷ días transcurridos. "Este mes" el día 3 divide entre 3, no entre 30: si no, el promedio se vería bajo todo el mes.',
    ejemplo: 'Es el número para comparar meses de distinto largo, o para saber cuánto tienes que vender mañana para alcanzar la meta.',
  },
  'kpi.pedidos_por_dia': {
    que: 'Cuántos clientes atiendes al día, en promedio.',
    origen: 'Los pedidos cobrados del período.',
    calculo: 'Pedidos ÷ días transcurridos.',
    ejemplo: 'Si las ventas por día suben y esto no, estás vendiendo más caro a la misma gente. Si esto sube, estás trayendo más gente.',
  },
  'kpi.vs_anterior': {
    que: 'Cuánto cambiaron las ventas contra el tramo inmediatamente anterior, del mismo largo.',
    origen: 'Las ventas de este período y las del mismo número de días justo antes.',
    calculo: '(Ventas de ahora − ventas de antes) ÷ ventas de antes × 100.',
    ejemplo:
      '"Este mes" el día 16 se compara con los 16 días anteriores, no con el mes pasado completo. Mientras el período no termina, la comparación va incompleta.',
  },
  'kpi.facturadas': {
    que: 'Cuántas ventas del período se facturaron.',
    origen: 'La casilla "facturar" al cobrar.',
    ejemplo: 'Solo lo facturado entra al Libro de Ventas y declara IVA. El resto se vendió igual, pero el SENIAT no lo ve.',
  },
  'kpi.perdidas': {
    que: 'La plata que se te fue en el período.',
    origen: 'Las devoluciones, los descuentos y la merma de inventario (cuenta 6020 del libro).',
    calculo: 'Devuelto + descuentos + merma. Lo anulado no se suma (nunca entró) ni lo vendido a crédito (todavía se puede cobrar).',
    ejemplo: 'Por encima de 3–4% de lo vendido, en comida, algo se está botando o se está yendo por la puerta.',
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
  'kpi.fiado_pendiente': {
    que: 'Ventas de este período que se entregaron y todavía no se han pagado.',
    origen: 'Los pagos "A crédito" sin saldar de las ventas del período.',
    ejemplo: 'Es venta hecha y plata que aún no está. Se cobra desde Cierre de caja › A crédito y propinas.',
  },
}

/** La explicación de una columna o una cifra. `undefined` si no la hay. */
export function explicar(clave: string | undefined): Explicacion | undefined {
  return clave ? GLOSARIO[clave] : undefined
}
