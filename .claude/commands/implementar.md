---
description: Implementa las tareas de la fase en curso siguiendo el plan (paso Implementar de Spec Kit)
argument-hint: "[fase o tarea, ej: fase 1 o 1.2]"
---

Alcance pedido: $ARGUMENTS (si viene vacío, sigue con la primera tarea pendiente de @tareas.md).

## Contexto

- Especificación en `CLAUDE.md` (fuente de verdad funcional, ya cargado).
- Plan de implementación en @plan-implementacion.md (orden de ejecución obligatorio).
- Tareas y su estado en @tareas.md.
- Estado actual del sistema en @project-map.md (fuente de verdad del estado real).
- El código y los documentos de la metodología viven juntos en este repo; los documentos, en la raíz.
- Debes seguir el plan de implementación estrictamente, sin replantearlo.

## Jerarquía en caso de conflicto

1. `CLAUDE.md`: qué construir.
2. `specs/<modulo>.md`: con qué detalle.
3. `plan-implementacion.md`: cómo construirlo y en qué orden.
4. `project-map.md`: estado actual del sistema.

## Reglas de ejecución

- Consulta primero `project-map.md` antes de empezar cualquier tarea.
- Ejecuta las tareas de `tareas.md` en el orden exacto, sin saltarte ninguna.
- Antes de programar un bloque, su spec (`specs/<modulo>.md`) tiene que estar aprobada. Si no existe o está en borrador, escríbela o complétala, muéstramela y para hasta que la apruebe.
- No entres en modo de planificación, análisis global ni rediseño.
- Pruebas básicas solamente: comprueba que compila según la sección 0.3 del plan (backend `py -m compileall -q app`; web `npx tsc --noEmit && npm run build` y `npm run glosario`; móvil `npx tsc --noEmit` si se tocó). No corras la suite funcional ni valides en el sistema corriendo: implementa, deja el sistema levantado en local (`levantar-local.ps1`) y avísame cuando esté listo para validar.
- Solo pregunta si:
  - existe un bloqueo técnico real que impida continuar, o
  - la tarea depende de una decisión pendiente de la sección 3 del plan. En ese caso, no la implementes: márcala `[!]` y pregunta.
- Haz commit por tarea en la rama de la fase (`fase<N>`) del repo, con los documentos de la metodología en el mismo commit o en el siguiente. No hagas push, merge a master ni despliegue sin que te lo pida.

## Reglas SDD obligatorias

Después de cada cambio relevante, actualiza `project-map.md` con:
- cambios realizados;
- nuevos módulos, rutas o entidades;
- decisiones técnicas tomadas;
- impacto en el sistema.

## Control de consistencia

- No inventes nada en `project-map.md`: solo lo que está en el código.
- Si hay discrepancia entre el código y el mapa, el código tiene prioridad y el mapa se corrige.

## Alcance

- Mantén los cambios dentro de la fase actual.
- No modifiques funcionalidades fuera del alcance de la fase, salvo dependencia directa.

## Salida esperada

- Marca cada subtarea como completada en `tareas.md`.
- Al terminar cada bloque, dime qué validar (la **Aceptación** de su spec).
- Al finalizar cada fase:
  - resume lo implementado;
  - sincroniza completamente `project-map.md` con el estado real del sistema;
  - marca la fase como completada en `project-map.md`, en `tareas.md` y en `plan-implementacion.md`;
  - para y espera mi validación.
