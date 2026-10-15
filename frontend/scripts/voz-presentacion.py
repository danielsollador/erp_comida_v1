"""Narración + música de la presentación animada de Vertigo Pro (sitio/animacion).

- Voz: Google Cloud TTS (Chirp3-HD). Se sintetizan FRASES completas (no palabra
  por palabra) para que fluya; dentro de cada frase, el segundo de cada parte
  se saca de las pausas que la propia voz hace en las comas.
- Tratamiento "futurista": aire en los agudos, un doblaje muy leve y un espacio
  corto (reverb sintética). Nada robótico.
- Cama musical sintetizada aquí (sin licencias): pad, bajo con pulso, arpegio en
  la parte de la IA, subida y golpe en la marca. Se agacha cuando habla la voz.
- Escribe <salida>.mp3 y <salida>.json con el segundo de cada momento; la
  animación (vertigo-intro.js) se sincroniza con ese JSON.

uso: python voz-presentacion.py "$(gcloud auth print-access-token)" es-US-Chirp3-HD-Despina ../public/sitio/animacion/voz-despina 0.98
"""
import base64, json, os, sys, tempfile, urllib.request, zlib
import numpy as np
from scipy import signal
import lameenc

TOKEN, VOZ, SALIDA = sys.argv[1], sys.argv[2], sys.argv[3]
VELOCIDAD = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
SR = 24000
CACHE = os.path.join(tempfile.gettempdir(), "vertigo-voz-cache")
os.makedirs(CACHE, exist_ok=True)
rng = np.random.default_rng(7)

# (pausa ANTES, texto, nombres de las partes separadas por las comas)
# Leider (15-oct): "calmalo, que todo vaya en su momento, más que todo al
# inicio y en lo del teléfono". Cada idea es su propio clip, con aire entre una
# y otra para que la animación respire.
GUION = [
    (0.70, "Vendes,", ["vendes"]),
    (0.45, "compras,", ["compras"]),
    (0.45, "produces o calculas,", ["produces"]),
    (0.45, "y todo cuadra solo.", ["cuadra"]),
    (0.80, "Hecho para pymes venezolanas.", ["venezuela"]),
    (0.60, "Tasas automáticas.", ["tasas"]),
    (0.50, "Pérdida por brecha cambiaria.", ["brecha"]),
    (0.50, "Pago móvil verificado,", ["pago"]),
    (0.30, "y vueltos automáticos.", ["vuelto"]),
    (0.70, "Homologado por el Seniat.", ["seniat"]),
    (0.90, "Y en el centro de todo,", ["ia"]),
    (0.25, "la IA.", ["ia2"]),
    (0.70, "Lee tus facturas con una foto.", ["foto"]),
    (0.70, "Te predice qué comprar,", ["que"]),
    (0.30, "cuándo,", ["cuando"]),
    (0.30, "y dónde te sale mejor.", ["donde"]),
    (0.60, "Y responde todo lo que le preguntes.", ["chat"]),
    (0.90, "Y en tu teléfono,", ["app"]),
    (0.30, "tu negocio en vivo.", ["vivo"]),
    (0.60, "Con alertas,", ["alertas"]),
    (0.40, "recomendaciones,", ["recomendaciones"]),
    (0.40, "y permisos, al instante.", ["permisos"]),
    (0.90, "Vértigo Pro.", ["marca"]),
    (0.30, "Todo, impulsado con inteligencia artificial.", ["cierre"]),
]
COLA = 1.8


# ── voz ─────────────────────────────────────────────────────────────────
def sintetizar(texto):
    cache = os.path.join(CACHE, f"{VOZ}-{VELOCIDAD}-{zlib.crc32(texto.encode())}.npy")
    if os.path.exists(cache):
        return np.load(cache)
    cuerpo = {"input": {"text": texto}, "voice": {"languageCode": VOZ[:5], "name": VOZ},
              "audioConfig": {"audioEncoding": "LINEAR16", "sampleRateHertz": SR, "speakingRate": VELOCIDAD}}
    req = urllib.request.Request("https://texttospeech.googleapis.com/v1/text:synthesize", data=json.dumps(cuerpo).encode(),
                                 headers={"Authorization": f"Bearer {TOKEN}", "x-goog-user-project": "vertigo-erp-produccion",
                                          "Content-Type": "application/json"})
    datos = base64.b64decode(json.load(urllib.request.urlopen(req))["audioContent"])
    pcm = np.frombuffer(datos[44:], dtype=np.int16).astype(np.float64) / 32768
    env = np.abs(pcm)
    idx = np.where(env > env.max() * 0.02)[0]
    a, b = max(idx[0] - int(.03 * SR), 0), min(idx[-1] + int(.08 * SR), len(pcm))
    clip = pcm[a:b].copy()
    r = int(.008 * SR)
    clip[:r] *= np.linspace(0, 1, r); clip[-r:] *= np.linspace(1, 0, r)
    np.save(cache, clip)
    return clip


def partes(clip, n, texto):
    """inicio (s) de cada una de las n partes: las n-1 pausas más largas."""
    if n == 1:
        return [0.0]
    hop = int(.01 * SR)
    rms = np.sqrt(np.maximum(signal.oaconvolve(clip ** 2, np.ones(hop * 2) / (hop * 2), "same"), 0))[::hop]
    callado = rms < rms.max() * 0.06
    huecos, i = [], 0
    while i < len(callado):
        if callado[i]:
            j = i
            while j < len(callado) and callado[j]:
                j += 1
            if i > 5 and j < len(callado) - 5 and j - i >= 4:   # >= 40 ms, no en los bordes
                huecos.append((j - i, j * hop / SR))
            i = j
        else:
            i += 1
    # dónde "debería" caer cada coma según las letras; a cada una se le asigna
    # la pausa más larga cerca de ahí (las pausas dentro de una palabra son cortas)
    trozos = texto.split(",")
    tot = sum(len(x) for x in trozos); acc, esperado = 0, []
    for x in trozos[:-1]:
        acc += len(x); esperado.append(acc / tot * len(clip) / SR)
    elegidos, usados = [], set()
    for e in esperado[: n - 1]:
        mejor = max((h for h in huecos if h[1] not in usados), key=lambda h: h[0] * 0.01 - abs(h[1] - e) * 0.6, default=None)
        if mejor is None or abs(mejor[1] - e) > 0.9:
            elegidos.append(e); print("  (por letras)", texto[:30], round(e, 2))
        else:
            elegidos.append(mejor[1]); usados.add(mejor[1])
    return [0.0] + [round(t - 0.02, 3) for t in sorted(elegidos)]


def filtro(x, tipo, f, orden=2):
    sos = signal.butter(orden, f, btype=tipo, fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def estante_agudos(x, f, db):
    alto = filtro(x, "highpass", f)
    return x + alto * (10 ** (db / 20) - 1)


def reverb(x, dur=1.2, mezcla=.12):
    n = int(dur * SR)
    ir = rng.standard_normal(n) * np.exp(-np.arange(n) / (SR * dur / 6.5))
    ir = filtro(ir, "lowpass", 6000); ir[: int(.022 * SR)] = 0
    ir /= np.sqrt((ir ** 2).sum())
    mojado = signal.fftconvolve(x, ir)[: len(x)]
    return x + mojado * mezcla * 3


# ── armar la voz ────────────────────────────────────────────────────────
trozos, marcas, t = [], {}, 0.0
for pausa, texto, nombres in GUION:
    trozos.append(np.zeros(int(pausa * SR))); t += pausa
    clip = sintetizar(texto)
    dur = len(clip) / SR
    inis = partes(clip, len(nombres), texto)
    for k, nom in enumerate(nombres):
        fin = inis[k + 1] if k + 1 < len(nombres) else dur
        marcas[nom] = {"t": round(t + inis[k], 3), "fin": round(t + fin, 3)}
    marcas[nombres[0]]["texto"] = texto
    trozos.append(clip); t += dur
trozos.append(np.zeros(int(COLA * SR))); t += COLA
voz = np.concatenate(trozos)
voz = filtro(voz, "highpass", 90)
voz = estante_agudos(voz, 5500, 3.5)
doble = np.concatenate([np.zeros(int(.013 * SR)), voz])[: len(voz)]
voz = voz + filtro(doble, "highpass", 1200) * .12           # brillo de doblaje, muy leve
voz = reverb(voz, 1.1, .11)
voz = voz / np.abs(voz).max() * .89
N = len(voz)
m = {k: v["t"] for k, v in marcas.items()}

# ── cama musical ────────────────────────────────────────────────────────
def hz(nota):  # 'A2', 'C#4'
    nombres = {"C": -9, "C#": -8, "D": -7, "D#": -6, "E": -5, "F": -4, "F#": -3, "G": -2, "G#": -1, "A": 0, "A#": 1, "B": 2}
    return 440 * 2 ** ((nombres[nota[:-1]] + 12 * (int(nota[-1]) - 4)) / 12)


TEMPO = 96; PULSO = 60 / TEMPO; COMPAS = PULSO * 4
ACORDES = [("A1", ["A2", "E3", "A3", "C4", "E4", "B4"]), ("F1", ["F2", "C3", "A3", "C4", "E4", "G4"]),
           ("C2", ["C3", "G3", "C4", "E4", "G4", "D5"]), ("G1", ["G2", "D3", "B3", "D4", "F#4", "A4"])]
tt = np.arange(N) / SR
cuerda = (tt // (2 * COMPAS)).astype(int) % 4             # un acorde cada dos compases
fin_marca = m["marca"] - 0.12                              # el golpe
pad_bajo = np.zeros(N); pad_alto = np.zeros(N); bajo = np.zeros(N)
for k, (raiz, notas) in enumerate(ACORDES):
    activo = (cuerda == k).astype(float)
    activo = signal.oaconvolve(activo, np.hanning(int(.6 * SR)) / np.hanning(int(.6 * SR)).sum(), "same")   # fundido entre acordes
    for nota in notas:
        f = hz(nota)
        for det in (-0.004, 0.004):
            s = signal.sawtooth(2 * np.pi * f * (1 + det) * tt + rng.uniform(0, 6.28))
            pad_bajo += s * activo * .09
    bajo += np.sin(2 * np.pi * hz(raiz) * tt) * activo
pad = filtro(pad_bajo, "lowpass", 700, 4)
brillo_pad = filtro(pad_bajo, "bandpass", [1500, 5000], 2) * .5
apertura = np.clip((tt - m["ia"]) / 3, 0, 1) * (tt < fin_marca)    # se abre con la IA
pad = pad + brillo_pad * apertura
# bajo con "bombeo" a negras desde Venezuela hasta la marca
fase = (tt % PULSO) / PULSO
bombeo = 1 - .7 * np.exp(-fase * 6)
con_pulso = ((tt > m["venezuela"] - 0.2) & (tt < fin_marca - 0.4)).astype(float)
con_pulso = signal.oaconvolve(con_pulso, np.ones(int(.4 * SR)) / int(.4 * SR), "same")
bajo = bajo * (0.55 + 0.45 * con_pulso * bombeo) * .5
pad = pad * (1 - .45 * con_pulso * (1 - bombeo))
# bombo suave
bombo = np.zeros(N)
n_b = int(.35 * SR); tb = np.arange(n_b) / SR
golpecito = np.sin(2 * np.pi * np.cumsum(48 + 70 * np.exp(-tb / .03)) / SR) * np.exp(-tb / .12)
b0 = m["venezuela"] - 0.2
for s in np.arange(b0, fin_marca - 0.5, PULSO):
    i = int(s * SR); bombo[i:i + n_b] += golpecito[: N - i]
# arpegio en la parte de la IA (semicorcheas)
arpe = np.zeros(N)
n_a = int(.22 * SR); ta = np.arange(n_a) / SR
for j, s in enumerate(np.arange(m["ia"] - 0.1, m["marca"] - 0.6, PULSO / 4)):
    k = int(cuerda[min(int(s * SR), N - 1)])
    notas = ACORDES[k][1][2:]
    f = hz(notas[j % len(notas)]) * 2
    nota = (np.sin(2 * np.pi * f * ta) + .3 * np.sin(2 * np.pi * 2 * f * ta)) * np.exp(-ta / .06)
    i = int(s * SR); arpe[i:i + n_a] += nota[: N - i] * (.7 if j % 4 == 0 else .45)
arpe = reverb(arpe, 1.4, .35)
# subida y golpe en la marca, y un acorde final que se queda
n_s = int(1.4 * SR); ts = np.arange(n_s) / SR
subida = filtro(rng.standard_normal(n_s), "bandpass", [1500, 10000]) * (ts / ts[-1]) ** 3
ng = int(1.8 * SR); tg = np.arange(ng) / SR
golpe = np.sin(2 * np.pi * np.cumsum(36 + 40 * np.exp(-tg / .07)) / SR) * np.exp(-tg / .5)
final = np.zeros(N)
for nota in ["A2", "E3", "B3", "C4", "E4", "B4", "E5"]:
    final += np.sin(2 * np.pi * hz(nota) * tt + rng.uniform(0, 6.28))
final = final * np.clip((tt - fin_marca) / .05, 0, 1) * np.exp(-np.clip(tt - fin_marca, 0, None) / 3.2) * .05
final = reverb(final, 2.0, .5)
# antes de la marca la música se apaga un instante (silencio dramático)
hueco = 1 - .85 * np.exp(-((tt - (fin_marca - 0.25)) / .18) ** 2)
cama = (pad * 1.0 + bajo * .55 + bombo * .35 + arpe * .14) * hueco
cama[tt >= fin_marca] *= np.exp(-(tt[tt >= fin_marca] - fin_marca) / .6)
cama += final
i = int((fin_marca - 1.4) * SR); cama[i:i + n_s] += subida[: N - i] * .10
i = int(fin_marca * SR); cama[i:i + ng] += golpe[: N - i] * .55
cama *= np.clip(tt / 1.2, 0, 1)                              # entra suave
# se agacha cuando habla la voz
env_voz = np.sqrt(np.maximum(signal.oaconvolve(voz ** 2, np.ones(int(.25 * SR)) / int(.25 * SR), "same"), 0))
agacha = 1 - .45 * np.clip(env_voz / (env_voz.max() * .3), 0, 1)
cama = cama * agacha
cama = cama / (np.sqrt((cama ** 2).mean()) + 1e-9) * np.sqrt((voz ** 2).mean()) * .42

# ── efectos puntuales (los mismos segundos que la animación) ───────────
def tic():
    n = int(.05 * SR); x = filtro(rng.standard_normal(n), "highpass", 3000) * np.exp(-np.arange(n) / (SR * .008))
    return x / np.abs(x).max() * .5


def campana(f1, f2, dur=1.0):
    n = int(dur * SR); x = np.arange(n) / SR
    return (np.sin(2 * np.pi * f1 * x) + .55 * np.sin(2 * np.pi * f2 * x)) * np.minimum(x / .004, 1) * np.exp(-x / .25)


def soplo(dur=.6, lo=500, hi=5000):
    n = int(dur * SR); x = np.arange(n) / SR
    s = filtro(rng.standard_normal(n), "bandpass", [lo, hi]) * np.sin(np.pi * x / dur) ** 2
    return s / np.abs(s).max()


def poner(pista, s, seg, vol):
    i = int(seg * SR)
    if i < 0: s, i = s[-i:], 0
    j = min(i + len(s), len(pista)); pista[i:j] += s[: j - i] * vol


fx = np.zeros(N)
for d in (0.55, 0.62, 0.67, 0.72):
    poner(fx, tic(), m["cuadra"] + d, .07)
poner(fx, campana(659.3, 987.8), m["cuadra"] + .74, .05)
for k in ("tasas", "brecha", "pago"):
    poner(fx, soplo(), m[k] - .32, .04)
poner(fx, campana(880, 1318.5), m["pago"] - .2 + 1.15, .04)
poner(fx, golpe[: int(.9 * SR)] * .8, m["seniat"] + .37, .22)
poner(fx, soplo(1.2, 2000, 9000), m["ia"] - .2, .05)             # nace la IA
poner(fx, campana(1318.5, 1975.5, 1.6), m["ia2"] + .05, .035)
poner(fx, soplo(1.1, 1200, 6000) * .6, m["foto"] + .3, .03)
for k in ("que", "cuando", "donde"):
    poner(fx, tic(), m[k] - .02, .05)
for k in range(6):
    poner(fx, tic(), m["chat"] - .2 + k * .08, .025)
for k in ("alertas", "recomendaciones", "permisos"):
    poner(fx, campana(1567.98, 2093, .6), m[k] - .05, .035)       # notificación

mezcla = voz + cama + fx
mezcla = np.tanh(mezcla / .95) * .95                               # techo suave
mezcla = mezcla / np.abs(mezcla).max() * .9
r = int(.5 * SR); mezcla[-r:] *= np.linspace(1, 0, r)
pista = (mezcla * 32767).astype(np.int16)

enc = lameenc.Encoder()
enc.set_bit_rate(80); enc.set_in_sample_rate(SR); enc.set_channels(1); enc.set_quality(2)
with open(SALIDA + ".mp3", "wb") as f:
    f.write(enc.encode(pista.tobytes()) + enc.flush())
with open(SALIDA + ".json", "w", encoding="utf-8") as f:
    json.dump({"voz": VOZ, "duracion": round(t, 3), "marcas": marcas}, f, ensure_ascii=False, indent=1)
print(VOZ, round(t, 2), "s")
