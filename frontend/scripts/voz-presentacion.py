"""(Presentación de sitio/animacion) Genera la narración de la animación de Vertigo Pro con Google Cloud TTS.

Sintetiza cada frase por separado, recorta el silencio de los bordes, las une
con pausas medidas, le mezcla efectos sutiles (sintetizados aquí, sin
licencias) en los mismos segundos en que ocurren en la animación, y escribe un
mp3 + un JSON con el segundo exacto en que empieza y termina cada frase.

uso: python voz-presentacion.py "$(gcloud auth print-access-token)" es-US-Chirp3-HD-Leda ../public/sitio/animacion/voz-leda 1.12
(la animación lee los tiempos del JSON; si cambias el guion, cambia también las escenas de vertigo-intro.js)
"""
import base64, json, os, sys, urllib.request, zlib
import numpy as np
import lameenc

TOKEN, VOZ, SALIDA = sys.argv[1], sys.argv[2], sys.argv[3]
VELOCIDAD = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
SR = 24000
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")
os.makedirs(CACHE, exist_ok=True)

# (clave, texto, pausa ANTES de la frase en segundos)
GUION = [
    ("vendes", "Vendes.", 0.40),
    ("compras", "Compras.", 0.14),
    ("produces", "Produces,", 0.14),
    ("calculas", "o calculas.", 0.04),
    ("cuadra", "Y todo cuadra solo.", 0.34),
    ("venezuela", "Hecho para Venezuela.", 0.40),
    ("tasas", "Tasas automáticas,", 0.22),
    ("brecha", "pérdida por brecha cambiaria,", 0.06),
    ("pago", "pago móvil verificado", 0.06),
    ("vuelto", "y vueltos automáticos.", 0.03),
    ("seniat", "Homologado por el Seniat.", 0.32),
    ("foto", "Y la IA lee tus facturas con una foto.", 0.34),
    ("ia", "Pregúntale lo que quieras de tu negocio.", 0.26),
    ("marca", "Vértigo Pro.", 0.45),
    ("cierre", "Todo, impulsado con inteligencia artificial.", 0.16),
]
COLA = 0.7


def sintetizar(clave, texto):
    cache = os.path.join(CACHE, f"{VOZ}-{VELOCIDAD}-{clave}-{zlib.crc32(texto.encode())}.npy")
    if os.path.exists(cache):
        return np.load(cache)
    cuerpo = {
        "input": {"text": texto},
        "voice": {"languageCode": VOZ[:5], "name": VOZ},
        "audioConfig": {"audioEncoding": "LINEAR16", "sampleRateHertz": SR, "speakingRate": VELOCIDAD},
    }
    req = urllib.request.Request(
        "https://texttospeech.googleapis.com/v1/text:synthesize",
        data=json.dumps(cuerpo).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "x-goog-user-project": "vertigo-erp-produccion",
                 "Content-Type": "application/json"},
    )
    datos = base64.b64decode(json.load(urllib.request.urlopen(req))["audioContent"])
    pcm = np.frombuffer(datos[44:], dtype=np.int16).astype(np.float32) / 32768  # salta la cabecera WAV
    env = np.abs(pcm)
    idx = np.where(env > env.max() * 0.02)[0]
    a, b = max(idx[0] - int(.03 * SR), 0), min(idx[-1] + int(.06 * SR), len(pcm))
    clip = pcm[a:b].copy()
    r = int(.008 * SR)
    clip[:r] *= np.linspace(0, 1, r); clip[-r:] *= np.linspace(1, 0, r)
    np.save(cache, clip)
    return clip


# ── efectos ─────────────────────────────────────────────────────────────
rng = np.random.default_rng(7)


def filtrar(x, lo, hi):
    """paso banda por FFT (suficiente para ráfagas cortas)."""
    n = len(x); f = np.fft.rfftfreq(n, 1 / SR); X = np.fft.rfft(x)
    m = ((f >= lo) & (f <= hi)).astype(float)
    k = np.hanning(31); m = np.convolve(m, k / k.sum(), mode="same")
    return np.fft.irfft(X * m, n)


def env_ad(n, ataque, caida):
    t = np.arange(n) / SR
    return np.minimum(t / max(ataque, 1e-4), 1) * np.exp(-np.maximum(t - ataque, 0) / caida)


def tic():
    n = int(.06 * SR); t = np.arange(n) / SR
    ruido = filtrar(rng.standard_normal(n), 2500, 9000) * env_ad(n, .001, .008)
    tono = np.sin(2 * np.pi * 1800 * t) * env_ad(n, .001, .012) * .5
    return (ruido / np.abs(ruido).max() + tono) * .5


def campana(f1, f2, dur=1.1):
    n = int(dur * SR); t = np.arange(n) / SR
    s = sum(a * np.sin(2 * np.pi * f * t) for f, a in ((f1, 1), (f2, .55), (f1 * 2.01, .18)))
    return s * env_ad(n, .004, .28)


def soplo(dur=0.7, lo=500, hi=4000):
    n = int(dur * SR); t = np.arange(n) / SR
    s = filtrar(rng.standard_normal(n), lo, hi) * np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 2 * (t / dur) ** .4
    return s / np.abs(s).max()


def subida(dur=0.85):
    n = int(dur * SR); t = np.arange(n) / SR
    s = filtrar(rng.standard_normal(n), 1500, 11000) * (t / dur) ** 3
    return s / np.abs(s).max()


def golpe():
    n = int(1.4 * SR); t = np.arange(n) / SR
    f = 38 + 34 * np.exp(-t / .07)                          # cae de 72 a 38 Hz
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_ad(n, .003, .45)
    return s + filtrar(rng.standard_normal(n), 200, 2500) * env_ad(n, .001, .012) * .35


def brillo(dur=1.8):
    n = int(dur * SR); t = np.arange(n) / SR
    s = np.zeros(n)
    for f in (2093, 2637, 3136, 3951, 4699):
        s += np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * (0.5 + 0.5 * np.sin(2 * np.pi * rng.uniform(3, 7) * t))
    return s / 5 * env_ad(n, .05, .55)


def poner(pista, s, seg, vol):
    i = int(seg * SR)
    if i < 0: s, i = s[-i:], 0
    j = min(i + len(s), len(pista))
    pista[i:j] += s[: j - i] * vol


# ── armar voz ───────────────────────────────────────────────────────────
partes, marcas, t = [], {}, 0.0
for clave, texto, pausa in GUION:
    partes.append(np.zeros(int(pausa * SR), np.float32)); t += pausa
    clip = sintetizar(clave, texto)
    dur = len(clip) / SR
    marcas[clave] = {"t": round(t, 3), "fin": round(t + dur, 3), "texto": texto}
    partes.append(clip); t += dur
partes.append(np.zeros(int(COLA * SR), np.float32)); t += COLA
voz = np.concatenate(partes).astype(np.float64)
voz = voz / np.abs(voz).max() * .89

# ── efectos en los mismos segundos que la animación (vertigo-intro.js) ──
m = {k: v["t"] for k, v in marcas.items()}
fx = np.zeros_like(voz)
for k in ("vendes", "compras", "produces", "calculas"):
    poner(fx, tic(), m[k] - 0.08, .10)
for d in (0.55, 0.62, 0.67, 0.72):                          # los cuatro lados encajan
    poner(fx, tic(), m["cuadra"] + d, .07)
poner(fx, campana(659.3, 987.8), m["cuadra"] + 0.74, .055)   # visto del cuadro
poner(fx, brillo(1.4), m["venezuela"] + 0.2, .025)           # las ocho estrellas
entra = [m["tasas"] - 0.25, m["brecha"] - 0.2, m["pago"] - 0.2]
for e in entra:
    poner(fx, soplo(), e - 0.12, .05)
poner(fx, campana(880, 1318.5), entra[2] + 1.15, .045)       # "Verificado"
poner(fx, tic(), m["vuelto"] - 0.05, .06)                    # vuelto
poner(fx, subida(.5) * .7, m["seniat"] + 0.15 - 0.5 + 0.22, .04)
poner(fx, golpe() * .8, m["seniat"] + 0.37, .3)              # el sello
poner(fx, soplo(), m["foto"] - 0.37, .05)                     # entra la factura
poner(fx, soplo(1.3, 1200, 6000) * .6, m["foto"] + 0.35, .035)  # línea de escaneo
poner(fx, soplo(.6, 300, 3000), m["ia"] - 0.5, .05)           # entra el chat
for k in range(7):                                            # se escribe la pregunta
    poner(fx, tic(), m["ia"] - 0.15 + k * 0.1, .03)
poner(fx, campana(1046.5, 1568), m["ia"] + 1.1, .04)          # responde la IA
poner(fx, subida(), m["marca"] - 0.12 - 0.85, .06)
poner(fx, golpe(), m["marca"] - 0.12, .42)
poner(fx, brillo(), m["marca"] + 0.4, .03)

mezcla = voz + fx
mezcla = mezcla / max(np.abs(mezcla).max() / .89, 1)
r = int(.3 * SR); mezcla[-r:] *= np.linspace(1, 0, r)
pista = (mezcla * 32767).astype(np.int16)

enc = lameenc.Encoder()
enc.set_bit_rate(64); enc.set_in_sample_rate(SR); enc.set_channels(1); enc.set_quality(2)
with open(SALIDA + ".mp3", "wb") as f:
    f.write(enc.encode(pista.tobytes()) + enc.flush())
with open(SALIDA + ".json", "w", encoding="utf-8") as f:
    json.dump({"voz": VOZ, "duracion": round(t, 3), "marcas": marcas}, f, ensure_ascii=False, indent=1)
print(VOZ, round(t, 2), "s")
