# Vertigo Pro en Google Play

Complemento de `APP-STORE.md` para Android. Paquete: `tech.vertigopro.app`.

## Material listo (`tienda/google-play/`)

| Pieza | Archivo | Medida |
|---|---|---|
| Ícono de la tienda | `icono-512.png` | 512×512, PNG 32 bits |
| Imagen de portada | `portada-1024x500.png` | 1024×500, sin texto cerca de los bordes |
| Capturas de teléfono | `capturas/01…08-android-1080x1920.png` | 1080×1920 (9:16) |

Las capturas salen de la app actual (rama `app-expo`, 28-oct-2026) contra una
demo local llamada «La Despensa», con los datos inventados de `demo_data.py`.

## Firma

La llave de Android (keystore) ya existe en EAS: se generó en la nube en la
primera compilación de Android (14-oct-2026, perfil `publico`). Toda compilación
de este proyecto la reutiliza. No crear otra. Antes de pasar el proyecto a una
organización de Expo, descargar una copia: `npx eas-cli credentials -p android`
→ Keystore → Download (la guarda Leider, fuera de git).

## Permisos (manifiesto final verificado con `expo config --type introspect`)

- Declarados: `INTERNET`, `VIBRATE`, `CAMERA` (expo-image-picker),
  `POST_NOTIFICATIONS` y `RECEIVE_BOOT_COMPLETED` (expo-notifications),
  `ACCESS_NETWORK_STATE`.
- Bloqueados en `app.json` → `android.blockedPermissions`: `READ_MEDIA_IMAGES`,
  `READ_MEDIA_VIDEO`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`,
  `SYSTEM_ALERT_WINDOW`, `RECORD_AUDIO`.
- La galería usa el selector del sistema (`launchImageLibraryAsync` →
  PhotoPicker); la app nunca pide permiso de fotos.

## Seguridad de los datos

Igual que la sección 3.4 de `APP-STORE.md`, más **dos** terceros que reciben datos:

| Tercero | Qué recibe | Cuándo |
|---|---|---|
| Google Gemini | Foto o PDF de la factura de compra, nombre y RIF del negocio | Al tocar «Leer factura», tras el consentimiento |
| Anthropic (Claude) | La pregunta y los datos del negocio que hagan falta para responderla (ventas, productos, precios) | Al usar «Pregúntale a Vertigo», reportes con palabras o cambiar precios con IA |

Ojo: el consentimiento de la app (`lib/consentimiento-ia.ts`) hoy solo nombra a
Google Gemini. El asistente con Anthropic llegó el 23-oct y no tiene su propio
aviso; la ficha de Apple tampoco lo menciona.

## Probadores

Cuenta personal → prueba cerrada con 12 probadores durante 14 días antes de
poder pasar a producción. La versión de producción recibe las mismas
actualizaciones OTA que iOS (`runtimeVersion` = versión de la app, canal
`production`).
