SDD = Spec Drive Development
Primero se define que debe hacer un sistema / app / funcionalidad y luego el agente escribe el codigo


Como hacer un fichero de agentes:
# -> nivel de sistema (documento completo)
## -> modulos / bloques grandes de funcionalidades (Contabilidad, Inventario, Reportes, Etc)
### -> funcionalidades dentro de un modulos
bullets -> requisitos concretos

Estructura de un fichero de fichero de agentes (AGENTS.md o CLAUDE.md):

Como trabajar con los modelos de IA, cual usar y para que usarlos:
- Planes de implementacion: Opus
- Tajeras complejas, largas o muchas seguidas: Opus
- Pocas tareas muy simples, esteticas o repetitivas simples: Haiku
- Preguntas del proyecto o preguntas generales: Haiku
- Pocas tareas funcionales, sencillas o de dificultad mediana: Sonnet
- Funcionalidad mediana: Sonnet 

Trucos para ahorrar tokens y creditos en agentes de ia:
- Git entre specs, features y entre fases para no recargar el contexto en caso de caos.
- Usar el mismo chat (siempre que se pueda)
- Compactar el chat
- Crear un fichero map.md

    Reglas (Ejemplo):
        - Explora el repositorio de forma estructurada.
        - No entres en la logica de negocio profund.
        - Solo identitifca estructura, mdulos y archivos principales.
        - No modifiques el codigo.
        - No hagas refactos.

    - A partir de ahora usa MAP.md como referencial principal del proyecto, no realices una exploracion completa del repositorio salvo que sea estrictamente necesario.

- Usar un fichero de antes (para definir todas las especificaciones del proyecto)
- Caveman Skill (puede ser) -No expliques nada, simplemente avisame cuando hayas terminado (Caveman)




Como funciona el flujo de trabajo con el SDD y las fases de desarrollo:

Como hacer cambios y modificaciones en un proyecto:

Prompts para exprimir al agente de IA al maximo:

SDD hbrido vs SDD estricto:

Estructura de un SPEC:

Diferentes opciones para hacer SDD:

---

Contexto:
- Especificacion en @CLAUDE.md (fuente de verdad funcional)
- Plan de implementacion en @plan-implementacion.md (orden de ejecucion obligatoria)
- Estado actual del sistema en @project-map.md (fuente de verdad de estado real)
- Debes seguir el plan de implementacion estrictamente sin replantearlo

Jerarquia de conflicto:
1. @CLAUDE.md (que construir)
2. @plan-implementacion (como contruirlo)
3. @project-map.md (estado actual del sistema)

Reglas de ejecucion:
- Conslta primer @project-map.md antes de empezar cualquier tarea
- Ejecuta as tareas en orden exacto sin saltarte ninguna
- No entres en modo de planificacion, analisis global ni rediseno
- No realices pruebas tu mismo, implementa y me avisas cuando este listo para validar
- Solo pregunta si existe un bloqueo tecnico real que impida continuar

Reglas SDD Obligatorias:
- Despues de cada cambio relevante actualiza @project-map.md con:
 - cambios realizados.
 - nuevos modulos / rutas / entidades
 - decisiones tecnicas tomadas
 - impacto en el sistema

Control de consistencia:
 - No inventes en @project-map.md
 - Si hay discrepancia entre codigo y mapa, el codigo tiene prioridad, el map debe corregirse

Alcance:
- Manten los cambios dentro de la fase actual.
- No modifiques funcionalidades fuera del scope de la fase que estamos desarrollando, salvo dependencia directa

Salida esperada:
- Marca cada sub-tarea como completada.
- Al finalizar cada fase :
    - resume lo implementado
    - sincroniza completamente @project-map.md con el estado real del sistema
    - marca la fase como completada (en el map, en las tareas y en el plan de implementacion)

Como hacer cambios y modificaciones en un proyecto:
- si fixes.md vacio, basate en tu historial que tienes para colocar si hace falta
- si terminas una tarea de fixes.md la marcas como resuleta.
- si el usuario te dice una tarea que anteriormente fue resulta, no hagas pruebas para ver si no esta funcionando. Solo avisale al usuario que eso si se arreglo y que no deberia haber problemas, y si es un tema de: que no esta funcionando lo que dice el fix que se arreglo, o no funcionando como usted quiere