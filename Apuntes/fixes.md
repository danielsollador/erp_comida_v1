# Fixes

Lo que falla, un renglón por arreglo con dónde pasa. Se arreglan con `/arreglar`.

- [x] `npm run glosario` fallaba con 29 explicaciones sin usar · resuelto 2026-11-02, commit a5035af
- [x] La ficha de mercancía de la app no preguntaba "Cómo te llega" ni el precio por empaque (Inventario > ficha) · resuelto 2026-11-02, commit c038405
- [x] Dos cobros cruzados de la misma venta pasaban los dos (Cuentas por cobrar, Ventas) · resuelto 2026-11-04, commit ffa1ca1, sin desplegar
- [x] Un abono o cobro reenviado se aplicaba dos veces (Cuentas por cobrar, Ventas) · resuelto 2026-11-04, commit 1949f79, sin desplegar
- [x] Retención con pago parcial cerraba la deuda y dejaba comisión sin avisar (Cuentas por cobrar) · resuelto 2026-11-04, commits e4196a8 y 5115a5f, sin desplegar. Medida temporal hasta que responda el contador
- [x] La pantalla calculaba la retención distinto que el sistema y nacía un ingreso falso (Cuentas por cobrar) · resuelto 2026-11-04, commit 8d1755f, sin desplegar
- [x] El cuadre por banco esperaba lo que se debía, no lo que entró (Cierre de caja, Cobros del día, conciliación) · resuelto 2026-11-04, commit 18cfc32, sin desplegar
- [ ] El tono de aviso `aviso-800` no cambia en oscuro y casi no se lee (`Aviso tono="ojo"`, en 6 lugares)
- [ ] `npm run glosario` falla en `master` con 29 explicaciones sin usar: su arreglo (a5035af) está en `fase1`, que no se ha fusionado
- [ ] En modo oscuro, el mensaje verde de éxito casi no se lee (Cuentas por cobrar, al cobrar o abonar)
- [ ] El texto de la opción "Es comisión: se cierra la deuda" se corta (Cuentas por cobrar > Pagar o abonar, con retención)
- [ ] Casi ninguna tabla se exporta a CSV ni a Excel desde el componente `Tabla`: solo "Quién me debe" (rama `exportar-cuentas-por-cobrar`), más las descargas sueltas en Impuestos, Reportes a medida e Inventario. Hay tablas hechas con `<table>` suelto que no se ordenan ni explican sus columnas (todos los módulos)
- [ ] En Savora en modo oscuro, el aviso rojo de error casi no se lee (`Aviso`, todos los módulos). Los tonos de peligro para oscuro están en un bloque que excluye a Savora (`index.css:256`, `:not([data-marca="savora"])`). Lo más probable es que sea la misma causa de los avisos de arriba, el amarillo y el verde
- [ ] Una ráfaga de ventas satura la pantalla abierta: al crear 1.000 ventas seguidas, el navegador se quedó sin recursos pidiendo `reportes/arranque`, `reportes/avisos` y `autorizaciones/historial` (`ERR_INSUFFICIENT_RESOURCES`). Lo más probable es que repita esos pedidos con cada aviso en vivo. Revisar antes del 1.5, porque la cola manda comandas en ráfaga
- [x] QA nov · Montos con punto de miles mal leídos: «5.000» Bs en el cierre como 5, «17.922» en Compras como 17,92 (web y app) · resuelto 2026-11-08, commit c8780a3, sin desplegar
- [x] QA nov · Un doble toque pagaba dos veces factura, fijo, abono y retiro · resuelto 2026-11-08, commits 6e1e21d y 17ef24f, sin desplegar
- [x] QA nov · El cierre de caja escribía en los libros y se anulaba a diario (cierre como cuadre, bloque 1.10) · resuelto 2026-11-08, commits 17ef24f y 31190e8, sin desplegar
- [x] QA nov · Un mes declarado se seguía cambiando; se declaraba con débito $0 y sin RIF sin aviso · resuelto 2026-11-08, commits 17ef24f y fe3bf5b, sin desplegar
- [x] QA nov · El euro del BCV «1.001,18» se guardaba 1,18 y no había freno a saltos absurdos · resuelto 2026-11-08, commit 17ef24f, sin desplegar
- [x] QA nov · Balance y Estado de resultados con saldos viejos del mart (21 y 24-oct) · resuelto 2026-11-08, commit 1ab9022, sin desplegar. La noche siguiente al despliegue rehace esos días sola
- [x] QA nov · Retiro o gasto mayor que lo que hay en la gaveta · resuelto 2026-11-08, commit 17ef24f, sin desplegar
- [x] QA nov · La portada escondía faltantes en dólares y bancos · resuelto 2026-11-08, commit fe3bf5b, sin desplegar
- [x] QA nov · La cajera veía ganancia y costos, cambiaba la tasa, daba de baja deudas, anulaba cierres y borraba en días cerrados sin firma · resuelto 2026-11-08, commits 17ef24f y d912bba, sin desplegar
- [x] QA nov · Montos y fechas absurdas entraban sin preguntar · resuelto 2026-11-08, commit 17ef24f, sin desplegar
- [x] QA nov · Dona afirmaba cifras falsas y le faltaban saldos, deudas, IVA, cierres y productos · resuelto 2026-11-08, commit 45c966e, sin desplegar
- [x] QA nov · Pago en Bs a tasa paralela dejaba el banco en libros distinto del real · resuelto 2026-11-08, commit c3dadbb, sin desplegar
- [x] QA nov · Una factura con mercancía mal cargada no se podía deshacer · resuelto 2026-11-08, commit 611dfc0, sin desplegar
- [x] QA nov · Proveedores no se alimentaba de las facturas · resuelto 2026-11-08, commit cbb2e29, sin desplegar
- [x] QA nov · Sueldos como pago menor, referencia repetida sin aviso y explicador que no miraba la apertura · resuelto 2026-11-08, commit f72a699, sin desplegar
- [x] QA nov · Una preparación no se producía por un redondeo de 0,1 % · resuelto 2026-11-08, commit 1c319be, sin desplegar
- [x] QA nov · Cobros hechos no mostraba los abonos de Ventas y Caja · resuelto 2026-11-08, commit 73c7134, sin desplegar
- [x] QA nov · No se exportaba en Caja › Historial, Pagos ni Contabilidad · resuelto 2026-11-08, commit 03f4fed, sin desplegar
- [x] QA nov · Botón kg/g pegado a la cantidad, factura a medio cargar perdida, sin aviso de RIF, pago menor de Bs en $ y fila Fiado que cambiaba · resuelto 2026-11-08, commit 08fdd2d, sin desplegar
- [x] QA nov · La app móvil no entendía lo que el servidor pregunta antes de guardar · resuelto 2026-11-08, commit 0703476, sin desplegar
- [x] QA nov · El vuelto en dólares con centavos ($3,08) no se podía dar: ahora salen $3 de la gaveta de $ y los centavos en Bs (Ventas, web y app) · resuelto 2026-11-08, sin desplegar
- [x] QA regresión · El euro guardado mal (1,18) hacía que el freno de saltos rechazara siempre el bueno · resuelto 2026-11-09, commit 9bf61d7, sin desplegar
- [x] QA regresión · Un salto de tasa descartado no se le decía a nadie · resuelto 2026-11-09, commit 9bf61d7, sin desplegar
- [x] QA regresión · Tras anular un cierre hecho sin abrir no se podía abrir con el fondo real · resuelto 2026-11-09, commit 9bf61d7, sin desplegar
- [x] QA regresión · Diferencial cambiario separado aunque la gaveta de Bs se contó al abrir, y la pantalla esperaba distinto que el cierre · resuelto 2026-11-09, commit d2c5e6d, sin desplegar
- [x] QA regresión · Con un PIN equivocado el cuadro de firma se cerraba sin avisar · resuelto 2026-11-09, commit e9a2222, sin desplegar
- [x] QA regresión · Cantidades con coma del teléfono leídas como cero; «1.250» kg en los cuadros leído como 1.250 · resuelto 2026-11-09, commit c43171e, sin desplegar
- [x] Pregúntame pasa a llamarse Dona en la web y la app · resuelto 2026-11-09, commit ed4a94a, sin desplegar
- [x] QA regresión · Anular una declaración de IVA no pedía firma y reabría un mes ya presentado · resuelto 2026-11-09, sin desplegar

