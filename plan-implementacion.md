# Plan de implementación

Cómo y en qué orden se hace la fase en curso. Las siguientes se planifican al entrar. El estado de cada bloque está en `tareas.md`.

## Decisiones pendientes

Bloquean su bloque hasta que Leider responda.

| ID | Pregunta | Propuesta | Bloquea |
|---|---|---|---|
| D1 | ¿De qué día es una venta hecha después de medianoche con la caja de ayer abierta? | Día operativo con hora de corte por local (05:00) para caja, reportes y numeración. IVA y libro de ventas, con la fecha real. Confirmar con el contador. | 1.6 |
| D10 | ¿Cada tablet tiene su caja o las dos cobran en la misma? | Una caja por tablet (ver `specs/ventas.md`). | 1.4 |
| D11 | ¿Cuánto tiempo se guardan los respaldos en el bucket? | 90 días. | 1.7 |
| D3 | Cambio de turno: ¿arqueo en cada turno o solo al cierre? | Arqueo por turno sin cerrar el día. | FASE 3 |
| D4 | Alta de local: ¿un backend por local o uno para todos? | Script de alta mientras haya menos de 5 locales. | FASE 3 |
| D5 | Pagos de Vertigo: ¿manual o pasarela? ¿Se bloquea al moroso? | Manual. Nunca se bloquea la venta. | FASE 3 |
| D6 | Módulo Pagos: ¿cobros, cuentas por pagar o ambos? | Cuentas por pagar. | FASE 3 |
| D7 | ¿Qué reglas de negocio puede cambiar el cliente? | Se propone al entrar a la FASE 3. | FASE 3 |
| D8 | ¿Qué impresora y gaveta se compran? | Térmica de red de 80 mm con ESC/POS. | FASE 4 |
| D9 | Vertigo Campus: ¿qué puede hacer en el ERP? | Solo crear pedidos "por confirmar". | FASE 3 |

## FASE 1: orden

1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7 → 1.8 → 1.9.

- Los errores QA (1.3) van antes de lo nuevo: son errores de dinero en producción.
- Dos tablets (1.4) va antes de sin conexión (1.5): la cola manda comandas en ráfaga y, sin numeración con bloqueo, se repiten números.

### 1.2 Validar y subir a `master`
Leider valida en local lo integrado. Con las pruebas de GitHub en verde, `fase1` se fusiona en `master` y se borran `app-expo` y `app-expo-play`.

### 1.3 Errores de la auditoría QA (Opus)
Correr las 58 pruebas de la rama `qa-auditoria-pruebas` contra `fase1`. Las que fallan van a `specs/qa.md` con su riesgo (dinero, permisos u operación), Leider aprueba el orden y cada prueba arreglada entra a la suite.

### 1.4 Dos tablets (Opus) · `specs/ventas.md` · D10
- Numeración: fila contador por día con `SELECT … FOR UPDATE`, restricción única (día, número) y reintento si choca.
- Mismo bloqueo en el cobro (hoy se comprueba `pagado` sin bloqueo), el descuento de inventario y los abonos de fiado.
- Caja por tablet según D10: la caja como entidad; apertura, cobros, gastos, retiros y cierre con su caja. Las cuentas 1010 y 1011 no cambian.
- CI con un servicio `postgres:16` y `tests/test_concurrencia_pg.py` (se salta en SQLite).

### 1.5 Sin conexión (Opus) · `specs/ventas.md`
- Frontend: cola de operaciones en IndexedDB (`lib/colaComandas.ts`) con su clave de idempotencia, y caché del menú, tasa, caja y clientes de fiado. Sincroniza al volver la conexión y cada 30 s, en orden.
- Backend: crear, editar, cobrar y abonar aceptan `tomado_en` y `tasa_bcv` con `sin_conexion=true`. Se rechaza lo que tenga más de 72 h, caiga en un periodo cerrado o traiga una tasa que no coincida con la histórica (±0,5 %). Todo se fecha con `tomado_en` y se invalida ese día del mart.
- Tests en `tests/test_venta_sin_conexion.py`.

### 1.6 Medianoche (Opus) · D1
`timeutils.dia_operativo()` con hora de corte por local. Cada llamada a `hoy()` e `inicio_del_dia()` se clasifica como operativa o fiscal; se cambian las operativas y sube `consolidacion.VERSION`. Spec en `specs/caja.md`.

### 1.7 Respaldo externo (Sonnet) · D11
El temporizador del bucket escribe `ultimo_espejo.json`; `/salud` lo expone y el hub avisa si pasan más de 24 h. Procedimiento y script para restaurar en un esquema de prueba y comparar conteos.

### 1.8 Apps en las tiendas (Sonnet)
Builds de producción con EAS para App Store y Google Play, y APK `publico` para las tablets Fire. Cuando las tablets usen la APK de Expo, se borran Capacitor y `app-android.yml` (con el visto bueno de Leider).

### 1.9 Cierre de la FASE 1
Despliegue según `gcp/README.md`, lo terminado pasa a la FASE 0 de `fases.md` y se etiqueta `v1.1`.

## Optimizaciones propuestas

- Revisar recetas absurdas con reglas fijas, no con IA: más barato y comprobable (FASE 2).
- Alta de locales primero con un script y, con más de 5 locales, un solo backend (FASE 3).
