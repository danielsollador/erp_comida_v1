# Tareas

`[ ]` pendiente · `[~]` en curso · `[x]` hecha · `[!]` espera una decisión del plan

## FASE 1 · En curso

- [x] 1.0 Limpieza de carpetas de trabajo y ramas viejas
- [x] 1.1 App móvil (`app-expo`) integrada y APK de prueba

### 1.2 Validar y subir a `master`
- [x] Arreglos de `fixes.md` y metodología en el repo, en la rama `fase1`
- [x] Pruebas de GitHub en verde sobre `fase1`
- [ ] Leider valida en local: gastos de Vertigo, app móvil y ficha de mercancía de la app
- [ ] Fusionar en `master` y borrar `app-expo` y `app-expo-play`
- [ ] Desplegar cuando Leider lo pida

### 1.2a Exportar Cuentas por cobrar
- [x] Spec `specs/cuentas-por-cobrar.md` > Exportar la lista (aprobada el 6-nov)
- [x] Pruebas: columnas, orden, venta ya cobrada, permisos, separadores, fórmulas y 1.000 ventas
- [x] Backend: exportación a CSV y Excel
- [x] `descargar`: pedir por POST y guardar el archivo sin salir de la pantalla
- [x] `Tabla`: opción de exportar, activa solo en "Quién me debe"
- [x] Probar con Playwright la descarga de 1.000 ventas
- [ ] Validar en un Excel con configuración regional de Venezuela

### 1.3 Errores de la auditoría QA
- [ ] Correr las pruebas QA y escribir `specs/qa.md`
- [ ] Leider aprueba la lista
- [ ] Arreglar dinero y permisos
- [ ] Arreglar operación
- [ ] Pasar las pruebas a la suite
- [x] QA de noviembre: `specs/qa.md` con los 32 hallazgos (aprobada por Daniel)
- [ ] R1 · Un solo lector de montos (web, app y tasa)
- [ ] R2 · Nada se paga dos veces
- [ ] R3 · Mes declarado congelado y avisos al declarar
- [ ] R4 · Confirmar montos y fechas absurdas
- [ ] R5 · Firma para anular, dar de baja, corregir y cambiar la tasa
- [ ] Hallazgos sueltos de `specs/qa.md` (5 a 32)
- [ ] Dona: cifras solo de herramientas y herramientas nuevas

### 1.10 Cierre de caja como cuadre
- [x] Spec `specs/caja.md` (aprobada; D12–D15 con la propuesta)
- [ ] Fondo inicial = último cierre y apertura sin asientos
- [ ] Cierre sin asientos; diferencias por aprobar
- [ ] Aprobar diferencias (firma) y aviso en la portada
- [ ] Día cerrado: firma para borrar y marca «por revisar»
- [ ] Corregir y anular con firma
- [ ] Diferencial cambiario en la gaveta Bs

### 1.4 Dos tablets
- [~] Spec `specs/ventas.md` (borrador, falta aprobación)
- [!] D10: caja por tablet o compartida
- [ ] Numeración con bloqueo
- [ ] Bloqueo en cobro, inventario y abonos de fiado
- [ ] Caja por tablet
- [ ] PostgreSQL en CI y prueba de concurrencia

### 1.5 Sin conexión
- [~] Spec `specs/ventas.md` (borrador)
- [ ] Backend: operaciones con hora y tasa propias, y sus validaciones
- [ ] Backend: pago móvil por verificar, venta tardía y fiado sobre el límite
- [ ] Frontend: cola y caché en la tablet
- [ ] Frontend: barra de pendientes, "Requiere atención" y botones con su motivo
- [ ] Tests

### 1.6 Medianoche
- [!] D1: día de la venta pasada la medianoche
- [ ] Spec `specs/caja.md`
- [ ] Día operativo y hora de corte
- [ ] Llamadas a `hoy()` clasificadas y cambiadas
- [ ] Tests

### 1.7 Respaldo externo
- [!] D11: retención del bucket
- [ ] Fecha del último respaldo en `/salud` y aviso en el hub
- [ ] Restauración probada

### 1.8 Apps en las tiendas
- [ ] App Store
- [ ] Google Play
- [ ] APK para las tablets Fire
- [ ] Retirar Capacitor cuando las tablets usen la APK nueva

### 1.9 Cierre
- [ ] Desplegar, pasar lo hecho a la FASE 0 y etiquetar `v1.1`

## FASE 2 · Pendiente
## FASE 3 · Pendiente
## FASE 4 · Pendiente
