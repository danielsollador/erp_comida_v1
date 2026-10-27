# Pendientes del ERP Sávora

Lista viva. Se marca `[x]` lo hecho, con la fecha y el commit. Orden de trabajo
acordado (20-oct-2026): primero lo que Claude puede hacer solo, de lo más fácil
a lo más difícil; después lo que necesita al equipo, al dueño o al contador.

## A. Inteligencia artificial

**Carga de inventario con IA** (hecha en local, commit `20d21c4`, sin desplegar)
- [ ] 1. Probarla con una foto real del cuaderno del dueño.
- [ ] 2. Elegir el lector: hoy Gemini; comparar con Claude ahora que hay API.
- [ ] 3. Desplegarla (falta la clave y prender el lector en producción).

**Soporte con IA** (ver `Desktop/plan-soporte-ia-erp.md`)
- [ ] 4. Cerrar las decisiones del plan (propuesta: Sávora, chat en el ERP, issues en GitHub, pocas consultas de solo lectura).
- [x] 5. Manual de Sávora: `backend/app/manual-savora.md` (lo lee el chat de ayuda) (20-oct). Revisarlo cuando cambie una pantalla.
- [x] 6. Prueba del asistente: `backend/evals/` (21 preguntas, 3 de cosas que el sistema no hace). Gemini solo con el manual: 19/21, sin inventar nada; las 2 omitieron un detalle secundario (20-oct). Falta correrla con Claude.
- [x] 7. Nivel 1: chat de ayuda dentro del ERP, con los permisos de quien pregunta (21-oct, el «?» de la barra; Gemini por ahora).
- [x] 8. Nivel 2: triaje (duda / bug / pedido) y creación de issues. (22-oct: «?» › «Soporte»; se guarda siempre, issue en GitHub si hay ERP_GITHUB_REPO_SOPORTE y su token).
- [x] 9. Nivel 3: agente que propone el arreglo de un bug en un PR; el equipo aprueba. (22-oct: `.github/workflows/agente-bugs.yml`, corre con la etiqueta `bug-confirmado`; falta el secreto ANTHROPIC_API_KEY y la app de Claude en el repo. Ver docs/soporte-con-ia.md).
- [ ] 10. Clave de la API de Claude en local y tope de gasto mensual por cliente.

**Otras ideas de IA** (sin empezar)
- [x] 11. El cierre de caja explica los descuadres: botón «¿Por qué no cuadra?» en Caja (reglas fijas en `explicar_cierre.py`, la IA solo redacta; no cambia nada). 20-oct, sin desplegar.
- [x] 12. «Pregúntale a tu negocio»: chat sobre ventas, márgenes y caja. (22-oct: «?» › «Mis números»; la IA elige la consulta del catálogo de reportes, el sistema calcula).
- [x] 13. Pedido al proveedor redactado para WhatsApp (21-oct: Inventario › Qué comprar › «Pedir a proveedores»).
- [x] 14. Alertas que se explican (mermas raras, precios que suben, cobros repetidos) (21-oct: en la portada con «¿Por qué?»; reglas fijas, sin IA).
- [x] 15. Conciliar pago móvil y estados de cuenta contra los cobros. (22-oct: Caja › «Conciliar banco»; PDF del Provincial o Excel/CSV).
- [x] 16. Pedidos por WhatsApp como borrador para la cajera. (22-oct: POS › comanda › «Desde WhatsApp»; con IA o con reglas, no crea el pedido).

## B. Depende del dueño o del cajero

- [ ] 17. Recargar el inventario desde cero (mercancía, preparaciones, recetas). Mientras tanto las ventas no descuentan y el costo sale en cero.
- [ ] 18. Activar el aceite de freír: marcarlo como costo indirecto, marcar lo que se fríe, anotar cada carga de la freidora.
- [ ] 19. Cierre del 19-oct: faltan $10 en Zelle (¿pedido #1 cobrado por el punto?) y $20 en dólares. El 17-oct también faltaron $20 en dólares.
- [ ] 20. Contar una vez el efectivo en bolívares para que su saldo arranque real.
- [ ] 21. Confirmar los $134 de más en caja que dejaron las compras de prueba borradas (8, 16 y 17 de octubre).

## C. Contador

- [ ] 22. Porcentajes de retención de ISLR del flete.
- [ ] 23. Declaración de IVA en bolívares y mes de las notas de crédito.
- [x] 24. Retenciones de IVA que le hacen a Sávora sus clientes especiales: ya existía en el punto de venta («El cliente retiene IVA», 75 % o 100 %, solo en ventas facturadas). Falta solo que el contador lo confirme.

## D. Desarrollo para después

- [ ] 25. Vender sin internet.
- [ ] 26. Repartir el gas igual que el aceite.
- [ ] 27. Del rediseño de inventario: ubicaciones, modificadores con receta, lotes y vencimiento.
- [x] 28. Prueba de permisos que fallaba por el formulario de demo del sitio público: la prueba ahora usa `SIN_SESION` del middleware (20-oct).

## E. Módulos nuevos (pedidos el 26-oct)

- [x] 29. (26-oct, en local) **Pagos sin factura**: nómina, compras sin factura, pagos a externos (ej. la mensualidad del ERP). Hoy existe Caja › Gastos (`TRX620_CON_GASTO`, categorías Insumos/Servicios/Sueldos/Otros, efectivo o banco), pero es corto: sin proveedor/beneficiario, sin referencia del pago, sin moneda Bs/$, sin recurrentes. Decidir si se amplía Gastos o se hace un módulo «Pagos».
- [x] 30. (26-oct, en local) **Cuentas por cobrar (CxC)**: PedidosYa paga semanal, así que sus pedidos deben quedar a crédito. Hoy está el «Fiado» (cuenta 1015, abonos de a uno por pedido, cliente como texto libre). Falta: cliente como ficha (PedidosYa, empresas), estado de cuenta por cliente, **cobro masivo** marcando varios pedidos/facturas, y descontar la comisión de PedidosYa al cobrar.
  - Hecho: módulo `/cobranzas` (fichas de cliente, saldo y vencido, estado de cuenta, cobro agrupado con comisión a 6130, anular cobro) y `/pagos` (conceptos a 6080-6120, Bs con tasa BCV, retención ISLR a 2060, pagos fijos). Caja › «Gastos y retiros» pasó a «Retiros de caja», solo gavetas.
- [ ] 31. Que el contador confirme: comisión de PedidosYa como gasto sin IVA (si PedidosYa factura la comisión, va por Compras), retención de ISLR en pagos sin factura y cómo enterar el 2060. Nómina sin aportes (IVSS, FAOV, INCES) por ahora.
- [x] 32. (26-oct, en local) Los 20 casos del mes: depósito al banco y aporte del dueño (Caja), retención de IVA al cobrar a crédito, entró de más (4040), abono a cuenta de la venta más vieja, dar por perdida (6140) y recuperar, anticipo de sueldo (1016) que se descuenta solo, pagar el ISLR retenido al SENIAT, concepto Impuestos y tasas (6150), aviso de facturas con IVA en Pagos. Pruebas en `tests/test_casos_del_mes.py`.


## Estado al 27-oct (lista vigente)

En producción hasta `7a86571`: compra suelta con precio absurdo y anular, mercancía en empaque, stock negativo, «alcanza para» con días reales, aviso de conteo en otra unidad, cierre solo del día (compras sin forma de pago por defecto, «Plata del dueño», fiado cobrado entra en su fila), costo corregido en ficha mueve los libros. Datos corregidos: azúcar, mechada, molida, tocineta, pernil, cierres del 24 y 26-oct, inventario libros = fichas.

**Del cliente**
- [ ] 1. Los $4,40 en dólares del sábado 24-oct: cómo se pagó el pedido #16 ($6,40), efectivo $ o punto.
- [ ] 2. 13 mercancías en negativo (quesos, jamones, papa, crema…): al cargar la compra, dejar «Lo que hay ahora es lo que llegó».
- [ ] 3. Azúcar en sobres: cambiar a «Consumible».
- [ ] 4. Activar el aceite de freír (ver 18).
- [ ] 5. Recargar el inventario completo (ver 17).

**En local, sin desplegar (espera revisión del usuario)**
- [ ] 6. Cuentas por cobrar (29, 30, 32).
- [ ] 7. Pagos sin factura (29, 32).
- [ ] 8. Retiros de caja: nombre nuevo, depósito al banco, aporte del dueño.
- [ ] 9. Lo de IA (sección A): falta la clave de Claude y decidir cuándo.

**Del contador**
- [ ] 10. Comisión de PedidosYa: gasto sin IVA o por Compras si la factura (31).
- [ ] 11. ISLR: porcentajes (flete, honorarios) y cómo se declara lo retenido (22, 31).
- [ ] 12. IVA en bolívares y mes de las notas de crédito (23).
- [ ] 13. Nómina: aportes IVSS, FAOV, INCES (31).

**Para después**
- [ ] 14. Vender sin internet, gas como el aceite, ubicaciones/lotes/vencimiento (25-27).
