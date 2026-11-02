# Pasar un módulo de la web a la app (React Native / Expo)

Guía común para construir cada módulo de Vertigo Pro / Sávora en la app del
teléfono y la tablet. La app tiene que quedar **igual que la web**: el mismo
contenido, las mismas palabras, el mismo flujo, las mismas validaciones y
avisos, adaptado al pulgar. Leider compara la app contra la web pantalla por
pantalla.

## El producto

ERP para locales de comida en Venezuela (Sávora es el primer local). Lo usan
el dueño (rol `admin`/`dueno`), la cajera, el cocinero y el mesonero. En el
mostrador hay una tablet Fire HD 8 (800×1280); el dueño mira todo desde su
teléfono. Montos en dólares BCV, con vista en bolívares, dólares calle o euros.

## Dónde está cada cosa

| Qué | Dónde |
|---|---|
| La web (fuente de verdad del comportamiento) | `frontend/src/pages/*.tsx`, `frontend/src/pages/partes/**`, `frontend/src/components/**` |
| Las llamadas a la API de la web (rutas, parámetros) | `frontend/src/lib/api.ts` |
| El backend (lo que de verdad hace cada ruta) | `backend/app/routers/*.py`, `backend/app/schemas.py` |
| La app | `movil/src` |

### Dónde va lo tuyo

- Pantallas: `movil/src/app/(app)/<modulo>/index.tsx` y sus subpantallas
  (`[id].tsx`, `nueva.tsx`...). Navegación con Expo Router (`router.push`,
  `useLocalSearchParams`). Es un Stack, sin pestañas abajo.
- Piezas propias del módulo: `movil/src/componentes/<modulo>/*.tsx`.
- Llamadas a la API del módulo: `movil/src/lib/api-<modulo>.ts`, con `req` y
  `rango` de `./api` (mismas reglas: token, 401 = salir, errores en palabras).
- Lógica propia: `movil/src/lib/<modulo>.ts`.

### Lo que NO se toca (lo comparten todos)

`lib/api.ts`, `lib/almacen.ts`, `lib/archivos.ts`, `lib/dialogo.ts`,
`lib/numeros.ts`, `lib/formato.ts`, `lib/carga.ts`, `lib/moneda.tsx`,
`lib/sesion.tsx`, `lib/tema.tsx`, `lib/modulos.ts`, `lib/tipos.ts`,
`componentes/ui.tsx`, `componentes/kit.tsx`, `componentes/Hoja.tsx`,
`componentes/Encabezado.tsx`, `componentes/Icono.tsx`, `componentes/Fondo.tsx`,
`componentes/Seccion.tsx`, `app/_layout.tsx`, `app/(app)/_layout.tsx`,
`app/(app)/index.tsx`, `package.json`, `app.json`, y nada de `frontend/` ni
`backend/`. Si hace falta un cambio ahí, se describe en el informe final.
Otros módulos se están construyendo a la vez en la misma carpeta: solo se
tocan los archivos propios.

## Las piezas que ya existen (úsalas, no las dupliques)

- `componentes/ui.tsx`: `Pantalla` (fondo, márgenes, desliza y refresca;
  `arriba` fijo y `abajo` fijo), `Ficha` (la losa), `Pulsable`, `Etiqueta`,
  `Titulo`, `Nota`, `Cifra`, `Fila` (nombre … valor), `Cargando`, `Problema`
  (error con Reintentar), `Aviso`, `Boton` (acento / neutro / peligro),
  `Campo` (texto con rótulo), `Interruptor`, `Pestanas` (las secciones de la
  web).
- `componentes/kit.tsx`: `useDisposicion()` (`tablet` desde 700 px de ancho),
  `Pastilla`, `Vacio`, `Buscador` y `llano()`, `CampoNumero`, `Contador`
  (− 1 +), `Renglon` (fila tocable de una lista) dentro de `ListaFicha`,
  `Kpi`, `Selector` (uno o varios, con buscador; forma `pastilla` para
  filtros o `campo` para formularios) y `FilaFiltros`, `ElegirPeriodo`,
  `BarraAccion` (total + botón principal fijo abajo), `HojaFormulario`
  (formulario que sube desde abajo, con pie de botones), `PantallaLista`
  (listas largas con FlatList).
- `componentes/Hoja.tsx`: `Hoja` y `OpcionHoja` (menú que sube desde abajo).
- `componentes/Encabezado.tsx`: `Barra titulo="…"` (volver + título + tema),
  va en `Pantalla arriba={…}`.
- `componentes/Icono.tsx`: `<Icono nombre="…" />` con los nombres de
  `frontend/src/lib/iconos.ts` (solo esos).
- `lib/tema.tsx`: `useTema()` (colores; nunca un hex suelto) y `LETRA`
  (Sora para títulos, Manrope para texto, JetBrains Mono para cifras).
- `lib/moneda.tsx`: `useMoneda().fmt(usd)` para TODO monto (sigue la vista
  elegida: $, Bs, € …, con miles: `$2.685,50`).
- `lib/formato.ts`: `miles`, `dolares`, `bolivares`, `hoyEnCaracas`,
  `inicioDelMes`, `fechaDeHoy`.
- `lib/numeros.ts`: `aNumero` (coma o punto), `sinRuido`, `periodoDe`,
  `PERIODOS`, `fechaCorta`, `horaCorta` (el backend guarda la hora local SIN
  zona: se lee tal cual).
- `lib/dialogo.ts`: `confirmar`, `avisar`, `elegir`. **Nunca `Alert`
  directo**: no funciona en la vista web.
- `lib/archivos.ts`: `descargar(ruta, nombre)` (xlsx, csv → compartir) y
  `formularioConArchivo` (subir una foto o un PDF).
- `lib/carga.ts`: `useCarga(fn, segundos, clave)` y `parte()`.
- `lib/sesion.tsx`: `useSesion().acceso` (quién entró; `acceso.puede`:
  `modulos`, `operar`, `administrar`, `autoriza`, `ve_kpis`…).
- `lib/api.ts`: `req`, `rango`, `ErrorApi`, `abrirCanalEnVivo()` (el
  WebSocket `/ws` con el token).
- Tipos: `import type { … } from '../../lib/tipos'` (son los de la web,
  `frontend/src/lib/types.ts`). No se redefinen.
- Lógica pura de la web que se puede importar tal cual (ruta relativa a
  `frontend/src/lib/…`): `types`, `iconos`, `inventario`, `compras`, `pagos`,
  `tiposArticulo`, `unidades`, `menu`, `comandas`, `parecidos`, `paleta`.
  Nada más de `frontend/` (lo demás toca el navegador).

No se agregan dependencias: ya están `expo-image-picker`,
`expo-document-picker`, `expo-file-system`, `expo-sharing`, `expo-haptics`,
`expo-clipboard`, `react-native-svg`, `react-native-reanimated`. Expo SDK 57:
antes de usar una API de Expo, mirar la documentación de esa versión (ver
`AGENTS.md`) o los `.d.ts` en `node_modules`.

## Reglas de Leider (no se negocian)

- **Diseño Sávora**: tranquilo, tipo Apple. Una cosa grande por pantalla;
  aire en vez de líneas; losas de radio 20–24; un solo botón de acento por
  pantalla; toques de 44 px como mínimo; cifras en JetBrains Mono, títulos en
  Sora, texto en Manrope (nunca menos de 13 px); claro y oscuro (siempre los
  colores de `useTema`).
- **Los registros son los protagonistas**: la lista primero; los KPIs son
  complemento.
- **Teléfono primero, tablet también**: `useDisposicion().tablet` para las dos
  columnas donde la web las tiene. Nada se sale de la pantalla ni se monta
  encima de otra cosa; nada de desplazamiento lateral de la página.
- **Palabras**: "unidades", nunca "piezas"; "inventario", nunca "depósito";
  en compras siempre "costo", nunca "precio"; "Costo última compra"; plural
  correcto con `unidadDe` (1 unidad / 2 unidades). Sin recomendaciones de
  precio ni de margen ("precio sugerido", "con margen de…"): el margen lo
  decide el dueño, el sistema solo hace la cuenta.
- Los textos de ayuda, los avisos y las validaciones de la web se copian (en
  español de Venezuela, tuteando).

## Entorno para probar

- Backend local con el código de hoy: `http://127.0.0.1:8021` (datos de
  prueba en SQLite). Usuario de prueba: `qalocal` / `qa-local-2026` (admin).
  Con curl: `POST /api/acceso/login` con la cabecera `X-Vp-App: 1` → el
  token viene en la cabecera `x-vp-token`; después
  `Authorization: Bearer <token>` y `X-Vp-App: 1`.
- Metro ya está corriendo en `http://localhost:8081` (no arrancar otro ni
  matarlo). Vista web para revisar: abrir `http://localhost:8081/<modulo>` en
  el navegador del panel **en una pestaña propia** (`tabs_create`), ponerla de
  teléfono (`resize_window` con `preset: mobile` y tu `tabId`), entrar una vez
  con el usuario de prueba. No tocar las pestañas de otros.
- Antes de terminar: `npx tsc --noEmit` y `npx expo lint` dentro de `movil/`
  sin errores en tus archivos (los de otros pueden estar a medias), y el
  módulo probado contra el backend local: crear, editar, anular, lo que haga.
- No hacer commit ni push: los hace quien coordina.

## Informe final

1. Archivos creados.
2. Tabla de paridad con la web: qué quedó, qué no y por qué.
3. Cambios que hagan falta en archivos compartidos o en el backend.
4. Cómo probarlo (rutas, datos de prueba creados).
