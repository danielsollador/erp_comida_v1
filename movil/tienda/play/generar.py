"""Imagenes de la ficha de Google Play, a partir de las de App Store.

Google pide que el lado largo de una captura no pase del doble del corto; las
de iPhone 6,9" (1290x2796) se pasan. Aqui se llevan a 1080x1920 (9:16)
alargando el fondo hacia los lados, se saca el icono de 512x512 y se arma la
imagen destacada de 1024x500.

    python tienda/play/generar.py   (desde movil/)
"""
import pathlib

from PIL import Image, ImageDraw, ImageFilter, ImageFont

RAIZ = pathlib.Path(__file__).resolve().parents[2]
SALIDA = RAIZ / "tienda" / "play"
FUENTES = RAIZ / "node_modules" / "@expo-google-fonts"


def captura(origen: pathlib.Path, destino: pathlib.Path, ancho=1080, alto=1920):
    im = Image.open(origen).convert("RGB")
    escala = alto / im.height
    im = im.resize((round(im.width * escala), alto), Image.LANCZOS)
    lienzo = Image.new("RGB", (ancho, alto))
    x = (ancho - im.width) // 2
    # El fondo de la captura es un degradado vertical: se estira la primera y
    # la ultima columna hacia los lados y no se nota la costura.
    izq = im.crop((0, 0, 1, alto)).resize((x, alto))
    der = im.crop((im.width - 1, 0, im.width, alto)).resize((ancho - x - im.width, alto))
    lienzo.paste(izq, (0, 0))
    lienzo.paste(der, (x + im.width, 0))
    lienzo.paste(im, (x, 0))
    lienzo.save(destino, optimize=True)


def icono():
    Image.open(RAIZ / "assets" / "icon.png").convert("RGB").resize((512, 512), Image.LANCZOS).save(
        SALIDA / "icono-512.png", optimize=True
    )


def destacada():
    ancho, alto = 1024, 500
    arriba, abajo = (241, 230, 220), (246, 244, 239)
    im = Image.new("RGB", (ancho, alto))
    d = ImageDraw.Draw(im)
    for y in range(alto):
        t = y / (alto - 1)
        d.line([(0, y), (ancho, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(arriba, abajo)))

    # El icono con su sombra, a la izquierda.
    lado = 230
    ico = Image.open(RAIZ / "assets" / "icon.png").convert("RGB").resize((lado, lado), Image.LANCZOS)
    mascara = Image.new("L", (lado, lado), 0)
    ImageDraw.Draw(mascara).rounded_rectangle((0, 0, lado, lado), radius=52, fill=255)
    x0, y0 = 120, (alto - lado) // 2
    sombra = Image.new("RGBA", (ancho, alto), (0, 0, 0, 0))
    ImageDraw.Draw(sombra).rounded_rectangle((x0, y0 + 14, x0 + lado, y0 + lado + 14), radius=52, fill=(60, 40, 30, 70))
    im.paste(sombra.filter(ImageFilter.GaussianBlur(18)), (0, 0), sombra.filter(ImageFilter.GaussianBlur(18)))
    im.paste(ico, (x0, y0), mascara)

    titulo = ImageFont.truetype(str(FUENTES / "sora" / "700Bold" / "Sora_700Bold.ttf"), 72)
    sub = ImageFont.truetype(str(FUENTES / "manrope" / "500Medium" / "Manrope_500Medium.ttf"), 34)
    tx = x0 + lado + 60
    d.text((tx, 172), "Vertigo", font=titulo, fill=(23, 24, 27))
    d.text((tx, 268), "Ventas, cocina e inventario", font=sub, fill=(90, 82, 76))
    d.text((tx, 312), "de tu local, en el teléfono", font=sub, fill=(90, 82, 76))
    im.save(SALIDA / "destacada-vertigo-1024x500.png", optimize=True)


if __name__ == "__main__":
    SALIDA.mkdir(parents=True, exist_ok=True)
    for f in sorted((RAIZ / "tienda" / "capturas").glob("*-iphone-6.9.png")):
        captura(f, SALIDA / f.name.replace("-iphone-6.9", "-telefono-1080x1920"))
    icono()
    destacada()
    print("\n".join(sorted(p.name for p in SALIDA.glob("*.png"))))
