# Project map

Cómo está el sistema hoy, sacado del código. Si no coinciden, manda el código y se corrige este mapa.
Sincronizado el 2-nov-2026 sobre la rama `fase1`.

## Repo y ramas

- Remoto: `github.com/danielsollador/erp_comida_v1`. En la laptop de Leider, el repo es la carpeta `Desktop\Vertigopro`.
- Rama principal `master`, que ya tiene la metodología (`CLAUDE.md`, plan, specs, comandos): toda rama nueva la trae.
- `fase1` = `master` + gastos de Vertigo + app móvil (`app-expo`) + arreglos. En GitHub, sin fusionar.
- `qa-auditoria-pruebas`: 58 pruebas que demuestran errores. Fuera de `master` a propósito (fallan mientras el error exista).
- En GitHub quedan `app-expo` y `app-expo-play`, ya contenidas en `fase1`: se borran al fusionar.
- No se versionan: `.env` (claves), `movil/.env` (apunta a **producción**), `movil/tienda/REVISOR.local.txt`, `.dev-data/` (datos de prueba y copias de `.env`) y las skills de terceros.

## Producción

- Proyecto de Google Cloud `vertigo-erp-produccion`, región `us-east1`, desde el 6-oct.
- VM `vertigo-erp` (`e2-small`, 2 GB, `us-east1-b`, IP fija `35.231.43.80`). Código en `/docker/erp` (los tres compose y `locales/`). Servicios de `docker-compose.gcp.yml`: Traefik, backend y frontend del local, hub y Let's Encrypt.
- Imágenes en Artifact Registry: `us-east1-docker.pkg.dev/vertigo-erp-produccion/vertigo/{backend,frontend}:<versión>`. La versión en uso es el secreto `imagen-tag`.
- Dominios: `savora.vertigopro.tech` (ERP) y `vertigopro.tech` (hub y sitio).
- PostgreSQL 16, base `vertigo`, un esquema por local (`SAVORA`) y el esquema `HUB`.
- Respaldos: `pg_dump` cada 6 h, copia horaria a `gs://vertigo-erp-respaldos` y snapshot diario del disco (`vertigo-erp-diario`, 14 días).
- Secretos en Secret Manager: `postgres-password`, `erp-session-secret`, `pabilo-api-key`, `pabilo-user-bank-id`, `acme-email`, `dominio-savora`, `dominio-hub`, `imagen-tag`, `erp-lector-facturas`, `gemini-api-key`, `erp-gemini-modelo` y `erp-gemini-modelo-respaldo`.
- La cuenta de la VM (`vm-erp@…`) solo puede leer imágenes y secretos, escribir en el bucket y mandar logs y métricas.
- Despliegue manual: `CLAUDE.md` > Servidor y despliegue.
- CI: `pruebas.yml` (suite sobre SQLite en cada push) y `app-android.yml` (APK de Capacitor, a mano).
- Las tablets usan hoy la app de Capacitor (`frontend/android`). La app de Expo (`movil/`) tiene una APK de prueba hecha con EAS.

## Módulos

| Módulo | Ruta web | Pantalla | API | Permiso |
|---|---|---|---|---|
| Inicio | `/` | `Inicio.tsx` | varias | — |
| Punto de venta | `/pos/:seccion?` | `POS.tsx` | `pedidos.py`, `pagos.py`, `autorizaciones.py` | `pos` |
| Cuentas por cobrar | `/cobranzas/:seccion?` | `CuentasPorCobrar.tsx` | `cobranzas.py` | `cobranzas` |
| Cocina | `/cocina` | `Cocina.tsx` | `pedidos.py` | `cocina` |
| Ventas | `/ventas/:seccion?` | `Ventas.tsx` | `ventas.py` | `ventas` |
| Compras | `/compras/:seccion?` | `Compras.tsx` | `compras*.py`, `proveedores.py` | `compras` |
| Inventario | `/inventario/:seccion?` | `Inventario.tsx` | `inventario.py`, `preparaciones.py` | `inventario` |
| Menú y recetas | `/menu/:seccion?`, `/recetas` | `Menu.tsx` | `menu.py` | `menu`, `recetas` |
| Cierre de caja | `/caja/:seccion?` | `Caja.tsx` | `caja.py` | `caja` |
| Reportes | `/reportes/:seccion?` | `Reportes.tsx` | `reportes.py`, `reportes_dinamicos.py` | `reportes` |
| Contabilidad | `/contabilidad/:seccion?` | `Contabilidad.tsx` | `contabilidad.py`, `respaldos.py` | `contabilidad` |
| Impuestos | `/impuestos/:seccion?` | `Impuestos.tsx` | `impuestos.py` | `impuestos` |
| Tasa de cambio | `/tasa/:seccion?` | `Tasa.tsx` | `tasas.py`, `config.py` | `tasa` |
| Configuración | `/configuracion/:seccion?` | `Configuracion.tsx` | `usuarios.py`, `config.py` | `usuarios` |
| Contador | `/contador` | `Contador.tsx` | — | — |
| Asistente IA | botón en la barra | `Asistente.tsx`, `CambiarPrecios.tsx` | `asistente.py` | `reportes`, `menu` |

Otros routers: `acceso.py`, `agencia.py` (hub), `gastos_vertigo.py` (hub, solo equipo Vertigo), `app_movil.py`, `operadores.py`, `push.py`, `sitio.py`.
Hub (`frontend/public/inicio.html`): pestañas Cuentas, Locales y Gastos.
La IA ya consulta cifras y el manual, y cambia precios con confirmación.

## Tablas

Norma `CAPA###_MOD_ENTIDAD` (cabecera de `models.py`). Centena = módulo: 1 ventas, 2 menú, 3 inventario, 4 compras, 5 caja, 6 contabilidad, 7 impuestos, 8 tasa, 9 usuarios y admin.

| Módulo | Tablas |
|---|---|
| Ventas | `DIM110_VEN_PUNTO_VENTA`, `TRX110_VEN_PEDIDO`, `TRX111_VEN_PEDIDO_DET`, `TRX112_VEN_PEDIDO_EDICION`, `TRX120_VEN_PAGO`, `TRX121_VEN_VERIFICACION`, `TRX123_VEN_VUELTO`, `TRX130_VEN_ABONO_FIADO` |
| Menú | `DIM210_MEN_CATEGORIA`, `DIM220_MEN_PRODUCTO`, `DIM230_MEN_VARIANTE`, `HIS220_MEN_PRECIO`, `REL250_REC_PRODUCTO_INGREDIENTE`, `REL251_REC_COMBO`, `HIS250_REC_RECETA` |
| Inventario | `DIM305_INV_CATEGORIA`, `DIM310_INV_INGREDIENTE`, `REL311_INV_PREPARACION_DET`, `TRX310_INV_CONSUMO`, `TRX320_INV_MERMA`, `TRX330_INV_SOBRANTE`, `TRX340_INV_MOVIMIENTO`, `TRX350_INV_CONTEO`, `TRX351_INV_CONTEO_DET`, `TRX360_INV_PRODUCCION`, `TRX366_INV_SUSTITUCION` |
| Compras | `DIM410_COM_PROVEEDOR`, `DIM420_COM_EQUIVALENCIA`, `TRX410`–`TRX419` (factura, detalle, soporte, gasto, abono, reclamo, pago), `TRX420_COM_NOTA_CREDITO`, `TRX421_COM_NOTA_CREDITO_DET`, `TRX430_COM_COMPRA_SUELTA`, `TRX440_COM_ALERTA_PRECIO` |
| Caja | `TRX505_CAJ_APERTURA` (una fila por gaveta y día), `TRX510_CAJ_CIERRE`, `TRX511_CAJ_CIERRE_DET` |
| Contabilidad | `DIM610_CON_CUENTA`, `TRX610_CON_ASIENTO`, `TRX611_CON_ASIENTO_DET`, `TRX620_CON_GASTO`, `TRX630_CON_RETIRO_PROPIETARIO`, `DIM620_ACT_ACTIVO_FIJO` |
| Impuestos | `CFG710_IMP_FISCAL`, `TRX710_IMP_DECLARACION_IVA`, `TRX720_IMP_RETENCION_ENTERADA` |
| Tasa | `TRX810_TAS_TASA` |
| Usuarios y admin | `DIM910_USU_OPERADOR`, `DIM920_USU_DISPOSITIVO`, `TRX910_USU_AUTORIZACION`, `CFG910_ADM_PARAMETRO`, `CFG920_ADM_REPORTE_GUARDADO`, `CFG930_ADM_MIGRACION` |
| Hub (esquema `HUB`) | `DIM930_ADM_GASTO_VERTIGO`, `TRX930_ADM_PAGO_VERTIGO` |
| Mart diario | `DM_FACT110_VEN_DIA`, `DM_FACT120_VEN_DIA_DET`, `DM_FACT610_CON_DIA_CUENTA` |

Fuera de la base: cuentas y roles en `users.json` y `roles.json` (volumen `compartido`), y la marca de cada local en `locales/<slug>.json`.

## Riesgos conocidos

| Riesgo | Dónde | Lo resuelve |
|---|---|---|
| El número de comanda es "el último + 1" sin bloqueo: dos tablets pueden repetirlo | `pedidos.py`, `_siguiente_numero` | 1.4 |
| Dos cobros del mismo pedido al mismo instante pueden pasar | `pedidos.py`, `cobrar_pedido` | 1.4 |
| La CI no prueba sobre PostgreSQL | `pruebas.yml` | 1.4 |
| 58 pruebas QA demuestran errores de dinero, permisos y operación | rama `qa-auditoria-pruebas` | 1.3 |
| El control de un solo envío (`salvaguardas.py`) vive en memoria: con más de un proceso de uvicorn no ve los repetidos del otro | `main.py`, `salvaguardas.py` | Llevarlo a una tabla si se pasa a varios procesos |
| Nadie avisa si la copia al bucket deja de funcionar | `gcp/arranque.sh` | 1.7 |

## Registro de cambios

Una línea por cambio relevante; el detalle está en git.

- **8-nov** Rama `fix-2026-11-08-qa-noviembre` (sale de `fase1` con `master` y la exportación de Cuentas por cobrar), sin desplegar: los 32 hallazgos del QA de noviembre (`specs/qa.md`), y el cierre de caja como cuadre (`specs/caja.md`, bloque 1.10). Piezas nuevas: `lib/montos.ts` (un solo lector de montos, web y app), `backend/app/salvaguardas.py` (firma, confirmar y un solo envío: el servidor responde 428 y la web lo resuelve en `components/Salvaguardas.tsx`), cuenta 6160 «Diferencial cambiario», columnas de estado de la diferencia en `TRX505`, `TRX510` y `TRX511`, `consolidacion.VERSION` 3. Dona suma seis herramientas.

- **6-nov** Rama `exportar-cuentas-por-cobrar`, sin desplegar: "Quién me debe" se exporta a CSV y Excel. `Tabla` tiene la opción `exportar`, `descargar` acepta un cuerpo (POST) y `exportar_csv.py` suma `regional` y `respuesta_xlsx`.
- **4-nov** Rama `fix-2026-11-04-cobros-cxc`, sin desplegar: cobros con bloqueo y reintentos sin duplicar (columna `clave_cliente` en `TRX130` y `TRX140`), retención parcial solo con comisión marcada, y el cuadre espera lo que entró; un día cerrado muestra lo guardado. `tests/test_concurrencia_pg.py` necesita `ERP_TEST_PG_URL`: la CI todavía se la salta.
- **3-nov** Solo manda el `CLAUDE.md` del repo: `.claude/settings.json` ignora los personales y la memoria automática.
- **3-nov** Herramientas del agente: Context7, Serena y Playwright en `.mcp.json` (Serena con `.serena/project.yml`, sin memorias).
- **3-nov** Carril rápido en `CLAUDE.md` para cambios pequeños sin dinero, permisos ni base de datos (unos 15 min a producción); en un despliegue las imágenes se construyen mientras GitHub prueba.
- **3-nov** El despliegue y la operación del servidor pasan a `CLAUDE.md` (imágenes construidas a la vez); `gcp/README.md` solo apunta ahí. Datos del servidor en Producción de este mapa.
- **3-nov** CLAUDE.md: leer y buscar en el código antes de tocarlo; recibo (compila + pruebas solo de lo que cambió, nunca la suite en local); prueba primero en lo que toca dinero; spec "Implementada" queda como la verdad del módulo; sección "Servidor y despliegue". pytest en el entorno local.
- **2-nov** La carpeta `Vertigopro` pasa a ser el repo (CLAUDE.md siempre se carga) y la metodología sube a `master`. CLAUDE.md dice qué hacer con los pedidos sin comando.
- **2-nov** Comando `/revisar` (documentos repetidos, que chocan o viejos) y paso "aclarar" antes de aprobar una spec, en `/implementar` y `/nueva-funcionalidad`.
- **2-nov** Fuera los `.md` de planes y guías viejas (Hostinger, migración a Google, plan de compras, guías de la app); sus reglas vigentes pasaron a `CLAUDE.md`, que suma "Qué es fight complexity", "Tablas y gráficos" y "Palabras".
- **2-nov** `CLAUDE.md` por áreas (cómo se trabaja, base de datos, backend, web, app); las fases pasan al plan; fuera `fases.md` y `ESTADO.md` (historia en git). Documentos recortados sin repetir información.
- **2-nov** Toda la metodología en la raíz del repo, con un solo `CLAUDE.md`.
- **2-nov** Plan revisado: bloques 1.2 (validar y subir) y 1.3 (errores QA); decisiones D10 y D11. Spec `ventas.md` en borrador.
- **2-nov** Glosario: el chequeo vuelve a pasar (`a5035af`). Ficha de mercancía de la app igual a la web (`c038405`).
- **2-nov** App móvil (`app-expo`) integrada (`0a7c6c5`) y APK de prueba con EAS. Ramas viejas borradas en GitHub.
- **2-nov** Código traído a `Vertigopro/erp_comida_v1`, con los gastos de Vertigo que estaban sin commitear (`635a5c7`).
- **30-oct** Mapa inicial.
