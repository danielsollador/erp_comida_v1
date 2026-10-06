# Migración a Google Cloud: propuesta

Proyecto: `vertigo-erp-produccion`. Estado (5-oct-2026): **ambiente de prueba
levantado** con los datos reales copiados (ver `gcp/README.md` para operarlo).
Hostinger sigue siendo producción hasta que Daniel y Leider decidan el cambio.

## Lo que hay hoy (medido en el VPS el 5-oct-2026, solo lectura)

| Qué | Valor |
|---|---|
| Máquina | 2 vCPU, 8 GB RAM, 96 GB disco (3,5 GB usados), carga 0.00 |
| Contenedores | Traefik, PostgreSQL 16, backend + nginx de Sávora, backend + nginx del hub |
| Memoria en uso | ~320 MB entre los seis contenedores |
| Base `vertigo` | **12 MB** (esquemas `SAVORA` y `HUB`) |
| Respaldos | 5 MB en el volumen `erp_comida_data`, uno cada 6 h; 468 KB en `/root/respaldos` |
| `compartido` | `users.json` y `roles.json` (12 KB) |
| Tráfico | ~5.000 peticiones al día |

Es una carga minúscula: la máquina está al 1 %. Eso es lo que permite ir muy
barato.

## Decisión: una VM mínima, no Cloud Run ni BigQuery

**Base de datos: PostgreSQL, igual que hoy.** BigQuery no sirve como base del
ERP: es un almacén para análisis, no admite el ir y venir de un pedido que se
edita, se cobra y se anula fila por fila. Cloud SQL es PostgreSQL administrado
y tendría sentido, pero su instancia más pequeña cuesta ~US$10/mes para una base
de 12 MB; de momento PostgreSQL corre en la misma VM y los respaldos van a un
bucket. BigQuery queda para el día que haya varios locales y quieran cruzar
datos; con 12 MB no aporta nada.

**Cómputo: una VM `e2-micro` en `us-east1`** (Carolina del Sur, la región del
nivel gratuito más cercana a Venezuela; ya la usa vertigo-campus). Corre el
mismo `docker compose` que hoy, sin reescribir nada. Cloud Run se descartó
para esta etapa: el ERP tiene WebSocket (cocina/POS), hilos de respaldo y de
tasa, y un nginx que pregunta al backend por la sesión; en Cloud Run eso exige
una instancia siempre encendida y cambios de código, y sale en ~US$22-28/mes
entre dos servicios y Cloud SQL. Seis veces más caro para lo mismo.

### Costo mensual estimado (us-east1, octubre 2026, aprox.)

| Recurso | US$/mes |
|---|---|
| VM e2-micro (1 GB RAM, 2 vCPU compartidos) | 0 (nivel gratuito; 6,1 si se pierde) |
| Disco 30 GB estándar | 0 (nivel gratuito) |
| IP pública fija | ~3,7 |
| Bucket de respaldos (< 5 GB) | 0 |
| Artifact Registry (imágenes, < 0,5 GB) | 0 |
| Cloud Build (construir imágenes, < 120 min/día) | 0 |
| Secret Manager (6 secretos) | ~0,4 |
| Salida de datos (< 1 GB) | 0 |
| **Total** | **~US$4** |

Plan B si 1 GB de RAM queda corto (hoy se usan ~320 MB más el sistema):
`e2-small` (2 GB) por ~US$12 más. Sigue siendo igual o más barato que el VPS.

### Qué mejora respecto a Hostinger

- Respaldos **fuera del disco**: cada `pg_dump` se copia a un bucket (hoy
  viven en el mismo disco que la base). Más un snapshot diario del disco.
- Sin puerto 22 abierto: SSH por IAP con la cuenta de Google de cada uno.
- Secretos en Secret Manager (`POSTGRES_PASSWORD`, `ERP_SESSION_SECRET`,
  `PABILO_*`, `ERP_LECTOR_FACTURAS` y la clave de Gemini): la VM los lee al arrancar con una
  cuenta de servicio de permisos mínimos. Nada en el repositorio ni en imágenes.
- Las imágenes se construyen en Cloud Build y la VM solo las descarga: en
  1 GB no se puede compilar el frontend.
- Avisos de Cloud Monitoring si la VM o `/api/health` se caen.

## El dominio: Hostinger desaparece del todo

Hostinger cobra hoy dos cosas: el VPS y el nombre `vertigopro.tech`. El plan
elimina las dos (no hay correo en Hostinger; confirmado por Leider).

| Qué | Hoy | A dónde va | Costo |
|---|---|---|---|
| Servidor | VPS Hostinger | VM en GCP | ~US$4/mes |
| DNS (registros `@`, `savora`, `www`) | Hostinger | Cloud DNS, en el mismo proyecto | ~US$0,20/mes |
| Registro del nombre (renovación anual) | Hostinger | Un registrador a precio de costo (Cloudflare) | la renovación anual del `.tech` |

Cloud Domains ya no acepta transferencias (Google lo cerró en 2024; se
comprobó con `gcloud domains`), por eso el nombre va a Cloudflare. La
transferencia la hacen Daniel o Leider (cuenta y pago); los clics en Hostinger
se hacen con la sesión abierta por ellos. Orden obligatorio: **primero el
servidor, después el DNS, al final el nombre**, y solo entonces se cancela
Hostinger. Cambiar el nombre de registrador no cambia el DNS ni tumba nada si
el DNS ya está en Cloud DNS.

Para probar no hace falta tocar el DNS de Hostinger: la VM responde en
`savora.35.231.43.80.sslip.io` y `hub.35.231.43.80.sslip.io` (sslip.io
convierte la IP en nombre; Let's Encrypt emite certificado igual).

## Pasos

1. **Aprobación** de Daniel y Leider de este documento.
2. Activar APIs (gratis): Compute, Artifact Registry, Cloud Build, Secret
   Manager, Storage, Monitoring.
3. Crear la VM, el bucket, los secretos y la cuenta de servicio mínima.
4. Construir las imágenes y levantar el ERP con dominios **de prueba**
   (`savora-gcp.vertigopro.tech`, `hub-gcp.vertigopro.tech`): hace falta que
   quien maneja el DNS cree dos registros A hacia la IP nueva.
5. **Prueba de migración de datos**: `pg_dump` de la base de Hostinger
   (solo lectura, con permiso explícito) restaurado en la VM nueva; comparar
   conteos de pedidos, facturas, cierres y asientos.
6. Probar el ERP completo en la VM nueva con el código que se acuerde
   (`pabilo-pendiente` ya trae la sesión por token para la app).
7. **Cambio**, solo cuando lo decidan: congelar ventas unos minutos, último
   dump, cambiar los registros A de `savora` y `@`, verificar los dos
   `/api/health`. Hostinger queda una semana como respaldo antes de apagarlo.

## Lo que NO se hace sin preguntar

Crear recursos que cuesten, borrar, cambiar IAM, tocar la base de producción.
Ni encender la VM vieja `instance-20261001-161540` del proyecto
`prueba-servidores-510316`.
