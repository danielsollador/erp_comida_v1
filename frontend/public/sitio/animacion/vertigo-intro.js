/* Presentación animada de Vertigo Pro (~23 s, con voz).
 *
 * Cómo funciona: cada pieza tiene UNA animación (Web Animations API) que dura
 * todo el clip y queda en pausa; el reloj maestro mueve el `currentTime` de
 * todas a la vez. Con voz, el reloj es el propio audio (así nunca se
 * desincroniza); sin voz, el reloj del navegador. Los tiempos salen del JSON
 * de la voz (`voz-<nombre>.json`: segundo exacto de cada frase), así que si se
 * cambia la voz o el guion, la animación se acomoda sola.
 *
 * Uso: <div data-vp-intro data-base="/sitio/animacion/" data-voz="leda"></div>
 * Para comparar voces en local: ?voz=leda | kore | aoede | zephyr
 */
(() => {
  const VOCES = ['leda', 'kore', 'aoede', 'zephyr'];
  const EASE = 'cubic-bezier(.2,.7,.2,1)';       // la curva del sitio
  const REBOTE = 'cubic-bezier(.34,1.5,.64,1)';
  const SALIDA = 'cubic-bezier(.55,0,.75,.2)';
  const SUAVE = 'cubic-bezier(.65,0,.35,1)';
  const GOLPE = 'cubic-bezier(.7,0,.9,.4)';

  const ICONO = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
    pausa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>',
    otra: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    voz: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    mudo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    chispa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5Z" fill="currentColor"/><path d="M19 15.5c.25 1.9 1.1 2.75 3 3-1.9.25-2.75 1.1-3 3-.25-1.9-1.1-2.75-3-3 1.9-.25 2.75-1.1 3-3Z" fill="currentColor" opacity=".6"/></svg>',
  };

  const letras = (txt, clase = '') => [...txt].map((c) => `<span class="vpi-l${clase}">${c === ' ' ? '&nbsp;' : c}</span>`).join('');
  const estrella = (x, y, r) => {
    const p = [];
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * .42 : r;
      p.push(`${(x + rr * Math.cos(a)).toFixed(2)},${(y + rr * Math.sin(a)).toFixed(2)}`);
    }
    return `<polygon points="${p.join(' ')}"/>`;
  };

  function html(transcripcion) {
    const rotulos = ['Punto de venta', 'Compras y proveedores', 'Producción y recetas', 'Precios y costos'];
    const renglones = [62, 48, 70, 40, 56];
    // ocho estrellas en arco, como en la bandera
    const estrellas = Array.from({ length: 8 }, (_, k) => {
      const a = Math.PI * (0.86 - k * 0.72 / 7);
      return `<svg class="vpi-estrella" viewBox="-6 -6 12 12" style="--x:${(Math.cos(a) * 46).toFixed(2)};--y:${(-Math.sin(a) * 30).toFixed(2)}">${estrella(0, 0, 5.5)}</svg>`;
    }).join('');
    const dias = [38, 46, 41, 52, 68, 100, 57];
    return `
<div class="vpi" data-estado="inicio" role="region" aria-label="Presentación de Vertigo Pro, con voz">
  <p class="vpi-sr">${transcripcion}</p>
  <div class="vpi-camara" aria-hidden="true">
    <div class="vpi-capa"><div class="vpi-halo"></div><div class="vpi-renglones"></div></div>
    <div class="vpi-capa vpi-e1">
      <div class="vpi-palabra">${letras('Vendes.')}</div>
      <div class="vpi-palabra">${letras('Compras.')}</div>
      <div class="vpi-palabra">${letras('Produces,')}</div>
      <div class="vpi-palabra">${letras('o ', ' vpi-tenue')}${letras('calculas.')}</div>
      ${rotulos.map((r) => `<div class="vpi-rotulo">${r}</div>`).join('')}
    </div>
    <div class="vpi-capa vpi-e2">
      <div class="vpi-cuadro-relleno"></div>
      <div class="vpi-onda"></div>
      <div class="vpi-barra"></div><div class="vpi-barra"></div><div class="vpi-barra"></div><div class="vpi-barra"></div>
      <svg class="vpi-check" viewBox="0 0 100 100"><path pathLength="1" d="M22 52 L42 71 L78 31"/></svg>
      <div class="vpi-frase">Todo cuadra <em>solo.</em></div>
    </div>
    <div class="vpi-capa vpi-ev">
      <div class="vpi-estrellas">${estrellas}</div>
      <div class="vpi-titulo">${letras('Hecho para')}<span class="vpi-esp"> </span><br class="vpi-salto"><span class="vpi-brillo-txt">${letras('Venezuela.')}</span></div>
    </div>
    <div class="vpi-capa vpi-tarjetas">
      <div class="vpi-tarjeta">
        <div class="vpi-et"><i></i>Tasas · automáticas</div>
        <div class="vpi-vis"><div class="vpi-tasas">
          <div class="vpi-tasa"><span>BCV $</span><b data-n="877.90">0,00</b></div>
          <div class="vpi-tasa"><span>BCV €</span><b data-n="982.76">0,00</b></div>
          <div class="vpi-tasa"><span>Binance</span><b data-n="1012.05">0,00</b></div>
          <div class="vpi-sinc"><i></i>bcv.org.ve · Binance P2P</div>
        </div></div>
        <div class="vpi-tit">Tasas<br>automáticas</div>
      </div>
      <div class="vpi-tarjeta">
        <div class="vpi-et"><i></i>Brecha cambiaria</div>
        <div class="vpi-vis"><div class="vpi-brecha">
          <svg viewBox="0 0 200 110" preserveAspectRatio="none">
            <defs><pattern id="vpi-rayas" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="6" fill="rgba(239,233,223,.35)"/></pattern></defs>
            <path class="vpi-area" d="M4 70 C60 62 110 46 196 14 L196 74 C120 82 60 86 4 90 Z" fill="url(#vpi-rayas)"/>
            <path class="vpi-linea alta" pathLength="1" d="M4 70 C60 62 110 46 196 14"/>
            <path class="vpi-linea baja" pathLength="1" d="M4 90 C60 86 120 82 196 74"/>
          </svg>
          <div class="vpi-brecha-dato"><small>Brecha</small><b data-n="15.3">0,0</b><small>%</small></div>
          <div class="vpi-perdida">Pérdida del mes <b>−Bs <span data-n="18420">0</span></b></div>
        </div></div>
        <div class="vpi-tit">Pérdida por<br>brecha, calculada</div>
      </div>
      <div class="vpi-tarjeta">
        <div class="vpi-et"><i></i>Pago móvil</div>
        <div class="vpi-vis"><div class="vpi-pago">
          <div class="vpi-monto"><small>Bs</small><span data-n="8779">0,00</span></div>
          <div class="vpi-ok"><svg viewBox="0 0 100 100"><circle pathLength="1" cx="50" cy="50" r="44" transform="rotate(-90 50 50)"/><path pathLength="1" d="M30 52 L45 66 L71 37"/></svg><span class="vpi-pildora">Verificado</span></div>
          <div class="vpi-vuelto"><span>Vuelto</span><b>Bs 221,00</b><em>automático</em></div>
        </div></div>
        <div class="vpi-tit">Pago móvil<br>verificado</div>
      </div>
    </div>
    <div class="vpi-capa vpi-es">
      <div class="vpi-sello">
        <svg viewBox="0 0 200 200">
          <defs><path id="vpi-aro" d="M100 100 m-74 0 a74 74 0 1 1 148 0 a74 74 0 1 1 -148 0"/></defs>
          <circle class="vpi-sello-a" cx="100" cy="100" r="94"/>
          <circle class="vpi-sello-b" cx="100" cy="100" r="58"/>
          <text><textPath href="#vpi-aro" textLength="462">HOMOLOGADO · SENIAT · HOMOLOGADO · SENIAT ·</textPath></text>
          <path class="vpi-sello-check" pathLength="1" d="M76 101 L93 118 L126 83"/>
        </svg>
      </div>
      <div class="vpi-sello-txt">Homologado por el <b>SENIAT</b></div>
    </div>
    <div class="vpi-capa vpi-ef">
      <div class="vpi-tarjeta vpi-factura">
        <div class="vpi-et"><span class="vpi-ia-chip">${ICONO.chispa}IA</span>Compras</div>
        <div class="vpi-vis">
          <div class="vpi-papel">${renglones.map((w) => `<div class="vpi-ren"><span style="width:${w}%"></span><span></span></div>`).join('')}<div class="vpi-escan"></div></div>
          <div class="vpi-mira"><i></i><i></i><i></i><i></i></div>
        </div>
        <div class="vpi-leido"><span>Proveedor</span><span>Renglones</span><span>IVA</span></div>
        <div class="vpi-tit">La IA lee<br>tus facturas</div>
      </div>
    </div>
    <div class="vpi-capa vpi-ec">
      <div class="vpi-chat">
        <div class="vpi-chat-cab"><span class="vpi-ia-chip">${ICONO.chispa}IA</span>Pregúntale a Vertigo</div>
        <div class="vpi-burbuja yo"><span class="vpi-escribe"></span><i class="vpi-cursor"></i></div>
        <div class="vpi-puntos"><i></i><i></i><i></i></div>
        <div class="vpi-burbuja ia">
          <p>Los <b>sábados</b>: vendes un 34 % más que el promedio.</p>
          <div class="vpi-dias">${dias.map((h, k) => `<i style="--h:${h}%"${k === 5 ? ' class="top"' : ''}></i>`).join('')}</div>
        </div>
      </div>
    </div>
    <div class="vpi-capa vpi-e4">
      <div class="vpi-anillo"></div>
      <div class="vpi-chispa"></div>
      <div class="vpi-v">
        <svg viewBox="0 0 100 100"><defs><linearGradient id="vpi-perla" x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stop-color="#f9f6ef"/><stop offset=".5" stop-color="#e9e2d6"/><stop offset="1" stop-color="#cfc6b6"/></linearGradient></defs><path pathLength="1" stroke="url(#vpi-perla)" d="M32 31.5 L50 71 L68 31.5"/></svg>
        <div class="vpi-v-brillo"></div>
      </div>
      <div class="vpi-marca">${letras('Vertigo Pro')}</div>
      <div class="vpi-lema"><span class="vpi-pal">Todo, </span><span class="vpi-pal">impulsado </span><span class="vpi-pal">con</span><br><span class="vpi-pal vpi-ia">inteligencia </span><span class="vpi-pal vpi-ia">artificial.</span></div>
      <div class="vpi-dominio">VERTIGOPRO.TECH</div>
    </div>
  </div>
  <div class="vpi-vineta"></div>
  <button class="vpi-grande" type="button"><span class="vpi-circ">${ICONO.play}</span><span class="vpi-grande-txt"></span></button>
  <div class="vpi-ctrl">
    <button class="vpi-btn vpi-voz" type="button" aria-pressed="false"><span class="vpi-on">${ICONO.voz}</span><span class="vpi-off">${ICONO.mudo}</span><span class="vpi-voz-txt">Escuchar con voz</span></button>
    <button class="vpi-btn solo vpi-pp" type="button" aria-label="Pausar">${ICONO.pausa}</button>
  </div>
  <div class="vpi-progreso"><i></i></div>
</div>`;
  }

  document.querySelectorAll('[data-vp-intro]').forEach(montar);

  async function montar(raiz) {
    const base = raiz.dataset.base || '/sitio/animacion/';
    let voz = (new URLSearchParams(location.search).get('voz') || raiz.dataset.voz || VOCES[0]).toLowerCase();
    if (!VOCES.includes(voz)) voz = VOCES[0];
    let guion;
    try { guion = await (await fetch(`${base}voz-${voz}.json`)).json(); } catch { return; }
    const T = guion.duracion, m = guion.marcas;
    const transcripcion = Object.values(m).map((x) => x.texto).join(' ').replace('Vértigo', 'Vertigo');

    raiz.innerHTML = html(transcripcion);
    const $ = (s) => raiz.querySelector(s), $$ = (s) => [...raiz.querySelectorAll(s)];
    const esc = $('.vpi');
    const audio = new Audio();
    audio.preload = 'none';
    audio.src = `${base}voz-${voz}.mp3`;

    const mqReducido = matchMedia('(prefers-reduced-motion: reduce)');
    let reducido = mqReducido.matches;
    let anims = [], contadores = [];
    let t = 0, estado = 'inicio', conVoz = false, pausaAuto = false, raf = 0, ultimo = 0, esperando = 0, visible = false;

    /* ── Constructor de la línea de tiempo ── */
    function K(el, claves) {
      // claves: [segundo, {propiedades}, curva del tramo que LLEGA a esta clave]
      claves = claves.slice().sort((a, b) => a[0] - b[0]);
      const props = new Set();
      claves.forEach((c) => Object.keys(c[1]).forEach((p) => props.add(p)));
      const fr = claves.map(([s, p]) => ({ offset: Math.min(Math.max(s / T, 0), 1), ...p }));
      props.forEach((p) => {
        let v = fr.find((f) => p in f)[p];
        fr.forEach((f) => { if (p in f) v = f[p]; else f[p] = v; });
      });
      fr.forEach((f, i) => { f.easing = (claves[i + 1] && claves[i + 1][2]) || 'linear'; });
      if (fr[0].offset > 0) fr.unshift({ ...fr[0], offset: 0, easing: 'linear' });
      if (fr[fr.length - 1].offset < 1) fr.push({ ...fr[fr.length - 1], offset: 1, easing: 'linear' });
      const a = el.animate(fr, { duration: T * 1000, fill: 'both' });
      a.pause();
      anims.push(a);
    }
    const tf = (x = 0, y = 0, r = 0, sx = 1, sy = sx) => `translate(${x}px, ${y}px) rotate(${r}deg) scale(${sx}, ${sy})`;
    const t3 = (x = 0, y = 0, rx = 0, s = 1) => `translate(${x}px, ${y}px) rotateX(${rx}deg) scale(${s})`;
    // entra (abajo, inclinado, borroso) → en su sitio
    const entrar = (el, s, x, y, d, extra = {}) => [
      [s, { opacity: 0, transform: t3(x, y + d, 28, .9), filter: 'blur(6px)', ...extra }],
      [s + 0.75, { opacity: 1, transform: t3(x, y, 0, 1), filter: 'blur(0px)' }, EASE],
    ];
    const recoger = (s, x, y, sc = 1) => [
      [s, { opacity: 1, transform: t3(x, y, 0, sc), filter: 'blur(0px)' }],
      [s + 0.42, { opacity: 0, transform: t3(0, 0, 0, .15), filter: 'blur(12px)' }, SALIDA],
    ];
    const contar = (el, t0, t1, b, dec = 2) => contadores.push({ el, t0, t1, b, dec });
    const aparece = (el, s, dy, d = 0.5, curva = EASE) => K(el, [[s, { opacity: 0, transform: tf(0, dy, 0) }], [s + d, { opacity: 1, transform: tf(0, 0, 0) }, curva]]);

    function construir() {
      anims.forEach((a) => a.cancel());
      anims = []; contadores = [];
      const alta = raiz.clientWidth < 600;
      esc.dataset.forma = alta ? 'alta' : 'ancha';
      const W = esc.clientWidth, H = esc.clientHeight;
      const u = Math.min(Math.min(W, H) / 100, 1.25 * W / 100);

      const tV = m.vendes.t, tC = m.compras.t, tP = m.produces.t, tCa = m.calculas.t, tQ = m.cuadra.t;
      const tVz = m.venezuela.t, tTa = m.tasas.t, tBr = m.brecha.t, tPg = m.pago.t, tVu = m.vuelto.t;
      const tSe = m.seniat.t, tFo = m.foto.t, tIa = m.ia.t, tM = m.marca.t, tL = m.cierre.t, tLf = m.cierre.fin;

      /* cámara y fondo */
      K($('.vpi-camara'), [[0, { transform: 'scale(1)' }], [tVz - 0.3, { transform: 'scale(1.03)' }, 'linear'], [tVz + 0.4, { transform: 'scale(1)' }, EASE], [tM - 0.35, { transform: 'scale(1.04)' }, 'linear'], [tM + 0.4, { transform: 'scale(1)' }, EASE], [T, { transform: 'scale(1.03)' }, 'linear']]);
      K($('.vpi-halo'), [
        [0, { transform: tf(-10 * u, 6 * u, 0, .8), opacity: .35 }],
        [tQ, { transform: tf(8 * u, -4 * u, 0, 1), opacity: .7 }, SUAVE],
        [tVz + 0.3, { transform: tf(0, -10 * u, 0, 1.1), opacity: .9 }, SUAVE],
        [tFo, { transform: tf(-8 * u, 4 * u, 0, .95), opacity: .6 }, SUAVE],
        [tM - 0.15, { transform: tf(0, 0, 0, .9), opacity: .55 }, SUAVE],
        [tM + 0.25, { transform: tf(0, 0, 0, 1.25), opacity: 1 }, EASE],
        [T, { transform: tf(0, -6 * u, 0, 1.1), opacity: .8 }, SUAVE],
      ]);
      K($('.vpi-renglones'), [[tQ - 0.1, { opacity: 0, transform: tf(0, 0, 0, 1.08) }], [tQ + 0.5, { opacity: 1, transform: tf(0, 0, 0, 1) }, EASE], [tVz - 0.4, { opacity: 1 }], [tVz + 0.1, { opacity: 0 }, SUAVE]]);

      /* 1 · Vendes. Compras. Produces, o calculas. */
      const inicios = [tV, tC, tP, tCa], finales = [tC, tP, tCa, tQ];
      $$('.vpi-palabra').forEach((pal, i) => {
        const ls = [...pal.children], n = ls.length;
        const fs = parseFloat(getComputedStyle(pal).fontSize);
        ls.forEach((l, j) => {
          const e = inicios[i] - 0.1 + j * 0.026, s = finales[i] - 0.14 + j * 0.012;
          const fuera = i === 3 ? { opacity: 0, transform: tf((j - n / 2) * fs * .08, -fs * .15, 0, .9), filter: 'blur(10px)' } : { opacity: 0, transform: tf(0, -fs * .4, -4), filter: 'blur(8px)' };
          K(l, [
            [e, { opacity: 0, transform: tf(0, fs * .55, 7), filter: 'blur(10px)' }],
            [e + 0.5, { opacity: 1, transform: tf(0, 0, 0), filter: 'blur(0px)' }, EASE],
            [s, { opacity: 1, transform: tf(0, 0, 0), filter: 'blur(0px)' }],
            [s + 0.28, fuera, SALIDA],
          ]);
        });
      });
      $$('.vpi-rotulo').forEach((r, i) => {
        K(r, [
          [inicios[i] + 0.05, { opacity: 0, transform: tf(0, 15 * u + 8, 0) }],
          [inicios[i] + 0.4, { opacity: 1, transform: tf(0, 15 * u, 0) }, EASE],
          [finales[i] - 0.1, { opacity: 1, transform: tf(0, 15 * u, 0) }],
          [finales[i] + 0.1, { opacity: 0, transform: tf(0, 15 * u - 6, 0) }, SALIDA],
        ]);
      });

      /* 2 · cuatro subrayados sueltos que encajan en un cuadro: todo cuadra */
      const S = 28 * u, cy = -7 * u, yb = 9.5 * u;
      const lado = [tf(-S / 2, cy, 90), tf(S / 2, cy, 90), tf(0, cy + S / 2, 0), tf(0, cy - S / 2, 0)];
      const suelta = [tf(-31 * u, -15 * u, -9, .8, 1), tf(32 * u, 13 * u, 12, .8, 1), tf(-26 * u, 17 * u, 7, .8, 1), null];
      $$('.vpi-barra').forEach((b, i) => {
        const claves = [
          [inicios[i], { opacity: 1, transform: tf(0, yb, 0, 0, 1) }],
          [inicios[i] + 0.45, { transform: tf(0, yb, 0, 1, 1) }, EASE],
        ];
        if (suelta[i]) {
          claves.push([finales[i] - 0.05, { opacity: 1, transform: tf(0, yb, 0, 1, 1) }]);
          claves.push([finales[i] + 0.5, { opacity: .35, transform: suelta[i] }, SUAVE]);
        }
        claves.push([tQ + 0.02 + i * 0.05, {}]);
        claves.push([tQ + 0.55 + i * 0.06, { opacity: 1, transform: lado[i] }, REBOTE]);
        K(b, claves);
      });
      K($('.vpi-cuadro-relleno'), [[tQ + 0.6, { opacity: 0, transform: tf(0, cy, 0, .85) }], [tQ + 1.0, { opacity: 1, transform: tf(0, cy, 0, 1) }, EASE]]);
      K($('.vpi-onda'), [[tQ + 0.66, { opacity: 0, transform: tf(0, cy, 0, 1) }], [tQ + 0.7, { opacity: .9 }], [tQ + 1.5, { opacity: 0, transform: tf(0, cy, 0, 1.7) }, EASE]]);
      const chk = $('.vpi-check');
      K(chk, [[tQ + 0.7, { opacity: 0, transform: tf(0, cy, 0) }], [tQ + 0.71, { opacity: 1 }]]);
      K(chk.firstElementChild, [[tQ + 0.72, { strokeDashoffset: 1 }], [tQ + 1.1, { strokeDashoffset: 0 }, SUAVE]]);
      const fy = cy + S / 2 + 10 * u;
      K($('.vpi-frase'), [[tQ + 0.15, { opacity: 0, transform: tf(0, fy + 3 * u, 0), filter: 'blur(8px)' }], [tQ + 0.75, { opacity: 1, transform: tf(0, fy, 0), filter: 'blur(0px)' }, EASE]]);
      K($('.vpi-frase em'), [[tQ + 0.7, { backgroundPosition: '100% 0' }], [tQ + 1.9, { backgroundPosition: '0% 0' }, SUAVE]]);
      K($('.vpi-e2'), [[tVz - 0.4, { opacity: 1, transform: tf(0, 0, 0, 1), filter: 'blur(0px)' }], [tVz - 0.05, { opacity: 0, transform: tf(0, -4 * u, 0, .9), filter: 'blur(8px)' }, SALIDA]]);

      /* 3 · Hecho para Venezuela: ocho estrellas en arco */
      const tituloY = alta ? 9 * u : 6 * u;
      const tit = $('.vpi-titulo'), tfs = parseFloat(getComputedStyle(tit).fontSize);
      K(tit, [[0, { transform: tf(0, tituloY, 0) }]]);
      [...tit.querySelectorAll('.vpi-l')].forEach((l, j) => {
        const e = tVz - 0.08 + j * 0.022;
        K(l, [
          [e, { opacity: 0, transform: tf(0, tfs * .6, 6), filter: 'blur(8px)' }],
          [e + 0.5, { opacity: 1, transform: tf(0, 0, 0), filter: 'blur(0px)' }, EASE],
          [tTa - 0.42 + j * 0.008, { opacity: 1, transform: tf(0, 0, 0), filter: 'blur(0px)' }],
          [tTa - 0.12 + j * 0.008, { opacity: 0, transform: tf(0, -tfs * .4, 0), filter: 'blur(8px)' }, SALIDA],
        ]);
      });
      const ra = alta ? 0.5 * u : 0.36 * u, ey = tituloY - (alta ? 21 : 11) * u;
      $$('.vpi-estrella').forEach((st, k) => {
        const x = parseFloat(st.style.getPropertyValue('--x')) * ra * 2, y = parseFloat(st.style.getPropertyValue('--y')) * ra * 2 + ey;
        const e = tVz + 0.2 + k * 0.06;
        K(st, [
          [e, { opacity: 0, transform: tf(x, y + 3 * u, -60, .2) }],
          [e + 0.5, { opacity: 1, transform: tf(x, y, 0, 1) }, REBOTE],
          [tTa - 0.4 + k * 0.01, { opacity: 1, transform: tf(x, y, 0, 1) }],
          [tTa - 0.1 + k * 0.01, { opacity: 0, transform: tf(x * .6, y - 6 * u, 40, .4) }, SALIDA],
        ]);
      });

      /* 4 · tres tarjetas: tasas, brecha, pago móvil + vuelto */
      const tarjetas = $$('.vpi-tarjetas .vpi-tarjeta');
      const entra = [tTa - 0.25, tBr - 0.2, tPg - 0.2];
      const cae = tSe - 0.4;
      // en PC se van acomodando: una al centro, luego dos, luego las tres en fila;
      // en el teléfono cada una reemplaza a la anterior
      const fila = alta ? [[0], [0, 0], [0, 0, 0]] : [[0], [-0.16 * W, 0.16 * W], [-0.315 * W, 0, 0.315 * W]];
      tarjetas.forEach((c, i) => {
        let x = fila[i][i];
        const e = entra[i] + (alta && i ? 0.12 : 0);
        const claves = entrar(c, e, x, 0, (alta ? 34 : 12) * u);
        let op = 1, s = 1, fuera = false;
        for (let k = i + 1; k < 3; k++) {
          const sig = entra[k];
          claves.push([sig - 0.04, { opacity: op, transform: t3(x, 0, 0, s), filter: 'blur(0px)' }]);
          if (alta) {
            claves.push([sig + 0.4, { opacity: 0, transform: t3(0, -30 * u, -16, .86), filter: 'blur(6px)' }, SALIDA]);
            fuera = true;
            break;
          }
          x = fila[k][i]; op = .5; s = .96;
          claves.push([sig + 0.7, { opacity: op, transform: t3(x, 0, 0, s), filter: 'blur(0px)' }, EASE]);
        }
        if (!fuera) claves.push(...recoger(cae + i * 0.04, x, 0, s));
        K(c, claves);
      });
      // tasas: las tres cifras corren hasta la de hoy
      $$('.vpi-tasa').forEach((r, k) => {
        aparece(r, entra[0] + 0.3 + k * 0.1, 10);
        const b = r.querySelector('b');
        contar(b, entra[0] + 0.35 + k * 0.1, entra[0] + 1.25 + k * 0.1, +b.dataset.n);
      });
      aparece($('.vpi-sinc'), entra[0] + 0.9, 6);
      // brecha: dos curvas, el hueco rayado entre ellas y la pérdida
      const e1 = entra[1] + (alta ? 0.12 : 0);
      $$('.vpi-linea').forEach((l, k) => K(l, [[e1 + 0.3 + k * 0.1, { strokeDashoffset: 1 }], [e1 + 1.1 + k * 0.1, { strokeDashoffset: 0 }, SUAVE]]));
      K($('.vpi-area'), [[e1 + 0.9, { opacity: 0 }], [e1 + 1.3, { opacity: 1 }, EASE]]);
      aparece($('.vpi-brecha-dato'), e1 + 0.8, 8);
      contar($('.vpi-brecha-dato b'), e1 + 0.85, e1 + 1.45, 15.3, 1);
      aparece($('.vpi-perdida'), e1 + 1.15, 8);
      contar($('.vpi-perdida span'), e1 + 1.2, e1 + 1.8, 18420, 0);
      // pago móvil: el monto sube, se dibuja el visto, "Verificado" y el vuelto
      const e2 = entra[2] + (alta ? 0.12 : 0);
      contar($('.vpi-monto span'), e2 + 0.25, e2 + 0.9, 8779);
      const [circ, visto] = $$('.vpi-ok circle, .vpi-ok path');
      K(circ, [[e2 + 0.7, { strokeDashoffset: 1 }], [e2 + 1.1, { strokeDashoffset: 0 }, SUAVE]]);
      K(visto, [[e2 + 1.0, { strokeDashoffset: 1 }], [e2 + 1.28, { strokeDashoffset: 0 }, SUAVE]]);
      K($('.vpi-pildora'), [[e2 + 1.15, { opacity: 0, transform: tf(-8, 0, 0, .6) }], [e2 + 1.55, { opacity: 1, transform: tf(0, 0, 0, 1) }, REBOTE]]);
      K($('.vpi-vuelto'), [[tVu - 0.08, { opacity: 0, transform: tf(0, 10, 0, .96) }], [tVu + 0.4, { opacity: 1, transform: tf(0, 0, 0, 1) }, REBOTE]]);

      /* 5 · el sello del SENIAT cae y marca */
      const sy = -5 * u;
      const sello = $('.vpi-sello');
      K(sello, [
        [tSe + 0.12, { opacity: 0, transform: tf(0, sy, -24, 2.2), filter: 'blur(6px)' }],
        [tSe + 0.37, { opacity: 1, transform: tf(0, sy, -8, .94), filter: 'blur(0px)' }, GOLPE],
        [tSe + 0.6, { transform: tf(0, sy, -8, 1) }, REBOTE],
        [tFo - 0.45, { opacity: 1, transform: tf(0, sy, -8, 1), filter: 'blur(0px)' }],
        [tFo - 0.1, { opacity: 0, transform: tf(0, sy - 4 * u, -8, .9), filter: 'blur(8px)' }, SALIDA],
      ]);
      K(sello.querySelector('text'), [[tSe + 0.4, { opacity: .55 }], [tSe + 1.2, { opacity: 1 }, EASE]]);
      K(sello.querySelector('.vpi-sello-check'), [[tSe + 0.45, { strokeDashoffset: 1 }], [tSe + 0.85, { strokeDashoffset: 0 }, SUAVE]]);
      K($('.vpi-sello-txt'), [
        [tSe + 0.3, { opacity: 0, transform: tf(0, sy + 24 * u, 0), filter: 'blur(8px)' }],
        [tSe + 0.85, { opacity: 1, transform: tf(0, sy + 21 * u, 0), filter: 'blur(0px)' }, EASE],
        [tFo - 0.45, { opacity: 1 }], [tFo - 0.1, { opacity: 0, filter: 'blur(8px)' }, SALIDA],
      ]);

      /* 6 · la IA lee la factura */
      const fac = $('.vpi-factura'), fw = fac.offsetWidth;
      const fs2 = alta ? 1 : 1.12;
      K(fac, [...entrar(fac, tFo - 0.25, 0, 0, (alta ? 30 : 12) * u), [tFo + 0.5, { transform: t3(0, 0, 0, fs2) }, EASE], ...recoger(tIa - 0.45, 0, 0, fs2)]);
      K($('.vpi-mira'), [[tFo + 0.1, { opacity: 0, transform: tf(0, 0, 0, 1.25) }], [tFo + 0.6, { opacity: 1, transform: tf(0, 0, 0, 1) }, EASE], [tFo + 1.9, { transform: tf(0, 0, 0, 1) }], [tFo + 2.05, { transform: tf(0, 0, 0, .96) }, SUAVE], [tFo + 2.25, { transform: tf(0, 0, 0, 1) }, REBOTE]]);
      const s0 = tFo + 0.45, sd = 1.3;
      K($('.vpi-escan'), [[s0, { opacity: 0, transform: tf(0, 0, 0) }], [s0 + 0.1, { opacity: 1 }], [s0 + sd, { opacity: 1, transform: tf(0, .53 * fw, 0) }, SUAVE], [s0 + sd + 0.25, { opacity: 0 }]]);
      $$('.vpi-ren').forEach((r, k) => {
        const s = s0 + sd * ((k + 0.7) / 5.4);
        K(r, [[s, { opacity: .16 }], [s + 0.18, { opacity: 1 }, EASE]]);
      });
      $$('.vpi-leido span').forEach((c, k) => K(c, [[s0 + 0.5 + k * 0.4, { opacity: 0, transform: tf(0, 6, 0, .8) }], [s0 + 0.9 + k * 0.4, { opacity: 1, transform: tf(0, 0, 0, 1) }, REBOTE]]));
      K($('.vpi-factura .vpi-ia-chip'), [[tFo + 0.2, { backgroundPosition: '100% 0' }], [tFo + 1.4, { backgroundPosition: '0% 0' }, SUAVE]]);

      /* 7 · pregúntale a la IA */
      const chat = $('.vpi-chat');
      K(chat, [...entrar(chat, tIa - 0.45, 0, 0, (alta ? 26 : 10) * u), ...recoger(tM - 0.5, 0, 0)]);
      const pregunta = '¿Qué día vendo más?';
      const yo = $('.vpi-burbuja.yo');
      aparece(yo, tIa - 0.15, 10, 0.35);
      contadores.push({ el: $('.vpi-escribe'), t0: tIa - 0.1, t1: tIa + 0.6, texto: pregunta });
      K($('.vpi-cursor'), [[tIa - 0.1, { opacity: 1 }], [tIa + 0.7, { opacity: 1 }], [tIa + 0.71, { opacity: 0 }]]);
      const puntos = $('.vpi-puntos');
      K(puntos, [[tIa + 0.65, { opacity: 0, transform: tf(0, 6, 0) }], [tIa + 0.8, { opacity: 1, transform: tf(0, 0, 0) }, EASE], [tIa + 1.05, { opacity: 1 }], [tIa + 1.15, { opacity: 0 }]]);
      [...puntos.children].forEach((p, k) => {
        const cl = [];
        for (let s = tIa + 0.65 + k * 0.1; s < tIa + 1.2; s += 0.3) cl.push([s, { transform: tf(0, 0, 0) }], [s + 0.15, { transform: tf(0, -4, 0) }, SUAVE], [s + 0.3, { transform: tf(0, 0, 0) }, SUAVE]);
        K(p, cl);
      });
      const ia = $('.vpi-burbuja.ia');
      K(ia, [[tIa + 1.05, { opacity: 0, transform: tf(0, 12, 0, .96), filter: 'blur(6px)' }], [tIa + 1.5, { opacity: 1, transform: tf(0, 0, 0, 1), filter: 'blur(0px)' }, EASE]]);
      $$('.vpi-dias i').forEach((d, k) => K(d, [[tIa + 1.3 + k * 0.05, { transform: 'scale(1, 0)' }], [tIa + 1.9 + k * 0.05, { transform: 'scale(1, 1)' }, REBOTE]]));
      K($('.vpi-chat-cab .vpi-ia-chip'), [[tIa, { backgroundPosition: '100% 0' }], [tIa + 1.2, { backgroundPosition: '0% 0' }, SUAVE]]);

      /* 8 · todo se recoge en un punto y nace la V */
      const vy = -10 * u, my = 12 * u;
      K($('.vpi-chispa'), [[tM - 0.4, { opacity: 0, transform: tf(0, vy, 0, 0) }], [tM - 0.22, { opacity: 1, transform: tf(0, vy, 0, 1) }, EASE], [tM + 0.15, { opacity: 0, transform: tf(0, vy, 0, 5) }, EASE]]);
      K($('.vpi-anillo'), [[tM - 0.22, { opacity: 0, transform: tf(0, vy, 0, .05) }], [tM - 0.18, { opacity: .9 }], [tM + 0.9, { opacity: 0, transform: tf(0, vy, 0, 2.4) }, EASE]]);
      const vPos = (s) => tf(0, vy, 0, s), vArriba = alta ? tf(0, -24 * u, 0, .72) : tf(0, -21 * u, 0, .66);
      K($('.vpi-v'), [[tM - 0.2, { opacity: 0, transform: vPos(.8) }], [tM - 0.18, { opacity: 1 }], [tM + 0.6, { transform: vPos(1) }, EASE], [tL - 0.1, { transform: vPos(1) }], [tL + 0.6, { transform: vArriba }, SUAVE]]);
      K($('.vpi-v path'), [[tM - 0.18, { strokeDashoffset: 1 }], [tM + 0.45, { strokeDashoffset: 0 }, SUAVE]]);
      K($('.vpi-v-brillo'), [[tM + 0.45, { backgroundPosition: '100% 0' }], [tM + 1.35, { backgroundPosition: '0% 0' }, SUAVE], [T - 1.4, { backgroundPosition: '100% 0' }], [T - 0.5, { backgroundPosition: '0% 0' }, SUAVE]]);
      const marca = $('.vpi-marca'), ml = [...marca.children], c = (ml.length - 1) / 2;
      const mfs = parseFloat(getComputedStyle(marca).fontSize);
      const mArriba = alta ? -6 * u : -3 * u;
      K(marca, [[tL - 0.1, { transform: tf(0, my, 0) }], [tL + 0.6, { transform: tf(0, mArriba, 0) }, SUAVE]]);
      ml.forEach((l, j) => {
        const s = tM + 0.05 + Math.abs(j - c) * 0.025;
        K(l, [[s, { opacity: 0, transform: tf((j - c) * mfs * .32, 0, 0), filter: 'blur(8px)' }], [s + 0.75, { opacity: 1, transform: tf(0, 0, 0), filter: 'blur(0px)' }, EASE]]);
      });
      const lemaY = alta ? 13 * u : 13.5 * u;
      const pals = $$('.vpi-lema .vpi-pal');
      const largo = pals.reduce((n, p) => n + p.textContent.length, 0);
      let acum = 0;
      pals.forEach((p) => {
        const s = tL - 0.05 + (tLf - tL) * (acum / largo) * 0.92;
        acum += p.textContent.length;
        K(p, [[s, { opacity: 0, transform: tf(0, mfs * .22, 0), filter: 'blur(6px)' }], [s + 0.5, { opacity: 1, transform: tf(0, 0, 0), filter: 'blur(0px)' }, EASE]]);
      });
      K($('.vpi-lema'), [[0, { transform: tf(0, lemaY, 0) }]]);
      $$('.vpi-lema .vpi-ia').forEach((p) => K(p, [[tLf - 0.6, { backgroundPosition: '100% 0' }], [tLf + 0.8, { backgroundPosition: '0% 0' }, SUAVE]]));
      K($('.vpi-dominio'), [[tLf - 0.3, { opacity: 0, transform: tf(0, (alta ? 34 : 31) * u + 6, 0) }], [tLf + 0.4, { opacity: 1, transform: tf(0, (alta ? 34 : 31) * u, 0) }, EASE]]);

      ir(t);
    }

    /* ── Reloj ── */
    const formatos = {};
    const fmt = (dec) => (formatos[dec] ||= new Intl.NumberFormat('es-VE', { minimumFractionDigits: dec, maximumFractionDigits: dec }));
    function ir(s) {
      const ms = s * 1000;
      for (const a of anims) a.currentTime = Math.min(ms, T * 1000 - 1);
      for (const k of contadores) {
        const p = Math.min(Math.max((s - k.t0) / (k.t1 - k.t0), 0), 1);
        if (k.texto) { k.el.textContent = k.texto.slice(0, Math.round(p * k.texto.length)); continue; }
        const v = k.b * (1 - Math.pow(1 - p, 3));
        k.el.textContent = fmt(k.dec).format(v);
      }
      $('.vpi-progreso i').style.transform = `scaleX(${s / T})`;
    }
    function tick(ahora) {
      if (estado !== 'corriendo') return;
      const dt = Math.min((ahora - ultimo) / 1000, 0.1);
      ultimo = ahora;
      if (conVoz) {
        if (!audio.paused && audio.currentTime > 0) { t = audio.currentTime; esperando = 0; }
        else { esperando += dt; if (esperando > 1.2) t += dt; }   // si el audio no arranca, seguimos sin él
      } else t += dt;
      if (t >= T) { t = T; ir(t); return terminar(); }
      ir(t);
      raf = requestAnimationFrame(tick);
    }
    function sonar(desde) {
      audio.preload = 'auto';
      const p = audio.play();
      if (p) p.catch(() => { conVoz = false; pintar(); });
      if (audio.readyState >= 1) audio.currentTime = desde;
      else audio.addEventListener('loadedmetadata', () => { audio.currentTime = t; }, { once: true });
    }
    function empezar(desde, voz) {
      t = desde; conVoz = voz; pausaAuto = false;
      if (voz) sonar(desde); else audio.pause();
      estado = 'corriendo'; pintar();
      cancelAnimationFrame(raf); ultimo = performance.now(); esperando = 0;
      raf = requestAnimationFrame(tick);
    }
    function pausar(auto) {
      if (estado !== 'corriendo') return;
      estado = 'pausa'; pausaAuto = !!auto;
      audio.pause(); cancelAnimationFrame(raf); pintar();
    }
    function reanudar() { empezar(t, conVoz); }
    function terminar() {
      estado = 'fin'; conVoz = false; audio.pause(); cancelAnimationFrame(raf); pintar();
    }

    /* ── Controles ── */
    const grande = $('.vpi-grande'), bVoz = $('.vpi-voz'), bPP = $('.vpi-pp');
    const segundos = Math.round(T);
    function pintar() {
      esc.dataset.estado = estado;
      const txt = { inicio: `Ver con voz <small>· ${segundos} s</small>`, pausa: 'Continuar', fin: 'Ver de nuevo' }[estado];
      if (txt) {
        $('.vpi-grande-txt').innerHTML = txt;
        $('.vpi-circ').innerHTML = estado === 'fin' ? ICONO.otra : ICONO.play;
      }
      bVoz.setAttribute('aria-pressed', String(conVoz));
      $('.vpi-voz-txt').textContent = conVoz ? 'Silenciar' : 'Escuchar con voz';
      const pp = estado === 'corriendo' ? ['Pausar', ICONO.pausa] : estado === 'fin' ? ['Ver de nuevo', ICONO.otra] : ['Reproducir', ICONO.play];
      bPP.setAttribute('aria-label', pp[0]); bPP.innerHTML = pp[1];
    }
    grande.addEventListener('click', () => (estado === 'pausa' ? reanudar() : empezar(0, true)));
    bVoz.addEventListener('click', () => {
      if (conVoz) { conVoz = false; audio.pause(); pintar(); return; }
      // con la voz se ve desde el principio, salvo que apenas haya empezado
      if (estado !== 'corriendo' || t > 1.2) empezar(0, true);
      else { conVoz = true; sonar(t); pintar(); }
    });
    bPP.addEventListener('click', () => {
      if (estado === 'corriendo') pausar(false);
      else if (estado === 'fin' || estado === 'inicio') empezar(0, conVoz);
      else reanudar();
    });
    audio.addEventListener('ended', () => { if (conVoz && estado === 'corriendo') { t = T; ir(t); terminar(); } });

    /* se ve sola y en silencio cuando entra en pantalla; se pausa al salir */
    new IntersectionObserver((ents) => {
      for (const e of ents) {
        visible = e.isIntersecting;
        if (visible && audio.preload === 'none') audio.preload = 'metadata';
        if (visible && estado === 'inicio' && !reducido) empezar(0, false);
        else if (visible && estado === 'pausa' && pausaAuto) reanudar();
        else if (!visible && estado === 'corriendo') pausar(true);
      }
    }, { threshold: 0.55 }).observe(esc);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) pausar(true);
      else if (visible && estado === 'pausa' && pausaAuto) reanudar();
    });

    let ancho = 0, temporizador = 0;
    new ResizeObserver(() => {
      if (raiz.clientWidth === ancho) return;
      ancho = raiz.clientWidth;
      clearTimeout(temporizador);
      temporizador = setTimeout(construir, anims.length ? 120 : 0);
    }).observe(raiz);
    mqReducido.addEventListener?.('change', (e) => { reducido = e.matches; });

    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    ancho = raiz.clientWidth;
    construir();
    esc.dataset.listo = '';
    // con movimiento reducido no arranca sola (solo con el botón) y el cartel es el cuadro final
    if (reducido) { t = T; ir(T); t = 0; }
    pintar();
    // para revisar un cuadro exacto desde la consola: el.vpi.ver(10.5)
    raiz.vpi = { T, m, ver: (s) => { pausar(false); t = s; ir(s); } };
  }
})();
