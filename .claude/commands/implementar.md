---
description: Implementa las tareas de la fase en curso siguiendo el plan.
argument-hint: "[bloque o tarea, ej: 1.4]"
---

Alcance: $ARGUMENTS (si viene vacío, la primera tarea pendiente de @tareas.md).

Lee @project-map.md, el bloque en @plan-implementacion.md y su spec.

1. **Spec aprobada.** Si el bloque no tiene spec o está en borrador, escríbela o complétala con la plantilla, muéstrala y para hasta que Leider la apruebe.
2. **Decisiones.** Si una tarea espera una decisión pendiente, márcala `[!]`, pregunta y no la implementes.
3. **Implementar** las tareas en orden, sin replantear el plan, en la rama `fase<N>`, un commit por tarea. Solo pregunta ante un bloqueo técnico real.
4. **Comprobar que compila** (paso 4 de "Cómo se trabaja" en `CLAUDE.md`). No corras la suite ni valides en el sistema.
5. **Documentos:** marca la tarea en `tareas.md` y agrega una línea al registro de `project-map.md` (y corrige el mapa si cambió algo).
6. **Al terminar el bloque:** deja todo levantado en local y di qué validar (la sección "Cómo se valida" de la spec). Sin push, merge ni despliegue.
7. **Al terminar la fase:** sincroniza el mapa con el código, marca la fase en `tareas.md` y para hasta que Leider valide.
