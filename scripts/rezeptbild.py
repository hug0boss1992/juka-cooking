"""Prüft ein Rezeptbild und macht es bei Bedarf hochauflösend.

    python scripts/rezeptbild.py QUELLE ZIEL.jpg

QUELLE ist eine Datei oder eine https-Adresse (Behold). Ist das Bild schmaler als 1080 Pixel oder
unscharf, wird es mit Real-ESRGAN (x4plus, Fotomodell) vergrößert und danach auf 1080 Pixel Breite
gebracht. Der Pfad zum Programm steht in ESRGAN_BIN (realesrgan-ncnn-vulkan, Modelle daneben in
models/). Fehlt das Programm, wird mit Lanczos vergrößert und nachgeschärft. Ausgabe: eine Zeile JSON
mit den Messwerten. Exit-Code 2, wenn das Ergebnis trotz allem zu klein oder zu unscharf ist.
"""
import io
import json
import os
import subprocess
import sys
import tempfile
import urllib.request

from PIL import Image, ImageFilter, ImageStat

TARGET_WIDTH = 1080
MIN_WIDTH = 1000          # Pinterest-Bild ist 1000 px breit
SHARP_ENOUGH = 120.0      # Laplace-Varianz auf 540 px Breite; darunter gilt das Bild als weich
TOO_BLURRY = 35.0         # darunter wird das Rezept zurückgehalten


def load(source):
    if source.startswith('https://'):
        request = urllib.request.Request(source, headers={'User-Agent': 'juka-cooking-rezeptbot'})
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read(15_000_000)
        return Image.open(io.BytesIO(data)).convert('RGB')
    return Image.open(source).convert('RGB')


def sharpness(img):
    small = img.convert('L').resize((540, round(img.height * 540 / img.width)), Image.LANCZOS)
    edges = small.filter(ImageFilter.Kernel((3, 3), [0, 1, 0, 1, -4, 1, 0, 1, 0], scale=1, offset=128))
    return ImageStat.Stat(edges).var[0]


def esrgan_torch(img):
    """Bevorzugt: Real-ESRGAN über PyTorch (schnell auf dem Prozessor). None, wenn nicht installiert."""
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from esrgan_torch import upscale
    except ImportError:
        return None
    return upscale(img, os.environ.get('ESRGAN_MODEL', 'general'))


def esrgan(img):
    big = esrgan_torch(img)
    if big is not None:
        return big
    binary = os.environ.get('ESRGAN_BIN')
    if not binary or not os.path.exists(binary):
        return None
    with tempfile.TemporaryDirectory() as folder:
        source, target = os.path.join(folder, 'in.png'), os.path.join(folder, 'out.png')
        img.save(source)
        subprocess.run([binary, '-i', source, '-o', target, '-n', 'realesrgan-x4plus', '-s', '4',
                        '-m', os.path.join(os.path.dirname(binary), 'models')],
                       check=True, timeout=900, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return Image.open(target).convert('RGB')


def main():
    source, target = sys.argv[1], sys.argv[2]
    img = load(source)
    before = {'width': img.width, 'height': img.height, 'sharpness': round(sharpness(img), 1)}
    method = 'original'
    if img.width < TARGET_WIDTH or before['sharpness'] < SHARP_ENOUGH:
        big = esrgan(img)
        if big is not None:
            method = f"real-esrgan-{os.environ.get('ESRGAN_MODEL', 'general')}" if 'esrgan_torch' in sys.modules else 'real-esrgan-ncnn'
            img = big
        else:
            method = 'lanczos'
            img = img.resize((img.width * 2, img.height * 2), Image.LANCZOS)
            img = img.filter(ImageFilter.UnsharpMask(radius=2, percent=80, threshold=2))
    if img.width > TARGET_WIDTH:
        img = img.resize((TARGET_WIDTH, round(img.height * TARGET_WIDTH / img.width)), Image.LANCZOS)
    after = {'width': img.width, 'height': img.height, 'sharpness': round(sharpness(img), 1)}
    os.makedirs(os.path.dirname(os.path.abspath(target)), exist_ok=True)
    img.save(target, quality=90, optimize=True, progressive=True)
    ok = img.width >= MIN_WIDTH and after['sharpness'] >= TOO_BLURRY
    print(json.dumps({'before': before, 'after': after, 'method': method, 'ok': ok}))
    sys.exit(0 if ok else 2)


main()
