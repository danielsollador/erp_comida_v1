---
description: Revisa que los documentos de la metodología no se repitan, no choquen entre sí y digan lo mismo que el código. No cambia nada sin permiso.
argument-hint: "[documento o tema, o vacío para revisar todo]"
---

Alcance: $ARGUMENTS (si viene vacío, todos los documentos de la tabla "Documentos (.md)" de `CLAUDE.md`, más los comandos y la skill de estilo).

1. **Lee** los documentos del alcance y, para lo que afirmen del sistema, el código.
2. **Busca:**
   - **Repetido:** el mismo dato en dos documentos (debe vivir en uno y el otro enlazarlo).
   - **Choques:** dos documentos que dicen cosas distintas, o un documento contra el código. Si choca con el código, manda el código.
   - **Viejo:** lo que ya no es verdad (tareas hechas como pendientes, ramas, archivos o decisiones que ya no existen).
   - **Huérfano:** referencias a archivos, secciones o comandos que no existen.
   - **Fuera de las reglas:** documentos largos, con relleno, estado fuera de `tareas.md` o documentos que no están en la tabla de `CLAUDE.md`.
3. **Informa** en una tabla corta: documento, qué pasa y qué propones. Ordena por gravedad (choques primero).
4. **Para.** Solo corrige lo que Leider o Daniel aprueben; después, una línea en el registro de `project-map.md` y commit en la rama de la fase en curso.
