---
description: Arregla lo anotado en Apuntes/fixes.md (o lo que se pase como argumento) y lo deja listo para validar en local.
argument-hint: "[lo que falla, o vacío para tomar los pendientes de fixes.md]"
---

Pedido: $ARGUMENTS

**Qué se arregla.** Si viene texto, se anota primero en @Apuntes/fixes.md y se arregla eso. Si viene vacío, todos los `- [ ]` de `fixes.md`, en orden.

- Si ya estaba resuelto (`- [x]`), no lo investigues: di cuándo y en qué commit, y pregunta si no funciona (se reabre) o si es un cambio (se anota como nuevo).
- Si no es un error sino algo que el plan no pide, sugiere `/nueva-funcionalidad` y para.
- Si no toca dinero, permisos ni la base de datos, va por el **carril rápido** de `CLAUDE.md`, no por estos pasos.

**Cómo.**
1. Ubica el código con @project-map.md y lee su `git log`: el porqué de cada regla está en los commits.
2. Si cambia un resultado de dinero, caja, inventario, asientos o impuestos, explícalo en dos líneas y espera el visto bueno.
3. Rama `fix-<fecha>-<tema>` desde la rama de la fase en curso. Un commit por arreglo, con el porqué.
4. Si hay una regla de negocio detrás, escribe el test con el caso real.
5. Comprueba y deja el recibo (paso de `CLAUDE.md`): compila y pasan las pruebas de lo que cambió.

**Al terminar.** Marca en `fixes.md`: `- [x] ... · resuelto AAAA-MM-DD, commit <hash>`; agrega una línea al registro de `project-map.md`; deja todo levantado, da el recibo y di dónde comprobar cada arreglo. Sin push, merge ni despliegue.
