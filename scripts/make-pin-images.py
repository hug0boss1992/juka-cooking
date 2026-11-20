# Erzeugt Pinterest-Bilder (1000 x 1500, 2:3) für alle Rezepte aus public/rezepte/rezepte.json.
# Aufruf (nach scripts/publish-recipes.mjs):  python scripts/make-pin-images.py
# Ergebnis: public/pins/<slug>.jpg  – Foto oben, grünes Band mit Rezepttitel und juka-cooking.de unten.
import json
import os
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, 'public')
OUT = os.path.join(PUBLIC, 'pins')
W, H = 1000, 1500
BAND = 430
GREEN = (62, 89, 63)
CREAM = (255, 253, 248)
CLAY = (232, 196, 170)

# Unter Windows Georgia/Segoe wie bisher; auf GitHub (Linux) die freien Schriften aus scripts/fonts/
# (PT Serif Bold und Lato SemiBold, beide SIL Open Font License).
WINDOWS = 'C:/Windows/Fonts'
OWN = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fonts')
if os.path.exists(os.path.join(WINDOWS, 'georgiab.ttf')) and '--freie-schriften' not in sys.argv:
    TITLE, SANS = os.path.join(WINDOWS, 'georgiab.ttf'), os.path.join(WINDOWS, 'seguisb.ttf')
else:
    TITLE, SANS = os.path.join(OWN, 'PTSerif-Bold.ttf'), os.path.join(OWN, 'Lato-SemiBold.ttf')

title_font = lambda size: ImageFont.truetype(TITLE, size)
small_font = ImageFont.truetype(SANS, 34)
kicker_font = ImageFont.truetype(SANS, 30)
ONLY_MISSING = '--nur-neue' in sys.argv


def cover(img, w, h):
    sw, sh = img.size
    scale = max(w / sw, h / sh)
    img = img.resize((round(sw * scale), round(sh * scale)), Image.LANCZOS)
    left = (img.width - w) // 2
    top = (img.height - h) // 2
    return img.crop((left, top, left + w, top + h))


def wrap(draw, text, font, width):
    # Umbruch an Leerzeichen und nach Bindestrichen, damit lange Wörter nicht über den Rand laufen
    import re
    parts = re.findall(r'[^\s-]+-|[^\s-]+|\s+', text)
    lines, line = [], ''
    for part in parts:
        if part.isspace():
            line += ' '
            continue
        test = line + part
        if line.strip() and draw.textlength(test.strip(), font=font) > width:
            lines.append(line.strip())
            line = part
        else:
            line = test
    lines.append(line.strip())
    return lines


def make(recipe):
    photo = Image.open(os.path.join(PUBLIC, recipe['image'])).convert('RGB')
    canvas = Image.new('RGB', (W, H), GREEN)
    top = cover(photo, W, H - BAND).filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
    canvas.paste(top, (0, 0))
    draw = ImageDraw.Draw(canvas)
    # Titel so groß wie möglich: höchstens drei Zeilen, keine Zeile breiter als das Band, Abstand zur Fußzeile
    for size in range(74, 36, -2):
        font = title_font(size)
        lines = wrap(draw, recipe['title'], font, W - 120)
        fits = all(draw.textlength(line, font=font) <= W - 120 for line in lines)
        bottom = H - BAND + 108 + len(lines) * int(size * 1.18)
        if len(lines) <= 3 and fits and bottom <= H - 105:
            break
    y = H - BAND + 52
    draw.text((60, y), 'REZEPT VON JUSTYNA', font=kicker_font, fill=CLAY)
    y += 56
    for line in lines:
        draw.text((60, y), line, font=font, fill=CREAM)
        y += int(size * 1.18)
    draw.text((60, H - 78), 'juka-cooking.de', font=small_font, fill=CREAM)
    meta = f"ca. {recipe['minutes']} Min." if recipe.get('minutes') else 'Mit Zutaten & Zubereitung'
    draw.text((W - 60 - draw.textlength(meta, font=small_font), H - 78), meta, font=small_font, fill=CLAY)
    canvas.save(os.path.join(OUT, f"{recipe['slug']}.jpg"), quality=86, optimize=True, progressive=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    recipes = json.load(open(os.path.join(PUBLIC, 'rezepte', 'rezepte.json'), encoding='utf-8'))['recipes']
    keep = {f"{r['slug']}.jpg" for r in recipes}
    for name in os.listdir(OUT):
        if name not in keep:
            os.remove(os.path.join(OUT, name))
    made = 0
    for recipe in recipes:
        # --nur-neue: bestehende Pins nicht neu zeichnen (täglicher Lauf auf GitHub)
        if ONLY_MISSING and os.path.exists(os.path.join(OUT, f"{recipe['slug']}.jpg")):
            continue
        make(recipe)
        made += 1
    sys.stdout.write(f'{made} Pinterest-Bilder erzeugt, {len(recipes)} insgesamt in public/pins/\n')


main()
