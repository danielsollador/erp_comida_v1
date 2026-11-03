# Project map: Vertigo Pro

> Estado real del sistema, sacado del código. Si el código y este mapa no coinciden, manda el código y se corrige el mapa.
> Última sincronización: 2-nov-2026, rama `fase1` (`origin/master` + gastos de Vertigo + `app-expo` + arreglos + documentos), subida a GitHub y sin fusionar en `master`.

## 1. Estado de las fases

| Fase | Estado |
|---|---|
| FASE 0: Base operativa | Completada (en producción) |
| FASE 1: Cerrar lo abierto y blindar | En curso. 1.0 y 1.1 hechas; 1.2 esperando la validación de Leider; spec de ventas (1.4 y 1.5) en borrador |
| FASE 2: El negocio en palabras (IA) | Pendiente. Ya existe en parte: asistente de cifras, manual y cambio de precios con confirmación (`backend/app/asistente/`) |
| FASE 3: Escalar el producto | Pendiente |
| FASE 4: Mundo físico | Pendiente |

## 2. Repositorio

- **Repo:** `C:\Users\Mota Leider\Desktop\Vertigopro\erp_comida_v1`. Es la única fuente de verdad: código y metodología juntos. La sesión del agente se abre en su raíz.
- **Remoto:** `https://github.com/danielsollador/erp_comida_v1.git`
- **Rama principal:** `master`. El trabajo de la FASE 1 va en `fase1` (en GitHub, sin fusionar).
- **Metodología (en la raíz del repo):** `CLAUDE.md` (el único), `specs/`, `plan-implementacion.md`, `tareas.md`, `project-map.md`, `prompts.md`, `Apuntes/` (apuntes y `fixes.md`), `.claude/commands/` (los tres comandos), `.claude/skills/estilo-vertigo` y `levantar-local.ps1`. `docs/plan-compras-inventario-produccion.md` es un plan viejo de compras.
- **Documentos de operación:** `DESPLIEGUE.md`, `DOCKER.md`, `GCP.md`, `gcp/README.md`, `gcp/cambio.md`. `ESTADO.md` es historial hasta el 19-sep.
- **No se versiona:** `.dev-data/` (datos de prueba y lo rescatado del repo viejo, con copias de `.env`) y las skills de terceros en `.claude/skills/`.

### Ramas

| Rama | Estado frente a master |
|---|---|
| `master` (local) | `origin/master` (`1a50624`) + gastos de Vertigo (`635a5c7`) + `fase1-app-expo` (`0a7c6c5`) |
| `fase1` | `master` local + arreglos + metodología. En GitHub desde el 2-nov; es la rama de trabajo de la FASE 1 |
| `gastos-vertigo-hub` | Ya en master local. Venía sin commitear de `erp_comida_v1-gastos` |
| `fase1-app-expo` | Ya en master local. `origin/app-expo` + master + arreglos para que la app compile (tarea 1.1) |
| `qa-auditoria-pruebas` | Fuera de master a propósito: 3 pruebas QA que demuestran bugs y fallan mientras existan. Venían sin commitear de `erp_qa` |
| `fix-2026-11-02-glosario-y-ficha-movil` | Ya en `fase1` (`a5035af`, `c038405`) |

`origin/app-expo` ya está entera en master local (`git rev-list --count master..origin/app-expo` = 0).

En GitHub quedan `master`, `fase1`, `app-expo` y `app-expo-play`. Las otras 11 ramas ya estaban en `origin/master` y se borraron el 2-nov; `app-expo` y `app-expo-play` se borran después del push de master.

Sin seguimiento o ignorado: `.claude/` (skills `frontend-design` e `impeccable`), `.env` (claves de Gemini y Claude para correr sin Docker), `movil/.env` (apunta a **producción**) y `movil/tienda/REVISOR.local.txt` (acceso del revisor de las tiendas).

El repo viejo del escritorio, sus carpetas de trabajo y `Desktop\SDD` se borraron el 2-nov. Lo ignorado que valía la pena está en `.dev-data/rescate-repo-viejo`.

### Entorno local (sin Docker)

`levantar-local.ps1` en la raíz del repo. Backend con `.venv` de Python 3.13 y SQLite; datos en `.dev-data` (`local`, `hub` y `compartido`, este último con las cuentas de los dos).

| Servicio | Puerto | Notas |
|---|---|---|
| Backend del local (Savora) | 8011 | `ERP_SEMBRAR_DEMO=1`, lector de facturas de prueba |
| Backend del hub | 8012 | `ERP_ES_HUB=1`, crea y siembra los gastos de Vertigo |
| Web del ERP y sitio público | 5181 | Vite, proxy a 8011. Sitio en `/sitio/` |
| Web del hub | 5182 | Vite, proxy a 8012. Hub en `/inicio.html` |
| App móvil en el navegador | 8081 | `npx expo start --web` con `EXPO_PUBLIC_API_BASE=http://localhost:8011`. Sin esa variable, la app usa `movil/.env`, que apunta a producción |

## 3. Producción e infraestructura

- **Servidor:** Google Cloud, VM `vertigo-erp` (`e2-small`, zona `us-east1-b`, IP `35.231.43.80`), desde el 6-oct-2026. Hostinger ya no es producción.
- **Servicios** (`docker-compose.gcp.yml`): `traefik`, `backend`, `frontend`, `hub-backend`, `hub-frontend` y `letsencrypt`.
- **Dominios:** `savora.vertigopro.tech` (ERP de Sávora) y `vertigopro.tech` / `www` (hub y sitio público).
- **Base de datos:** PostgreSQL 16, base `vertigo`, un esquema por local (`SAVORA`) y el esquema `HUB`. El puerto no se publica.
- **Respaldos:**
  - `pg_dump` cada 6 h en el volumen de datos (`backup.py`).
  - Copia horaria a un bucket de GCS (`gcp/arranque.sh`, temporizador `respaldos-al-bucket`).
  - Snapshot diario del disco, con 14 días de retención.
- **Secretos:** Secret Manager (clave de Claude `ANTHROPIC_API_KEY`, clave de Gemini).
- **CI** (`.github/workflows/`):
  - `pruebas.yml`: suite de pruebas sobre SQLite.
  - `app-android.yml`: build de la app Android.
- **Despliegue:** manual, con el procedimiento de `gcp/README.md`. No hay despliegue automático.

## 4. Stack

- **Backend:** Python (3.12 en la imagen, 3.8 en la laptop de Daniel), FastAPI, SQLAlchemy y PostgreSQL (SQLite en pruebas).
- **Web:** React, Vite, TypeScript y Tailwind 4. Capacitor (`frontend/android`, `frontend/ios`).
- **Móvil:** Expo (React Native) en `movil/`, ya en master local. Importa de `frontend/src/lib/` (iconos, pagos, inventario, tipos de artículo): esos archivos no pueden importar componentes de la web.
- **Tiempo real:** WebSocket (`ws_manager.py`).
- **IA:** Claude (`asistente/claude.py`, modelo en `ASISTENTE_MODELO_CLAUDE`) y Gemini (`asistente/gemini.py`, lectura de facturas).
- **Pruebas:** 105 archivos `backend/tests/test_*.py` con 1.111 funciones de prueba, y pruebas de frontend `*.test.ts` en `frontend/src/lib`.

## 5. Módulos

| Módulo | Ruta web | Pantalla | API | Permiso (`permisos.MODULOS`) |
|---|---|---|---|---|
| Inicio | `/` | `Inicio.tsx` | varias | — |
| Punto de venta | `/pos/:seccion?` (tomar, pedidos) | `POS.tsx` | `pedidos.py`, `pagos.py`, `autorizaciones.py` | `pos` |
| Cocina | `/cocina` | `Cocina.tsx` | `pedidos.py` (lectura y marcar listo) | `cocina` |
| Ventas | `/ventas/:seccion?` (historial, resumen, perdidas) | `Ventas.tsx` | `ventas.py` | `ventas` |
| Compras | `/compras/:seccion?` (facturas, nueva, alertas, proveedores) | `Compras.tsx` | `compras.py`, `compras_lectura.py`, `compras_equivalencias.py`, `compras_alertas.py`, `proveedores.py` | `compras` |
| Inventario | `/inventario/:seccion?` (almacenes, comprar, control, materia-prima, reventa, consumibles, desechables, categorias) | `Inventario.tsx` | `inventario.py`, `preparaciones.py` | `inventario` |
| Menú | `/menu/:seccion?` (menu, recetas) | `Menu.tsx` | `menu.py` | `menu` |
| Recetas | `/recetas` | (ruta en `App.tsx`) | `/api/inventario/recetas` | `recetas` |
| Cierre de caja | `/caja/:seccion?` (cierre, movimientos, historial) | `Caja.tsx` | `caja.py` | `caja` |
| Reportes | `/reportes/:seccion?` (resumen, ventas, perdidas, inventario, a_medida) | `Reportes.tsx` | `reportes.py`, `reportes_dinamicos.py` | `reportes` |
| Contabilidad | `/contabilidad/:seccion?` (plan, diario, comprobacion, resultados, general, activos, respaldos) | `Contabilidad.tsx` | `contabilidad.py`, `respaldos.py` | `contabilidad` |
| Impuestos | `/impuestos/:seccion?` (ventas, compras, retenciones, declaraciones) | `Impuestos.tsx` | `impuestos.py` | `impuestos` |
| Tasa de cambio | `/tasa/:seccion?` (hoy, calculadora, analisis, historial) | `Tasa.tsx` | `tasas.py`, `config.py` | `tasa` |
| Configuración | `/configuracion/:seccion?` (cuenta, lenguaje, apariencia, usuarios, roles, pago-movil) | `Configuracion.tsx` | `usuarios.py`, `config.py` | `usuarios` |
| Contador | `/contador` | `Contador.tsx` | — (puerta a contabilidad, impuestos y tasa) | — |
| Mi cuenta | `/mi-cuenta`, `/mi-usuario` | `MiUsuario.tsx` | `usuarios.py` | — |
| Asistente IA | botón (`components/Asistente.tsx`, `CambiarPrecios.tsx`) | — | `asistente.py` | `reportes` (preguntar, reporte) y `menu` (precios) |

Otros routers: `acceso.py` (login y sesión), `agencia.py` (hub), `gastos_vertigo.py` (hub: `/api/gastos-vertigo`, solo equipo Vertigo, en `SOLO_VERTIGO` y `SOLO_HUB`), `app_movil.py`, `operadores.py` (operadores y puntos de venta), `push.py` y `sitio.py`.

Hub (`frontend/public/inicio.html`): pestañas Cuentas, Locales y Gastos (lo que cuesta mantener la plataforma, con pagos por gasto; totales por moneda sin convertir).

**Asistente IA hoy:** `/api/asistente/preguntar` y `/api/asistente/reporte` solo consultan. `/api/asistente/precios` cambia precios con confirmación.

## 6. Entidades (tablas)

Norma `CAPA###_MOD_ENTIDAD` (cabecera de `models.py`). La centena es el módulo: 1 ventas, 2 menú y recetas, 3 inventario, 4 compras, 5 caja, 6 contabilidad, 7 impuestos, 8 tasa, 9 usuarios y admin.

| Módulo | Tablas |
|---|---|
| Ventas (1) | `DIM110_VEN_PUNTO_VENTA`, `TRX110_VEN_PEDIDO`, `TRX111_VEN_PEDIDO_DET`, `TRX112_VEN_PEDIDO_EDICION`, `TRX120_VEN_PAGO`, `TRX121_VEN_VERIFICACION`, `TRX123_VEN_VUELTO`, `TRX130_VEN_ABONO_FIADO` |
| Menú y recetas (2) | `DIM210_MEN_CATEGORIA`, `DIM220_MEN_PRODUCTO`, `DIM230_MEN_VARIANTE`, `HIS220_MEN_PRECIO`, `REL250_REC_PRODUCTO_INGREDIENTE`, `REL251_REC_COMBO`, `HIS250_REC_RECETA` |
| Inventario (3) | `DIM305_INV_CATEGORIA`, `DIM310_INV_INGREDIENTE`, `REL311_INV_PREPARACION_DET`, `TRX310_INV_CONSUMO`, `TRX320_INV_MERMA`, `TRX330_INV_SOBRANTE`, `TRX340_INV_MOVIMIENTO`, `TRX350_INV_CONTEO`, `TRX351_INV_CONTEO_DET`, `TRX360_INV_PRODUCCION`, `TRX366_INV_SUSTITUCION` |
| Compras (4) | `DIM410_COM_PROVEEDOR`, `DIM420_COM_EQUIVALENCIA`, `TRX410_COM_FACTURA`, `TRX411_COM_FACTURA_DET`, `TRX412_COM_FACTURA_SOPORTE`, `TRX416_COM_FACTURA_GASTO`, `TRX417_COM_FACTURA_ABONO`, `TRX418_COM_FACTURA_RECLAMO`, `TRX419_COM_FACTURA_PAGO`, `TRX420_COM_NOTA_CREDITO`, `TRX421_COM_NOTA_CREDITO_DET`, `TRX430_COM_COMPRA_SUELTA`, `TRX440_COM_ALERTA_PRECIO` |
| Caja (5) | `TRX505_CAJ_APERTURA`, `TRX510_CAJ_CIERRE`, `TRX511_CAJ_CIERRE_DET` |
| Contabilidad (6) | `DIM610_CON_CUENTA`, `TRX610_CON_ASIENTO`, `TRX611_CON_ASIENTO_DET`, `TRX620_CON_GASTO`, `TRX630_CON_RETIRO_PROPIETARIO`, `DIM620_ACT_ACTIVO_FIJO` |
| Impuestos (7) | `CFG710_IMP_FISCAL`, `TRX710_IMP_DECLARACION_IVA`, `TRX720_IMP_RETENCION_ENTERADA` |
| Tasa (8) | `TRX810_TAS_TASA` |
| Usuarios y admin (9) | `DIM910_USU_OPERADOR`, `DIM920_USU_DISPOSITIVO`, `TRX910_USU_AUTORIZACION`, `CFG910_ADM_PARAMETRO`, `CFG920_ADM_REPORTE_GUARDADO`, `CFG930_ADM_MIGRACION` |
| Hub, esquema `HUB` (`hub_models.py`, `HubBase`) | `DIM930_ADM_GASTO_VERTIGO`, `TRX930_ADM_PAGO_VERTIGO`. Se crean solo en el hub y los gastos conocidos se siembran si la tabla no existía |
| Mart diario | `DM_FACT110_VEN_DIA`, `DM_FACT120_VEN_DIA_DET`, `DM_FACT610_CON_DIA_CUENTA` |

Fuera de la base: cuentas y roles en `users.json` y `roles.json` (volumen `compartido`), y la marca de cada local en `locales/<slug>.json` (hoy solo `savora.json`).

## 7. Piezas transversales

- **Acceso:** `backend/app/acceso/` (sesión HMAC en cookie, PBKDF2, permisos por módulo, roles a medida). El middleware de `main.py` cierra toda ruta y nginx valida la cookie antes de servir archivos.
- **Fecha del negocio:** `timeutils.py` (`ahora`, `hoy`, `inicio_del_dia`, `rango_de_mes`, `rango_periodo`). Hoy no existe el concepto de día operativo ni de hora de corte.
- **Mart diario:** `consolidacion.py` (03:30 cada noche, `VERSION`, `invalidar_dia`).
- **Frontend común:** `components/ui.tsx`, `dialogo.tsx`, `Tabla.tsx`, `Secciones.tsx`, `Ayuda.tsx` + `lib/glosario.ts`, `Conexion.tsx`, `Rail.tsx`, `Marca.tsx`.
- **Sin conexión:** `frontend/public/sw.js` (la app abre sin internet y nunca guarda `/api/`) y `clave_cliente` de idempotencia en `crear_pedido`.

## 8. Riesgos conocidos

| Riesgo | Dónde | Tarea que lo resuelve |
|---|---|---|
| El número de comanda se calcula como "el último más uno", sin bloqueo ni restricción única: con dos tablets se puede repetir | `routers/pedidos.py` (`_siguiente_numero`) | 1.4 |
| Dos cobros del mismo pedido en el mismo instante pueden pasar los dos (se comprueba `pagado` sin bloqueo) | `routers/pedidos.py`, `cobrar_pedido` | 1.4 |
| Las pruebas de CI no corren sobre PostgreSQL | `.github/workflows/pruebas.yml` | 1.4 |
| 58 pruebas de auditoría demuestran errores de dinero, permisos y operación | rama `qa-auditoria-pruebas` | 1.3 |
| No hay aviso si la copia al bucket deja de funcionar | `gcp/arranque.sh` | 1.7 |

## 9. Registro de cambios

Formato de cada entrada:

```
### AAAA-MM-DD · Tarea X.Y · <título>
- Cambios realizados:
- Nuevos módulos / rutas / entidades:
- Decisiones técnicas:
- Impacto en el sistema:
```

### 2026-10-30 · Mapa inicial
- Cambios realizados: ninguno en el código. Se levantó el estado real del repo.
- Nuevos módulos / rutas / entidades: —
- Decisiones técnicas: los documentos de la metodología viven en `SDD`; el código, en `erp_comida_v1`.
- Impacto en el sistema: ninguno.

### 2026-11-02 · Tarea 1.0.1 · Código traído a Vertigopro e integración del trabajo local
- Cambios realizados: clon de `origin/master` (`1a50624`, 3 commits nuevos desde el mapa inicial: buscadores sin acentos, compra en $0, partes en Bs en caja) en `Vertigopro/erp_comida_v1`. Integrado en master local lo que `erp_comida_v1-gastos` tenía sin commitear (`635a5c7`). Las 3 pruebas QA sin commitear de `erp_qa` van en la rama `qa-auditoria-pruebas`. Backend compila.
- Nuevos módulos / rutas / entidades: `/api/gastos-vertigo`, `DIM930_ADM_GASTO_VERTIGO`, `TRX930_ADM_PAGO_VERTIGO`, pestaña Gastos del hub.
- Decisiones técnicas: los documentos y el código viven juntos en `Vertigopro` (documentos en la raíz, código en `erp_comida_v1/`). Las pruebas QA no entran en master porque fallan a propósito.
- Impacto en el sistema: ninguno en producción (nada se subió ni se desplegó). El mapa decía que `gastos-vertigo` y `qa-auditoria` estaban integradas; tenían trabajo sin commitear y se corrigió.

### 2026-11-02 · Metodología · Entorno local, specs, skill de estilo y git de los documentos
- Cambios realizados: `levantar-local.ps1` y entorno local sin Docker; carpeta `specs/` con su plantilla; skill `estilo-vertigo` (reemplaza a `estilo-savora`); `CLAUDE.md` completo (consideraciones generales, estilos, estructura de archivos y gastos de Vertigo); git en la raíz de Vertigopro solo para los documentos.
- Nuevos módulos / rutas / entidades: ninguno en el código.
- Decisiones técnicas: Vertigopro es la única fuente de verdad. Todo cambio se valida primero en local.
- Impacto en el sistema: ninguno.

### 2026-11-02 · Metodología · Comandos `/nueva-funcionalidad` y `/arreglar`
- Cambios realizados: dos comandos nuevos en `.claude/commands/` y formato de `Apuntes/fixes.md`. Se borró la skill global `estilo-savora` (la reemplaza `estilo-vertigo`).
- Nuevos módulos / rutas / entidades: ninguno en el código.
- Decisiones técnicas: una idea nueva pasa por `/nueva-funcionalidad` (requisito, spec, plan y tareas, sin código) antes de `/implementar`. Los arreglos van en ramas `fix-<fecha>-<tema>` y se validan en local antes de subirlos.
- Impacto en el sistema: ninguno.

### 2026-11-02 · Tareas 1.0 y 1.1 · Limpieza y app móvil en master
- Cambios realizados: borrado el repo viejo del escritorio con sus 8 carpetas de trabajo y `Desktop\SDD`, después de rescatar lo ignorado que importaba. `origin/app-expo` (47 commits) fusionada con master en `fase1-app-expo` sin conflictos de texto, y esta en master local (`0a7c6c5`). Para que la app compile: `lib/tiposArticulo.ts` toma `NombreIcono` de `lib/iconos.ts` y `lib/pagos.ts` define su propio tipo de `pedirTexto` (los dos importaban componentes web); la ficha de mercancía de la app pide un solo nivel, "Sería ideal siempre tener al menos", como la web. Compilan backend, web (tsc y build) y móvil (tsc).
- Nuevos módulos / rutas / entidades: `movil/` en master (Expo). Usa `/api/app/inicio`, `/api/app/pos` y `/api/push/dispositivo`, que ya estaban en master.
- Decisiones técnicas: `lib/` compartido entre web y app no importa componentes de la web. La app en local se levanta en el navegador (Expo web, puerto 8081) contra el backend local.
- Impacto en el sistema: ninguno en producción (nada subido ni desplegado). `npm run glosario` falla con 29 entradas que "ya no se usan", y ya fallaba igual en `origin/master`: anotado en `fixes.md`.

### 2026-11-02 · Arreglos y cierre de 1.0 · Glosario, ficha de la app, ramas y build
- Cambios realizados: en la rama `fix-2026-11-02-glosario-y-ficha-movil`. `npm run glosario` vuelve a pasar (`a5035af`): el script ahora cuenta `explicar('x')` y las `<Tabla>` con el `glosario=` en otra línea, y se quitaron 17 explicaciones de pantallas rehechas (historial de cierres, asientos y columnas y cifras viejas); se regeneró `asistente/glosario.json`. La ficha de mercancía de la app pregunta "Cómo te llega" (suelta o en empaque) y en empaque pide cuántos hay y el precio por empaque, como la web (`c038405`). Borradas en GitHub las 11 ramas ya integradas en `origin/master`. Build de EAS `publico` (Android, APK) terminado con la cuenta `motaleider7` (build `86c2be1f`).
- Nuevos módulos / rutas / entidades: ninguno.
- Decisiones técnicas: el chequeo del glosario solo mira la web; la app tiene su propia copia en `movil/src/componentes/reportes/glosario.ts`. `fix-bloqueo-postgres` se borró porque master ya tiene ese arreglo (`with_for_update(of=...)` y `test_bloqueo_postgres.py`).
- Impacto en el sistema: ninguno en producción. El build de EAS salió de `0a7c6c5`, sin los dos arreglos.

### 2026-11-02 · Metodología · Documentos al repo, plan revisado y spec de ventas
- Cambios realizados: `CLAUDE.md` del producto y `docs/` (specs, plan, tareas y este mapa) pasan al repo, en la rama `fase1`, subida a GitHub. En `Vertigopro/` queda un `CLAUDE.md` personal que importa el del repo. `ESTADO.md` queda como historial. Plan revisado: bloques nuevos 1.2 (validar y subir) y 1.3 (errores QA), el resto se renumera (dos tablets 1.4, sin conexión 1.5, medianoche 1.6, respaldo 1.7, apps 1.8, cierre 1.9); decisiones nuevas D10 (caja por tablet) y D11 (retención del bucket); las FASES 2 a 4 quedan solo con ideas generales. `specs/ventas.md` en borrador. En `CLAUDE.md`: fuera el estado de las fases, requisito de errores QA en la FASE 1 y la FASE 0 corregida a "una caja por día con dos gavetas", que es lo que hace el código.
- Nuevos módulos / rutas / entidades: ninguno en el código.
- Decisiones técnicas: la spec y su código viajan en la misma rama. La app de Capacitor (`frontend/android`, `app-android.yml`) sigue hasta que las tablets usen la APK de Expo.
- Impacto en el sistema: ninguno en producción. Subir `fase1` solo corre las pruebas en GitHub.

### 2026-11-02 · Metodología · Un solo CLAUDE.md y todo dentro del repo
- Cambios realizados: por pedido de Leider (un solo `CLAUDE.md`, y Daniel trabaja con la misma metodología), todo pasa a la raíz del repo: `CLAUDE.md` único (une el del producto y el personal), `specs/`, `plan-implementacion.md`, `tareas.md`, `project-map.md`, `prompts.md`, `Apuntes/`, los comandos, la skill `estilo-vertigo`, `levantar-local.ps1` y `.dev-data/`. La carpeta `Vertigopro/` queda solo como contenedor del repo; su git viejo guarda la historia de los documentos hasta hoy.
- Nuevos módulos / rutas / entidades: ninguno en el código.
- Decisiones técnicas: los documentos van en la raíz, como pedía la metodología original, no en `docs/`. `.dev-data/` y las skills de terceros no se versionan.
- Impacto en el sistema: ninguno en producción. La sesión del agente se abre ahora en `erp_comida_v1/`.
