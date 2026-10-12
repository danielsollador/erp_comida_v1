# Vertigo Pro en la App Store

Todo lo que pide Apple para publicar la app, qué ya está hecho y qué falta.
Las claves de la cuenta de demostración están en `tienda/REVISOR.local.txt`
(no va a git).

## 1. Lo que ya está listo

| Requisito de Apple | Dónde quedó |
|---|---|
| Identificador de la app | `tech.vertigopro.app` (`app.json`) |
| Versión | 1.0.0; el número de compilación lo lleva EAS solo (`eas.json`, `autoIncrement`) |
| Ícono 1024×1024 sin transparencia | `assets/icon.png` (rombo de Vertigo Pro; provisional hasta el logo definitivo) |
| Pantalla de inicio clara y oscura | `expo-splash-screen` en `app.json` |
| Textos de permiso (cámara y fotos) | `expo-image-picker` en `app.json`; micrófono apagado |
| Cifrado de exportación | `ITSAppUsesNonExemptEncryption: false` (solo HTTPS) |
| Manifiesto de privacidad | `ios.privacyManifests` en `app.json`: razones de las API y datos recogidos, sin rastreo |
| Servidor de producción en la compilación | `eas.json` → `production` usa `https://savora.vertigopro.tech` |
| Eliminar la cuenta desde la app (guía 5.1.1(v)) | Configuración → Mi cuenta → Eliminar mi cuenta (también en la web) |
| Política de privacidad pública | https://vertigopro.tech/privacidad.html |
| Página de soporte pública | https://vertigopro.tech/soporte.html |
| Cómo eliminar la cuenta (página) | https://vertigopro.tech/eliminar-cuenta.html |
| Cuenta de prueba para el revisor | Servidor de demostración `demo.vertigopro.tech`: local ficticio "Café La Esquina", 45 días de ventas, compras y contabilidad inventadas |
| Entrar a otro negocio | Entrar → "Otro negocio" (así entra el revisor a la demo, y sirve para varios locales) |
| Capturas de iPhone 6,9" (1290×2796) | `tienda/capturas/01…05-iphone-6.9.png` |

El nombre de la empresa y el correo de las páginas legales se cambian en
un solo archivo de la web: `frontend/public/legal-datos.js` (repo
`erp_rediseno`). Hoy dicen "Vertigo Pro" y `leideriverson@gmail.com`.

La app es solo para iPhone en esta primera versión (`supportsTablet: false`):
así no hacen falta capturas de iPad ni que Apple revise el diseño de tablet.
En el iPad abre en modo iPhone. La tablet del mostrador sigue siendo Android.

## 2. Lo que tienes que hacer tú (cuentas y pagos)

1. **Cuenta de desarrollador de Apple** (US$99 al año) en
   developer.apple.com/programs/enroll.
   - Como **organización** (sale "Vertigo Pro" como vendedor): hace falta
     el número **D-U-N-S** de la empresa (gratis, se pide en Dun & Bradstreet
     y tarda de días a dos semanas), un sitio web de la empresa y que quien
     la registra pueda firmar por ella.
   - Como **persona natural**: más rápido, pero el vendedor que se ve en la
     tienda es tu nombre.
2. **Cuenta de Expo** (gratis) en expo.dev, mejor a nombre de la empresa.
   Desde esa cuenta se compila en la nube: no hace falta una Mac.
3. **Crear la app en App Store Connect** (appstoreconnect.apple.com →
   Apps → +):
   - Plataforma iOS · Nombre: **Vertigo Pro** (si está tomado, ver 3.1)
   - Idioma principal: **Español (México)** · Identificador:
     `tech.vertigopro.app` · SKU: `vertigo-pro-ios`

### Compilar y subir (en la carpeta `movil/`)

```bash
npx eas-cli@latest login
```

```bash
npx eas-cli@latest init
```

`init` escribe el `projectId` en `app.json`: guárdalo en git.

```bash
npx eas-cli@latest build --platform ios --profile production
```

La primera vez pide entrar con tu cuenta de Apple: EAS crea solo los
certificados y el perfil de distribución. Tú escribes tu clave en la
terminal.

```bash
npx eas-cli@latest submit --platform ios --latest
```

La compilación llega a **TestFlight** en unos 10 a 30 minutos. Instálala en
tu iPhone con la app TestFlight y pruébala contra producción antes de mandar
a revisión.

## 3. La ficha de la tienda (copiar y pegar)

### 3.1 Textos

- **Nombre** (30): `Vertigo Pro`
  - Si Apple dice que está tomado: `Vertigo Pro: tu local`
- **Subtítulo** (30): `Ventas, cocina e inventario`
- **Categoría principal**: Negocios · **Secundaria**: Comida y bebida
- **Palabras clave** (100):
  `punto de venta,restaurante,cafetería,inventario,caja,facturas,cocina,comandas,menú,recetas,bolívares`
- **Texto promocional** (170):
  `Vende, cobra y lleva el inventario de tu local desde el teléfono. Tómale foto a la factura de compra y se llena sola.`
- **Descripción**:

```
Vertigo Pro es el sistema de tu local de comida: punto de venta, cocina, inventario, compras, caja y reportes, en el teléfono y en la tablet del mostrador.

VENDE
• Toma la comanda y cobra en bolívares, dólares o euros, con pago mixto y vuelto.
• La cocina recibe cada comanda al instante.
• Lleva lo que te deben los clientes a crédito.

COMPRA SIN TECLEAR
• Tómale foto a la factura del proveedor: se llena sola y tú la revisas.
• O anótala a mano, renglón por renglón.
• Avisos cuando un proveedor te sube el costo.

TU INVENTARIO, CLARO
• Materia prima, preparaciones y reventa, cada uno en su lugar.
• Recetas con su costo, conteos y control de mermas.
• Qué comprar antes de que se acabe.

TUS NÚMEROS
• Cuánto vendiste y cuánto te quedó, contra el periodo anterior.
• Qué día y a qué hora vendes más, y cuánto deja cada producto.
• Cierre de caja diario, cuadrado por forma de pago.

Hecho para Venezuela: tasa del BCV del día y montos en bolívares, dólares o euros.

Vertigo Pro es para negocios: el dueño del local crea el usuario de cada persona del equipo. Para conocerlo, escríbenos.
```

- **URL de soporte**: https://vertigopro.tech/soporte.html
- **URL de la política de privacidad**: https://vertigopro.tech/privacidad.html
- **Copyright**: `2026 Vertigo Pro`
- **Precio**: Gratis (el servicio se contrata fuera de la app; la app no
  vende nada ni enlaza a pagos, guía 3.1.3).
- **Disponibilidad**: Venezuela y los países que quieras.

### 3.2 Capturas

En App Store Connect → la versión → "iPhone 6,9 pulgadas": sube
`tienda/capturas/01` a `05` en ese orden. Apple usa las mismas para las
pantallas más chicas.

### 3.3 Clasificación por edad

Responde **Ninguno / No** a todo (violencia, apuestas, contenido médico,
navegador web abierto, etc.). Resultado: **4+**.

### 3.4 Privacidad de la app (App Privacy)

"¿Recopilas datos?" → **Sí**. Ninguno se usa para rastrear. Todos están
vinculados al usuario y su único uso es **Funcionalidad de la app**:

| Tipo de dato en Apple | Qué es en Vertigo Pro |
|---|---|
| Información de contacto → Nombre | Nombre y apellido del usuario |
| Identificadores → ID de usuario | El usuario con que entra |
| Fotos o videos | Fotos de facturas de compra que sube |
| Contenido del usuario → Otro contenido | Ventas, compras, inventario, clientes a crédito que registra el negocio |

Rastreo: **No**. Publicidad: **No**.

### 3.5 Revisión de la app (App Review Information)

- **Requiere inicio de sesión**: Sí. Usuario `revision` y la contraseña de
  `tienda/REVISOR.local.txt`.
- **Contacto**: tu nombre, teléfono y correo.
- **Notas** (en inglés, que es lo que lee el revisor):

```
Vertigo Pro is a business app (point of sale, kitchen, inventory, purchases and reports) for restaurants and cafés. Each business has its own server; accounts are created by the business owner.

To review with demo data (a fictional café, no real customers):
1. On the sign-in screen tap "Otro negocio" (Other business).
2. Type: demo.vertigopro.tech and tap "Usar este negocio".
3. Sign in with the username and password provided above.

Suggested path: Punto de venta (take an order and charge it), Cocina (the order arrives), Compras → Cargar factura → Foto o archivo (on the demo server the photo is filled with sample data), Reportes.

Account deletion: Configuración → Mi cuenta → Eliminar mi cuenta (asks for the password). Please use a separate test user if you try it, or tell us and we will recreate the demo user.

The app does not sell anything; the service is contracted outside the app (B2B). Camera and photo access are only used to photograph supplier invoices when the user taps the button.
```

## 4. Antes de mandar a revisión

- [ ] Probar la compilación de TestFlight en tu iPhone contra producción
      (entrar, vender, cocina, foto de factura, eliminar cuenta con un
      usuario de prueba).
- [ ] Revisar que la demo siga viva: `https://demo.vertigopro.tech/api/health`.
- [ ] Revisar `legal-datos.js` (empresa y correo definitivos).
- [ ] Si la cuenta de Apple sale a nombre de otra empresa, ponerla también
      en `legal-datos.js` y en el copyright.

## 5. Después

- Cada cambio de pantallas que deba llegar a la tienda: subir `version` en
  `app.json`, compilar y mandar de nuevo. Los cambios solo de código JS
  pueden llegar sin revisión con `eas update` (se configura aparte).
- Google Play: la misma app sirve (`android.package` ya está). Hace falta
  la cuenta de Google Play Console (US$25 una vez) y capturas de Android.
- Logo definitivo: reemplazar `assets/icon.png`, `assets/splash-icon.png`
  y los `android-icon-*.png` con los mismos tamaños.

## 6. El servidor de demostración

- VPS de Hostinger (2.25.223.224), carpeta `/docker/demo`, junto al de
  prueba. Dominio `demo.vertigopro.tech` en Cloud DNS.
- Lector de facturas en modo "prueba" (no gasta IA) y sin Pabilo.
- Para volver a llenarlo desde cero: borrar el volumen `demo_pg`, levantar,
  copiar `demo_data.py` al contenedor y correrlo (ver el encabezado del
  `docker-compose.yml` de la demo), y recrear los usuarios.
