# Vertigo Pro en Google Play

Lo que pide Google para publicar la app, qué ya está hecho y qué falta. Es
la misma app de App Store (`tienda/APP-STORE.md`): los textos, las páginas
legales y la demo del revisor se reutilizan.

## 1. Lo que ya está listo

| Requisito de Google | Dónde quedó |
|---|---|
| Nombre del paquete | `tech.vertigopro.app` (`app.json` › `android.package`). **No se puede cambiar después de la primera subida.** |
| Versión | 1.0.0; el código de versión lo lleva EAS solo (`appVersionSource: remote`, `autoIncrement`) |
| Ícono adaptable | `assets/android-icon-*.png` (fondo, figura y monocromo para Android 13+) |
| Permisos mínimos | `app.json` › `android.permissions` (cámara) y `blockedPermissions`: sin micrófono, sin almacenamiento, sin acceso a toda la galería, sin «mostrar sobre otras apps». Las fotos se eligen con el selector del sistema, que no pide permiso. |
| Servidor de producción en la compilación | `eas.json` › `production` (`https://savora.vertigopro.tech`) |
| Formato que pide Play | `production` compila **AAB** (por defecto en EAS) |
| Eliminar la cuenta (en la app y en la web) | Configuración › Mi cuenta › Eliminar mi cuenta · https://vertigopro.tech/eliminar-cuenta.html |
| Política de privacidad | https://vertigopro.tech/privacidad.html |
| Ícono de la tienda 512×512 | `tienda/play/icono-512.png` |
| Imagen destacada 1024×500 | `tienda/play/destacada-1024x500.png` |
| Capturas de teléfono 1080×1920 (9:16) | `tienda/play/01…05-telefono-1080x1920.png` (se regeneran con `python tienda/play/generar.py`) |

## 2. La cuenta es personal: prueba cerrada obligatoria

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

## 3. Crear la app en Play Console

Play Console › Crear aplicación:

- **Nombre**: `Vertigo Pro`
- **Idioma predeterminado**: Español (Latinoamérica) – es-419
- **App o juego**: App · **Gratis o de pago**: Gratis
- Aceptar las declaraciones (políticas y leyes de exportación de EE. UU.).

## 4. La ficha de la tienda (Crecimiento › Presencia en Play Store › Ficha principal)

- **Nombre** (30): `Vertigo Pro`
- **Descripción breve** (80):
  `Punto de venta, cocina, inventario y caja de tu local, desde el teléfono.`
- **Descripción completa** (4000): la misma de `APP-STORE.md` § 3.1.
- **Ícono**: `tienda/play/icono-512.png`
- **Imagen destacada**: `tienda/play/destacada-1024x500.png`
- **Capturas de teléfono**: `tienda/play/01` a `05`, en ese orden.
- **Categoría**: Empresa · **Etiquetas**: Punto de venta, Inventario, Restaurantes.
- **Datos de contacto**: correo de soporte, sitio https://vertigopro.tech

No hace falta subir capturas de tablet: si se dejan vacías, la app no se
anuncia para tablets en la tienda (se instala igual).

## 5. Contenido de la app (Política › Contenido de la app)

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

### 5.1 Seguridad de los datos

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

## 6. Compilar y subir

En la carpeta `movil/`, con acceso al proyecto de Expo:

```bash
npx eas-cli@latest build --platform android --profile production
```

La primera vez EAS pregunta si genera la **llave de firma de Android**: sí,
que la guarde EAS. Esa llave (y la de subida que registra Google) es la que
permite actualizar la app para siempre: no se borra el proyecto de Expo.

1. **Primera subida, a mano**: Play Console › Pruebas › Prueba interna ›
   Crear versión › subir el `.aab` que dio EAS. (Google no deja que la
   primera la suba una herramienta.) Probarla en un Android propio.
2. **Prueba cerrada**: Pruebas › Prueba cerrada › crear pista, agregar la
   lista de correos de los 12 probadores, subir la misma versión (o
   promoverla), enviar a revisión. Mandarles el enlace de la prueba.
3. **A los 14 días**: Solicitar acceso a producción.

### 6.1 Que las siguientes versiones se suban solas

1. Google Cloud (el mismo proyecto o uno nuevo) › IAM › Cuentas de servicio ›
   crear `play-publicar`, y una **clave JSON**.
2. Play Console › Usuarios y permisos › Invitar usuario › el correo de esa
   cuenta de servicio, con permiso para **lanzar versiones** en esta app.
3. Guardar la clave como `tienda/play/play-cuenta-servicio.json`
   (está en `.gitignore`; **nunca** a git) o subirla a EAS
   (`npx eas-cli@latest credentials` › Android › Google Service Account).
4. Desde entonces:

```bash
npx eas-cli@latest submit --platform android --latest
```

Va a la pista de **prueba interna como borrador** (`eas.json` › `submit.production.android`); desde Play Console se promueve.

## 7. Antes de mandar a revisión

- [ ] Instalar la versión de prueba interna en un Android y probar contra
      producción: entrar, vender, cocina, foto de factura (permiso de
      cámara), elegir foto de la galería (no debe pedir permiso), eliminar
      cuenta con un usuario de prueba.
- [ ] Confirmar en Play Console › Contenido de la app › Permisos que no
      aparezcan micrófono ni almacenamiento.
- [ ] Revisar que la demo siga viva: `https://demo.vertigopro.tech/api/health`.
