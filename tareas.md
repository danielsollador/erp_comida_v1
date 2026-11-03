# Tareas

Estados: `[ ]` pendiente · `[~]` en curso · `[x]` hecha · `[!]` bloqueada (falta una decisión de la sección 3 del plan).
Se ejecutan en el orden en que aparecen. El detalle de cada bloque está en `plan-implementacion.md` y en su spec.
Solo la fase en curso se desglosa en tareas; las siguientes se desglosan al entrar.

## FASE 1: Cerrar lo abierto y blindar · En curso

### 1.0 Limpieza de carpetas de trabajo
- [x] 1.0.1 Revisar `git status` de las carpetas de trabajo (2-nov): solo `erp_comida_v1-gastos` y `erp_qa` tenían cambios sin commitear, y quedaron en el repo (master local y rama `qa-auditoria-pruebas`).
- [x] 1.0.2 Borrados (2-nov) el repo viejo `Desktop\erp_comida_v1`, sus 8 carpetas de trabajo y `Desktop\SDD`. Lo ignorado que importaba se rescató en `.dev-data/rescate-repo-viejo` (no se versiona).
- [x] 1.0.3 Borradas en GitHub (2-nov) las 11 ramas que ya estaban en `origin/master`.
- [x] 1.0.4 Actualizar `project-map.md`.
- [x] 1.0.5 Avisar a Leider para validar.

### 1.1 Integrar `app-expo`
- [x] 1.1.1 Traer master a `app-expo` y resolver conflictos. Sin conflictos de texto (2-nov).
- [x] 1.1.2 Confirmar que la carpeta `movil/` sin seguimiento no tenía nada propio, y borrarla.
- [x] 1.1.3 Comprobar que compila: backend, web y `movil`.
- [x] 1.1.4 Build de EAS con el perfil `publico` (2-nov, cuenta `motaleider7`, build `86c2be1f`, commit `0a7c6c5`). APK en expo.dev.
- [x] 1.1.5 Fusionar en master local (`0a7c6c5`) y borrar los worktrees.
- [x] 1.1.6 Actualizar `project-map.md`.
- [x] 1.1.7 Avisar a Leider para validar.

### 1.2 Validar lo integrado y subirlo a `master`
- [x] 1.2.1 Arreglos de `fixes.md` en la misma rama: glosario (`a5035af`) y ficha de mercancía de la app (`c038405`).
- [x] 1.2.2 Toda la metodología movida al repo (un solo `CLAUDE.md`, documentos en la raíz, comandos, skill de estilo y `levantar-local.ps1`) y rama `fase1` subida a GitHub (2-nov).
- [ ] 1.2.3 Leider valida en local: gastos de Vertigo (hub), app móvil, ficha de mercancía de la app y glosario. Instala la APK de prueba en una tablet.
- [ ] 1.2.4 Pruebas de GitHub en verde sobre `fase1`.
- [ ] 1.2.5 Fusionar `fase1` en `master`, subirlo y borrar en GitHub `app-expo` y `app-expo-play`.
- [ ] 1.2.6 Desplegar cuando Leider lo pida.

### 1.3 Errores de la auditoría QA
- [ ] 1.3.1 Correr las pruebas de `qa-auditoria-pruebas` contra `fase1` y escribir `specs/qa.md`: cuáles siguen fallando, qué error demuestra cada una y su riesgo.
- [ ] 1.3.2 Leider aprueba la lista y el orden.
- [ ] 1.3.3 Arreglar los de dinero y permisos (cada uno explicado antes de tocarlo).
- [ ] 1.3.4 Arreglar los de operación.
- [ ] 1.3.5 Pasar las pruebas arregladas a la suite normal.
- [ ] 1.3.6 Comprobar que compila, actualizar `project-map.md` y avisar a Leider para validar.

### 1.4 Dos tablets cobrando a la vez
- [~] 1.4.1 Escribir `specs/ventas.md` (borrador del 2-nov, falta la aprobación de Leider).
- [!] 1.4.2 Decisión D10: caja por tablet o caja compartida.
- [ ] 1.4.3 Tabla de secuencias y restricción única (día, número) con su migración automática.
- [ ] 1.4.4 Reescribir `_siguiente_numero` con bloqueo y reintento.
- [ ] 1.4.5 Revisar concurrencia en cobro, descuento de inventario, abonos de fiado y edición de pedidos.
- [ ] 1.4.6 Caja por tablet según D10: apertura, cobros, gastos, retiros y cierre por caja.
- [ ] 1.4.7 Servicio `postgres:16` en `pruebas.yml` y `tests/test_concurrencia_pg.py`.
- [ ] 1.4.8 Comprobar que compila, actualizar `project-map.md` y `manual.md`.
- [ ] 1.4.9 Avisar a Leider para validar con el protocolo de dos tablets.

### 1.5 Vender sin conexión
- [x] 1.5.1 Decisión D2: sin conexión se hace todo lo que no necesita al servidor en ese momento (2-nov).
- [~] 1.5.2 Requisitos en `specs/ventas.md` (borrador del 2-nov).
- [ ] 1.5.3 Backend: crear, editar, cobrar y abonar aceptan `tomado_en`, `tasa_bcv` y `sin_conexion`, con clave de idempotencia y sus validaciones.
- [ ] 1.5.4 Backend: fecha, cobros, inventario, asientos y caja según `tomado_en`; venta tardía si la caja ya se cerró; `invalidar_dia`.
- [ ] 1.5.5 Backend: pago móvil verificado al sincronizar ("por verificar" bloquea el cierre) y fiado por encima del límite con aviso.
- [ ] 1.5.6 Frontend: cola de operaciones en IndexedDB y caché del menú, tasa, caja y clientes de fiado.
- [ ] 1.5.7 Frontend: cobro sin conexión, número provisional, sincronización, "Requiere atención", barra de pendientes y botones deshabilitados con su motivo.
- [ ] 1.5.8 Escribir `tests/test_venta_sin_conexion.py`.
- [ ] 1.5.9 Comprobar que compila, actualizar `project-map.md` y `manual.md`.
- [ ] 1.5.10 Avisar a Leider para validar.

### 1.6 Caja pasada la medianoche
- [!] 1.6.1 Decisión D1 (día de la venta después de medianoche), consultada con el contador.
- [ ] 1.6.2 Escribir `specs/caja.md`.
- [ ] 1.6.3 `timeutils.dia_operativo` y `hora_corte` por local.
- [ ] 1.6.4 Clasificar cada llamada a `hoy()` e `inicio_del_dia()` y cambiar las operativas.
- [ ] 1.6.5 Numeración de comandas por día operativo y subir `consolidacion.VERSION`.
- [ ] 1.6.6 Escribir los tests del bloque.
- [ ] 1.6.7 Comprobar que compila, actualizar `project-map.md` y `manual.md`.
- [ ] 1.6.8 Avisar a Leider para validar.

### 1.7 Respaldo fuera del servidor
- [!] 1.7.1 Decisión D11: retención del bucket.
- [ ] 1.7.2 `ultimo_espejo.json` desde el temporizador y fecha del último respaldo externo en `/salud`.
- [ ] 1.7.3 Aviso en el hub si pasan más de 24 h.
- [ ] 1.7.4 `operaciones/restaurar-desde-bucket.md` y su script.
- [ ] 1.7.5 Regla de retención del bucket.
- [ ] 1.7.6 Comprobar que compila, actualizar `project-map.md` y avisar a Leider para validar y ensayar la restauración.

### 1.8 Publicar las apps iPhone y Android
- [ ] 1.8.1 Build de EAS de producción y envío a App Store.
- [ ] 1.8.2 Publicación en Google Play.
- [ ] 1.8.3 APK para las tablets Fire con el perfil `publico` de EAS.
- [ ] 1.8.4 Con el visto bueno de Leider, borrar `app-android.yml` y Capacitor cuando las tablets usen la APK de Expo.
- [ ] 1.8.5 Actualizar `project-map.md` y avisar a Leider para validar.

### 1.9 Cierre de la FASE 1
- [ ] 1.9.1 Desplegar en la VM según `gcp/README.md`, a una hora sin ventas y con Leider presente.
- [ ] 1.9.2 Pasar lo terminado a FASE 0 en `CLAUDE.md`.
- [ ] 1.9.3 Etiquetar la versión `v1.1`.
- [ ] 1.9.4 Sincronizar `project-map.md` completo con el código.
- [ ] 1.9.5 Marcar la FASE 1 como completada aquí, en el mapa y en el plan.
- [ ] 1.9.6 Parar: Leider valida en el local.

## FASE 2: El negocio en palabras (IA) · Pendiente
Se desglosa al entrar a la fase (bloque 2.0 del plan).

## FASE 3: Escalar el producto · Pendiente
Se desglosa al entrar a la fase.

## FASE 4: Mundo físico · Pendiente
Se desglosa al entrar a la fase.
