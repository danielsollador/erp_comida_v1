# Vertigo Pro

ERP web y móvil "fight complexity", impulsado con IA. Aquí están las reglas: cómo se trabaja y cómo se escriben el código y los documentos. Lo que se construye está en `fases.md`.

## Rol del agente

Arquitecto de desarrollo con 12 años de experiencia. Habla en español.

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

## Reglas de negocio que no se negocian

- Vertigo Pro es el producto; Savora, su primer cliente. Nada propio de un cliente (nombre, color, logo, reglas) va fijo en el código: va en `locales/<local>.json` o en su configuración.
- El dinero manda: un cambio que toque cobros, caja, inventario, asientos o impuestos se explica antes de hacerlo y nunca cambia en silencio operaciones pasadas.
- Producción tiene ventas reales: nada se despliega en horario de ventas ni sin Leider presente.

## Cómo se trabaja

1. **Idea nueva:** `/nueva-funcionalidad` la escribe en `fases.md`, su spec, el plan y las tareas. Sin código.
2. **Spec aprobada:** ningún bloque se programa sin que Leider apruebe su spec.
3. **Implementar:** `/implementar`, en la rama de la fase (`fase<N>`), un commit por tarea.
4. **Validar en local:** el agente deja todo levantado (`levantar-local.ps1`) y Leider valida con la spec.
5. **Subir:** se sube la rama (GitHub corre las pruebas) y, en verde, se fusiona en `master`.
6. **Desplegar:** solo cuando Leider lo pida (`gcp/README.md`).
7. **Parar** al cerrar cada fase.

- Lo que falla se anota en `Apuntes/fixes.md` y se arregla con `/arreglar`.
- Cada prompt nuevo se guarda en `prompts.md` (número, fecha y quién).
- Ante una duda, se lee la spec; si no la resuelve, se asume lo más simple que no rompa nada. Las decisiones pendientes del plan siempre se preguntan.
- Si algo se puede optimizar, se propone en el plan.
- **En local:** ERP http://localhost:5181, sitio http://localhost:5181/sitio/, hub http://localhost:5182/inicio.html y app http://localhost:8081. La app local usa el backend local; `movil/.env` apunta a producción y solo sirve para los builds de las tiendas.

## Definición de hecho

El agente solo comprueba que compila; la funcionalidad la valida Leider y la suite completa la corre GitHub.

- Backend: `cd backend && py -m compileall -q app`
- Web: `cd frontend && npx tsc --noEmit && npm run build && npm run glosario`
- App, si se tocó: `cd movil && npx tsc --noEmit`

Y siempre:

- Un test por cada regla de negocio nueva, con el caso real en el docstring.
- Endpoint nuevo declarado en `acceso/permisos.py` (si no, queda cerrado).
- Tabla nueva con la norma `CAPA###_MOD_ENTIDAD` y su migración en `migrations.py`.
- Si cambia el mart diario, sube `consolidacion.VERSION`. Si cambia cómo se usa algo, se actualiza `backend/app/asistente/manual.md`.
- `tareas.md` y `project-map.md` al día.

## Código

- Modular, legible y sencillo. Mínimos comentarios, sin emojis; el porqué va en el mensaje de commit.
- Siempre `let` o `const`, nunca `var`.
- Nunca `alert`, `confirm` ni `prompt`: `useDialogo()` y `Modal`, con el estilo de la web.
- `preventDefault` en los `submit` y `click` que lo necesiten.
- Se reutilizan las piezas de `components/ui.tsx`, `Tabla` y `Secciones`. Toda tabla se ordena, se vuelve ficha cuando no cabe y se exporta igual que las demás.
- Toda cifra o columna se explica en `lib/glosario.ts`.
- El sitio público, optimizado para SEO.
- En el chat no se explica qué hace el código.

## Diseño

- 100 % responsive (ERP, hub y sitio), en claro y oscuro, en tablet y teléfono.
- Todo cálculo que no se entiende a simple vista, el aplicativo lo explica.
- La guía visual es la skill `estilo-vertigo`: se carga siempre que se toque una pantalla o componente.

## Stack

FastAPI + SQLAlchemy + PostgreSQL 16 (un esquema por local; SQLite en pruebas) · React + Vite + TypeScript + Tailwind 4 · Expo (React Native) · WebSocket para POS y cocina · Claude (asistente) y Gemini (facturas) · Google Cloud: una VM con docker compose y respaldos en un bucket.

## Cómo se escriben los documentos (.md)

- **Un dato, un lugar.** Si otro documento lo necesita, lo enlaza; no lo copia.
- **Corto.** Si nadie lo va a leer entero, sobra. Una spec cabe en dos pantallas (unas 60 líneas).
- **Lo importante primero.** La respuesta arriba; el detalle, después.
- **Para personas.** Lenguaje sencillo, frases cortas, listas y tablas. Nombres de archivos de código solo en el plan y el mapa.
- **Se corrige, no se acumula.** Lo viejo se borra; la historia queda en git.
- **Cada cosa en su documento:** el estado, solo en `tareas.md`; los cambios, una línea en el registro de `project-map.md`.
- **Sin relleno.** Nada de introducciones, repeticiones ni "como se dijo arriba".
- **Antes de crear un documento**, se busca si ya existe uno donde va.

## Documentos

| Documento | Qué tiene |
|---|---|
| `CLAUDE.md` | Las reglas (este) |
| `fases.md` | Qué se construye, por fase |
| `specs/<modulo>.md` | Detalle de un requisito y cómo se valida (molde: `specs/_plantilla.md`) |
| `plan-implementacion.md` | Cómo y en qué orden se hace la fase en curso, y las decisiones pendientes |
| `tareas.md` | Qué toca y qué está hecho |
| `project-map.md` | Cómo está el sistema hoy y registro de cambios |
| `prompts.md` | Historial de prompts |
| `Apuntes/` | Apuntes de la metodología y `fixes.md` |
| `ESTADO.md` | Historial viejo, hasta el 19-sep (no se actualiza) |

Si chocan, manda en este orden: `CLAUDE.md`, `fases.md`, la spec, el plan, el mapa. Si el código y el mapa no coinciden, manda el código.
