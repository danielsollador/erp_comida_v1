# La app de Sávora (Android y iOS)

Es el mismo ERP, empaquetado con Capacitor. Las pantallas van **dentro** de la
app (abre al instante, sin cargar una página) y hablan con el servidor del
local que dice `.env.app` (`VITE_API_BASE`).

## Cómo funciona la sesión en la app

La web usa una cookie HttpOnly. Dentro de la app la cookie no viaja (la API
está en otro origen), así que la app se identifica con `X-Vp-App: 1`, recibe
el mismo token firmado en la cabecera `X-Vp-Token` y lo devuelve en
`Authorization: Bearer`. El canal en vivo lo manda como subprotocolo
(`vp, <token>`). Todo esto vive en `src/lib/plataforma.ts` y en
`backend/app/acceso/auth.py`; la web no cambia.

**Requisito en el servidor:** el backend con este cambio tiene que estar en
producción antes de que la app pueda entrar.

## Compilar

| Qué | Cómo |
|---|---|
| Pantallas de la app | `npm run build:app` (usa `.env.app`) |
| Copiarlas a Android/iOS | `npm run app:sync` |
| APK de prueba (Android) | GitHub → Actions → "App Android" → Run workflow. Deja `app-debug.apk` para instalar en una tablet. |
| Iconos y arranque | `assets/` → `npx capacitor-assets generate --ios` y luego `--android` (por separado: juntos fallan en Windows) |

## Para publicar en las tiendas

1. **Cuentas** a nombre de la empresa, con número D-U-N-S:
   Google Play ($25 una vez) y Apple Developer ($99 al año).
2. **Android (Google Play):** una llave de firma (`keystore`) guardada en los
   secretos del repositorio y un flujo que compile el AAB firmado
   (`./gradlew bundleRelease`).
3. **iOS (App Store):** se compila en macOS (un runner macOS de GitHub o
   Codemagic) con el certificado y el perfil de Apple.
4. **Fichas de las tiendas:** política de privacidad publicada, formulario de
   datos recogidos, capturas, descripción y una cuenta de prueba para los
   revisores.
5. **Cobro:** se cobra fuera de la app (como hoy). Sávora se vende al negocio
   para su personal; las reglas de Apple (3.1.3(c)) permiten que la app solo dé
   acceso a lo ya pagado. Revisarlo antes de enviar: esas reglas cambian.

## Pendiente

- Un logo en alta resolución (1024 px o vectorial) para el ícono: hoy se
  escala desde uno de 512 px.
- Notificaciones push (comanda lista, caja sin cerrar, resumen del día): Apple
  pide funciones nativas, no solo una web empaquetada.
- Pasada de diseño pantalla por pantalla para teléfono.
