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
- [ ] Ninguna tabla se exporta a CSV ni a Excel desde el componente `Tabla` (solo hay descargas sueltas en Impuestos, Reportes a medida e Inventario), y hay tablas hechas con `<table>` suelto que no se ordenan ni explican sus columnas (todos los módulos)
