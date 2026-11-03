# Plan de implementación: Vertigo Pro

> Cómo y en qué orden se construyen las FASES 1 a 4 de `CLAUDE.md`. La FASE 0 ya está en producción: no se reconstruye, se protege.
> Revisado el 2-nov-2026 sobre la rama `fase1`. Solo la fase en curso tiene detalle técnico; las siguientes se detallan cuando les toque.

| Fase | Estado |
|---|---|
| FASE 0: Base operativa | Completada |
| FASE 1: Cerrar lo abierto y blindar | En curso |
| FASE 2: El negocio en palabras (IA) | Pendiente |
| FASE 3: Escalar el producto | Pendiente |
| FASE 4: Mundo físico | Pendiente |

---

## 0. Cómo usar este plan (léelo antes de tocar nada)

### 0.1 Documentos y jerarquía

Todos viven en el repo, junto al código. Toda ruta de este plan es relativa a la raíz del repo.

| Documento | Qué responde | Prioridad si chocan |
|---|---|---|
| `CLAUDE.md` | Qué construir (requisitos y reglas) | 1 |
| `docs/specs/<modulo>.md` | Con qué detalle: reglas, casos borde y aceptación | 2 |
| `docs/plan-implementacion.md` | Cómo construirlo y en qué orden | 3 |
| `docs/project-map.md` | Cómo está el sistema hoy | 4 |
| `docs/tareas.md` | Qué tarea toca y cuáles están hechas | Sigue al plan |

- Si el código y `project-map.md` no coinciden, manda el código y se corrige el mapa.
- `ESTADO.md` es el historial de traspasos hasta el 19-sep. Se consulta para entender el porqué de una regla, pero ya no se actualiza.

Orden de lectura antes de cada tarea:
1. `docs/project-map.md`
2. La spec del módulo, la tarea en `docs/tareas.md` y su bloque en este plan
3. `git log -- <archivo>` de los archivos que vayas a tocar: los commits explican el porqué de cada regla

### 0.2 Flujo por bloque (SDD)

1. **Spec:** escribir o completar `docs/specs/<modulo>.md` (plantilla en `docs/specs/_plantilla.md`) con requisitos, casos borde y aceptación. **Leider la aprueba antes de programar.** Si el bloque depende de una decisión pendiente (sección 3), se pregunta y no se implementa.
2. **Tareas:** el bloque se desglosa en `docs/tareas.md`.
3. **Implementar:** en la rama de la fase (`fase<N>`), un commit por tarea.
4. **Comprobar que compila** (0.3).
5. **Validar en local:** se levanta el sistema y Leider valida con la Aceptación de la spec.
6. **Subir:** con la validación, se sube la rama a GitHub. Las pruebas corren solas (`pruebas.yml`); si fallan, se arregla antes de seguir.
7. **Fusionar en `master`** con las pruebas en verde. Se despliega solo cuando Leider lo pida, fuera del horario de ventas y con él presente (`gcp/README.md`).
8. **Actualizar** `docs/tareas.md` y `docs/project-map.md`.
9. **Parar** al cerrar cada fase.

### 0.3 Definición de Hecho

**Lo que comprueba el agente (solo que compila):**
- [ ] Backend: `cd backend && py -m compileall -q app` sin errores.
- [ ] Web: `cd frontend && npx tsc --noEmit && npm run build` sin errores.
- [ ] Web: `cd frontend && npm run glosario` sin columnas ni cifras sin explicar.
- [ ] App móvil, si se tocó: `cd movil && npx tsc --noEmit` sin errores.

La suite completa la corre GitHub Actions al subir la rama (paso 6). La funcionalidad la valida Leider.

**Reglas de código que se cumplen siempre:**
- [ ] Un test escrito por cada regla de negocio nueva, con el caso real en el docstring.
- [ ] Cero `window.alert`, `window.confirm` y `window.prompt`: se usa `useDialogo()`. Cero `var`.
- [ ] Solo las piezas de `components/ui.tsx`, `Tabla` y `Secciones`. Colores por significado, nunca por su nombre.
- [ ] Toda tabla nueva es ordenable, se vuelve ficha cuando no cabe y se exporta igual que las demás.
- [ ] Todo endpoint nuevo está declarado en `acceso/permisos.py` (`MODULOS`); si no, queda cerrado.
- [ ] Toda tabla nueva sigue la norma `CAPA###_MOD_ENTIDAD` (cabecera de `models.py`) y entra con migración automática en `migrations.py`.
- [ ] Si cambia lo que guarda el mart diario, se sube `consolidacion.VERSION`.
- [ ] Si cambia cómo se usa algo, se actualiza `backend/app/asistente/manual.md`.
- [ ] Mínimos comentarios dentro del código. El porqué va en el mensaje de commit.

### 0.4 Modelo sugerido por tipo de tarea

| Tipo de tarea | Modelo |
|---|---|
| Plan, decisiones de arquitectura, contabilidad, concurrencia, multi-local | Opus |
| Funcionalidad mediana (endpoint + pantalla + tests) | Sonnet |
| Textos, glosario, ajustes visuales, tareas repetitivas | Haiku |

---

## 1. Punto de partida (2-nov)

- La rama `fase1` tiene `origin/master` + gastos de Vertigo + la app móvil (`movil/`, antes en `app-expo`) + dos arreglos. Nada de eso está validado ni en `master` de GitHub.
- La rama `qa-auditoria-pruebas` tiene 58 pruebas de auditoría que demuestran errores de dinero, permisos y operación. Fallan mientras el error exista.
- Producción está en Google Cloud desde el 6-oct. Los respaldos se copian cada hora a un bucket y hay un snapshot diario del disco.
- Hay una sola caja por día con dos gavetas (bolívares y divisas). No existe la caja por tablet.
- El número de comanda se calcula como "el último más uno" (`routers/pedidos.py`, `_siguiente_numero`), sin bloqueo ni restricción única.
- GitHub Actions corre las pruebas sobre SQLite: los fallos de concurrencia solo aparecen en PostgreSQL.
- La IA ya existe en parte (`backend/app/asistente/`): consulta cifras, el manual y cambia precios con confirmación.

---

## 2. Mapa técnico (dónde va cada cosa)

| Necesito... | Lo hago en... |
|---|---|
| Un endpoint | `backend/app/routers/<modulo>.py` y declararlo en `acceso/permisos.py` |
| Una tabla o columna | `models.py` con la norma de nombres y migración automática en `migrations.py` |
| Un asiento contable | `contabilidad.crear_asiento` (ya invalida el día del mart). Nunca se escribe en el libro a mano. |
| La fecha y la hora del negocio | `timeutils.py`. Nunca `datetime.now()` suelto. |
| Una cifra que se muestra | El componente `Cifra` y su entrada en `lib/glosario.ts` |
| Preguntar o avisar algo al usuario | `useDialogo()` en `components/dialogo.tsx` |
| Una pantalla con secciones | `Secciones` con la sección en la URL (`?s=` o `:seccion`) |
| Restringir una pantalla | `Requiere modulo="..."` en `App.tsx` |
| Algo en tiempo real (POS y cocina) | `ws_manager.py` |
| Un aviso push | `push.py` |
| IA | `backend/app/asistente/` |
| La app móvil | `movil/` (Expo). Lo que comparte con la web va en `frontend/src/lib/` y no importa componentes web. |

---

## 3. Decisiones pendientes

Bloquean su bloque hasta que Leider responda. La regla "asume la decisión más simple" de `CLAUDE.md` no aplica aquí: tocan dinero, fiscalidad o arquitectura.

| ID | Pregunta | Propuesta por defecto | Bloquea |
|---|---|---|---|
| D1 | ¿A qué día pertenece una venta hecha después de medianoche con la caja de ayer abierta? | **Día operativo con hora de corte por local** (por defecto 05:00) para caja, reportes y numeración. Libro de ventas e IVA usan la **fecha calendario real**, que es la que exige el SENIAT. Confirmarlo con el contador. | 1.6 |
| D2 | Vender sin conexión: ¿también se cobra sin conexión? | **Decidida (2-nov):** se hace todo lo que no necesita al servidor en ese momento (ver `docs/specs/ventas.md`). | — |
| D3 | Cambio de turno: ¿arqueo de gavetas en cada turno o solo al cierre del día? | **Aplazada (2-nov)** a la FASE 3. Propuesta: arqueo por turno sin cerrar el día. | 3.6 |
| D4 | Alta de local: ¿un backend por local (como hoy) o uno solo para todos? | Menos de 5 locales en 6 meses: script de alta. Más: un solo backend multi-local. | 3.1 |
| D5 | Pagos de Vertigo: ¿registro manual o pasarela? ¿Se bloquea al moroso? | Registro manual. **Nunca se bloquea la venta.** | 3.2 |
| D6 | Módulo Pagos: ¿cobros, cuentas por pagar o ambos? | Cuentas por pagar; los cobros ya viven en Ventas. | 3.4 |
| D7 | Personalización: ¿qué reglas de negocio puede cambiar el cliente? | Lista inicial en 3.3. | 3.3 |
| D8 | Impresora y gaveta: ¿qué modelo se compra? | Térmica de red de 80 mm con ESC/POS y gaveta conectada a la impresora. | 4.1 |
| D9 | Vertigo Campus (WhatsApp): ¿qué debe poder hacer en el ERP? | Solo crear pedidos con un token de servicio. | 3.5 |
| D10 | Dos tablets: ¿cada tablet es una caja con sus propias gavetas, o las dos cobran en la misma caja? | **Una caja por tablet**, cada una con sus dos gavetas, su apertura y su cierre. Las cuentas contables no cambian (1010 y 1011): cada movimiento dice de qué caja es. Detalle en `docs/specs/ventas.md`. | 1.4 |
| D11 | ¿Cuánto tiempo se guardan los respaldos en el bucket? | 90 días, con una regla de ciclo de vida. | 1.7 |

---

## 4. FASE 1: Cerrar lo abierto y blindar

**Objetivo:** una sola rama viva (`master`) sin riesgos operativos conocidos antes de sumar funciones nuevas.
**Salida de la fase:** desplegado en la VM, apps publicadas y Leider validó los tres casos operativos (dos tablets, sin conexión y medianoche).
**Orden:** los bloques van en su orden de número. 1.3 (errores QA) va antes que todo lo nuevo porque son errores de dinero en producción. 1.4 va antes de 1.5 porque la cola sin conexión manda comandas en ráfaga al reconectar, y con la numeración sin bloqueo eso repite números.

### 1.0 Limpieza de carpetas de trabajo · hecha
Repo viejo, carpetas de trabajo y `Desktop\SDD` borrados (2-nov). Ramas ya integradas borradas en GitHub.

### 1.1 Integrar `app-expo` · hecha
La app está en `movil/` dentro de `fase1` y compila. APK de prueba hecha con EAS (perfil `publico`).

### 1.2 Validar lo integrado y subirlo a `master` (Sonnet)
- Leider valida en local: gastos de Vertigo en el hub, la app móvil contra el backend local, la ficha de mercancía de la app y el glosario.
- Se sube `fase1` y las pruebas de GitHub dan verde.
- Se fusiona en `master` y se borran en GitHub `app-expo` y `app-expo-play`.
- Despliegue de gastos de Vertigo y de lo integrado: cuando Leider lo pida.
- **Aceptación:** `master` de GitHub tiene todo lo de `fase1` con las pruebas en verde.

### 1.3 Errores de la auditoría QA (Opus)
- Correr las pruebas de `qa-auditoria-pruebas` contra `fase1` y anotar en `docs/specs/qa.md` cuáles siguen fallando, qué error demuestra cada una y su riesgo (dinero, permisos u operación).
- Leider aprueba la lista y el orden: primero dinero y permisos.
- Cada arreglo que cambia un resultado de dinero se explica antes de tocarlo. Nunca cambia en silencio operaciones pasadas.
- Cada prueba arreglada entra a la suite normal.
- **Aceptación:** las pruebas QA pasan en GitHub y Leider valida en local los casos de dinero.

### 1.4 Dos tablets cobrando a la vez (Opus). Spec: `docs/specs/ventas.md`. Requiere D10.
- **Numeración:** restricción única (`UQ_`) sobre (día, número) y asignación dentro de la transacción con bloqueo sobre una fila contador por día, con reintento si choca. Nunca `max + 1` sin bloqueo. Cuando exista el día operativo (1.6), la clave pasa a ser el día operativo.
- Revisar el mismo patrón en cobro, descuento de inventario, abonos de fiado y edición concurrente.
- **Caja por tablet** según D10: la caja física como entidad, apertura y cierre por caja, y cada cobro, gasto y retiro con su caja.
- **CI con PostgreSQL:** servicio `postgres:16` en `pruebas.yml` y `tests/test_concurrencia_pg.py` (hilos contra la base real), que se salta en SQLite.
- **Aceptación:** el protocolo con dos tablets de la spec.

### 1.5 Vender sin conexión (Opus). Spec: `docs/specs/ventas.md`. D2 decidida.
Hoy la app abre sin conexión (`public/sw.js`), la comanda es idempotente (`clave_cliente`) y `components/Conexion.tsx` detecta el corte. Falta la cola.

**Frontend**
- `lib/colaComandas.ts`: IndexedDB con las **operaciones** en orden (`crear`, `editar`, `cobrar`, `abonar`), cada una con su clave de idempotencia, `payload`, `tasa`, `tomado_en`, `intentos`, `estado` y `error`. Editar o cobrar un pedido que aún no llegó al servidor lo referencia por su `clave_cliente`.
- Caché en IndexedDB, con la fecha de la copia: menú, variantes, combos, tasa, la caja abierta de la tablet y los clientes de fiado con su saldo. El service worker sigue sin guardar `/api/`.
- Sincronización al volver la conexión, al volver a la pestaña y cada 30 s, una operación a la vez y en orden.

**Backend**
- Crear, editar, cobrar y abonar aceptan `tomado_en` y `tasa_bcv` opcionales, solo con `sin_conexion=true`, y llevan clave de idempotencia.
- Validaciones: `tomado_en` no está en el futuro ni tiene más de 72 h; no cae en un ejercicio cerrado ni en un periodo de IVA declarado; `tasa_bcv` coincide con la tasa histórica de esa fecha (tolerancia 0,5 %).
- Fecha del pedido, cobros, inventario y asientos según `tomado_en`. El número se asigna al sincronizar (1.4). `invalidar_dia` del mart para ese día.
- Pago móvil encolado: se verifica con Pabilo al sincronizar.

**Tests a escribir** (`tests/test_venta_sin_conexion.py`): los casos borde de la spec.
**Aceptación:** la de la spec.

### 1.6 Caja pasada la medianoche (Opus). Requiere D1.
- `timeutils.dia_operativo(momento)` con `hora_corte` por local.
- Clasificar cada llamada a `hoy()` e `inicio_del_dia()` como **operativa** (caja, numeración, reportes por día, portada, mart) o **fiscal** (libro de ventas, IVA, declaraciones) y cambiar las operativas.
- Subir `consolidacion.VERSION`.
- Spec en `docs/specs/caja.md` antes de programar.
- **Tests a escribir:** venta a las 00:30 con la caja de ayer abierta; cierre a la 01:00; la numeración se reinicia en la hora de corte; IVA del mes correcto en una venta del 31 hecha a las 00:30 del 1.
- **Aceptación:** Leider simula un día que cruza la medianoche y el cierre, el reporte del día y el libro de ventas dan lo que espera según D1.

### 1.7 Respaldo fuera del servidor: aviso y restauración probada (Sonnet). Requiere D11.
- El temporizador `respaldos-al-bucket` (`gcp/arranque.sh`) escribe `ultimo_espejo.json` al terminar bien; el backend lo expone en `/salud`.
- El hub muestra un `Aviso` si el último respaldo externo tiene más de 24 h.
- `operaciones/restaurar-desde-bucket.md` + script: restaurar el último volcado en un esquema temporal y comparar conteos con `gcp/conteos.sql`.
- Regla de retención del bucket según D11.
- **Aceptación:** con el temporizador detenido 25 h, el hub muestra el aviso; Leider ensaya la restauración y los conteos son idénticos.

### 1.8 Publicar las apps iPhone y Android (Sonnet)
- Builds de EAS de producción y envío a App Store (notas para el revisor en `movil/tienda/`) y a Google Play.
- APK para las tablets sin Play Store con el perfil `publico` de EAS.
- Hoy las tablets usan la app de Capacitor (`frontend/android`, `app-android.yml`). Cuando la APK de Expo la reemplace en las tablets, se borran `app-android.yml` y Capacitor, con el visto bueno de Leider.
- **Aceptación:** la app se descarga desde las dos tiendas y la APK se instala en una tablet Fire.

### 1.9 Cierre de la FASE 1 (Sonnet)
- Despliegue en la VM según `gcp/README.md`, a una hora sin ventas y con Leider presente.
- Pasar lo terminado a FASE 0 en `CLAUDE.md`; actualizar `docs/tareas.md` y `docs/project-map.md`. Etiquetar la versión `v1.1`.
- Marcar la FASE 1 como completada en la tabla del inicio.
- **PARAR:** Leider valida en el local.

---

## 5. FASE 2: El negocio en palabras (IA)

**Objetivo:** que el dueño le hable al negocio y obtenga cifras, reportes, documentos y cambios sin aprender pantallas.

**Ideas generales** (el detalle técnico se escribe al entrar a la fase):
- **2.0 Primero una auditoría:** ver qué de la FASE 2 ya existe en el código y qué falta, y armar las piezas comunes: límite de uso y costo por local, tiempo máximo de respuesta, registro de cada consulta y un conjunto de preguntas de prueba.
- **Toda acción de la IA sigue el mismo patrón:** propone, muestra la vista previa con su efecto en dinero, el usuario confirma, se aplica con los mismos servicios y permisos que la pantalla manual y queda en el historial con quien lo pidió.
- **2.1 Asistente "Pregúntame":** un solo botón igual en todos los módulos; toda cifra dice su periodo y contra qué compara.
- **2.2 Reportes hablados:** la frase se convierte en los filtros del reporte a medida; no se inventan filtros.
- **2.3 Buscar documentos:** facturas, ventas y gastos con "Abrir", respetando los permisos del rol.
- **2.4 Cambiar precios diciéndolo:** vista previa con el margen resultante e historial.
- **2.5 Soporte con el manual:** el manual cubre cada pantalla y la respuesta lleva a ella.
- **2.6 Receta sugerida:** solo con insumos que existen; lo que falta se ofrece crear. Nada se guarda sin confirmar.
- **2.7 Recetas absurdas:** con reglas fijas, no con IA (más barato y comprobable); la IA solo redacta la explicación.
- **2.8 Pedido escrito en el POS:** llena el carrito y la cajera confirma; sin IA usa la búsqueda aproximada local.
- **2.9 Reportes guardados**, **2.10 editar pedidos hablando** y **2.11 tableros con IA** (armados con piezas de un catálogo fijo, sin consultas escritas por la IA).
- **2.12 Nota de voz:** en espera.
- **2.13 Cierre de la fase y PARAR.**

---

## 6. FASE 3: Escalar el producto

**Ideas generales:**
- **3.1 Alta de un local (D4):** primero un formulario en el hub + un script de alta; con más de 5 locales, un solo backend multi-local con prueba obligatoria de aislamiento entre locales.
- **3.2 Pagos de Vertigo (D5):** planes, suscripciones y cobros en el hub, con aviso antes del vencimiento. La venta del cliente nunca se bloquea.
- **3.3 Personalización (D7):** color de acento, logo, tono (tú o usted) y reglas de negocio configurables, cada una explicada.
- **3.4 Módulo Pagos (D6):** cuentas por pagar con abonos y vencimientos.
- **3.5 Vertigo Campus por WhatsApp (D9):** solo crea pedidos "por confirmar" con un rol de servicio.
- **3.6 Cambio de turno (D3):** entregar el turno sin perder ventas, sobre el día operativo de 1.6 y la caja por tablet de 1.4.
- **3.7 Cierre de la fase y PARAR.**

---

## 7. FASE 4: Mundo físico

**Regla de arquitectura:** el servidor está en la nube y el hardware en la red del local. Todo lo físico se hace desde la app en la tablet, nunca desde el backend.

**Ideas generales:** impresión directa y gaveta (D8), código de barras, balanza, habladores y menú en pantalla que cambian con la tasa, QR en la mesa y kiosco (sobre el camino de pedidos externos de 3.5), asistente de voz (después de 2.12), pantalla de pedido listo y máquina fiscal (espera la norma). Cada bloque lleva su spec antes de programar. **PARAR** al final de la fase.

---

## 8. Orden y dependencias

```
FASE 1: 1.0 -> 1.1 -> 1.2 -> 1.3 -> 1.4 (D10) -> 1.5 -> 1.6 (D1) -> 1.7 (D11) -> 1.8 -> 1.9
FASE 2: 2.0 -> 2.1 .. 2.11 (2.8 reutiliza la cola sin conexión de 1.5)
FASE 3: 3.1 (D4) -> 3.2 (D5); 3.3 (D7); 3.4 (D6); 3.5 (D9); 3.6 (D3) usa 1.4 y 1.6
FASE 4: 3.5 -> QR en la mesa -> kiosco; el resto según el hardware
```

---

## 9. Optimizaciones aplicadas

1. **Integrar ramas** se redujo a `app-expo` más la limpieza: las demás ya estaban en master.
2. **Android pasó de FASE 3 a FASE 1:** ya estaba casi listo.
3. **Respaldo externo:** se mantiene el bucket que ya funciona; solo faltan el aviso y la restauración probada.
4. **Revisión de recetas con reglas fijas** y no con IA.
5. **PostgreSQL en CI:** los errores de concurrencia y de migración solo salen ahí.
6. **Alta de local en dos pasos** (script y luego multi-local).
7. **`docs/project-map.md`** como fuente del estado real, para no explorar el repo entero en cada sesión.
8. **Errores QA antes que lo nuevo** (2-nov): las pruebas ya estaban escritas y demuestran errores de dinero en producción.
9. **Documentos dentro del repo** (2-nov): la spec y su código viajan en la misma rama, y quien trabaje en el repo ve las mismas reglas.

---

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| Errores de dinero ya en producción | 1.3 antes que todo lo nuevo. |
| Venta sin conexión sincronizada con fecha o tasa equivocada | Tasa y hora congeladas, validadas contra el histórico (1.5). |
| Números de comanda repetidos | 1.4 antes de 1.5. Restricción única y test de concurrencia en PostgreSQL. |
| Cambiar "hoy" a "día operativo" rompe reportes o IVA | Clasificar cada llamada (1.6) con un test por módulo. El mart sube de versión. |
| Un local ve datos de otro (multi-local) | Test de aislamiento obligatorio (3.1). |
| Costo de la IA | Límite por local, registro de costo y reglas fijas donde se pueda. |
| La IA cambia algo que no debía | Vista previa, confirmación, mismos permisos que la pantalla e historial. |
| Romper la FASE 0 | GitHub Actions corre la suite completa en cada rama; Leider valida cada bloque. |
| Despliegue en horario de ventas | Siempre de noche o antes de abrir, con el procedimiento de `gcp/README.md`. |
