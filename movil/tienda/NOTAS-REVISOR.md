# Notas para el revisor de Apple (App Review Information → Notes)

Copiar tal cual en App Store Connect. Antes de pegar, cambiar `<URL>` por el
enlace público del video y `<date>` por la fecha hasta la que la demo sigue
viva. Usuario y clave de `revision` van en los campos "Sign-in required"
(están en `REVISOR.local.txt`, nunca en estas notas).

```
1. SCREEN RECORDING
Recorded on a physical iPhone: <URL>. Shows the home screen, the AI assistant ("Pregúntame": asking a question about sales and getting an answer), the Reports screens and a custom report. The AI consent screen is shown the first time a user taps the assistant; the demo user already accepted it, so to see it again go to Configuración → Mi cuenta → "Retirar el permiso" and open Pregúntame again.

2. APP PURPOSE
Vertigo Pro is a B2B back-office app for food businesses and small retailers (point of sale, kitchen tickets, inventory, supplier purchases, cash closing, reports and an AI assistant that answers questions about the business's own numbers). It replaces paper tickets and spreadsheets; owners see sales and costs from the phone.

3. ACCESS INSTRUCTIONS & TEST CREDENTIALS
Each business runs its own server; the business owner creates accounts (there is no public sign-up). To review with demo data (a fictional shop, "La Despensa", no real people; sales are generated every day so "today" always has data):
1) On the sign-in screen tap "Otro negocio" (Other business).
2) Type demo.vertigopro.tech and tap "Usar este negocio".
3) Sign in with the demo credentials provided above (role: owner, full access).
Suggested path: Inicio → "Pregúntale a Vertigo" (ask e.g. "¿cuánto vendí hoy?") → Reportes → Inventario → Punto de venta (take an order and charge it) → Cocina (the order arrives) → Compras → Cargar factura → Foto o archivo (on the demo server the invoice reader returns sample data and nothing is sent to Google).
A second test user ("probador", cashier role) is available for account deletion: Configuración → Mi cuenta → Eliminar mi cuenta (asks for the password). If it has already been deleted, tell us and we will recreate it.
The demo account stays active through <date>. No remote feature flags gate any user-facing feature; the AI features are enabled per business by its own server configuration and are visible on the demo server.

4. EXTERNAL SERVICES
- Google Cloud (US): hosts the servers and the database.
- Anthropic (Claude): powers the in-app assistant ("Pregúntame", spoken reports and price suggestions). Only when the user sends a question, and only after an in-app consent screen that names Anthropic (shown before the first question; the permission can be withdrawn in Configuración → Mi cuenta). The request goes through our server and carries the question plus the business's own figures needed to answer it (sales, products, prices, inventory). Anthropic does not train on this data.
- Google Gemini (Generative Language API): reads a supplier invoice photo/PDF only when the user taps "Leer factura", after a separate in-app consent screen that names Google Gemini.
- Pabilo: verifies Venezuelan "pago móvil" bank payments by reference number (business-level integration configured by the owner).
No analytics, ads, tracking or payment SDKs. No in-app purchases; the service is contracted outside the app (B2B). Camera and photo access are only used to photograph supplier invoices when the user taps the button.

5. REGIONAL DIFFERENCES
The app works the same in every region. Currency features (bolívares, BCV exchange rate) are specific to Venezuelan businesses but available everywhere.

6. REGULATED INDUSTRY
Not applicable.
```

## App Privacy (cuestionario de privacidad)

"¿Recopilas datos?" → Sí. Nada se usa para rastrear. Todo vinculado al
usuario, uso "Funcionalidad de la app".

| Tipo de dato en Apple | Qué es en Vertigo Pro | ¿Compartido con terceros? |
|---|---|---|
| Información de contacto → Nombre | Nombre y apellido del usuario | No |
| Identificadores → ID de usuario | El usuario con que entra | No |
| Fotos o videos | Fotos de facturas de compra que sube | **Sí** (Google Gemini, solo al leer una factura) |
| Contenido del usuario → Otro contenido | Ventas, compras, inventario, precios y clientes a crédito del negocio; nombre y RIF del negocio; las preguntas que escribe al asistente | **Sí**: la pregunta y las cifras del negocio van a Anthropic (Claude) al usar el asistente; el nombre y RIF del negocio van a Google Gemini junto con la factura |

Rastreo: No. Publicidad: No.
