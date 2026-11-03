---
description: Arregla los errores y mejoras pequenas anotados en Apuntes/fixes.md (o el que se pase como argumento) y los deja listos para validar en local.
argument-hint: "[lo que falla, o vacio para tomar los pendientes de fixes.md]"
---

Pedido: $ARGUMENTS

## Contexto

- Lista de arreglos en @Apuntes/fixes.md.
- Estado real en @project-map.md. Especificacion en `CLAUDE.md` (ya cargado).
- Todo vive en este repo: codigo y documentos de la metodologia.

## Que se arregla

- Si el pedido viene con texto, agregalo primero a `fixes.md` como pendiente y arregla ese.
- Si viene vacio, toma todos los pendientes (`- [ ]`) de `fixes.md`, en orden.
- Si `fixes.md` no tiene pendientes y el pedido viene vacio, revisa lo que el usuario reporto en esta conversacion; si tampoco hay nada, dilo y para.

**Si es algo que ya esta resuelto** (`- [x]` en `fixes.md`): no lo vuelvas a investigar ni a probar. Dile al usuario que ya se arreglo, cuando y en que commit, y preguntale cual de estas es:
- no funciona lo que dice el arreglo: se reabre como pendiente nuevo, con lo que cuenta el usuario;
- funciona, pero no como el lo quiere: es un cambio, no un error; se anota como pendiente nuevo con lo que quiere.

**Si no es un arreglo sino una funcionalidad nueva** (algo que `CLAUDE.md` no pide), no lo hagas aqui: dilo y sugiere `/nueva-funcionalidad`.

## Como se arregla

1. Consulta `project-map.md` y ubica el codigo afectado. Mira `git log` de esos archivos: el porque de cada regla esta en los commits.
2. Si el arreglo cambia un resultado de dinero, caja, inventario, asientos o impuestos, explica en dos lineas que cambia y espera el visto bueno antes de tocarlo.
3. Rama: `fix-<fecha>-<tema-corto>`, creada desde la rama de la fase en curso (`fase<N>`) mientras esta no este en `master`; si no, desde `master`. Varios arreglos de la misma tanda pueden ir en la misma rama.
4. Un commit por arreglo, con el porque en el mensaje.
5. Si el error tiene una regla de negocio detras, escribe el test que lo demuestra, con el caso real en el docstring. Se escribe, no se corre.
6. Comprueba que compila (seccion 0.3 del plan): backend `py -m compileall -q app`; web `npx tsc --noEmit && npm run build` y `npm run glosario`; movil `npx tsc --noEmit` si se toco.
7. Respeta las mismas reglas de siempre: `useDialogo` y `Modal` en vez de ventanas del navegador, componentes de `ui.tsx`, tokens de color y la skill `estilo-vertigo` si se toca algo visual.

## Al terminar

- En `fixes.md`, marca cada arreglo como `- [x] ... · resuelto AAAA-MM-DD, commit <hash>`.
- Agrega una entrada en el registro de cambios de `project-map.md` y corrige el mapa si algo cambio.
- Deja el sistema levantado en local (`levantar-local.ps1`) y di para cada arreglo donde y como comprobarlo (URL y pasos).
- Los documentos (`fixes.md`, `project-map.md`) van en el mismo commit del arreglo o en el siguiente.
- No hagas push, merge a master ni despliegue: eso se hace cuando el usuario lo valide y lo pida.
