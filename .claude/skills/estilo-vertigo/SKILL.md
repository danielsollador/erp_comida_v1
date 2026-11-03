---
name: estilo-vertigo
description: Direccion visual de Vertigo Pro en sus tres superficies (sitio publico vertigopro.tech, hub interno y ERP de cada local) y la capa de marca de cada local, hoy Savora, el unico cliente. Usar SIEMPRE que se cree o retoque una pantalla, pagina, componente, modal, tabla o grafico en erp_comida_v1/frontend (src/ o public/). Reemplaza a estilo-savora.
---

# Estilo Vertigo Pro: claro, quieto, de calidad

Vertigo Pro es el producto; Savora es su primer cliente. El estilo es de
Vertigo, y cada local solo le pone encima su acento, su logo y su nombre.

La meta (Leider, 23-sep-2026): "que se vea espectacular, tipo Apple". Eso no
es copiar a Apple: es la sensacion de producto cuidado. Menos cosas, mejor
puestas. Una pantalla del ERP se debe poder leer de un vistazo desde un metro,
en una tablet de mostrador, con las manos ocupadas y prisa (filosofia
"fight complexity" de `CLAUDE.md`).

Lee tambien `frontend-design`. Si chocan, manda esta skill.

## 1. Dos capas de marca

| Capa | Que define | Donde vive |
|---|---|---|
| **Vertigo** (base) | Neutros papel y grafito, tipografia, espacio, radios, sombras, movimiento, la V. El acento es grafito en claro y perla en oscuro. | `frontend/src/index.css` (bloque `html:not([data-marca="savora"])`), `public/sitio/index.html`, `public/inicio.html`, `public/login.html` |
| **Local** | Solo la escala `--color-acento-*`, el logo, el favicon y el nombre. | `locales/<slug>.json` y un bloque `html[data-marca="<slug>"]` en `index.css` |

- **Savora:** acento cobre (matiz oklch 42, el del logo), logo
  `/logo-savora.png`, favicon `/favicon-savora.png`. `lib/acceso.tsx` pone
  `data-marca` con el slug del local.
- Un componente compartido nunca nombra a Savora ni usa su cobre a mano: usa
  los tokens de acento y la marca los resuelve.
- Un local nuevo no toca componentes: su JSON en `locales/` y, si tiene color
  propio, su escala de acento. Sin color propio, lleva el de Vertigo.
- Exito, aviso y peligro son iguales para todos los locales: significan lo
  mismo en todas partes.

## 2. Las tres superficies

| Superficie | Archivo | Caracter |
|---|---|---|
| **Sitio publico** (`vertigopro.tech`) | `public/sitio/index.html` | Vende. Oscuro por defecto con interruptor a claro. Puede tener un momento expresivo (la V perla con brillo, el grano leve, la entrada del heroe). SEO completo. |
| **Hub** (sistema interno) | `public/inicio.html` | Herramienta del equipo Vertigo: cuentas, locales y gastos. Densidad media, mismos tokens, sin efectos. |
| **ERP** (un local) | `frontend/src` (React + Tailwind 4) | Se trabaja con prisa. Quieto, tactil, modo ligero en tablet. |

El sitio, el hub y el login no comparten hoja de estilos con el ERP: copian
los mismos valores en sus propias variables (`--fondo`, `--tinta`, `--linea`,
`--superficie` o `--sup`). **Si cambias un tono, cambialo en las cuatro
partes** (`index.css`, `sitio/index.html`, `inicio.html`, `login.html`).

## 3. Lo que ya existe y se respeta

- **Neutros** papel y grafito, con un punto de calidez, nunca gris puro:
  `--color-neutral-50` `#f6f4ef` (papel) a `--color-neutral-950` `#0e0f12`.
  Superficie oscura `#161920`.
- **Tokens del ERP:** `--vp-papel`, `--vp-superficie`, `--vp-tinta`,
  `--vp-acento`, `--vp-acento-tinta`, `--vp-acento-suave`, `--vp-textura` y la
  serie `--vp-dato-*` para graficos. Familias `neutral`, `acento`, `exito`
  (152), `aviso` (72) y `peligro` (24), con el mismo L y C por tono.
- **Nunca un hex suelto** dentro de un componente. Si falta un tono, se agrega
  como token.
- **Tipografia:** Sora (titulares), Manrope (texto) y JetBrains Mono (cifras).
  No se agregan familias.
- **Temas:** claro y oscuro con `data-tema`. Todo se prueba en los dos.
- **Modo ligero** (`html.vp-ligero`, `lib/ligero.ts`): en tablet, Punto de
  venta y Cocina no hay `backdrop-filter`, animaciones de entrada ni sombras
  grandes. Lo que solo se ve bien con desenfoque no va.
- **Componentes base:** `components/ui.tsx` (`Pagina`, `Tarjeta`, `Seccion`,
  `Boton`, `Campo`, `Selector`, `Cifra`, `Pastilla`, `Aviso`, `Vacio`,
  `Lecturas`, `Modal`), `Tabla.tsx`, `Secciones.tsx`, `Grafico.tsx`,
  `dialogo.tsx` (`useDialogo`), `Ayuda.tsx` y `lib/glosario.ts`.
  Se extienden; no se duplican con otra version "mas linda" al lado.

## 4. Principios (en orden de importancia)

1. **Jerarquia antes que decoracion.** Una cosa grande por pantalla: la cifra
   que importa, la comanda que toca, el total a cobrar. Si dos cosas compiten,
   una sobra.
2. **Espacio como material.** Padding de 20 a 32 px en tarjetas, gaps de 12 a
   16 px y margenes de seccion de 32 a 48 px. No hacen falta lineas donde el
   espacio ya separa.
3. **Superficies, no cajas.** Radio grande, fondo de superficie, borde de 1 px
   muy sutil (`--vp-textura`) o ninguno, y sombra difusa y baja. En oscuro la
   profundidad sale del tono de la superficie, no de la sombra.
4. **Color con proposito.** Neutros para casi todo. El acento solo para la
   accion principal y el estado activo. Exito, aviso y peligro solo cuando
   significan algo. Maximo un boton con fondo de color entero por pantalla.
5. **Tipografia que respira.** Titulares en Sora con `letter-spacing` de
   -0.01 a -0.025 em y `line-height` de 1.08 a 1.1. Texto en Manrope de 15 a 17
   px con 1.5 de interlineado. Cifras siempre en `tabular-nums`. Prohibido:
   mayusculas por todos lados, una sola palabra del titulo en negrita y grises
   de 11 px como relleno.
6. **Movimiento que responde, no que decora.** Solo se anima lo que el usuario
   acaba de tocar, en 150 a 300 ms, con `cubic-bezier(.2, .7, .2, 1)`. La
   unica excepcion es el heroe del sitio publico.
7. **Tacto primero.** Objetivos de 44 px como minimo (48 px en los botones del
   sitio), `touch-action: manipulation` y estados `active:` visibles. En la
   tablet no existe el hover.
8. **Cero ruido.** Sin iconos de adorno, emojis, gradientes de fondo ni
   numeraciones `01 / 02 / 03` que no sean una secuencia real.
9. **Todo se explica.** Toda cifra o columna lleva su explicacion (`Cifra` y
   `lib/glosario.ts`; `npm run glosario` falla si falta). Las alertas y
   confirmaciones son propias (`useDialogo`, `Modal`), nunca del navegador.

## 5. Reglas propias del sitio publico

- HTML semantico: un solo `h1`, secciones con su `h2`, `nav`, `main` y
  `footer`, y enlace para saltar al contenido.
- `title` y `meta description` unicos, Open Graph, `canonical`, `lang="es"` y
  datos estructurados de la organizacion.
- Imagenes con `alt`, `width` y `height` (sin saltos de diseno) y carga
  diferida debajo del pliegue. Videos sin sonido y con poster.
- Fuentes con `preconnect` y `display=swap`.
- Botones en pildora completa, una sola forma en toda la pagina: `perla`
  (principal) y `borde` (secundario).
- La animacion respeta `prefers-reduced-motion`.

## 6. Como se trabaja una pantalla

1. Levantar el proyecto en local (`levantar-local.ps1` en la raiz del
   repo) y mirar la pantalla actual antes de tocar nada: en claro y en
   oscuro, en tablet (~1024 px) y en telefono (~390 px).
   - ERP: http://localhost:5181
   - Sitio publico: http://localhost:5181/sitio/
   - Hub: http://localhost:5182/inicio.html
   - App movil en el navegador: http://localhost:8081
2. Proponer en dos o tres lineas que cambia y por que. Si el cambio toca mas
   de una pantalla, preguntar antes.
3. Implementar reutilizando los componentes base. Un patron nuevo va en
   `components/` con nombre en espanol y se usa en todas las pantallas que lo
   necesitan, no en una sola.
4. Comprobar que compila (`npx tsc --noEmit` y `npm run build`) y volver a
   mirar en los dos temas, en tablet y telefono, con el modo ligero forzado
   (`localStorage.setItem('vp-ligero','siempre')`) y sin el.
5. Si el cambio es del ERP, mirarlo con la marca de Savora y con la de Vertigo
   (un local sin color propio).
6. Nunca mover lo que la cajera ya sabe usar: los botones de siempre (cobrar,
   enviar, plegar, volver) quedan en el mismo lugar y con el mismo nombre.

## 7. Medidas

| Cosa | Valor |
|---|---|
| Radio de tarjeta y modal | 20 a 24 px (`rounded-2xl`, `rounded-3xl`) |
| Radio de boton | 12 a 14 px en el ERP; pildora completa en el sitio |
| Padding de tarjeta | 20 a 28 px |
| Gap entre tarjetas | 12 a 16 px |
| Titular de pantalla (ERP) | Sora 28 a 34 px, 600, -0.02 em |
| Titular del heroe (sitio) | Sora `clamp(30px, 3.45vw, 50px)`, 700, -0.025 em |
| Titulo de seccion | Sora 18 a 20 px, 600 |
| Cifra KPI | Sora 34 a 44 px, 700, `tabular-nums` |
| Texto | Manrope 15 a 16 px en el ERP, 17 px en el sitio, interlineado 1.5 |
| Nota o ayuda | Manrope 13 px, `neutral-500` (nunca menos de 12 px) |
| Sombra en reposo | `0 1px 2px rgb(0 0 0/.04), 0 8px 24px rgb(0 0 0/.06)` |
| Transicion | 180 a 260 ms, `cubic-bezier(.2, .7, .2, 1)` |
| Ancho maximo del sitio | 1180 px, con 16 px de margen lateral en el telefono |

## 8. Senales de que salio mal

- Se ve "a plantilla": tres KPIs iguales arriba, un gradiente, iconos redondos.
- Hay que leer dos veces para saber que es lo importante.
- El cobre de Savora aparece en el hub, en el sitio o en otro local.
- Un tono cambio en el ERP pero no en el sitio, el hub o el login.
- En oscuro las tarjetas se pierden o brillan de mas.
- En la tablet algo se mueve solo o algo pequeno no se puede tocar.
- Hubo que agregar una fuente, un hex suelto o un `!important`.
