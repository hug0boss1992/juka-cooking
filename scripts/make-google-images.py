"""Große Rezeptbilder für Google (Suche mit Bild und Discover).

python scripts/make-google-images.py            # alle Rezepte neu
python scripts/make-google-images.py --nur-neue # nur fehlende oder geänderte (täglicher Lauf)

Google empfiehlt für Rezepte Bilder in 1:1, 4:3 und 16:9, für Discover mindestens 1200 px breit.
Die Rezeptfotos sind meist nur 640 px breit. Darum: Titelbild einmal mit Real-ESRGAN vergrößern
(wie scripts/rezeptbild.py, ohne Torch ersatzweise Lanczos), dann mittig zuschneiden und auf
1200 px Breite bringen. Ergebnis: public/google-bilder/<slug>-1x1.webp, -4x3.webp, -16x9.webp.
quelle.json merkt sich, aus welchem Titelbild die Bilder stammen. Bekommt ein Rezept ein neues
Titelbild (Bildauftrag), werden seine Google-Bilder beim nächsten Lauf neu erzeugt.
"""
import json
import os
import sys

from PIL import Image, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
OUT = os.path.join(ROOT, 'google-bilder')
WIDTH = 1200
RATIOS = {'1x1': (1, 1), '4x3': (4, 3), '16x9': (16, 9)}


def upscale(img):
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from esrgan_torch import upscale as esrgan
        return esrgan(img, os.environ.get('ESRGAN_MODEL', 'general')), 'real-esrgan'
    except ImportError:
        big = img.resize((img.width * 2, img.height * 2), Image.LANCZOS)
        return big.filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2)), 'lanczos'


def crop(img, rw, rh):
    """Größtmöglicher Ausschnitt im Seitenverhältnis, leicht über der Mitte (Teller sitzt selten ganz unten)."""
    w, h = img.width, img.height
    if w / h > rw / rh:
        cw, ch = round(h * rw / rh), h
        left, top = (w - cw) // 2, 0
    else:
        cw, ch = w, round(w * rh / rw)
        left, top = 0, max(0, min(h - ch, round((h - ch) * 0.45)))
    return img.crop((left, top, left + cw, top + ch))


def main():
    only_new = '--nur-neue' in sys.argv
    recipes = json.load(open(os.path.join(ROOT, 'rezepte', 'rezepte.json'), encoding='utf-8'))['recipes']
    os.makedirs(OUT, exist_ok=True)
    manifest_path = os.path.join(OUT, 'quelle.json')
    manifest = json.load(open(manifest_path, encoding='utf-8')) if os.path.exists(manifest_path) else {}
    done = 0
    for r in recipes:
        slug, image = r['slug'], r['image']
        targets = {key: os.path.join(OUT, f'{slug}-{key}.webp') for key in RATIOS}
        if only_new and manifest.get(slug) == image and all(os.path.exists(t) for t in targets.values()):
            continue
        source = os.path.join(ROOT, image)
        if not os.path.exists(source):
            print(f'fehlt: {image} ({slug})')
            continue
        img = Image.open(source).convert('RGB')
        method = 'original'
        # Schmalster Zuschnitt ist 1:1 bzw. 16:9 bei Hochformat: Breite = Bildbreite.
        if img.width < WIDTH:
            img, method = upscale(img)
        for key, (rw, rh) in RATIOS.items():
            part = crop(img, rw, rh)
            part = part.resize((WIDTH, round(WIDTH * rh / rw)), Image.LANCZOS)
            part.save(targets[key], 'WEBP', quality=82, method=6)
        manifest[slug] = image
        done += 1
        print(f'{slug}: {method}')
    # Bilder von Rezepten, die es nicht mehr gibt, aufräumen.
    slugs = {r['slug'] for r in recipes}
    for slug in [s for s in manifest if s not in slugs]:
        for key in RATIOS:
            path = os.path.join(OUT, f'{slug}-{key}.webp')
            if os.path.exists(path):
                os.remove(path)
        del manifest[slug]
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(dict(sorted(manifest.items())), f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(f'{done} Rezepte mit Google-Bildern erneuert.')


main()
