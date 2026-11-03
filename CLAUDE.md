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

- **Habla como el negocio, no como el sistema:** "lo que te quedó", no "utilidad neta del periodo".
- **Una cosa importante por pantalla,** y lo siguiente que hay que hacer, a la vista.
- **Toda cifra se explica sola:** qué es, de dónde sale y cómo se calcula, con un ejemplo.
- **Menos pasos:** lo que el sistema puede hacer solo (asientos, impuestos, tasa), lo hace sin preguntar.
- **Ningún error sin salida:** cada aviso dice qué pasó y qué hacer.

## Reglas de negocio que no se negocian

- Vertigo Pro es el producto; Savora, su primer cliente. Nada propio de un cliente (nombre, color, logo, reglas) va fijo en el código: va en `locales/<local>.json` o en su configuración.
- El dinero manda: un cambio que toque cobros, caja, inventario, asientos o impuestos se explica antes de hacerlo y nunca cambia en silencio operaciones pasadas.
- Producción tiene ventas reales: nada se despliega en horario de ventas ni sin Leider presente.

## Cómo se trabaja

1. **Idea nueva:** `/nueva-funcionalidad` la agrega al plan, con su spec y sus tareas. Sin código.
2. **Spec aprobada:** ningún bloque se programa sin que Leider o Daniel apruebe su spec.
3. **Implementar:** `/implementar`, en la rama de la fase (`fase<N>`), un commit por tarea.
4. **Comprobar que compila** (es lo único que prueba el agente; la suite completa la corre GitHub):
   - Backend: `cd backend && py -m compileall -q app`
   - Web: `cd frontend && npx tsc --noEmit && npm run build && npm run glosario`
   - App, si se tocó: `cd movil && npx tsc --noEmit`
5. **Validar en local:** el agente deja todo levantado y Leider valida con la spec.
6. **Subir:** se sube la rama (GitHub corre las pruebas) y, en verde, se fusiona en `master`.
7. **Desplegar:** solo cuando Leider o Daniel lo pida (`gcp/README.md`).
8. **Parar** al cerrar cada fase.

Además:

- Al cerrar una tarea se marcan `tareas.md` y una línea en el registro de `project-map.md`.
- Lo que falla se anota en `Apuntes/fixes.md` y se arregla con `/arreglar`.
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
- Un test por cada regla de negocio nueva, con el caso real en el docstring.
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

## Servidor

- Google Cloud: una VM con docker compose (Traefik, backend y frontend por local, hub).
- Respaldos cada 6 h, copia horaria a un bucket y snapshot diario del disco.
- Despliegue manual con `gcp/README.md`.

## Documentos (.md)

| Documento | Qué tiene |
|---|---|
| `CLAUDE.md` | Cómo se trabaja (este) |
| `plan-implementacion.md` | Qué se construye en cada fase, cómo se hace la fase en curso y las decisiones pendientes |
| `specs/<modulo>.md` | El detalle de un requisito y cómo se valida (molde: `specs/_plantilla.md`) |
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
