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
- [ ] 8. Nivel 2: triaje (duda / bug / pedido) y creación de issues.
- [ ] 9. Nivel 3: agente que propone el arreglo de un bug en un PR; el equipo aprueba.
- [ ] 10. Clave de la API de Claude en local y tope de gasto mensual por cliente.

**Otras ideas de IA** (sin empezar)
- [x] 11. El cierre de caja explica los descuadres: botón «¿Por qué no cuadra?» en Caja (reglas fijas en `explicar_cierre.py`, la IA solo redacta; no cambia nada). 20-oct, sin desplegar.
- [ ] 12. «Pregúntale a tu negocio»: chat sobre ventas, márgenes y caja.
- [x] 13. Pedido al proveedor redactado para WhatsApp (21-oct: Inventario › Qué comprar › «Pedir a proveedores»).
- [x] 14. Alertas que se explican (mermas raras, precios que suben, cobros repetidos) (21-oct: en la portada con «¿Por qué?»; reglas fijas, sin IA).
- [ ] 15. Conciliar pago móvil y estados de cuenta contra los cobros.
- [ ] 16. Pedidos por WhatsApp como borrador para la cajera.

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
