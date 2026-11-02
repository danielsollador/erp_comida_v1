# Vertigo Pro en Google Play

Complemento de `APP-STORE.md` para Android. Paquete: `tech.vertigopro.app`.

## 1. Material listo (`tienda/google-play/`)

| Pieza | Archivo | Medida |
|---|---|---|
| Ícono de la tienda | `icono-512.png` | 512×512, PNG 32 bits |
| Imagen de portada | `portada-1024x500.png` | 1024×500, sin texto cerca de los bordes |
| Capturas de teléfono | `capturas/01…08-android-1080x1920.png` | 1080×1920 (9:16) |

Las capturas salen de la app actual (rama `app-expo`, 28-oct-2026) contra una
demo local llamada «La Despensa», con los datos inventados de `demo_data.py`.

## 2. Firma

La llave de Android (keystore) ya existe en EAS: se generó en la nube en la
primera compilación de Android (14-oct-2026, perfil `publico`). Toda compilación
de este proyecto la reutiliza. No crear otra. Antes de pasar el proyecto a una
organización de Expo, descargar una copia: `npx eas-cli credentials -p android`
→ Keystore → Download (la guarda Leider, fuera de git).

## 3. Permisos (manifiesto final verificado con `expo config --type introspect`)

- Declarados: `INTERNET`, `VIBRATE`, `CAMERA` (expo-image-picker),
  `POST_NOTIFICATIONS` y `RECEIVE_BOOT_COMPLETED` (expo-notifications),
  `ACCESS_NETWORK_STATE`.
- Bloqueados en `app.json` → `android.blockedPermissions`: `READ_MEDIA_IMAGES`,
  `READ_MEDIA_VIDEO`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`,
  `SYSTEM_ALERT_WINDOW`, `RECORD_AUDIO`, `READ_MEDIA_AUDIO`,
  `READ_MEDIA_VISUAL_USER_SELECTED` y `com.google.android.gms.permission.AD_ID`
  (sin publicidad: así se declaró en Play Console).
- La galería usa el selector del sistema (`launchImageLibraryAsync` →
  PhotoPicker); la app nunca pide permiso de fotos.

## 4. Seguridad de los datos

Igual que la sección 3.4 de `APP-STORE.md`, más **dos** terceros que reciben datos:

| Tercero | Qué recibe | Cuándo |
|---|---|---|
| Google Gemini | Foto o PDF de la factura de compra, nombre y RIF del negocio | Al tocar «Leer factura», tras el consentimiento |
| Anthropic (Claude) | La pregunta y los datos del negocio que hagan falta para responderla (ventas, productos, precios) | Al usar «Pregúntale a Vertigo», reportes con palabras o cambiar precios con IA |

Cada uno tiene su permiso en la app, que se pide antes del primer envío y se
ve y se retira en Configuración › Mi cuenta: `lib/consentimiento-ia.ts`
(Gemini, facturas) y `lib/consentimiento-asistente.ts` (Anthropic, asistente,
desde el 29-oct). Falta nombrar a Anthropic en la ficha de Apple.

## 5. La cuenta es personal: prueba cerrada obligatoria

La cuenta de Play Console es **personal** (Vertigo.IA). Para las cuentas
personales nuevas Google exige, antes de dejar publicar en producción:

1. Una **prueba cerrada** con **al menos 12 probadores** que se unan a la prueba…
2. …y que sigan dentro **14 días seguidos**.
3. Después se pide el acceso a producción (Panel › «Solicitar acceso a
   producción»), respondiendo unas preguntas sobre la prueba. Google
   contesta en unos días.

El reloj de los 14 días arranca cuando hay 12 dentro: conviene armar la
lista de correos (Gmail) ya. Sirven el equipo del local, Leider, Daniel,
familia: cualquiera con Android que instale la prueba y no se salga.

## 6. Crear la app en Play Console

Play Console › Crear aplicación:

- **Nombre**: `Vertigo Pro` (igual que en App Store)
- **Idioma predeterminado**: Español (Latinoamérica) – es-419
- **App o juego**: App · **Gratis o de pago**: Gratis
- Aceptar las declaraciones (políticas y leyes de exportación de EE. UU.).

## 7. La ficha de la tienda (Crecimiento › Presencia en Play Store › Ficha principal)

- **Nombre** (30): `Vertigo Pro`
- **Descripción breve** (80):
  `Punto de venta, cocina, inventario y caja de tu local, desde el teléfono.`
- **Descripción completa** (4000): la misma de `APP-STORE.md` § 3.1.
- **Ícono**: `tienda/google-play/icono-512.png`
- **Imagen destacada**: `tienda/google-play/portada-1024x500.png`
- **Capturas de teléfono**: `tienda/google-play/capturas/01` a `08`, en ese orden.
- **Categoría**: Empresa · **Etiquetas**: Punto de venta, Inventario, Restaurantes.
- **Datos de contacto**: correo de soporte, sitio https://vertigopro.tech

No hace falta subir capturas de tablet: si se dejan vacías, la app no se
anuncia para tablets en la tienda (se instala igual).

## 8. Contenido de la app (Política › Contenido de la app)

Todo se responde una sola vez; Google no deja enviar a revisión con algo pendiente.

- **Política de privacidad**: https://vertigopro.tech/privacidad.html
- **Acceso a la app**: «Toda o parte de la funcionalidad está restringida».
  Instrucciones (en inglés, como lee el revisor):

  ```
  Each business runs its own server and the owner creates the accounts (no public sign-up).
  1) On the sign-in screen tap "Otro negocio" (Other business).
  2) Type demo.vertigopro.tech and tap "Usar este negocio".
  3) Sign in with the username and password below (owner role, demo data of a fictional shop).
  ```
  Usuario `revision` y la contraseña de `tienda/REVISOR.local.txt` (no va a git).
- **Anuncios**: No.
- **Clasificación de contenido** (cuestionario IARC): categoría
  «Todas las demás apps / Herramientas»; **No** a todo (violencia, contenido
  sexual, apuestas, compras digitales, interacción entre usuarios, ubicación
  compartida). Resultado esperado: Apto para todos / 3+.
- **Público objetivo**: **18 años o más** (es una app de negocio). «¿Atrae a niños?»: No.
- **Apps gubernamentales / Funciones financieras / Salud / Noticias**: No.
  (Cobra y registra ventas del negocio, pero no es un banco, ni presta, ni
  mueve dinero de los usuarios: en «Funciones financieras» se marca «Mi app
  no ofrece ninguna».)
- **Eliminación de cuenta**: URL https://vertigopro.tech/eliminar-cuenta.html ;
  se puede pedir que se borren los datos sin borrar la cuenta: No.

### 8.1 Seguridad de los datos (lo declarado en Play Console)

- **¿Recopila o comparte datos?** Sí.
- **¿Encriptados en tránsito?** Sí (solo HTTPS).
- **¿Se puede pedir que se borren?** Sí (eliminar cuenta, en la app y en la web).

| Categoría de Google | Qué es en Vertigo Pro | Recopilado | Compartido | Para qué | ¿Opcional? |
|---|---|---|---|---|---|
| Información personal › Nombre | Nombre y apellido del usuario | Sí | No | Funcionalidad de la app, gestión de la cuenta | No |
| Información personal › ID de usuario | El usuario con que entra | Sí | No | Funcionalidad, gestión de la cuenta | No |
| Fotos y videos › Fotos | Fotos de facturas de compra | Sí | No* | Funcionalidad de la app | Sí |
| Archivos y documentos | PDF de facturas y planillas de conteo | Sí | No* | Funcionalidad de la app | Sí |
| Actividad en la app › Otro contenido generado por el usuario | Ventas, compras, inventario, clientes a crédito, nombre y RIF del negocio | Sí | No* | Funcionalidad de la app | No |

\* Google **no cuenta como «compartir»** la transferencia a un proveedor que
procesa los datos por cuenta de la app (Google Cloud, y Gemini al leer una
factura después del aviso en la app). Si el abogado o el contador prefieren
declararlo igual, se marca «Compartido» en Fotos y en Otro contenido, con
propósito «Funcionalidad de la app».

Sin publicidad, sin analítica, sin rastreo, sin ubicación.

## 9. Compilar y subir

En la carpeta `movil/`, con acceso al proyecto de Expo:

```bash
npx eas-cli@latest build --platform android --profile production
```

La llave de firma ya existe en EAS (ver «Firma»): EAS la reutiliza, no se crea otra.

1. **Primera subida, a mano**: Play Console › Pruebas › Prueba interna ›
   Crear versión › subir el `.aab` que dio EAS. (Google no deja que la
   primera la suba una herramienta.) Probarla en un Android propio.
2. **Prueba cerrada**: Pruebas › Prueba cerrada › crear pista, agregar la
   lista de correos de los 12 probadores, subir la misma versión (o
   promoverla), enviar a revisión. Mandarles el enlace de la prueba.
3. **A los 14 días**: Solicitar acceso a producción.

### 9.1 Que las siguientes versiones se suban solas

1. Google Cloud (el mismo proyecto o uno nuevo) › IAM › Cuentas de servicio ›
   crear `play-publicar`, y una **clave JSON**.
2. Play Console › Usuarios y permisos › Invitar usuario › el correo de esa
   cuenta de servicio, con permiso para **lanzar versiones** en esta app.
3. Guardar la clave como `tienda/google-play/play-cuenta-servicio.json`
   (está en `.gitignore`; **nunca** a git) o subirla a EAS
   (`npx eas-cli@latest credentials` › Android › Google Service Account).
4. Desde entonces:

```bash
npx eas-cli@latest submit --platform android --latest
```

Va a la pista de **prueba interna como borrador** (`eas.json` › `submit.production.android`); desde Play Console se promueve.

## 10. Antes de mandar a revisión

- [ ] Instalar la versión de prueba interna en un Android y probar contra
      producción: entrar, vender, cocina, foto de factura (permiso de
      cámara), elegir foto de la galería (no debe pedir permiso), eliminar
      cuenta con un usuario de prueba.
- [ ] Confirmar en Play Console › Contenido de la app › Permisos que no
      aparezcan micrófono ni almacenamiento.
- [ ] Revisar que la demo siga viva: `https://demo.vertigopro.tech/api/health`.

## 11. Estado (29-oct-2026)

App creada en Play Console (cuenta Vertigo.IA, `tech.vertigopro.app`, nombre **Vertigo Pro** desde el 29-oct; portada y 8 capturas de `tienda/google-play/`).
**Todo el «Contenido de la aplicación» está completo**: privacidad, datos de inicio de sesión
(usuario `revision` con su contraseña), anuncios (no), ID de publicidad (no; `AD_ID` bloqueado
en `app.json`), clasificación IARC (contenido en línea: sí, por la IA; nada más), público
18+, seguridad de los datos, apps gubernamentales, funciones financieras y salud (no).
Ficha completa; categoría **Economía**; contacto daniel.sanabria.2017@gmail.com y vertigopro.tech.

Expo: el proyecto es de la cuenta personal `motaleider777`; para dar acceso hay que crear una
organización en expo.dev, transferirle el proyecto e invitar con rol Developer.

Falta: la primera compilación AAB, subirla a prueba
interna, armar la prueba cerrada con 12 probadores durante 14 días y pedir producción.

**Micrófono**: el dictado vive en el ERP web (reconocimiento del navegador). Si pasa a la app,
quitar `RECORD_AUDIO` de `blockedPermissions`, poner el texto del permiso y declarar «Audio»
en seguridad de los datos.
