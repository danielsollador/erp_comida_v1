# Estado del proyecto

> Documento de traspaso. Si vas a retomar este proyecto, lee esto primero — sobre
> todo la sección de arriba, que es la que no se puede deducir leyendo el código.

---

## ⚠ No desplegar sin resolver esto

**El repo y producción divergieron en direcciones opuestas.**

Producción está en `savora.vertigopro.tech` y **tiene cosas que el repo no tiene**:

- `login.html` servido por nginx, con sesiones
- Usuario `admin` con avatar en la barra
- Modo oscuro

Verificado contra el despliegue:

```
GET /                  -> 302 a /login.html  ("Acceso · Vertigo Pro")
GET /api/openapi.json  -> 401
```

Y verificado contra el repo: **no existe** endpoint de login, ni hash de
contraseñas, ni `login.html`, ni mención a "Vertigo Pro" o "savora".

Al mismo tiempo, **el repo tiene cosas que producción no tiene**: los 36
hallazgos cerrados (ver más abajo).

| | Repo | Producción |
|---|---|---|
| Los 36 hallazgos arreglados | ✅ | ❌ |
| Bolívares y divisas separados, propinas, fiado, descuentos | ✅ | ❌ |
| Login y sesiones | ❌ | ✅ |
| Modo oscuro | ❌ | ✅ |

**Redesplegar desde el repo tal cual deja el sistema sin login, abierto en
internet.**

Lo que falta averiguar: **dónde vive el código del login**. ¿Editado directo en
el VPS? ¿Otro repo? ¿Otra carpeta? De eso depende si esto es un merge, un
cherry-pick de la capa de auth hacia el repo, o rehacer el login encima.

---

## Bloqueante antes de cualquier despliegue

**Zona horaria.**

`timeutils.py` usa la hora local del servidor como hora del negocio. El
comentario del módulo lo dice explícitamente:

> El servidor corre en el mismo local (mini PC / laptop detrás del mostrador),
> así que la hora local del sistema ES la hora del negocio. Usar `utcnow()` haría
> que el "día" cierre a las 8pm en Venezuela (UTC-4), partiendo las ventas de la
> noche en dos días distintos.

Esa premisa dejó de ser cierta: el despliegue es en la nube. Con el servidor en
UTC, el día del negocio cierra a las 8pm y rompe:

- cierre de caja
- reportes por día
- numeración de comandas (reinicia por día)
- períodos de IVA

Hay que meter zona horaria configurable **antes del primer despliegue**. Después,
los datos ya quedaron mal fechados y no hay vuelta fácil.

---

## Qué es esto

ERP para un negocio de comida (empanadas, pastelitos, café) en Venezuela, local
de dos pisos.

- **Backend**: FastAPI + SQLAlchemy + SQLite
- **Frontend**: React + Vite + TypeScript + Tailwind v4
- **Python 3.8** — usar `typing.Optional`, no `X | None`
- **170 tests**, todos verdes
- Realtime POS↔Cocina por WebSocket

```bash
cd backend && py -m pytest tests -q      # 170 tests
cd frontend && npx tsc --noEmit && npm run build
```

---

## Lo que se hizo en la última tanda

Una auditoría de 40 casos operativos reales (no de código: "el cliente devuelve
la comida", "se va el internet", "un insumo sube 300%"). Salieron 36 hallazgos y
se cerraron todos.

**Los mensajes de commit explican el razonamiento de cada uno.** Están escritos
para eso — léelos antes de tocar las áreas que mencionan.

Por bloques:

- **Tier 1 — la plata mal contada a diario**: bolívares y divisas como dos cajas
  contables separadas (`1010` / `1011`), lo recibido y el vuelto (incluido el
  caso venezolano de pagar en verdes y devolver en bolívares, que mueve dos
  cajas), descuentos por pedido contra la contra-cuenta `4020`, propinas contra
  el pasivo `2040` (nunca tocan la utilidad), y fiado con `1015`.

- **Tier 2 — marcha atrás**: cinco operaciones movían los libros sin forma de
  deshacerse (cierre de caja, ajuste de inventario hacia arriba, baja de activo,
  declaración de IVA, factura de compra). Todas siguen ahora el patrón que ya
  usaban merma y devolución: el hecho no se borra, se le hace contra-asiento y
  queda el rastro.

- **Tier 3 — números que mentían**: el reporte agrupaba por el nombre congelado
  del ítem (dos productos distintos con el mismo nombre se fundían en una línea);
  el flag `sin_receta` se evaluaba con las recetas de hoy y reescribía el pasado;
  el ticket promedio lo movía un solo pedido grande; un salto de 200% en el costo
  se presentaba como inflación cuando suele ser un saco tecleado como 1.

- **Tier 4 — huecos estructurales**: trazabilidad (quién cobró, quién anuló,
  desde qué caja — sin contraseñas, a propósito), dos puntos de venta con su
  propio cierre, reportes y libros fiscales de meses ya cerrados, cierre de
  ejercicio, activos que ya se tenían antes del ERP, y ticket imprimible.

- **Tier 5**: historial de recetas, consumo del personal separado de la merma,
  comandas viejas sin cobrar, y venta libre (cobrar algo que no está en el menú).

### Dos cosas que solo aparecieron corriendo el sistema, no en los tests

1. **Las migraciones no sabían relajar un `NOT NULL`.** La venta libre guarda
   `pedido_items.variante_id` en NULL; los tests pasaban porque crean las tablas
   de cero, y el endpoint reventaba sobre una base existente. El primer intento de
   arreglarlo dejó la tabla viva vacía con 1.014 filas en la copia. Se recuperó y
   se reescribió en una sola transacción, con test de regresión.

2. **Dos falsos positivos de `/salud`** con la venta libre. El peor: "producto sin
   receta", un aviso imposible de resolver — que es justo lo que entrena a
   ignorar la pantalla de salud.

---

## Hardware (contexto, no código)

- El cliente compró **2 tablets Amazon Fire HD 8**. Sin Play Store y sin sistema
  de impresión de Android.
- Falta comprar la **comandera de cocina**: térmica 80 mm **de red**, no
  Bluetooth — el local tiene dos pisos y el Bluetooth no aguanta la losa. ~$100.
- **Pendiente probar**: si RawBT (APK sideloado, sin Play Store) logra imprimir
  desde la Fire. Si no, hace falta una tablet Android normal para la caja (~$110)
  y la Fire queda en la cocina como pantalla.
- Despliegue en nube, **subdominio por cliente**: `savora.vertigopro.tech`.

---

## Pendiente después de desplegar

- **POS offline (PWA + IndexedDB).** Sin internet el local no puede cobrar, y en
  Venezuela eso pasa. Solo el POS necesita funcionar offline; reportes y
  contabilidad pueden pedir conexión.
- **Casos sin auditar**: dos tablets en operación real simultánea, y cambio de
  turno / caja abierta pasada la medianoche.

---

## Cómo se trabaja en este repo

- **Comentarios en español que explican el POR QUÉ, no el qué.** Si un comentario
  solo repite lo que dice el código, sobra. Si explica qué se rompía antes y por
  qué la solución es esa, se queda.
- **Un test por hallazgo**, con el caso real en el docstring.
- **Verificar contra el sistema corriendo**, no solo con tests. Los dos bugs de
  arriba salieron así y la suite no los veía.
- Commits que explican el razonamiento, no el diff.
