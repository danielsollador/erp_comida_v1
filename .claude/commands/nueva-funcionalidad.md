---
description: Convierte una idea en requisito, spec, bloque del plan y tareas. No escribe código.
argument-hint: "<la idea, con tus palabras>"
---

Idea: $ARGUMENTS (si viene vacía, pregunta cuál es y para).

1. **Entender.** Busca en @fases.md, @project-map.md y el código si ya existe; si existe, pregunta si es un cambio. Si falta algo para no inventar (quién la usa, módulo, efecto en dinero, sin conexión, dos usuarios), pregunta con `AskUserQuestion`. Lo que toque dinero, fiscalidad o arquitectura y no esté decidido va como decisión pendiente.
2. **Proponer.** Muestra en el chat, corto: el requisito como quedaría en `fases.md`, en qué fase va (nunca en la FASE 0), de qué depende y qué queda por decidir. Espera el visto bueno.
3. **Escribir**, siguiendo las reglas de documentos de `CLAUDE.md`:
   - `fases.md`: el requisito en su fase, en una línea por punto.
   - `specs/<modulo>.md`: desde @specs/_plantilla.md, o una sección nueva si ya existe.
   - `plan-implementacion.md`: solo si es de la fase en curso (bloque con su enfoque técnico); las decisiones pendientes, en su tabla.
   - `tareas.md`: el bloque en tareas cortas, con `[!]` las que esperan una decisión.
4. **Cerrar.** Commit en la rama de la fase en curso, sin subir. Di qué se agregó y que se construye con `/implementar`. No implementes nada.
