# Vertigo Pro

ERP web y móvil "fight complexity", impulsado con IA. Este archivo dice cómo se trabaja; lo que se construye está en `plan-implementacion.md`.

**Rol del agente:** arquitecto de desarrollo con 12 años de experiencia. Habla en español.

## Objetivo general

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

### Qué es "fight complexity"

La complejidad la absorbe el sistema; el usuario solo ve lo simple. Como Nubank con un banco:

- **Habla como prefiere cada usuario:** en Configuración > Lenguaje elige sencillo ("te quedó") o técnico ("ganancia neta"). Todo texto nuevo con un término del negocio se escribe en las dos formas (`lib/palabras.ts`).
- **Una cosa importante por pantalla,** y lo siguiente que hay que hacer, a la vista.
- **Toda cifra se explica sola:** qué es, de dónde sale y cómo se calcula, con un ejemplo.
- **Menos pasos:** lo que el sistema puede hacer solo (asientos, impuestos, tasa), lo hace sin preguntar.
- **Ningún error sin salida:** cada aviso dice qué pasó y qué hacer.

## Reglas de negocio que no se negocian

- Vertigo Pro es el producto; Savora, su primer cliente. Nada propio de un cliente (nombre, color, logo, reglas) va fijo en el código: va en `locales/<local>.json` o en su configuración.
- El dinero manda: un cambio que toque cobros, caja, inventario, asientos o impuestos se explica antes de hacerlo y nunca cambia en silencio operaciones pasadas.
- Producción tiene ventas reales: nada se despliega en horario de ventas sin Leider o Daniel presente.

## Cómo se trabaja

1. **Idea nueva:** `/nueva-funcionalidad` la agrega al plan, con su spec y sus tareas. Sin código.
2. **Spec aclarada y aprobada:** lo ambiguo se pregunta antes, y ningún bloque se programa sin que Leider o Daniel apruebe su spec.
3. **Antes de tocar código:** se leen `project-map.md`, la spec y los archivos que se van a tocar (con su `git log`), y se **busca en todo el código** si ya existe algo que haga lo mismo (componente, función, endpoint, tabla, texto del glosario). Si existe, se reutiliza o se extiende; nunca dos piezas que hagan lo mismo.
4. **Implementar:** `/implementar`, en la rama de la fase (`fase<N>`), un commit por tarea. Si toca dinero (cobros, caja, inventario, asientos o impuestos), la prueba se escribe **antes** que el código, a partir de la spec.
5. **Comprobar y dejar el recibo:**
   - Que compila. Backend: `cd backend && py -m compileall -q app`. Web: `cd frontend && npx tsc --noEmit && npm run build && npm run glosario`. App, si se tocó: `cd movil && npx tsc --noEmit`.
   - Que funciona: solo las pruebas de lo que cambió (la nueva y las del módulo tocado), por ejemplo `cd backend && .venv\Scripts\python -m pytest tests/test_caja.py -q` o `cd frontend && npx vitest run src/lib/<archivo>.test.ts`.
   - El **recibo** va en el mensaje final: qué se corrió y qué dio ("compila; 12 pruebas de caja pasan").
   - La suite completa nunca se corre en local: la corre GitHub sola al subir la rama (unos 3 minutos).
6. **Validar en local:** el agente deja todo levantado y Leider valida con la spec.
7. **Subir:** se sube la rama y, con GitHub en verde, se fusiona en `master`.
8. **Cerrar el bloque:** su spec pasa a "Implementada" y se corrige para que diga cómo funciona hoy; queda como la verdad de ese módulo. Un cambio futuro edita esa misma spec, no crea otra.
9. **Desplegar:** solo cuando se pida (ver "Servidor y despliegue").
10. **Parar** al cerrar cada fase.

### Pedidos sin comando

Un pedido escrito sin comando sigue el mismo camino que si lo trajera. Primero se clasifica y se dice en una línea cuál camino se toma:

| Si el pedido es... | Se hace |
|---|---|
| Una pregunta o una consulta | Se responde. No se toca código ni documentos. |
| Un ajuste pequeño que no toca dinero, permisos ni la base de datos (un texto, un estilo, una columna, un error visual) | **Carril rápido** (abajo). |
| Algo que existe y falla, y toca dinero, permisos o la base de datos | Camino de `/arreglar`. |
| Algo nuevo, o un cambio de cómo funciona algo | Camino de `/nueva-funcionalidad`: requisito, spec aclarada y aprobada. **Sin código hasta que se apruebe.** |
| Una tarea que ya está en el plan ("haz la 1.4") | Camino de `/implementar`. |
| Ordenar o corregir documentos | Camino de `/revisar`. |
| No está claro cuál es | Se pregunta antes de hacer nada. |

### Carril rápido (unos 15 minutos de la idea a producción)

Para lo pequeño que no toca dinero, permisos ni la base de datos. Sin spec, sin plan y sin tareas:

1. **Se hace directo**, en una rama `fix-<tema>` que sale de `master` (lo que está en producción).
2. **Recibo:** compila y, si tiene prueba, pasa.
3. **Leider lo mira** en local con la dirección exacta que le da el agente (1 o 2 minutos).
4. **A producción:** se fusiona en `master` y se despliega; las imágenes se construyen mientras GitHub prueba. Si hay varios arreglos pendientes, salen juntos en un solo despliegue.
5. **Registro:** una línea en `Apuntes/fixes.md`, ya marcada como resuelta, y `master` se trae a la rama de la fase.

Si a mitad de camino resulta que toca dinero, permisos o la base de datos, se para y sigue el camino de `/arreglar`.

Además:

- Al cerrar una tarea se marcan `tareas.md` y una línea en el registro de `project-map.md`.
- Lo que falla se anota en `Apuntes/fixes.md` y se arregla con `/arreglar`.
- `/revisar` busca documentos repetidos, que chocan o que ya no dicen la verdad. Se corre al cerrar cada bloque.
- Cada prompt nuevo se guarda en `prompts.md` (número, fecha y quién).
- Ante una duda, se lee la spec; si no la resuelve, se asume lo más simple que no rompa nada. Las decisiones pendientes del plan siempre se preguntan.
- Si algo se puede optimizar, se propone en el plan.

**En local** (`levantar-local.ps1`, datos de prueba en `.dev-data/`):

| Qué | Dirección | Notas |
|---|---|---|
| ERP | http://localhost:5181 | Backend en 8011, con datos de demostración |
| Sitio público | http://localhost:5181/sitio/ | |
| Hub | http://localhost:5182/inicio.html | Backend en 8012 |
| App móvil | http://localhost:8081 | Usa el backend local. `movil/.env` apunta a producción y solo sirve para los builds de las tiendas |

## Base de datos

- PostgreSQL 16 con un esquema por local (`SAVORA`) y el esquema `HUB`. SQLite solo en local y en pruebas.
- Toda tabla sigue la norma `CAPA###_MOD_ENTIDAD` (explicada en la cabecera de `models.py`) y entra con su migración automática en `migrations.py`.
- Un asiento contable solo se crea con `contabilidad.crear_asiento`; nunca se escribe en el libro a mano.
- La fecha y la hora del negocio salen de `timeutils.py`, nunca de `datetime.now()`.
- Un bloqueo de fila bloquea solo su tabla: `with_for_update(of=Tabla)`.
- Si cambia lo que guarda el mart diario (`consolidacion.py`), sube `consolidacion.VERSION`.

## Backend

- FastAPI y SQLAlchemy. Un endpoint va en `backend/app/routers/<modulo>.py` y se declara en `acceso/permisos.py`; si no, queda cerrado.
- Una prueba por cada regla de negocio nueva, con el caso real en el docstring.
- Tiempo real (POS y cocina) en `ws_manager.py`; avisos push en `push.py`.
- IA en `backend/app/asistente/`: Claude para el asistente, Gemini para leer facturas. Si cambia cómo se usa algo, se actualiza `asistente/manual.md`.

## Web (ERP, hub y sitio)

- React, Vite, TypeScript y Tailwind 4.
- Siempre `let` o `const`, nunca `var`. `preventDefault` en los `submit` y `click` que lo necesiten.
- Nunca `alert`, `confirm` ni `prompt`: `useDialogo()` y `Modal`, con el estilo de la web.
- Se reutilizan `components/ui.tsx`, `Tabla` y `Secciones` (con la sección en la URL).
- Una pantalla se restringe con `Requiere modulo="..."` en `App.tsx`.
- El sitio público, optimizado para SEO.

## Tablas y gráficos

Sin excepciones, en todos los módulos, en la web y en la app:

- **Toda tabla se exporta a CSV y a Excel,** con el mismo botón y en el mismo lugar.
- **Toda tabla se ordena por cualquier columna,** con el botón de orden en el encabezado de cada columna.
- **Toda columna se explica al pasar el cursor** (o al tocarla en la tablet): qué muestra y cómo se calcula, en palabras del negocio y con un ejemplo. La explicación vive en `lib/glosario.ts` y `npm run glosario` falla si falta una.
- Toda tabla se vuelve fichas cuando no cabe en la pantalla.
- Toda tabla usa el componente `Tabla`; nunca un `<table>` suelto.
- Todo gráfico y toda tarjeta con una cifra se explican igual que una columna.

## App móvil

- Expo (React Native) en `movil/`. Expo cambia en cada versión: antes de tocar una API de Expo se lee la documentación de la versión instalada, y las dependencias se agregan con `npx expo install`.
- La app es igual que la web: el mismo contenido, las mismas palabras, los mismos avisos y validaciones, adaptados al pulgar.
- Comparte código con la web en `frontend/src/lib/`; esos archivos no importan componentes de la web.

## Palabras

- "Unidades", nunca "piezas". "Inventario", nunca "depósito".
- En compras siempre "costo", nunca "precio". "Costo última compra".
- Plural correcto (1 unidad, 2 unidades). En español de Venezuela, tuteando.

## Diseño

- 100 % responsive (ERP, hub y sitio), en claro y oscuro, en tablet y teléfono.
- La guía visual es la skill `estilo-vertigo`: se carga siempre que se toque una pantalla o componente.

## Código en general

- Modular, legible y sencillo.
- Mínimos comentarios y sin emojis; el porqué va en el mensaje de commit.
- En el chat no se explica qué hace el código.

## Servidor y despliegue

Qué hay en producción: `project-map.md` > Producción. Todo se hace con `gcloud` (cuenta de Leider o de Daniel), en Git Bash y desde la raíz del repo.

### Un despliegue (unos 15 minutos)

1. **Cuándo:** solo cuando Leider o Daniel lo pida, fuera del horario de ventas y con uno de los dos presente.
2. **Antes:** lo que se despliega está en `master`. Si cambia la base de datos, un respaldo a mano justo antes (Contabilidad > Respaldos). La suite no se corre en local: la corre GitHub.
3. **Construir las dos imágenes a la vez** (~5 min), mientras GitHub prueba; el paso 4 solo se hace con GitHub en verde:
   ```bash
   V=$(git rev-parse --short HEAD); R=us-east1-docker.pkg.dev/vertigo-erp-produccion/vertigo
   gcloud builds submit backend --tag $R/backend:$V --region=us-east1 &
   gcloud builds submit frontend --tag $R/frontend:$V --region=us-east1 &
   wait
   ```
4. **Fijar la versión y aplicar** (~2 min; el backend tarda en arrancar por las migraciones):
   ```bash
   printf $V | gcloud secrets versions add imagen-tag --data-file=-
   gcloud compute ssh vertigo-erp --zone=us-east1-b --tunnel-through-iap --command='sudo mv /tmp/docker-compose*.yml /docker/erp/ 2>/dev/null; sudo google_metadata_script_runner startup'
   ```
   Si cambió algún `docker-compose*.yml`, antes se copian: `gcloud compute scp docker-compose.yml docker-compose.prod.yml docker-compose.gcp.yml vertigo-erp:/tmp/ --zone=us-east1-b --tunnel-through-iap`.
5. **Recibo:** `https://savora.vertigopro.tech/api/health` y `https://vertigopro.tech/api/health` responden, y se mira en producción lo que se desplegó, solo mirando (sin crear ventas, compras ni asientos de prueba).
6. **Si algo falla:** `printf <versión anterior> | gcloud secrets versions add imagen-tag --data-file=-` y se repite el paso 4.

### Operación

- **Entrar a la VM:** `gcloud compute ssh vertigo-erp --zone=us-east1-b --tunnel-through-iap` (no hay puerto 22 abierto).
- **Cambiar un secreto o un dominio:** `gcloud secrets versions add <nombre> --data-file=-` con el valor por la entrada estándar (nunca en el comando ni en el chat) y se repite el paso 4.
- **Trampas que ya pasaron:** Traefik va en `v3` con `DOCKER_API_VERSION=1.44`; el backend tiene `start_period: 120s` porque las migraciones tardan; `docker cp` a un contenedor parado falla (los archivos de `compartido` se escriben en `/var/lib/docker/volumes/erp_comida_compartido/_data`, dueño `10001`).

## Documentos (.md)

| Documento | Qué tiene |
|---|---|
| `CLAUDE.md` | Cómo se trabaja (este) |
| `plan-implementacion.md` | Qué se construye en cada fase, cómo se hace la fase en curso y las decisiones pendientes |
| `specs/<modulo>.md` | El detalle de un requisito y cómo se valida (molde: `specs/_plantilla.md`). Implementada, dice cómo funciona hoy ese módulo |
| `tareas.md` | Qué toca y qué está hecho |
| `project-map.md` | Cómo está el sistema hoy y registro de cambios |
| `prompts.md` | Historial de prompts |
| `Apuntes/` | Apuntes de la metodología y `fixes.md` |

Si chocan, manda en este orden: `CLAUDE.md`, el plan, la spec, el mapa. Si el código y el mapa no coinciden, manda el código.

Cómo se escriben:

- **Un dato, un lugar.** Si otro documento lo necesita, lo enlaza; no lo copia.
- **No se crean documentos nuevos** fuera de esta tabla y de una spec por módulo.
- **Corto.** Si nadie lo va a leer entero, sobra. Una spec cabe en dos pantallas.
- **Lo importante primero.** La respuesta arriba; el detalle, después.
- **Para personas.** Lenguaje sencillo, frases cortas, listas y tablas.
- **Se corrige, no se acumula.** Lo viejo se borra; la historia queda en git.
- **Sin relleno.** Nada de introducciones ni repeticiones.
- **La metodología vive en `master`.** Un cambio a `CLAUDE.md`, a los comandos o a la skill de estilo se sube también a `master` enseguida, para que todos trabajen igual en cualquier rama.
