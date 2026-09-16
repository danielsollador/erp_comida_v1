# Estado del proyecto

> Documento de traspaso. Si vas a retomar este proyecto, lee esto primero — sobre
> todo la sección de arriba, que es la que no se puede deducir leyendo el código.

---

## Respuesta al traspaso del 15-sep (Leider)

Daniel: la divergencia que viste **ya no existe**. El login, el modo oscuro y
todo lo que había en producción y no en el repo era trabajo mío en un clon
local **sin commitear**, porque el repo es tuyo y no quise pushear sin
acordarlo. Ese trabajo ya está integrado **encima de tus 13 commits** (los 36
hallazgos incluidos) y desplegado. Las 170 pruebas tuyas siguen en verde más
95 nuevas de acceso: **265**.

Lo que hay ahora, en un solo árbol:

| | Repo + producción |
|---|---|
| Los 36 hallazgos | ✅ |
| Bolívares/divisas, propinas, fiado, descuentos, venta libre | ✅ |
| Login con sesiones firmadas, cuatro roles, hub de administración | ✅ |
| Modo oscuro | ✅ |
| **PostgreSQL** (un esquema por local) en vez de SQLite | ✅ |
| Zona horaria del negocio | ✅ (ver abajo) |

Dónde vive cada cosa nueva:

- **Acceso**: `backend/app/acceso/` (sesión HMAC en cookie, `users.json` con
  PBKDF2, pases de un uso entre dominios, permisos por rol) y
  `routers/acceso.py`, `routers/usuarios.py`, `routers/agencia.py`. La puerta
  la cierra el middleware de `main.py` sobre **toda** ruta, y nginx
  (`frontend/nginx.conf.template`) valida la cookie con `auth_request` antes
  de servir un solo archivo: sin sesión solo sale `login.html`.
- **Roles**: `admin` = Vertigo (nosotros, todos los locales, hub), `dueno` =
  dueño del local (todo dentro del suyo, incluidas sus cuentas), `caja`,
  `cocina`. Tabla en `acceso/permisos.py`.
- **Tu trazabilidad se quedó, con un cambio**: el operador **es quien inició
  sesión** (`operadores.del_turno`). La fila de `operadores` se crea sola con
  el nombre de la cuenta y el `operador_id` que mande la tablet se ignora si
  hay sesión — si no, una cajera podría cargarle sus anulaciones a otra. Se
  quitó el selector "Turno de" del POS y "Quién atiende" de Sistema; las cajas
  físicas siguen. Adapté 6 pruebas de `test_trazabilidad.py` a eso (los
  mensajes dicen por qué).
- **Hub** `vertigopro.tech` (`frontend/public/inicio.html`): cartera de
  locales con salud en vivo y administración de cuentas. `savora.vertigopro.tech`
  es el ERP. Cómo se reparte quién va a dónde: `routers/acceso.py`, arriba.
- **Marca**: `locales/savora.json` declara logo y favicon
  (`frontend/public/logo-savora.png`, `favicon-savora*.png`).

### PostgreSQL

Producción corre sobre **PostgreSQL 16** (`db` en el compose), base `vertigo`,
**un esquema por local** (`savora`, `hub`). Cada backend lleva su
`search_path`; `create_all` y las migraciones trabajan dentro del esquema sin
que el resto del código lo sepa. Detalles y por qué esquema-por-local en
`DESPLIEGUE.md`.

- `migrations.py` traduce los tipos al dialecto (`DATETIME`→`TIMESTAMP`,
  `BOOLEAN DEFAULT 1`→`TRUE`) y relaja `NOT NULL` con `ALTER COLUMN` en
  PostgreSQL; tu reconstrucción de tabla sigue para SQLite.
- `backup.py`: `pg_dump -n <esquema>` con una ficha `.json` al lado (cuántos
  pedidos, hasta cuándo) porque un volcado no se puede leer sin restaurarlo.
  Restaurar renombra el esquema vivo a `_previo` y solo lo suelta si
  `pg_restore --single-transaction` terminó bien. Tu implementación SQLite
  sigue intacta para desarrollo sin Docker; las pruebas corren sobre SQLite en
  memoria como siempre.
- **Para el local que venía con `comida.db`**:
  `backend/scripts/migrar_sqlite_a_postgres.py` copia todo respetando el
  orden de las FKs y deja las secuencias en el siguiente id.
- El backend trae `postgresql-client-16` del repositorio oficial (pg_dump
  tiene que ser ≥ que el servidor).

### Zona horaria: resuelto, y vigilado

El compose pone `TZ=America/Caracas` en cada contenedor y la imagen trae
`tzdata`. Verificado en producción el 15-sep: host en UTC 00:25, dentro del
backend `datetime.now()` = 20:25 −04, PostgreSQL `SHOW timezone` =
`America/Caracas`. Además `main.py` escribe la zona horaria en el log de
arranque y **avisa con ERROR** si el proceso amanece en UTC con PostgreSQL
(`_avisar_zona_horaria`), para que no vuelva a ser una premisa silenciosa.

### Python

La imagen es **3.12**. Como tú desarrollas con 3.8, lo mío usa
`from __future__ import annotations` y `Optional`/`List` en lo que FastAPI y
pydantic evalúan en tiempo de ejecución. Si algo se te rompe por una
anotación, es un despiste mío: avísame.

### Auditoría contable del 15-sep (Leider)

Se revisó módulo por módulo cómo cada operación mueve los libros y se armó un
día completo del local en `tests/test_contabilidad_auditoria.py` (ventas de
todos los tipos, devolución, anulación, compras con y sin factura, gasto,
retiro, propinas, fiado, cierre con diferencias en las dos gavetas). Al final
el balance de comprobación, el balance general y el inventario contable vs.
físico tienen que cuadrar. Once fallas reales, todas con su prueba:

| Falla | Qué pasaba | Dónde |
|---|---|---|
| Devolver una venta **con propina** reventaba (500) | El asiento no cuadraba: la plata salía completa pero la propina no se revertía de 2040 | `contabilidad.registrar_devolucion` |
| Devolver una venta **con descuento** dejaba el descuento vivo | 4020 seguía diciendo que se regaló algo en una venta que no existió | ídem |
| Devolver un **fiado ya cobrado** dejaba 1015 en negativo | Se acreditaba la cuenta por cobrar en vez de sacar la plata de donde entró al cobrar | ídem + `_cuenta_del_cobro_fiado` |
| La **diferencia de divisas** del cierre no iba a libros | Se contaban las dos gavetas pero solo 1010 se conciliaba | `registrar_diferencia_caja` y su reverso |
| **Los dólares no podían pagar nada** | Gastos, retiros, facturas, IVA y compras sueltas solo aceptaban "Efectivo o Banco": 1011 solo crecía | `METODOS_DE_PAGO` / `cuenta_de_pago` y las validaciones de cada router |
| La **compra suelta** siempre salía de bolívares | Aunque se pagara por transferencia | `registrar_compra_insumo(metodo_pago)` |
| Borrar un gasto/retiro/factura/asiento manual de un **ejercicio cerrado** | Cambiaba en silencio un resultado ya llevado a Utilidades retenidas | `asegurar_ejercicio_abierto` → 409 |
| Asentar con **fecha de un año cerrado** | Una factura vieja o la depreciación atrasada reescribían el año cerrado | `fecha_contable`: cae al 1-ene del ejercicio abierto y la descripción dice de qué fecha era |
| Borrar la factura de un **activo** daba 500 | La FK de `activos_fijos.factura_id` lo impedía; y sin FK dejaba el equipo depreciándose contra nada | `eliminar_factura` borra el bien (o 409 si ya se depreció) |
| El **estado de resultados** no sabía de meses pasados | Reportes y libros fiscales ya aceptaban `anio`/`mes` | `estado_resultados(anio, mes)` |
| El **resumen de caja** contaba lo devuelto como venta | | `resumen_caja` |

Además: `sumas_de_cuenta` suma debe/haber **en la base** (antes cada pantalla
traía todos los movimientos a Python para sumarlos; con un año de ventas eso
eran decenas de miles de filas por cuenta en cada balance).

Lo que se revisó y **está bien**: partida doble en todos los asientos; venta
bruta + descuento aparte con IVA sobre lo cobrado; propina como pasivo;
costo de ventas congelado por ítem con rendimiento; pago mixto y vuelto entre
gavetas; anulación preparada → merma; reversas con contra-asiento (cierre,
sobrante, activo, declaración); crédito fiscal neto de notas de crédito;
arrastre de excedente de IVA; cierre de ejercicio contra 3020; depreciación
mensual idempotente. Pendiente (no es error): cobro **parcial** de fiado.

### Sistema de diseño (15-sep, noche)

El frontend tiene ahora un sistema de diseño propio en vez de la paleta por
defecto de Tailwind: papel y grafito cálidos, acento índigo "vertigo", Sora
para títulos / Manrope para texto / JetBrains Mono para cifras, y una barra
lateral de módulos (`components/Rail.tsx`, `Icono.tsx`, `ui.tsx`).

Dos cosas que conviene saber antes de tocar el CSS:

1. **Todo pasa por las variables de Tailwind** (`@theme` en `index.css`). Las
   pantallas siguen escritas con `bg-white`, `border-neutral-200`, etc.;
   Tailwind 4 las compila a `var(--color-*)` y redefinir esas variables
   cambia el ERP entero sin tocar una pantalla. La cocina lleva
   `.tema-original` en su raíz para conservar la escala original: se diseñó
   negra a propósito y no debe invertirse.

2. **Hay una capa de homologación al final de `index.css`, fuera de `@layer`.**
   Las trece pantallas se escribieron sueltas y cada una eligió sus formas
   (tarjetas con `shadow` en unas y `border` en otras, campos en tres radios,
   botones en cuatro). Esa capa les pone una sola forma apoyándose en las
   clases que ya tienen. Va sin capa porque en Tailwind 4 las utilidades
   ganan a `base` y `components` por orden de capa, sin importar la
   especificidad; el CSS sin capa gana a todas. Se limita con `:where()` para
   que lo que una pantalla pidió explícitamente (un `rounded-full`, un
   `text-lg`) siga mandando.

**El cambio de tema usa View Transitions** (`lib/tema.tsx`), no `transition`
por nodo: con `html.animando *` el navegador repintaba los ~1.600 elementos
del POS en cada fotograma y el cambio se veía a tirones. Ahora el compositor
funde dos fotos y revela la nueva en círculo desde el botón. `flushSync` es
obligatorio ahí: `startViewTransition` toma la foto del "después" cuando su
callback retorna, y React agruparía el `setState` para más tarde.

Lo nuevo se escribe con las piezas de `components/ui.tsx` (Tarjeta, Sección,
Botón, Campo, Cifra, Pastilla, Vacío, Aviso) para no volver a desviarse.

**La cocina ya no tiene paleta propia.** Antes fijaba la escala de grises por
defecto de Tailwind (clase `tema-original`), que era justo lo que la sacaba de
la familia. Ahora lleva `.tema-cocina`, que comparte bloque con
`html[data-tema="oscuro"]`: sigue siendo oscura siempre —esa decisión no
cambia, es menos brillo detrás del fogón— pero con la paleta oscura del
sistema, así que la pantalla se escribe con las mismas clases que las demás
(`bg-white` es superficie, `border-neutral-200` es borde) y su `NavBar` ya no
necesita el modo `dark`.

**Volver al inicio:** el botón de la flecha está ahora en el encabezado de
todos los módulos, no solo en móvil. En escritorio la barra lateral ya lleva
al inicio, pero el rombo no se lee como "volver"; quien entra a un módulo
busca la flecha arriba a la izquierda. La miga (`Sávora / Módulo`) también
enlaza al inicio.

**Responsive, verificado midiendo** `scrollWidth` contra `innerWidth` en cada
ruta a 375, 768 y 1280 px (ninguna desborda). Lo que hubo que arreglar:
tablas sin contenedor de scroll en cuatro pantallas —resuelto con
`:has(> table)` en el CSS, que le da el scroll al contenedor sea cual sea, en
vez de envolver cada tabla a mano—, dos rejillas de tres columnas fijas y
ocho filas de formulario que no envolvían (`flex-wrap`). En un teléfono, el
formulario de gasto de Caja dejaba dos de sus cinco controles fuera de la
pantalla.

**Los modales, y un `transform` que rompía todo lo `fixed`.** Buscando el
"no hay botón para volver" apareció el caso de verdad. Los cinco modales del
ERP se habían escrito sueltos y el peor era el de cobro del POS: `w-80` fijo,
sin `max-height` ni scroll, y la única salida era un "Cancelar" gris al final.
Con factura + descuento + propina + vuelto + pago mixto el contenido crecía
más que la pantalla del teléfono y los botones quedaban fuera, sin manera de
llegar a ellos: quedarse encerrado en una ventana es la peor versión de "no
hay botón para volver atrás".

Ahora hay un solo `Modal` en `components/ui.tsx` y los cinco lo usan (cobro
del POS, receta, impacto de compra, historial de costo, restaurar respaldo).
Garantiza siempre lo mismo: X de 40 px arriba a la derecha, cuerpo con scroll
propio y tope de altura, hoja desde abajo en el teléfono y centrado en
escritorio, cierre con Escape y tocando fuera, y el fondo no se desplaza
mientras está abierto.

Debajo había algo peor. La animación de entrada de cada pantalla
(`.min-h-screen { animation: vp-entrar … both }`) dejaba el `transform` de los
fotogramas puesto para siempre, y un elemento con `transform` pasa a ser el
bloque contenedor de todo `position: fixed` que lleve dentro. Es decir: los
modales y el aviso de "Cobrado #N" se posicionaban contra la página y no
contra la pantalla. Medido en un teléfono de 375 px, el diálogo de cobro caía
145 px por debajo del borde inferior. Se arregló en la raíz —fotograma final
explícito y relleno `backwards`— y además el `Modal` se monta en el `body` con
un portal, para que no vuelva a depender de lo que tenga encima.

Verificado midiendo en los cinco modales a 375, 768 y 1280 px: ninguno se sale
de la pantalla, el botón de cerrar siempre visible con área táctil de 40x40,
el cuerpo desplaza cuando el contenido no cabe, el pie con las acciones
siempre a la vista, y ningún control queda fuera en el caso peor.

**Que una tablet use la tablet, y dos reglas nuevas para las tablas.** En una
tablet el ERP dejaba un hueco en blanco del alto de media pantalla y, al mismo
tiempo, la tabla de inventario se cortaba por la derecha: la columna de
acciones quedaba a medias. Las dos cosas salían de lo mismo — cada pantalla
traía su propio tope de ancho a mano (`max-w-2xl`, `3xl`, `4xl`) y ese tope
estrujaba la tabla mientras sobraba pantalla a los lados.

Ahora el ancho lo decide el contenido y no el archivo: `Pagina` con tres
anchos (`ancha` para tablas y tableros, `media` para formulario más listado,
`angosta` para un formulario solo). Inicio reparte a lo alto lo que sobra, así
que en 1024×768 llena la pantalla justo, sin scroll y sin hueco.

Las dos reglas que pediste, aplicadas a las quince tablas:

1. **Toda columna se ordena con un clic.** `useOrden` + `Th` en
   `components/Tabla.tsx`. Primer clic ascendente, segundo descendente, con la
   flecha marcando cuál manda y `aria-sort` para el lector de pantalla. Lo
   vacío siempre al final: una fila sin dato no es la menor, es la que no
   tiene dato. Comparación con locale `es`, así la ñ va después de la n y la
   factura 9 antes que la 10.
2. **La tabla se ve completa.** No hay punto de quiebre fijo: `Tabla` compara
   lo que la tabla necesita con el espacio que hay y, si no da, cada fila pasa
   a ser una ficha con sus rótulos — en rejilla de dos columnas si cabe, que
   es lo que pasa en la tablet. Así cada tabla decide sola: la de cuatro
   columnas sigue siendo rejilla donde la de ocho ya se apiló, y agregar una
   columna mañana no obliga a revisar ningún breakpoint. En modo ficha no hay
   encabezados que tocar, así que aparece una barra "Ordenar por" con la misma
   lista de columnas.

Dos cosas que salieron en el camino y eran errores de verdad: el segundo clic
en una columna no invertía el orden (se llamaba a un `setState` dentro del
actualizador de otro, y React corre esos actualizadores dos veces en
desarrollo), y en el historial de costos el porcentaje de cambio se calculaba
contra la fila de al lado en la pantalla — correcto solo mientras la tabla
estuviera en orden de fecha, e inventado en cuanto se pudiera ordenar por otra
cosa. Ahora el cambio se calcula contra la compra anterior en el tiempo y
viaja con la fila.

Verificado midiendo en 375, 768, 1024 y 1440: ninguna ruta desborda, ninguna
tabla queda cortada, y ordenar por cualquier columna funciona en los dos
sentidos.

### Paleta central, logo del local y tablet de verdad (16-sep, tarde)

Leider miró el sistema en una tablet y mandó capturas: el inicio con media
pantalla en blanco y estrecho, reportes igual, la cocina en oscuro con todo lo
demás en claro, colores sueltos por módulo y el nombre "SÁVORA" escrito donde
debería ir el logo. Las capturas eran de **producción, que todavía no se ha
redesplegado** (el ancho por contenido de arriba ya lo arreglaba), pero en
vertical el diseño anterior llenaba la pantalla con cajas vacías y letra
chica, así que el inicio se rediseñó de todas formas.

**Una paleta, cinco familias.** `index.css` genera `acento` (cobre, matiz 42,
sacado del logo), `exito` (152), `aviso` (72) y `peligro` (24) de **una sola
tabla** de luminosidad y croma en `oklch`, en claro y en oscuro; los neutros de
papel y tinta son la quinta. Las quince pantallas ya no usan ningún color de
Tailwind por su nombre (`emerald`, `amber`, `red`, `blue`, `sky`, `indigo`,
`violet`, `orange`, `rose`, `green`: cero ocurrencias). El renombre fue
mecánico y con criterio: verde → `exito`, ámbar y naranja → `aviso`, rojo →
`peligro`, los azules e índigos de cajas informativas → tinte de `acento`, el
`text-blue-600` de los enlaces "Descargar / Ver detalle" → `text-acento-600`,
y el único botón azul (Cerrar caja) → tinta como todos los primarios. El POS
toma los tintes de categoría de la misma paleta (`lib/theme.ts`: cinco, no un
arcoíris). `login.html` lleva el mismo cobre. **Regla para lo que venga:**
un color nuevo se llama por lo que significa (`bg-aviso-50`), nunca por su
matiz; si hace falta otro significado, se agrega una familia en `index.css`
con la misma tabla.

**Cocina.** Iba oscura siempre (clase `tema-cocina`). Era la única pantalla
que no obedecía al interruptor y de día, con el local iluminado, parecía de
otro aplicativo. Ahora sigue el tema como las demás; quien la quiera oscura
pone el modo oscuro, que se recuerda.

**El logo.** El backend ya modelaba la marca por local (`locales/savora.json`
→ `local.logo` = `/logo-savora.png`, que nginx sirve sin sesión y que
`login.html` ya mostraba). El componente `components/Marca.tsx` lo pinta en
la cabecera del inicio y en la miga de cada módulo, con el mismo filtro de
brillo que el login en modo oscuro; sin logo en la ficha, vuelve el rombo con
el nombre. El `SAVORA.jpg` que Leider dejó en el escritorio tiene **menos
resolución** que el PNG que ya estaba en `frontend/public` (458 px de logo
útil contra 504), así que se quedó el PNG. Cuando llegue el segundo local, su
logo es una línea en su JSON.

**El inicio llena la tablet, en las dos orientaciones.** La tipografía y las
cifras crecen con el ancho (`clamp`), las tres fichas de operación miden una
fracción del alto (24 %, con tope) y el mosaico de administración se queda
con **todo el alto que sobre**. El mosaico (`.vp-mosaico`) es `flex-wrap` con
`align-content: stretch`, no `grid`: elige como columnas un **divisor exacto**
del número de módulos que ve ese rol (diez → cinco, seis → tres) para no
dejar celdas vacías, y si no hay divisor las últimas fichas se ensanchan. Dos
variantes propias de Tailwind decididas por el **alto** de la pantalla, que
es lo que ningún `sm:/lg:` mira: `alto:` (≥ 1100 px, tablet vertical: fichas
en columna con una línea de descripción, porque una sola palabra en una ficha
de 280 px de alto se ve vacía) y `bajo:` (≤ 850 px y ≥ 640 de ancho: fichas
en fila y rellenos menores, para que 1024×768 quepa sin desplazar). Medido
`scrollHeight == innerHeight` en 1032×1376, 1376×1032, 1024×768, 1280×800 y
1366×768; en 375 la página se desplaza como siempre y nada desborda a lo
ancho.

**PC no es tablet.** Leider lo vio en un monitor de 1900 px y todo era
enorme: el "llenar la pantalla" es para la tablet, que se mira de pie y de
lejos. Desde 1440 px de ancho (`pc:`; el iPad de 13" apaisado mide 1376) el
inicio es un tablero normal: ancho tope de 84 rem, letra de escritorio, fichas
en fila y la página termina donde termina el contenido. Y en la tablet en
vertical las fichas ya no son cinco columnas flacas sino dos anchas en fila,
con su descripción. Las tres variantes propias (`alto:`, `bajo:`, `pc:`) van
declaradas en ese orden y la última manda.

Dos trampas de esta tanda: un `style={{ height }}` en línea le gana a las
clases responsive (el logo salía de 26 px en todas partes; el alto va por
clase), y las variantes `@custom-variant` ganan a `sm:/lg:` cuando fijan la
misma propiedad porque salen después en el CSS — es lo que hace que `bajo:`
mande, y hay que saberlo para no pelearse con ello.

### Ni una ventana del navegador, y un inventario de verdad (16-sep, noche)

Leider probó el sistema en producción y mandó dos cosas: "estas ventanas
flotantes a nivel de navegador no sirven, no quiero que exista ni UNA", y "el
inventario está horrible: es para llenar todos los productos y la materia y
también llevar conteo, y eso no se está reflejando".

**Diálogos propios.** Había sesenta `window.confirm / prompt / alert` en once
pantallas. Son ventanas del navegador: salen con el rótulo "savora.vertigopro.
tech dice", en la tablet diminutas, un flujo de cuatro preguntas eran cuatro
ventanas seguidas, y los números se pedían como texto sin teclado numérico.
Ahora hay un solo sitio, `components/dialogo.tsx`, con `useDialogo()`:
`confirmar`, `elegir` (opciones grandes con explicación, en vez de "Aceptar =
banco · Cancelar = gaveta"), `pedir` (un formulario con varios campos:
número con teclado decimal y coma, texto, fecha, opciones), `pedirNumero`,
`pedirTexto` y `avisar`. Devuelven promesas, así que el código que los usa se
lee igual que antes pero con `await`; cancelar da `false`/`null`. Los flujos
de varias preguntas (nota de crédito de compras, devolución de una venta,
alta de un equipo existente) pasaron a UN formulario. **Regla para lo que
venga: cero `window.*`.** Si hace falta preguntar algo, es `useDialogo()`.

**Inventario.** No había forma de crear un insumo desde la pantalla (nacían
con la base) ni de contar el depósito completo. Ahora:

- **Alta y ficha.** "Nuevo insumo" y, tocando el nombre, la ficha: nombre,
  tipo, unidad, mínimo, objetivo, costo, rendimiento, los cuatro movimientos
  (compra, merma, consumo del personal, contar), el historial de costos y las
  pérdidas del insumo. Se archiva en vez de borrar: tiene recetas, compras y
  mermas colgando.
- **Tipo.** `insumo` (materia prima que entra en recetas) o `reventa` (el
  refresco: se compra y se vende tal cual, sin rendimiento que medir). Columna
  `ingredientes.tipo`, y `activo` para el archivado; las dos con migración
  automática al arrancar.
- **Conteo físico en lote.** `POST /api/inventario/conteo`: se recorre el
  depósito con la tablet, se anota lo que hay, lo que se deja en blanco no se
  toca, y cada diferencia queda como merma o sobrante con su asiento — igual
  que el "Contar" de un solo insumo, que sigue existiendo. Todo o nada: un id
  que no existe no cambia ningún stock. Tests en
  `tests/test_inventario_conteo.py`.
- **La pantalla.** Cuatro cifras arriba (insumos, bajo mínimo, valor en
  depósito, pérdidas 30 días), buscador y filtros (bajo mínimo, sin costo,
  materia prima, reventa, archivados), la tabla con estado de stock (Agotado /
  Bajo) y tres acciones por fila, y debajo qué comprar, la inflación de
  insumos y las pérdidas como tabla ordenable.

### Qué falta acordar

- **Commit y push de todo esto** al repo (hoy vive en mi clon, sobre tu
  `d5443d7`). Propongo rama `vertigo-pro-acceso-postgres` para que la revises.
- El dueño de Sávora todavía no tiene cuenta: se crea desde el hub.

---

## Bloqueante antes de cualquier despliegue (Daniel, 15-sep)

> Resuelto arriba. Se deja el razonamiento porque es el que hay que recordar.

**Zona horaria.**

`timeutils.py` usa la hora local del servidor como hora del negocio. El
comentario del módulo lo dice explícitamente:

> El servidor corre en el mismo local (mini PC / laptop detrás del mostrador),
> así que la hora local del sistema ES la hora del negocio. Usar `utcnow()` haría
> que el "día" cierre a las 8pm en Venezuela (UTC-4), partiendo las ventas de la
> noche en dos días distintos.

Esa premisa dejó de ser cierta: el despliegue es en la nube. Con el servidor en
UTC, el día del negocio cierra a las 8pm y rompe:

- cierre de caja
- reportes por día
- numeración de comandas (reinicia por día)
- períodos de IVA

Hay que meter zona horaria configurable **antes del primer despliegue**. Después,
los datos ya quedaron mal fechados y no hay vuelta fácil.

---

## Qué es esto

ERP para un negocio de comida (empanadas, pastelitos, café) en Venezuela, local
de dos pisos. Producto: **Vertigo Pro**; primer cliente: **Sávora**.

- **Backend**: FastAPI + SQLAlchemy + **PostgreSQL** (SQLite solo en pruebas y
  desarrollo sin Docker)
- **Frontend**: React + Vite + TypeScript + Tailwind v4
- **Python 3.8** en la laptop de Daniel, **3.12** en la imagen — usar
  `typing.Optional`, no `X | None`, en lo que FastAPI/pydantic evalúan
- **265 tests**, todos verdes
- Realtime POS↔Cocina por WebSocket

```bash
cd backend && py -m pytest tests -q      # 265 tests
cd frontend && npx tsc --noEmit && npm run build
```

Despliegue y operación: `DESPLIEGUE.md`. Docker en local: `DOCKER.md`.

---

## Lo que se hizo en la última tanda (Daniel)

Una auditoría de 40 casos operativos reales (no de código: "el cliente devuelve
la comida", "se va el internet", "un insumo sube 300%"). Salieron 36 hallazgos y
se cerraron todos.

**Los mensajes de commit explican el razonamiento de cada uno.** Están escritos
para eso — léelos antes de tocar las áreas que mencionan.

Por bloques:

- **Tier 1 — la plata mal contada a diario**: bolívares y divisas como dos cajas
  contables separadas (`1010` / `1011`), lo recibido y el vuelto (incluido el
  caso venezolano de pagar en verdes y devolver en bolívares, que mueve dos
  cajas), descuentos por pedido contra la contra-cuenta `4020`, propinas contra
  el pasivo `2040` (nunca tocan la utilidad), y fiado con `1015`.

- **Tier 2 — marcha atrás**: cinco operaciones movían los libros sin forma de
  deshacerse (cierre de caja, ajuste de inventario hacia arriba, baja de activo,
  declaración de IVA, factura de compra). Todas siguen ahora el patrón que ya
  usaban merma y devolución: el hecho no se borra, se le hace contra-asiento y
  queda el rastro.

- **Tier 3 — números que mentían**: el reporte agrupaba por el nombre congelado
  del ítem (dos productos distintos con el mismo nombre se fundían en una línea);
  el flag `sin_receta` se evaluaba con las recetas de hoy y reescribía el pasado;
  el ticket promedio lo movía un solo pedido grande; un salto de 200% en el costo
  se presentaba como inflación cuando suele ser un saco tecleado como 1.

- **Tier 4 — huecos estructurales**: trazabilidad (quién cobró, quién anuló,
  desde qué caja), dos puntos de venta con su propio cierre, reportes y libros
  fiscales de meses ya cerrados, cierre de ejercicio, activos que ya se tenían
  antes del ERP, y ticket imprimible. *(La trazabilidad ahora sale del login,
  ver arriba.)*

- **Tier 5**: historial de recetas, consumo del personal separado de la merma,
  comandas viejas sin cobrar, y venta libre (cobrar algo que no está en el menú).

### Dos cosas que solo aparecieron corriendo el sistema, no en los tests

1. **Las migraciones no sabían relajar un `NOT NULL`.** La venta libre guarda
   `pedido_items.variante_id` en NULL; los tests pasaban porque crean las tablas
   de cero, y el endpoint reventaba sobre una base existente. El primer intento de
   arreglarlo dejó la tabla viva vacía con 1.014 filas en la copia. Se recuperó y
   se reescribió en una sola transacción, con test de regresión.

2. **Dos falsos positivos de `/salud`** con la venta libre. El peor: "producto sin
   receta", un aviso imposible de resolver — que es justo lo que entrena a
   ignorar la pantalla de salud.

---

## Hardware (contexto, no código)

- El cliente compró **2 tablets Amazon Fire HD 8**. Sin Play Store y sin sistema
  de impresión de Android.
- Falta comprar la **comandera de cocina**: térmica 80 mm **de red**, no
  Bluetooth — el local tiene dos pisos y el Bluetooth no aguanta la losa. ~$100.
- **Pendiente probar**: si RawBT (APK sideloado, sin Play Store) logra imprimir
  desde la Fire. Si no, hace falta una tablet Android normal para la caja (~$110)
  y la Fire queda en la cocina como pantalla.
- Despliegue en nube, **subdominio por cliente**: `savora.vertigopro.tech`.

---

## Pendiente después de desplegar

- **POS offline (PWA + IndexedDB).** Sin internet el local no puede cobrar, y en
  Venezuela eso pasa. Solo el POS necesita funcionar offline; reportes y
  contabilidad pueden pedir conexión.
- **Casos sin auditar**: dos tablets en operación real simultánea, y cambio de
  turno / caja abierta pasada la medianoche.

---

## Cómo se trabaja en este repo

- **Comentarios en español que explican el POR QUÉ, no el qué.** Si un comentario
  solo repite lo que dice el código, sobra. Si explica qué se rompía antes y por
  qué la solución es esa, se queda.
- **Un test por hallazgo**, con el caso real en el docstring.
- **Verificar contra el sistema corriendo**, no solo con tests. Los dos bugs de
  arriba salieron así y la suite no los veía.
- Commits que explican el razonamiento, no el diff.
