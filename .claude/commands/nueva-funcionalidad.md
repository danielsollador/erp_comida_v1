---
description: Convierte una idea nueva en requisito, spec, bloque del plan y tareas (pasos Especificar, Planificar y Tareas de Spec Kit). No escribe codigo.
argument-hint: "<la idea, con tus palabras>"
---

Idea del usuario: $ARGUMENTS

Si viene vacia, pregunta cual es la idea y no sigas.

## Contexto

- Especificacion en `CLAUDE.md` (ya cargado).
- Plan en @plan-implementacion.md, tareas en @tareas.md y estado real en @project-map.md.
- Plantilla del spec en @specs/_plantilla.md.
- El codigo solo se lee para entender lo que ya existe; este comando no lo modifica.

## Paso 1: entender

1. Lee `project-map.md` y busca si la idea ya existe, entera o en parte, en `CLAUDE.md`, en el plan o en el codigo. Si ya existe, dilo y pregunta si se trata de un cambio a lo que hay.
2. Si falta algo para escribir el requisito sin inventar, pregunta (con `AskUserQuestion`, maximo 4 preguntas, cada una con una opcion recomendada). Lo tipico que falta:
   - quien la usa (dueno, caja, cocina, contador, equipo Vertigo);
   - en que modulo vive;
   - que pasa con el dinero, la caja, el inventario, los asientos o los impuestos;
   - si debe funcionar sin conexion, con dos usuarios a la vez o en el telefono.
3. Si la idea depende de una decision que toca dinero, fiscalidad o arquitectura, no la decidas: va como decision pendiente (D10, D11...).

## Paso 2: proponer antes de escribir

Muestra en el chat, corto:
- el requisito tal como quedaria en `CLAUDE.md`;
- en que fase va y por que (FASE 1 si cierra un riesgo de lo que ya funciona; si no, la fase cuyo objetivo encaja; nunca en FASE 0);
- de que otros bloques depende;
- las decisiones pendientes, si hay.

Espera el visto bueno. Si el usuario corrige algo, ajusta y vuelve a mostrarlo.

## Paso 3: escribir los documentos

Con el visto bueno, en este orden:

1. **`CLAUDE.md`:** el requisito en su fase, con el mismo formato que el resto: `- Nombre (Modulo):` y debajo una vinieta por requisito concreto, en lenguaje sencillo y sin detalles tecnicos.
2. **`specs/<modulo>.md`:** si no existe, se crea desde `_plantilla.md`; si existe, se agrega una seccion. Requisitos numerados que se puedan comprobar con un si o un no, reglas de negocio, casos borde, textos de pantalla, fuera de alcance y Aceptacion.
3. **`plan-implementacion.md`:**
   - un bloque nuevo en su fase con el siguiente numero libre (`### N.M Nombre (Modelo)`), con el modelo segun 0.4, que hacer en backend y en frontend, los tests a escribir y la **Aceptacion**;
   - si hay decisiones pendientes, una fila en la tabla de la seccion 3;
   - sus dependencias en la seccion 8.
4. **`tareas.md`:** el bloque desglosado en subtareas `N.M.1`, `N.M.2`... con el mismo formato que los demas, terminando en "Comprobar que compila", "Actualizar `project-map.md`" y "Avisar al usuario para validar". Las que dependen de una decision pendiente van con `[!]`.
5. **`prompts.md`:** el prompt del usuario, si no esta ya.

## Paso 4: cerrar

- Commit en la rama de la fase en curso con un mensaje que diga que funcionalidad se agrego. No se sube sin que el usuario lo pida.
- Resume en el chat que se agrego y donde, y di que se construye con `/implementar N.M`.
- **Para aqui.** No implementes nada.

## Reglas

- Nada de codigo en este comando.
- No cambies requisitos que ya existen sin decirlo y sin el visto bueno del usuario.
- Respeta las reglas de `CLAUDE.md`: todo homologado, todo se explica, responsive y nada propio de un cliente fijo en el codigo compartido.
