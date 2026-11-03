# Plan de implementación

Qué se construye en cada fase y cómo se hace la fase en curso. El estado de cada tarea está en `tareas.md`; el detalle de un requisito, en su spec.

## Módulos

- **Aplicativo:** Hub principal, Compras, Inventario, Menú, Ventas, Cierre de caja, Reportes, Contabilidad, Impuestos, Tasa de cambio, Configuración y Pagos.
- **Sistema interno:** cuentas de los clientes, empresas que gestionamos, lo que cada cliente le paga a Vertigo y lo que Vertigo paga para mantener la plataforma.

## FASE 0 · Base operativa

Ya funciona en producción: es contrato y no cambia sin decirlo aquí.

- Transversal, aplica a todos los modulos:
    - Login con sesion firmada. Roles de fabrica (admin Vertigo, dueno, caja, cocina) y roles a medida definidos como lista de modulos; un modulo nuevo queda cerrado hasta asignarlo a un rol.
    - Multi-local: un esquema PostgreSQL por local y marca (logo, favicon) por local en `locales/<local>.json`.
    - Multimoneda: bolivares y divisas como cajas separadas; la tasa, el precio y el costo se congelan en cada operacion.
    - Toda columna y tarjeta de cifras explica que es, de donde sale, como se calcula y para que sirve (`lib/glosario.ts`; `npm run glosario` falla si falta una).
    - Tablas ordenables por cualquier columna, que se convierten en fichas cuando no caben.
    - Dialogos y modales propios (`useDialogo`, `Modal`), nunca ventanas del navegador.
    - Modo claro y oscuro, paleta por significado (acento, exito, aviso, peligro).
    - Lenguaje sencillo o tecnico a eleccion del usuario.
    - Misiones de arranque y guias paso a paso sobre la pantalla.
    - Avisos push al telefono: caja sin cerrar y autorizaciones.
    - El punto de venta abre sin conexion y la comanda es idempotente (no se duplica al reintentar).
- Hub principal:
    - Portada con las cifras del dia y avisos (IVA del mes, caja sin cerrar, stock bajo).
    - Mosaico de modulos segun el rol, que llena tablet, telefono y PC.
    - Puerta "Contador": contabilidad, impuestos y tasa se arman solos y se consultan aqui.
- Ventas (punto de venta, cocina e historial):
    - Tomar pedido en tablet, telefono y app iPhone, con variantes, combos y venta libre.
    - Cobro con pago mixto, vuelto entre gavetas, propina, descuento y fiado con abonos parciales.
    - Pago movil verificado con el banco (Pabilo) antes de cobrar.
    - Editar un pedido sin cobrar; lo agregado viaja aparte a cocina.
    - Sin caja abierta no se toman pedidos, y se dice por que.
    - "Lo viene a buscar" y "Entregados hoy".
    - Ticket imprimible desde el navegador.
    - Pantalla de cocina en vivo (WebSocket).
    - Historial, resumen y perdidas; devolucion con contra-asiento.
- Compras:
    - Cargar factura por foto o archivo (lectura automatica) o a mano; cada renglon dice que es (mercancia, flete, servicio, equipo).
    - Compra suelta por paquete o unidades, con aviso de precio absurdo antes de guardar, y anulable.
    - Alertas de compra cara medidas sobre el margen sin IVA.
    - Proveedores y notas de credito.
- Inventario:
    - Cuatro almacenes (materia prima, reventa, consumibles, desechables) y categorias.
    - Ficha de mercancia: suelta o en empaque, costo, nivel de reposicion, historial de costos y perdidas.
    - Movimientos de compra, merma, consumo del personal y conteo, cada uno con su asiento.
    - Conteo fisico en lote (todo o nada), que acepta preparado y otra unidad.
    - "Que comprar" y avisos de "se acaba X el jueves".
    - Stock en negativo y "vender sin stock" con confirmacion.
- Menu (menu, recetas y preparaciones):
    - Menu con variantes, combos y "fuera del menu"; sin precio no se vende.
    - Receta por 1 kg con su costo, margen real y precio sugerido.
    - Preparaciones (olla) con rendimiento real, merma del crudo y crudo compartido repartido.
    - Historial de recetas.
- Cierre de caja:
    - Una caja por dia con dos gavetas (bolivares y divisas) y monto declarado al abrir.
    - Cierre solo con lo del dia, diferencias de las dos gavetas a libros y cierre reversible.
    - Gastos, retiros e historial de cierres.
- Reportes:
    - Resumen, ventas, perdidas, inventario y reporte a medida, con filtros de seleccion multiple.
    - Mart diario: los dias cerrados se consolidan de noche y solo hoy se calcula en vivo.
- Contabilidad:
    - Asientos automaticos en partida doble desde cada operacion, plan de cuentas y asientos manuales.
    - Balance de comprobacion, estado de resultados por mes y balance general.
    - Equipos (activos fijos) con depreciacion mensual.
    - Cierre de ejercicio; un ejercicio cerrado no se puede modificar.
    - Respaldos automaticos cada 6 horas y restauracion.
- Impuestos:
    - Libro de ventas y libro de compras (SENIAT).
    - Retenciones de IVA y declaraciones con arrastre de excedente.
- Tasa de cambio:
    - BCV, euro y Binance al dia de forma automatica; cada operacion guarda la tasa de su fecha valor.
    - Calculadora, analisis e historial.
- Configuracion:
    - Mi cuenta, lenguaje, apariencia, usuarios, roles y pago movil.
- Sistema interno (vertigopro.tech):
    - Cartera de locales con salud en vivo y administracion de cuentas.
    - Sitio publico con presentacion y formulario de demo.

## FASE 1 · Cerrar lo abierto y blindar

Orden: 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7 → 1.8 → 1.9. Los errores QA van antes de lo nuevo porque son errores de dinero en producción. Dos tablets va antes de sin conexión porque la cola manda comandas en ráfaga y, sin numeración con bloqueo, se repiten números.

### 1.0 a 1.2 · Una sola rama viva

**Qué:** todo el trabajo suelto integrado en `master`, incluida la app móvil (`movil/`) y los gastos de Vertigo:

- Lista de gastos de la plataforma con proveedor, categoria, monto, moneda, frecuencia (mensual, trimestral, semestral, anual, unico o por consumo) y estado (activo, por contratar, por cancelar o cancelado).
- Cada gasto guarda sus pagos, y se filtra por pagado o por pagar este mes y por categoria.
- Los totales van por moneda y no se convierten: la tasa es de cada local, no del hub.
- Solo lo ve el equipo de Vertigo.

**Cómo:** Leider valida en local; con las pruebas de GitHub en verde, `fase1` se fusiona en `master` y se borran `app-expo` y `app-expo-play`.

### 1.3 · Errores de la auditoría QA (Opus)

**Qué:** cada error que demuestran las pruebas de auditoría (dinero, permisos y operación) se corrige, y su prueba queda en la suite.

**Cómo:** correr las 58 pruebas de la rama `qa-auditoria-pruebas` contra `fase1`. Las que fallan van a `specs/qa.md` con su riesgo; Leider aprueba el orden (primero dinero y permisos) y cada prueba arreglada entra a la suite.

### 1.4 · Dos tablets cobrando a la vez (Opus) · D10

**Qué:** ver `specs/ventas.md`.

**Cómo:**
- Numeración: fila contador por día con `SELECT … FOR UPDATE`, restricción única (día, número) y reintento si choca.
- Mismo bloqueo en el cobro (hoy se comprueba `pagado` sin bloqueo), el descuento de inventario y los abonos de fiado.
- Caja por tablet según D10: la caja como entidad; apertura, cobros, gastos, retiros y cierre con su caja. Las cuentas 1010 y 1011 no cambian.
- CI con un servicio `postgres:16` y `tests/test_concurrencia_pg.py` (se salta en SQLite).

### 1.5 · Vender sin conexión (Opus)

**Qué:** ver `specs/ventas.md`.

**Cómo:**
- Frontend: cola de operaciones en IndexedDB (`lib/colaComandas.ts`) con su clave de idempotencia, y caché del menú, tasa, caja y clientes de fiado. Sincroniza al volver la conexión y cada 30 s, en orden.
- Backend: crear, editar, cobrar y abonar aceptan `tomado_en` y `tasa_bcv` con `sin_conexion=true`. Se rechaza lo que tenga más de 72 h, caiga en un periodo cerrado o traiga una tasa distinta de la histórica (±0,5 %). Todo se fecha con `tomado_en` y se invalida ese día del mart.
- Tests en `tests/test_venta_sin_conexion.py`.

### 1.6 · Caja pasada la medianoche (Opus) · D1

**Qué:**

- Definir a que dia pertenecen las ventas hechas despues de medianoche con la caja del dia anterior abierta.
- El cierre, los reportes por dia, la numeracion de comandas y el periodo de IVA deben dar lo mismo en ese caso.

**Cómo:** `timeutils.dia_operativo()` con hora de corte por local. Cada llamada a `hoy()` e `inicio_del_dia()` se clasifica como operativa o fiscal; se cambian las operativas y sube `consolidacion.VERSION`. Spec en `specs/caja.md`.

### 1.7 · Respaldo fuera del servidor (Sonnet) · D11

**Qué:**

- Copia automatica de los respaldos a un bucket de Google Cloud cada hora.
- Aviso en el sistema interno si el ultimo respaldo externo tiene mas de 24 horas.
- Restauracion probada desde la copia externa.

**Cómo:** el temporizador del bucket escribe `ultimo_espejo.json`; `/salud` lo expone y el hub avisa. Procedimiento y script para restaurar en un esquema de prueba y comparar conteos.

### 1.8 · Apps iPhone y Android (Sonnet)

**Qué:**

- Portada, punto de venta, avisos push y eliminar cuenta.
- Publicadas en App Store y Google Play, y APK para las tablets sin Play Store.

**Cómo:** builds de producción con EAS para las dos tiendas y APK `publico` para las tablets Fire. Cuando las tablets usen la APK de Expo, se borran Capacitor y `app-android.yml` (con el visto bueno de Leider).

### 1.9 · Cierre de la FASE 1

Despliegue según `CLAUDE.md`, lo terminado pasa a la FASE 0 y se etiqueta `v1.1`.

## FASE 2 · El negocio en palabras (IA)

- Asistente "Preguntame":
    - Responde con las cifras del negocio y dice exactamente que periodo compara.
    - Se abre desde el mismo boton en todos los modulos.
- Reportes hablados (Reportes):
    - El usuario pide un reporte con sus palabras y recibe el reporte con sus filtros ya puestos.
- Buscar documentos hablando:
    - Facturas, ventas y gastos, con un boton "Abrir" que lleva al documento desplegado.
- Cambiar precios diciendolo (Menu):
    - Muestra los cambios antes de aplicarlos y solo se aplican al confirmar.
    - Cada cambio queda en el historial con quien lo pidio.
- Soporte con el manual de Vertigo:
    - Responde dudas de uso con el manual y lleva a la pantalla de la que se habla.
- Receta sugerida por el nombre del plato (Menu):
    - Propone ingredientes y cantidades por 1 kg con los insumos que ya existen en inventario.
    - El usuario la revisa y la edita antes de guardarla.
- Revision de recetas absurdas (Menu):
    - Avisa de cantidades, costos o margenes fuera de lo razonable y explica por que.
- Pedido escrito en el punto de venta (Ventas):
    - Escribir "2 empanadas de queso y un cafe" llena el carrito.
    - La cajera confirma antes de enviar a cocina.
- La IA actua, no solo consulta (todos los modulos):
    - Toda accion de la IA muestra lo que va a cambiar y solo se aplica al confirmar.
    - Solo puede hacer lo que el rol del usuario puede hacer, y queda en el historial con quien lo pidio.
- Reportes creados con IA (Reportes):
    - El reporte que arma la IA se guarda con un nombre y se vuelve a abrir desde Reportes.
- Editar pedidos hablando (Ventas):
    - "Agrega un cafe a la comanda 45" cambia el pedido al confirmar.
    - Solo pedidos sin cobrar; lo agregado viaja aparte a cocina.
- Tableros armados con IA (Reportes):
    - "Armame un tablero con las ventas por hora y lo mas vendido" crea un tablero con tarjetas y graficos.
    - El tablero se guarda, se edita y se abre desde Reportes, y cada cifra explica que es.
- Pedido por nota de voz (Ventas, en espera: no se construye hasta que Leider lo saque de espera).

## FASE 3 · Escalar el producto

- Alta de un local nuevo desde el sistema interno:
    - Formulario con nombre, logo, favicon, subdominio, zona horaria y tipo de negocio.
    - Crea el esquema PostgreSQL, la ficha de marca y la cuenta del dueno sin tocar codigo.
- Pagos de Vertigo (sistema interno):
    - Plan, fecha de cobro y estado de pago de cada cliente.
    - Aviso antes del vencimiento.
- Personalizacion por cliente (Configuracion):
    - Estilo visual, reglas de negocio y tono con el que el aplicativo se dirige al usuario.
- Modulo Pagos:
    - Por definir: cobros, cuentas por pagar o ambos.
- Vertigo Campus, atencion por WhatsApp.
- Cambio de turno (Cierre de caja):
    - El cambio de turno cierra la caja de quien sale y abre la de quien entra sin perder ventas.
    - Por definir: si se cuentan las gavetas en cada turno o solo al cierre del dia.

## FASE 4 · Mundo físico

- Impresion directa y gaveta que abre sola (Cierre de caja):
    - Comandera termica de red de 80 mm en cocina; ticket sin pasar por el dialogo del navegador.
- Lector de codigo de barras al recibir y al vender (Compras y Ventas).
- Balanza conectada al conteo (Inventario).
- Habladores impresos o electronicos que cambian solos con la tasa, y menu en pantalla del local (Menu).
- Canales del cliente final (Ventas):
    - QR en la mesa para que el cliente pida solo.
    - Kiosco de autoservicio.
    - Asistente de voz que toma el pedido.
    - Pantalla de pedido listo.
- Maquina fiscal conectada (Impuestos, en espera de la norma nueva).

## Decisiones pendientes

Bloquean su bloque hasta que Leider responda.

| ID | Pregunta | Propuesta | Bloquea |
|---|---|---|---|
| D1 | ¿De qué día es una venta hecha después de medianoche con la caja de ayer abierta? | Día operativo con hora de corte por local (05:00) para caja, reportes y numeración. IVA y libro de ventas, con la fecha real. Confirmar con el contador. | 1.6 |
| D10 | ¿Cada tablet tiene su caja o las dos cobran en la misma? | Una caja por tablet (ver `specs/ventas.md`). | 1.4 |
| D11 | ¿Cuánto tiempo se guardan los respaldos en el bucket? | 90 días. | 1.7 |
| D3 | Cambio de turno: ¿arqueo en cada turno o solo al cierre? | Arqueo por turno sin cerrar el día. | FASE 3 |
| D4 | Alta de local: ¿un backend por local o uno para todos? | Script de alta mientras haya menos de 5 locales. | FASE 3 |
| D5 | Pagos de Vertigo: ¿manual o pasarela? ¿Se bloquea al moroso? | Manual. Nunca se bloquea la venta. | FASE 3 |
| D6 | Módulo Pagos: ¿cobros, cuentas por pagar o ambos? | Cuentas por pagar. | FASE 3 |
| D7 | ¿Qué reglas de negocio puede cambiar el cliente? | Se propone al entrar a la FASE 3. | FASE 3 |
| D8 | ¿Qué impresora y gaveta se compran? | Térmica de red de 80 mm con ESC/POS. | FASE 4 |
| D9 | Vertigo Campus: ¿qué puede hacer en el ERP? | Solo crear pedidos "por confirmar". | FASE 3 |

## Optimizaciones propuestas

- Revisar recetas absurdas con reglas fijas, no con IA: más barato y comprobable (FASE 2).
- Alta de locales primero con un script y, con más de 5 locales, un solo backend (FASE 3).
