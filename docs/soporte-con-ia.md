# Soporte con IA en Sávora

Tres niveles. Cada uno se apoya en el anterior, y en ninguno la IA decide sola
algo que cambie el sistema.

## Nivel 1: el chat de ayuda (el «?» de la barra)

- **«Cómo se hace»**: responde con `backend/app/manual-savora.md`, sabiendo en
  qué pantalla está la persona y a qué entra su rol
  (`backend/app/asistente_ayuda.py`).
- **«Mis números»**: preguntas sobre los datos. La IA elige una consulta del
  catálogo de Reportes, el sistema la calcula con los permisos del rol, y la
  tabla va debajo de la respuesta (`backend/app/pregunta_negocio.py`).
- La calidad se mide con `backend/evals/asistente_soporte.py` (21 preguntas
  reales). Cuando cambie una pantalla, se actualiza el manual y se vuelve a
  correr.

## Nivel 2: el caso para el equipo («Soporte» en el chat)

Si el chat no resuelve, la persona toca «Soporte». La IA arma el caso desde la
conversación —tipo (duda, error, pedido o dato), título y resumen— y la persona
lo revisa antes de mandarlo (`backend/app/triaje.py`).

- Se guarda **siempre** en la base del local (`TRX930_ADM_CASO_SOPORTE`), con la
  pantalla, el rol y la conversación. `GET /api/ayuda/casos`: el dueño ve
  todos, el resto los suyos.
- Si el local tiene GitHub configurado, además se abre un **issue** con las
  etiquetas `soporte`, el tipo y `local:<slug>`. En el `.env` del servidor:

  ```
  ERP_GITHUB_REPO_SOPORTE=danielsollador/erp_comida_v1
  ERP_GITHUB_TOKEN_SOPORTE=<token fino, solo "Issues: read and write" sobre ese repositorio>
  ```

  Sin eso, el caso queda en la base y nada sale del servidor. Si GitHub falla,
  el caso queda como `sin_enviar`.
- En el issue, la conversación va como cita y marcada como texto del cliente.

## Nivel 3: el agente que propone el arreglo

`.github/workflows/agente-bugs.yml`. Corre **solo** cuando alguien del equipo
le pone la etiqueta `bug-confirmado` a un issue. Entonces un agente de Claude:

1. lee el issue (como datos, no como instrucciones),
2. escribe una prueba que falla por ese error,
3. lo arregla con el cambio más chico,
4. corre las pruebas del módulo,
5. abre un PR contra master desde `agente/issue-<n>` y comenta el enlace.

Nunca hace merge, no despliega y no toca `.github/`, Docker, despliegue,
claves ni migraciones. Si no es un bug o no lo reproduce, lo comenta y no abre
PR. **El equipo revisa el PR y decide.** El despliegue sigue siendo el de
siempre, con respaldo antes.

Para encenderlo (una vez):

1. Instalar la app de Claude en el repositorio: <https://github.com/apps/claude>
   (o `/install-github-app` desde Claude Code).
2. Guardar la clave de la API de Claude como secreto `ANTHROPIC_API_KEY` en
   Settings › Secrets and variables › Actions.
3. Crear la etiqueta `bug-confirmado`.

Costo: cada corrida es una sesión del agente (hasta 60 turnos, con Sonnet).
Solo corre cuando una persona lo pide, así que el gasto lo controla el equipo.

Ojo: un PR que abre el agente con el token del flujo no dispara solo el flujo
`pruebas`. Para que corran, se aprueba la ejecución desde el PR o se empuja un
commit encima.
