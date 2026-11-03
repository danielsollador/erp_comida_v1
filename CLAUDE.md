# ERP Fight Complexity, Impulsado con IA y 360: Vertigo Pro

Reglas del producto y de la metodologia para cualquiera que trabaje en este repo (personas o agentes).

## Rol del Agente
Arquitecto de desarrollo con 12 años de experiencia.

---

## Objetivo General:

Crear un ERP web/movil donde nuestros cientes:

- Tengan los modulos necesarios para poder operar su negocio.
- Poder entender perfectamente el flujo de tu negocio y ver por donde te sale y entra dinero.
- Ser escalable, poder replicar este aplicativo para uno negocio de una forma sencilla, intuitiva y rapida.
- Ser personalizable al 100% para los clientes, que puedan elegir su estilo, preferencias de negocio, reglas de negocio, hasta la forma en el que el aplicativo se va a dirigir a el.
- Ser figth complexity. Todos el aplicativo en general busca copiar la filosofia de NuBank en ser un aplicativo demasiado facil e intutivo de usar. Necesitamos que para nuestros clientes la informacion sea lo mas intutitva posible.
- Todas las funcionalidades deben ser totalmente funcionalidades.
- Priorizar buenas practicas y seguridad.
- Priorizar sencilles, que todo sea intutivo y facil de entender.
- Que todo este homologado, un boton de echar para atras no puede ser diferente en un modulo o en otro. O no se puede exportar una tabla si y otra no, tanto en estilo como en funcionalidades tenemos que mantener una estructura.
- No romper funcionalidades anteriores.
- Mantener consistencia visual en todo el aplicativo.
- Que todo el aplicativo sea 100% responsive.
- Priorizar UX.
- Priorizar reutilizacion de componentes

---

## Consideraciones generales:

- Vertigo Pro es el producto; Savora es su primer y unico cliente hoy. Nada propio de un cliente (nombre, color, logo, reglas) va fijo en el codigo compartido: va en `locales/<local>.json` o en su configuracion.
- Todo cambio se valida primero en local. Despues se sube su rama a GitHub (corren las pruebas), se fusiona en `master` y se despliega solo cuando Leider lo pida.
- Produccion tiene ventas reales: nada se despliega en horario de ventas ni sin Leider presente.
- El dinero manda: un cambio que toque cobros, caja, inventario, asientos o impuestos se explica antes de hacerlo y nunca cambia en silencio el resultado de operaciones pasadas.

---

## Arquitectura general:

### Aplicativo:

El aplicativo como tal tendra estos modulos:

- Hub Principal
- Compras
- Inventario
- Menu
- Ventas
- Cierre de caja
- Reportes
- Contabilidad
- Impuestos
- Tasa de cambio
- Configuracion
- Pagos

### Sistema interno:

En el sistema interno se podran administrar:

- Cuentas de todos los clientes
- Empresas que gestionamos
- Pagos (para la parte administrativa de vertigo como tal): lo que cada cliente le paga a Vertigo
- Gastos de Vertigo: lo que Vertigo paga para mantener la plataforma (servidores, dominio, IA, tiendas de apps)

---

## Funcionalidades de la aplicacion:

La FASE 0 es lo que ya funciona en produccion: es contrato, no se cambia su comportamiento sin decirlo en el plan de implementacion. Si un requisito necesita mas detalle del que cabe aqui, va en `specs/<modulo>.md`. El estado de cada cosa (hecha, en curso, pendiente) no va aqui: va en `tareas.md` y `project-map.md`.

### FASE 0 (base operativa):
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

### FASE 1 (cerrar lo abierto y blindar):
- Una sola rama viva:
    - Todo el trabajo suelto (ramas y carpetas de trabajo) integrado en `master`, incluida la app movil (`movil/`).
- Gastos de Vertigo (sistema interno):
    - Lista de gastos de la plataforma con proveedor, categoria, monto, moneda, frecuencia (mensual, trimestral, semestral, anual, unico o por consumo) y estado (activo, por contratar, por cancelar o cancelado).
    - Cada gasto guarda sus pagos, y se filtra por pagado o por pagar este mes y por categoria.
    - Los totales van por moneda y no se convierten: la tasa es de cada local, no del hub.
    - Solo lo ve el equipo de Vertigo.
- Errores de la auditoria QA (todos los modulos):
    - Cada error que demuestran las pruebas de auditoria (dinero, permisos y operacion) se corrige, y su prueba queda en la suite para que no vuelva.
- Dos tablets cobrando a la vez (Ventas y Cierre de caja):
    - No se duplican comandas, numeros ni cobros, y el stock se descuenta una sola vez.
    - El numero de comanda se asigna con bloqueo en la base de datos, nunca como "el ultimo mas uno".
    - Cada tablet cierra su propia caja.
    - Probado con dos tablets reales en el mismo local.
- Vender sin conexion (Ventas):
    - La comanda se guarda en la tablet (IndexedDB) y se envia sola cuando vuelve la conexion.
    - Cada comanda viaja con la tasa y la hora del momento en que se tomo; el servidor no las recalcula.
    - El numero de comanda lo asigna el servidor al sincronizar; mientras tanto la tablet la muestra como pendiente.
    - Reintentar es seguro: se usa la clave de idempotencia que ya existe.
    - Sin conexion se hace todo lo que no necesita al servidor en ese momento: tomar, editar y cobrar pedidos (efectivo, divisas, punto, pago mixto, vuelto, propina, descuento y fiado) e imprimir el ticket.
    - El pago movil se anota con su referencia y se verifica con el banco al volver la conexion; si no se confirma, queda para revisar y la caja no cierra hasta resolverlo.
    - Lo que necesita al servidor (abrir y cerrar caja, devoluciones, gastos y retiros) espera a la conexion y se dice por que.
    - Una barra visible dice cuantas comandas faltan por enviar.
    - Solo el punto de venta funciona sin conexion; reportes y contabilidad la piden.
- Caja abierta pasada la medianoche (Cierre de caja):
    - Definir a que dia pertenecen las ventas hechas despues de medianoche con la caja del dia anterior abierta.
    - El cierre, los reportes por dia, la numeracion de comandas y el periodo de IVA deben dar lo mismo en ese caso.
- Respaldo fuera del servidor (Contabilidad):
    - Copia automatica de los respaldos a un bucket de Google Cloud cada hora.
    - Aviso en el sistema interno si el ultimo respaldo externo tiene mas de 24 horas.
    - Restauracion probada desde la copia externa.
- Apps moviles iPhone y Android:
    - Portada, punto de venta, avisos push y eliminar cuenta.
    - Publicadas en App Store y Google Play, y APK para las tablets sin Play Store.

### FASE 2 (el negocio en palabras, IA):
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

### FASE 3 (escalar el producto):
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

### FASE 4 (mundo fisico):
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

## Stack de tecnologia:

- API REST y WebSocket (punto de venta y cocina en vivo)
- Backend: Python (FastAPI, SQLAlchemy) y PostgreSQL 16 con un esquema por local (SQLite solo en pruebas)
- Front web: React, Vite, TypeScript y Tailwind 4
- Movil: React Native (Expo)
- IA: Claude (asistente) y Gemini (lectura de facturas)
- Google Cloud Platform: una VM con docker compose (Traefik, PostgreSQL, backend y frontend por local, hub) y respaldos en un bucket

## Preferencias generales:

- El agente se comunica en espanol.

## Preferencias de diseño:
- Uso de buenas practicas de maquetacion de css
- Que la webapp sea responsive en todos los sentidos, tanto en la parte del aplicativo como el sistema interno
- Todas las funcionalidades, botones, tarjetas, textos. Deben ser facil de entender, y en caso de ser un calculo o algo que no es facil de entender a simple vista, el aplicativo debe ser capaz de explicarlo facilmente

## Preferencias de estilos

- La guia completa es la skill `estilo-vertigo`. Se carga siempre que se toque una pantalla, pagina o componente.
- Estilo "tipo Apple": claro, quieto y de calidad. Menos cosas, mejor puestas.
- Dos capas de marca: Vertigo (neutros papel y grafito, la V perla, Sora, Manrope y JetBrains Mono) y la del local, que solo cambia el acento, el logo y el nombre (Savora: cobre).
- Tres superficies con los mismos tonos: sitio publico (oscuro por defecto, puede ser expresivo, SEO completo), hub interno y ERP (quieto, tactil, modo ligero en tablet).
- Colores solo por significado (acento, exito, aviso, peligro) y siempre como tokens, nunca un hex suelto.
- Todo se prueba en claro y oscuro, en tablet y en telefono.

## Preferencias de codigo:

- Trata de ser lo mas modular posible
- La parte publica debe estar completamente optimizada para SEO (a nivel de codigo y buenas practicas)
- Usar siempre Let o Const, y no uses nunca Var.
- No uses alert, confirm o prompt, todo el feedback debe ser  visual en el dom
- Toda alerta o ventana modal que aparezca debe tener el mismo estilo que la web
- Cuidado con olvidar prevener el default en los eventos submit o click
- Prioriza que el codigo sea legible y mantenible
- Prioriza el codigo sea sencillo de entender
- No pongas en comentarios caracteres especiales como emojis, que dificulten la legibilidad del codigo
- Si el angente duda, que revise las especificaciones del proyecto y si no, que pregunte al usuarios

## Estructura del repo

Este repo es la unica fuente de verdad: codigo y metodologia viven juntos. La sesion del agente se abre siempre en su raiz, para que cargue este archivo, los comandos y la skill de estilo.

```
CLAUDE.md                que construir y como se trabaja (este archivo, el unico)
specs/                   detalle por modulo (specs/<modulo>.md, plantilla en specs/_plantilla.md)
plan-implementacion.md   como y en que orden
tareas.md                tareas y su estado
project-map.md           estado real del sistema
prompts.md               historial de prompts
Apuntes/                 apuntes de la metodologia y fixes.md
.claude/commands/        /nueva-funcionalidad, /implementar, /arreglar
.claude/skills/          estilo-vertigo (guia visual)
levantar-local.ps1       levanta todo en local
.dev-data/               datos de prueba locales (no se versiona)
backend/app/             FastAPI: routers/, acceso/, asistente/, models.py, migrations.py
backend/tests/           pruebas (pytest)
frontend/src/            ERP web: pages/, components/, lib/
frontend/public/         sitio publico (sitio/), hub (inicio.html), login y legales
movil/                   app Expo (iPhone y Android); comparte lib/ con la web
locales/                 marca de cada local (<local>.json)
gcp/, operaciones/       servidor, despliegue y procedimientos
ESTADO.md                historial de traspasos hasta el 19-sep (ya no se actualiza)
```

## Fases del desarollo:

- Estudia las caracteristicas del proyecto
- Sigue las fases del desarrollo (especificadas en la seccion de funcionalidades de este fichero CLAUDE.md) y para trabajar despues de casa fase para poder probar lo que has desarollado, corregir, mejorar algo y si es necesario poder continuar
- Si crees que se puede optimizar, indicamelo en el plan de implementacion.

## Modo Implementacion
- Solo codigo, minimos comentarios dentro del codigo: el codigo ya debe ser autoexplicativo.
- No expliques que hace el codigo en el chat del agente
- Responde en espanol si preguntas, pero en prompts usa Ingles / Espanol libremente.
- Si hay ambiguedad, asume la decision mas simple que no rompa algo, salvo las decisiones pendientes de la seccion 3 del plan de implementacion: esas siempre se preguntan.
- Las pruebas del agente son basicas: solo comprobar que compila (tipos y build). La suite completa la corre GitHub Actions al subir la rama, y la validacion de la funcionalidad la hace Leider.

## Otras consideraciones:

- Guarda el plan de implementacion en `plan-implementacion.md`, en la raiz del repo.
- Guarda las tareas y su estado en `tareas.md`, en la raiz del repo, y cada vez que se cumpla una, modificalo para actualizarlas.
- Guarda cada uno de los prompts nuevos en `prompts.md`, en la raiz del repo (todos ordenados uno detras de otro, con quien lo hizo y la fecha). Cada prompt aparte se guarda ahi.
- Guarda el estado real del sistema en `project-map.md`, en la raiz del repo, y actualizalo despues de cada cambio relevante. Si el codigo y el mapa no coinciden, manda el codigo y se corrige el mapa.
- El detalle de cada modulo va en `specs/<modulo>.md`. Se escribe antes de programar el bloque y Leider la aprueba.
- Los documentos de la metodologia se versionan con el codigo, en la rama de la fase en curso: al cerrar cada tarea se actualizan `tareas.md` y `project-map.md` en el mismo commit o en el siguiente.
- Para levantar el sistema en local se usa `levantar-local.ps1`: ERP en http://localhost:5181, sitio publico en http://localhost:5181/sitio/, hub en http://localhost:5182/inicio.html y app movil en el navegador en http://localhost:8081. La app movil en local siempre apunta al backend local; su `movil/.env` apunta a produccion y solo se usa para los builds de las tiendas.
- Comandos de la metodologia (`.claude/commands/`):
    - `/nueva-funcionalidad <idea>`: lleva una idea a este archivo, su spec, su bloque del plan y sus tareas. Para ahi, sin codigo.
    - `/implementar [fase o tarea]`: construye las tareas del plan en orden.
    - `/arreglar [lo que falla]`: arregla lo anotado en `Apuntes/fixes.md` y lo deja listo para validar en local.
- Jerarquia en caso de conflicto: 1. `CLAUDE.md` (que construir), 2. la spec del modulo (con que detalle), 3. `plan-implementacion.md` (como construirlo), 4. `project-map.md` (estado actual).
