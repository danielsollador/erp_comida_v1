---
description: Implementa las tareas de la fase en curso siguiendo el plan.
argument-hint: "[bloque o tarea, ej: 1.4]"
---

Alcance: $ARGUMENTS (si viene vacío, la primera tarea pendiente de @tareas.md).

Lee @project-map.md, el bloque en @plan-implementacion.md y su spec.

1. **Spec aprobada.** Si el bloque no tiene spec o está en borrador:
   - escríbela o complétala con la plantilla;
   - **aclara:** busca lo que quedó ambiguo o sin decidir (quién, cuánto, qué pasa si falla, dinero, sin conexión, dos usuarios a la vez) y pregúntalo con `AskUserQuestion` (máximo 4 preguntas, cada una con la opción recomendada primero). Las respuestas van a la spec, no al chat;
   - muéstrala y para hasta que Leider o Daniel la apruebe.
2. **Decisiones.** Si una tarea espera una decisión pendiente, márcala `[!]`, pregunta y no la implementes.
3. **Antes de cada tarea:** busca en el código si ya existe algo que lo haga y reutilízalo (paso "Antes de tocar código" de `CLAUDE.md`).
4. **Implementar** las tareas en orden, sin replantear el plan, en la rama `fase<N>`, un commit por tarea. Si toca dinero, la prueba va antes que el código. Solo pregunta ante un bloqueo técnico real.
5. **Comprobar y dejar el recibo** (paso de `CLAUDE.md`): compila y pasan las pruebas de lo que cambió. Nunca la suite completa.
6. **Documentos:** marca la tarea en `tareas.md` y agrega una línea al registro de `project-map.md` (y corrige el mapa si cambió algo).
7. **Al terminar el bloque:** la spec pasa a "Implementada" y dice cómo funciona hoy; deja todo levantado en local, da el recibo y di qué validar (la sección "Cómo se valida" de la spec). Sin push, merge ni despliegue.
8. **Al terminar la fase:** sincroniza el mapa con el código, marca la fase en `tareas.md` y para hasta que Leider valide.
