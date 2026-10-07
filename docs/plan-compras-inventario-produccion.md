# Plan: compras → inventario → producción → venta

**Estado (7-oct-2026):** fases 0 a 4 implementadas en la rama `rediseno-flujo`. **No desplegado.** Ver la sección 10 para lo hecho, las decisiones tomadas y lo que queda.
**Para:** Daniel, Leider, Leidy.

---

## 1. Cómo está hoy (revisado en el código y en producción)

En producción hay **25 artículos** (19 "insumo", 6 "reventa") y **solo 1 de los 58 productos del menú tiene receta** (Pastelito Mechada = 0,05 kg carne + 2 discos). Casi no hay datos que migrar: es el momento barato para rediseñar.

| Pieza | Cómo está | Qué choca |
|---|---|---|
| Artículos (`DIM310_INV_INGREDIENTE`) | Una tabla. `tipo` = `insumo` o `reventa`. | Faltan desechable, consumible y preparación. |
| Costeo (`costeo.py`) | Promedio ponderado. El kardex congela el costo de cada movimiento. | Se pidió último costo (ver 3.5). |
| Merma de cocina | `rendimiento_pct` fijo **por artículo**, aplicado al descontar. | El rendimiento es de la **preparación**: el pollo no rinde igual en guiso que a la plancha. |
| Recetas (`REL250`) | Producto del menú → artículos comprados. Un solo nivel. | No hay sub-recetas. |
| Reventa en el menú | Producto del menú y artículo separados; se unen con una receta de 1 unidad hecha a mano. | Hoy **vender una Pepsi no descuenta la Pepsi**: ninguna bebida tiene receta. |
| Cuentas | Las decide la categoría de la **factura**. Todo el inventario va a la 1040 y todo el costo a la 5010. | Una factura mixta (carne + servilletas) no se puede cargar bien. |
| Crear artículo desde Compras | Hay un diálogo con nombre y unidad. Nace siempre como "insumo". **Sin control de duplicados** (ni en la pantalla ni en el servidor). | Así salieron "Crema de Leche Lata", "Crema de Leche Liquida Apoyo" y "Crema de leche"; "MASA" junto a "Disco (Masa)"; "Maiz lata 400g" medido en kg. |

---

## 2. Decisiones de diseño

1. **El tipo es del artículo, no de la factura.** Cada renglón se reparte a su cuenta según el tipo de su artículo. La categoría de factura queda solo para lo que no tiene renglones (servicios, alquiler, luz).
2. **Cinco tipos:** materia prima, reventa, consumible, desechable y **preparación** (guiso, mechada, salsa: no se compra, se produce).
3. **Artículo ≠ presentación.** El artículo es genérico ("Crema de leche", en kg). La lata de 250 g es una **presentación del proveedor** con su conversión. Ya existe dónde guardarla: la memoria de equivalencias por proveedor (`DIM420_COM_EQUIVALENCIA`). Mezclar las dos cosas es la causa principal de los duplicados.
4. **Consumible o desechable:** si la receta puede decir "1 por unidad vendida", es consumible (vaso, pitillo). Si no, desechable (servilleta). La bolsa para llevar se trata como desechable.
5. **Genérico desde el principio, pensando en el cliente #2:**
   - "Crudo y preparado" son **ubicaciones** configurables (depósito, cocina, barra, vitrina; a futuro otra sede), no dos estados fijos.
   - La vida útil se configura por preparación.
   - El modo de producción se elige por preparación.

---

## 3. Modelo de datos

### 3.1 Tipos y cuentas

| Tipo | Stock | Al comprar | Al consumir/vender |
|---|---|---|---|
| Materia prima | Sí | 1041 Inventario materia prima | 5011 Costo de ventas – materia prima |
| Reventa | Sí | 1042 Inventario reventa | 5012 Costo de ventas – reventa |
| Consumible | Sí | 1043 Inventario empaques | 5013 Costo de ventas – empaques |
| Preparación | Sí, o se descuenta del crudo (3.3) | — (se produce) | Se consume dentro de recetas |
| Desechable | **No** | 6050 Desechables y suministros (gasto) | — |

- Tabla **tipo → cuenta**. La categoría de depósito puede tener cuenta propia (opcional, para excepciones). El usuario nunca elige cuenta.
- Cada renglón de factura congela su tipo y su cuenta al guardarse.
- **Migración contable:** las cuentas 1041/1042/1043 serían subcuentas de la 1040 actual y las 5011/5012/5013 de la 5010. Los reportes que hoy leen 1040 y 5010 suman sus subcuentas. Los saldos actuales se reclasifican con un asiento de apertura por tipo. Esto necesita su propia ficha antes de implementarse.

### 3.2 Recetas en varios niveles

```
Receta       dueño (producto del menú | preparación) · rinde (cantidad, unidad)
LineaReceta  receta · artículo (cualquier tipo, incluida otra preparación) · cantidad
```

- Guiso de pollo: *1 kg pollo + 100 g cebolla + 50 g pimentón → rinde 0,85 kg*. Así lo dicta la cocina, por kilo, y el sistema escala.
- Pastelito de pollo: *50 g guiso de pollo + 1 disco + 1 bolsita*.
- Costo de una preparación = costo de sus líneas ÷ rendimiento. Es recursivo, protegido contra ciclos (una receta no puede contenerse a sí misma) y guardado en caché: se recalcula cuando cambia una compra o una receta, no en cada venta.
- El `rendimiento_pct` del artículo pasa a la receta de la preparación. Hoy todos los artículos están al 100 %: la migración es trivial.
- Reventa: al crear el artículo se ofrece "¿Venderlo en el menú?". Si sí, se crea el producto con su receta de 1 unidad.

### 3.3 Producción: opcional de verdad

Cada preparación elige su modo:

- **Descontar del crudo** (por defecto). Al vender un pastelito, el sistema baja la receta (pastelito → guiso → pollo, cebolla…) y descuenta el crudo con el rendimiento estándar. Es la idea de Leidy. **No pide nada a la cocina.**
- **Producir y registrar** (para quien quiera precisión). Pantalla "Producción del día":
  - se elige la preparación y se escribe **un número: cuánto salió**;
  - el sistema propone los ingredientes escalados y se pueden corregir;
  - con la vida útil, lo que sobra se ofrece al cierre como merma de preparado (6020).

El sistema funciona completo en el primer modo; el segundo mejora la precisión pero nunca se exige. Con los rendimientos reales registrados, el sistema sugiere corregir el estándar ("las últimas 10 tandas rindieron 0,78, no 0,85").

### 3.4 Costo teórico vs. real (el control que no depende de la cocina)

Reporte por período:
- lo que **debió** consumirse según recetas y ventas;
- lo que **dice el conteo físico**;
- la diferencia, por artículo y en dinero.

Es la métrica clave de cualquier restaurante (*food cost* teórico vs. real). Con un conteo semanal del crudo, el desvío (merma real, porciones grandes, robo) aparece sin que nadie registre producción a diario.

### 3.5 Costeo

**El último costo no sirve para valorar inventario según VEN-NIF / NIC 2**, que solo aceptan promedio o PEPS. Por eso se separa:

- **Costo contable** (libros, inventario valorizado): promedio ponderado. Ya está implementado y no cambia.
- **Costo para precios y márgenes**, configurable: último costo, promedio o el mayor de los dos. El último costo ya está en el kardex, así que es una opción de configuración.

### 3.6 Materia prima compartida

- La pantalla de disponibilidad muestra, por preparación, cuánto se podría hacer con el crudo actual, marcando "comparte pollo con: guiso ranchero".
- Un planificador simple: "hoy hago 3 kg de guiso de pollo" → el resto se recalcula con lo que queda.
- Con 3 o 4 preparaciones no hace falta un optimizador.

---

## 4. Antiduplicados

1. **Búsqueda mientras se escribe** en la ventana de crear: coincidencias aproximadas (tolera errores de tipeo y orden de palabras), cada una con su unidad, stock y último proveedor, y un botón **"Usar este"**. Para crear igual: **"No, es otro artículo"**.
2. **Nombre genérico + presentación:** se propone un nombre limpio desde el papel (sin marca, tamaño ni palabras repetidas) y la presentación queda en la memoria del proveedor.
3. **Bloqueo en el servidor:** si el nombre normalizado ya existe, se rechaza y se devuelve el existente.
4. **Fusionar artículos:** juntar dos en uno moviendo kardex, recetas, compras y equivalencias. Ya existe para las categorías de depósito.
5. **Ficha mínima:** nombre, tipo, unidad y exento de IVA. El resto, después, en Inventario.

---

## 5. Aceite de freír (y gas)

- En la industria es un **costo indirecto de fabricación** (CIF), y se prorratea.
- **Recomendado: prorrateo por unidades fritas.**
  - El aceite entra a inventario como materia prima.
  - Al cargar la freidora se registra "cargué 5 L", y eso pasa a costo.
  - Cada mes el sistema calcula **litros consumidos ÷ piezas fritas vendidas** = costo de aceite por pieza.
  - Ese estándar se suma al costo de los productos marcados "se fríe".
- Nadie necesita saber cuánto aceite lleva un pastelito.
- El gas se prorratea igual, por mes.

---

## 6. Evaluación del plan

| Perspectiva | Nota | Riesgo principal y cómo se atiende |
|---|---|---|
| Dueño | 8 | El beneficio grande llega en la fase 2. |
| Operación (cocina/caja) | 6 → 8 | La disciplina de registrar a diario se abandona. **Atendido:** la producción es opcional y el control lo da el conteo semanal (3.4). |
| Contador | 8 | Partir 1040/5010 requiere migración de saldos con ficha propia (3.1). |
| Arquitectura | 7 → 8 | Ciclos y rendimiento del costeo recursivo (3.2); ubicaciones genéricas en vez de estados fijos (2.5). |
| Experiencia de usuario | 7 | La disponibilidad con insumos compartidos debe diseñarse con cuidado. |
| Riesgo de alcance | 6 | Serían 4–6 semanas. Cada fase se entrega sola y sirve sola; la fase 3 puede no hacer falta nunca. |
| Producto (vender a otros) | 8 | Faltan piezas para restaurantes más grandes (sección 7). |

**Global: 7/10** tal como se planteó al inicio. **8,5/10** con los ajustes ya incluidos en este documento: producción opcional, costo teórico vs. real, ubicaciones genéricas y migración contable aparte.

---

## 7. ¿Escala?

**Sí: mejora el producto, no es una personalización.** Recetas multinivel, rendimiento por preparación, costeo en cadena, tipos con cuenta, producción y prorrateo de indirectos son la base de cualquier sistema para restaurantes. Sin eso Sávora no se puede vender a uno más grande.

Para que no quede a la medida, se hace genérico desde el inicio: ubicaciones, vida útil y modo de producción configurables, y método de costeo para precios configurable.

**Lo que pedirá un restaurante más grande** (fuera de este plan):
- modificadores con receta ("extra queso", "sin cebolla");
- lotes y vencimiento;
- órdenes de compra y stock mínimo por ubicación;
- recetas por sede;
- alérgenos.

---

## 8. Fases

| Fase | Contenido | Por qué en este orden |
|---|---|---|
| **0. Limpieza** | Bloqueo de duplicados en el servidor; búsqueda de parecidos en la ventana de crear; fusionar artículos; fusionar los duplicados actuales | Todo lo demás se construye sobre datos limpios |
| **1. Tipos y cuentas** | 5 tipos; tabla tipo → cuenta; factura mixta repartida por renglón; desechable directo a gasto; reventa con su producto del menú; migración contable | Arregla Compras y la venta de reventa |
| **2. Sub-recetas** | Receta multinivel; rendimiento en la preparación; costeo en cadena; descuento del crudo al vender; costo teórico vs. real | **El costo del pastelito queda real.** La cocina carga sus recetas por kilo |
| **3. Producción (opcional)** | Ubicaciones; producción del día; sobrantes por vida útil; rendimiento real vs. estándar; disponibilidad compartida | Precisión, cuando la operación lo pida |
| **4. Refinar** | Costo para precios configurable; aceite y gas prorrateados; reportes de rendimiento | Pulido sobre base firme |
| 5–6 (después) | Modificadores con receta; lotes y vencimiento | Para restaurantes más grandes |

## 9. Decisiones pendientes

1. ¿Separar costo contable (promedio) y costo para precios (configurable)?
2. ¿Producción opcional (descontar del crudo por defecto)?
3. Cuando el crudo no alcanza: ¿bloquear la venta o solo avisar? (Hoy se permite vender en negativo.)
4. ¿Las subcuentas 1041–1043 / 5011–5013 y la 6050, o mantener 1040/5010 con desglose solo en reportes?

---

## 10. Implementación (rama `rediseno-flujo`, sin desplegar)

### Decisiones tomadas para avanzar
Se pueden cambiar; están aisladas en el código.

1. **Costo:** el costo contable sigue siendo el promedio ponderado. El costo para fijar precios es configurable y por defecto usa el último costo (Inventario → Control).
2. **Producción opcional:** cada preparación elige su modo. Por defecto «se descuenta del crudo» y nadie anota nada.
3. **Crudo insuficiente:** se mantiene lo de hoy. La venta respeta el interruptor «vender sin inventario» y la producción nunca se bloquea: queda en negativo y el conteo lo corrige.
4. **Cuentas:** NO se partió la 1040 ni la 5010. Partirlas tocaba todos los asientos y reportes que existen. Se agregó solo la **6050 Desechables y suministros**. El desglose por tipo se puede sacar del kardex en un reporte.

### Qué hay por fase
| Fase | Backend | Pantalla |
|---|---|---|
| 0 | Bloqueo de nombres iguales; limpieza de palabras repetidas; `POST /inventario/ingredientes/{id}/fusionar` | Ventana «Mercancía nueva» con parecidas; «fusionarlas» en la ficha |
| 1 | Tipos `insumo` (materia prima), `reventa`, `consumible`, `desechable`, `preparacion`. Cada renglón de factura guarda su cuenta (`TRX411.cuenta`): desechable → 6050 sin stock. Notas de crédito repartidas igual. `POST /menu/desde-mercancia/{id}` | 4 tipos en la ventana nueva y en la ficha; «Venderla en el menú» en la reventa; las recetas no ofrecen desechables ni aceite |
| 2 | `REL311_INV_PREPARACION_DET` (receta por tanda) + `rinde`. Costo en cadena con protección contra ciclos (`Ingrediente.costo_efectivo`). La venta baja hasta la materia prima (`costeo.explotar`) | Inventario → Preparaciones: editor con escalador «para hacer X kg» |
| 3 | `TRX360_INV_PRODUCCION`; `POST /inventario/produccion` (sale el crudo y entra la preparación al mismo valor; guarda el rendimiento real); lo producido se vende primero y lo que falta sale del crudo; `/preparaciones/vencidas`; `/preparaciones/disponibilidad` con insumos compartidos | Anotar tanda; botar lo vencido; «usar el rendimiento real»; cuánto podrías hacer hoy |
| 4 | `/inventario/costo-teorico`; aceite: `es_indirecto` + `cargar-indirecto` (5010/1040) + `/inventario/indirectos` por pieza (`Variante.se_frie`); `Configuracion.costo_para_precios`; el costo del menú incluye el indirecto y el costo de reposición de las preparaciones | Inventario → Control: teórico vs real, aceite por pieza y qué se fríe, método de costo para precios |

### Límites conocidos
- **Editar una comanda:** lo que se agrega sale como en la venta (lo producido primero); lo que se quita de una preparación que se produce vuelve (o se pierde) como la preparación misma, y lo que se descuenta del crudo vuelve por la receta (`costeo.explotar`, modo `devolucion`).
- **Venta que mezcla lo producido y el crudo:** el costo congelado en la venta usa el promedio de lo producido mientras haya existencia. Si una venta toma parte de lo producido y parte del crudo, el costo puede diferir unos centavos del valor del kardex.
- **Pruebas en pantalla:** recorridas en local el 7-oct (Inventario completo, Compras, ficha, Preparado, «Sobró hoy», conteo). Falta recorrerlas en la tablet y en el teléfono real antes de desplegar.

### Pantallas (7-oct, pizarra de Leider y Daniel)
Inventario se reconstruyó alrededor de los **cuatro almacenes**; Compras se ajustó para alimentarlos. Lo nuevo:

| Dónde | Qué |
|---|---|
| Inventario → Almacenes | Portada con las cuatro fichas (materia prima, reventa, consumible, desechable): mercancías, plata en stock (o gastado, en desechables), bajo mínimo y el camino de cada una. Debajo, «Qué comprar» y «Control» resumidos. |
| Inventario → Materia prima | Dos caras: **Crudo** (tabla con aprovechable y costo real) y **Preparado** (`Preparaciones.tsx`): tarjetas con «podrías hacer hoy», qué la limita, con quién compite, la receta y **«Sobró hoy»** → `POST /inventario/preparaciones/{id}/sobrante` (`guardar` no mueve nada; `botar` saca el crudo por la receta como merma, o la preparación misma si se produce). |
| Inventario → Reventa / Consumible | Tabla con «vale» (stock × costo). |
| Inventario → Desechable | Sin stock: lo gastado en el período por mercancía y por proveedor (sale de los renglones de factura, que ahora traen `tipo` y `cuenta`). |
| Inventario → Control | Un solo sitio con cuatro vistas: debió salir vs. hay, pérdidas (mermas + conteos que sumaron), conteos hechos, aceite y costo para precios. Usa el período de la barra. |
| Conteo físico | Acepta preparado: «hay 0,8 kg de guiso» se traduce a crudo y se suma a lo contado de cada materia prima (`ResultadoConteo.no_contadas` avisa si falta alguna). |
| Ficha de mercancía (`FichaMercancia.tsx`) | Selector de tipo con las cuatro fichas, «cómo te llega» (las presentaciones recordadas por proveedor), sin la unidad «paquete» para fichas nuevas. |
| Compras → Cargar factura | Tres pasos (la factura, qué trae, el pago). Cada renglón busca su mercancía escribiendo, muestra su tipo con color y puede marcar **«viene en caja o paquete»** (2 cajas de 24 a $12 → entran 48 a $0,50); las presentaciones escritas a mano también se aprenden (`POST /compras/equivalencias/aprender`). «A dónde va la plata» por tipo. |
| Compras → Facturas | Comprado / al depósito / a gasto / por pagar; «a dónde fue la plata» del período; cada factura con los puntos de sus almacenes y su detalle plegable. |
| Mercancía nueva | Nombre con parecidas, qué es (cuatro fichas), se lleva en, **cómo te llega** (suelta, o en caja de N: la presentación queda para ese proveedor). |

Código compartido: `lib/tiposArticulo.ts` (`ALMACENES`, color e ícono por tipo), `components/compras/Almacenes.tsx` (`PuntoTipo`, `SelloTipo`, `ElegirAlmacen`, `DestinoPlata`), `components/compras/ElegirMercancia.tsx`, `lib/inventario.ts`.

Correcciones de la revisión del 7-oct: fusionar mueve las recetas de preparaciones y rechaza tipos distintos y ciclos; editar una comanda devuelve lo producido como producido; los duplicados ya existentes se pueden editar sin cambiarles el nombre; una preparación rinde 100 % a nivel de ficha (la merma va solo en `rinde`).

### Lo que queda (fase 5 en adelante)
- **Ubicaciones de stock** (depósito / cocina / barra / sede). Toca todos los caminos del stock, así que va en su propia fase.
- Modificadores con receta («extra queso»), lotes y vencimiento.
- Partir 1040 y 5010 en subcuentas por tipo, si el contador lo pide.
- Al desplegar: fusionar los duplicados reales de producción (las 3 cremas de leche; MASA / Disco (Masa)) y clasificar los artículos existentes con los tipos nuevos.
