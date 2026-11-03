---
name: estilo-vertigo
description: Guía visual de Vertigo Pro para el sitio público, el hub y el ERP de cada local (hoy Savora). Usar SIEMPRE que se cree o retoque una pantalla, página, componente, modal, tabla o gráfico en frontend/ o movil/.
---

# Estilo Vertigo Pro: claro, quieto, de calidad

"Que se vea espectacular, tipo Apple" (Leider): menos cosas, mejor puestas. Una pantalla del ERP se lee de un vistazo desde un metro, en una tablet, con las manos ocupadas y prisa. Si choca con `frontend-design`, manda esta skill.

## Dos capas de marca

- **Vertigo (base):** neutros papel y grafito, tipografía, espacio, radios, sombras y la V. Acento grafito en claro y perla en oscuro.
- **El local:** solo cambia la escala `--color-acento-*`, el logo, el favicon y el nombre (`locales/<slug>.json` y un bloque `html[data-marca="<slug>"]` en `index.css`). Savora: cobre, matiz oklch 42.
- Un componente nunca nombra a un local ni usa su color a mano. Éxito, aviso y peligro son iguales para todos.

## Tres superficies

| Superficie | Archivo | Carácter |
|---|---|---|
| Sitio público | `public/sitio/index.html` | Vende. Oscuro por defecto. Puede tener un momento expresivo en el héroe. SEO completo. |
| Hub | `public/inicio.html` | Herramienta del equipo. Densidad media, sin efectos. |
| ERP | `frontend/src` | Quieto y táctil, modo ligero en tablet. |

El sitio, el hub y el login copian los tonos en sus propias variables: **un tono que cambia, cambia en los cuatro** (`index.css`, `sitio/index.html`, `inicio.html`, `login.html`).

## Lo que ya existe y se respeta

- Tokens `--vp-*` y familias `neutral`, `acento`, `exito`, `aviso` y `peligro`. **Nunca un hex suelto**: si falta un tono, se crea el token.
- Sora (títulos), Manrope (texto) y JetBrains Mono (cifras). No se agregan fuentes.
- Temas claro y oscuro (`data-tema`). Modo ligero en tablet (`html.vp-ligero`): sin desenfoques, animaciones de entrada ni sombras grandes.
- Componentes base en `components/ui.tsx`, `Tabla`, `Secciones`, `Grafico`, `dialogo.tsx` y `Ayuda`. Se extienden, no se duplican.

## Principios

1. **Una cosa grande por pantalla:** la cifra que importa, la comanda que toca, el total a cobrar.
2. **El espacio separa;** no hacen falta líneas.
3. **Superficies, no cajas:** radio grande, borde sutil o ninguno, sombra baja. En oscuro la profundidad la da el tono.
4. **Color solo con propósito:** el acento para la acción principal; un solo botón de color entero por pantalla.
5. **Tipografía que respira:** cifras en `tabular-nums`; nada de mayúsculas por todos lados ni grises de 11 px.
6. **Solo se anima lo que se acaba de tocar** (150 a 300 ms). Excepción: el héroe del sitio.
7. **Tacto primero:** objetivos de 44 px o más, estados `active:` visibles; en la tablet no hay hover.
8. **Cero ruido:** sin iconos de adorno, emojis ni gradientes de fondo.

## Sitio público

Un solo `h1`, HTML semántico, `title` y `description` únicos, Open Graph, `canonical` y datos estructurados. Imágenes con `alt` y tamaño, carga diferida bajo el pliegue. Botones en píldora (`perla` y `borde`). Respeta `prefers-reduced-motion`.

## Cómo se trabaja una pantalla

1. Mirarla en local antes de tocarla: claro y oscuro, tablet (~1024 px) y teléfono (~390 px).
2. Proponer en dos o tres líneas qué cambia. Si toca más de una pantalla, preguntar.
3. Reutilizar los componentes base; un patrón nuevo va en `components/` y se usa en todas las pantallas que lo necesiten.
4. Volver a mirarla en los dos temas, con y sin modo ligero (`localStorage.setItem('vp-ligero','siempre')`), y con la marca de Savora y la de Vertigo.
5. Lo que la cajera ya sabe usar (cobrar, enviar, volver) no cambia de lugar ni de nombre.

## Medidas

| Cosa | Valor |
|---|---|
| Radio de tarjeta y modal | 20 a 24 px |
| Radio de botón | 12 a 14 px en el ERP; píldora en el sitio |
| Padding de tarjeta / gap | 20 a 28 px / 12 a 16 px |
| Título de pantalla (ERP) | Sora 28 a 34 px, 600 |
| Cifra KPI | Sora 34 a 44 px, 700 |
| Texto / nota | Manrope 15 a 16 px / 13 px (nunca menos de 12) |
| Sombra en reposo | `0 1px 2px rgb(0 0 0/.04), 0 8px 24px rgb(0 0 0/.06)` |
| Transición | 180 a 260 ms, `cubic-bezier(.2, .7, .2, 1)` |

**Salió mal si:** se ve "a plantilla", hay que leer dos veces para saber qué importa, el cobre de Savora aparece fuera del ERP de Savora, un tono cambió en un solo archivo, o hubo que agregar una fuente, un hex suelto o un `!important`.
