# Rezeptkarten-Pins (1000 x 1500): echtes Foto oben, Titel, komplette Zutatenliste, Hinweis auf die
# Schritt-für-Schritt-Anleitung auf juka-cooking.de. Zweiter Pin-Typ neben public/pins/<slug>.jpg.
#
#   python scripts/make-recipe-cards.py <slug> [<slug> ...] [--ziel ORDNER]
#
# Alle Angaben stammen aus den Rezeptdaten der Seite (JSON-LD in public/rezepte/<slug>.html):
# Zutaten, Portionen, Zeit, Zahl der Schritte. Nichts wird ergänzt oder geschätzt.
import json
import os
import re
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, 'public')
W, H = 1000, 1500
PHOTO_H = 640
GREEN = (62, 89, 63)
GREEN_LIGHT = (230, 236, 226)
CREAM = (255, 253, 248)
PAPER = (248, 243, 233)
CLAY = (232, 196, 170)
INK = (52, 48, 44)
MUTED = (110, 102, 94)

WINDOWS = 'C:/Windows/Fonts'
OWN = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fonts')
if os.path.exists(os.path.join(WINDOWS, 'georgiab.ttf')) and '--freie-schriften' not in sys.argv:
    TITLE, SANS, SANS_REG = (os.path.join(WINDOWS, f) for f in ('georgiab.ttf', 'seguisb.ttf', 'segoeui.ttf'))
else:
    TITLE = os.path.join(OWN, 'PTSerif-Bold.ttf')
    SANS = SANS_REG = os.path.join(OWN, 'Lato-SemiBold.ttf')
font = lambda path, size: ImageFont.truetype(path, size)


def cover(img, w, h, focus=0.45):
    sw, sh = img.size
    scale = max(w / sw, h / sh)
    img = img.resize((round(sw * scale), round(sh * scale)), Image.LANCZOS)
    left = (img.width - w) // 2
    top = max(0, min(img.height - h, round((img.height - h) * focus)))
    return img.crop((left, top, left + w, top + h))


def wrap(draw, text, fnt, width):
    parts = re.findall(r'[^\s-]+-|[^\s-]+|\s+', text)
    lines, line = [], ''
    for part in parts:
        if part.isspace():
            line += ' '
            continue
        test = line + part
        if line.strip() and draw.textlength(test.strip(), font=fnt) > width:
            lines.append(line.strip())
            line = part
        else:
            line = test
    lines.append(line.strip())
    return lines


def recipe_data(slug):
    page = open(os.path.join(PUBLIC, 'rezepte', f'{slug}.html'), encoding='utf-8').read()
    data = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', page, re.S).group(1))
    recipe = data[0] if isinstance(data, list) else data
    photo = next(u for u in reversed(recipe['image']) if '/rezepte-bilder/' in u)
    minutes = re.match(r'PT(\d+)M', recipe.get('totalTime') or '')
    return {
        'title': recipe['name'],
        'ingredients': recipe['recipeIngredient'],
        'steps': len(recipe['recipeInstructions']),
        'servings': recipe.get('recipeYield'),
        'minutes': int(minutes.group(1)) if minutes else None,
        'photo': os.path.join(PUBLIC, photo.split('juka-cooking.de/', 1)[1]),
    }


def make(slug, target, photo_file=None, focus=0.45):
    """Layout: grüner Kopf mit Titel, darunter links das Foto hochkant (die Videos sind 9:16, so wird
    das Bild verkleinert statt vergrößert und bleibt scharf), rechts Fakten und Zutaten."""
    r = recipe_data(slug)
    canvas = Image.new('RGB', (W, H), PAPER)
    draw = ImageDraw.Draw(canvas)

    # Kopf: Titel so groß wie möglich, höchstens zwei Zeilen
    for size in range(66, 36, -2):
        tf = font(TITLE, size)
        lines = wrap(draw, r['title'], tf, W - 120)
        if len(lines) <= 2:
            break
    head_h = 92 + len(lines) * int(size * 1.18) + 30
    draw.rectangle((0, 0, W, head_h), fill=GREEN)
    draw.text((60, 40), 'REZEPT VON JUSTYNA', font=font(SANS, 28), fill=CLAY)
    y = 86
    for line in lines:
        draw.text((60, y), line, font=tf, fill=CREAM)
        y += int(size * 1.18)

    # Foto links, hochkant, mit runden Ecken
    box_top, box_bottom = head_h + 40, H - 250
    pw, ph = 470, box_bottom - box_top
    photo = Image.open(photo_file or r['photo']).convert('RGB')
    pic = cover(photo, pw, ph, focus).filter(ImageFilter.UnsharpMask(radius=1, percent=40, threshold=2))
    mask = Image.new('L', (pw, ph), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, pw, ph), radius=28, fill=255)
    canvas.paste(pic, (50, box_top), mask)

    # Rechte Spalte: Fakten (nur was im Rezept steht), dann Zutaten
    x0, col_w = 50 + pw + 44, W - (50 + pw + 44) - 50
    y = box_top
    ff = font(SANS, 28)
    facts = [f for f in (r['servings'], r['minutes'] and f"ca. {r['minutes']} Min.", f"{r['steps']} Schritte") if f]
    for fact in facts:
        w = draw.textlength(fact, font=ff) + 40
        draw.rounded_rectangle((x0, y, x0 + w, y + 48), radius=24, fill=GREEN_LIGHT)
        draw.text((x0 + 20, y + 7), fact, font=ff, fill=GREEN)
        y += 60
    y += 18
    draw.text((x0, y), 'Zutaten', font=font(TITLE, 44), fill=GREEN)
    list_top = y + 70
    for size in range(32, 17, -1):
        f_item = font(SANS_REG, size)
        step = int(size * 1.3)
        wrapped = [wrap(draw, item, f_item, col_w - 28) for item in r['ingredients']]
        total = sum(len(w) * step + 6 for w in wrapped)
        if total <= box_bottom - list_top:
            break
    yy = list_top
    for item_lines in wrapped:
        draw.ellipse((x0, yy + size * 0.42, x0 + 11, yy + size * 0.42 + 11), fill=CLAY)
        for line in item_lines:
            draw.text((x0 + 26, yy), line, font=f_item, fill=INK)
            yy += step
        yy += 6

    # Hinweis auf die Anleitung + Fußzeile
    box = H - 210
    draw.rounded_rectangle((50, box, W - 50, box + 112), radius=22, fill=GREEN_LIGHT)
    draw.text((82, box + 16), 'Zubereitung Schritt für Schritt', font=font(TITLE, 36), fill=GREEN)
    draw.text((82, box + 64), 'mit allen Tipps auf juka-cooking.de', font=font(SANS_REG, 30), fill=MUTED)
    draw.rectangle((0, H - 80, W, H), fill=GREEN)
    fs = font(SANS, 32)
    draw.text((60, H - 60), 'juka-cooking.de', font=fs, fill=CREAM)
    hint = 'Merken & nachkochen'
    draw.text((W - 60 - draw.textlength(hint, font=fs), H - 60), hint, font=fs, fill=CLAY)

    os.makedirs(target, exist_ok=True)
    path = os.path.join(target, f'{slug}-karte.jpg')
    canvas.save(path, quality=90, optimize=True, progressive=True)
    return path


# ---------- Stil „auffällig“: großes Foto, Sticker, zweifarbiger Titel, zweites Foto neben den Zutaten ----------
BROWN = (74, 44, 30)
TERRA = (191, 84, 46)
WARM = (251, 246, 238)
BLUSH = (243, 226, 210)
FONTS = {
    'script': os.path.join(WINDOWS, 'segoescb.ttf'),
    'black': os.path.join(WINDOWS, 'seguibl.ttf'),
    'semi': os.path.join(WINDOWS, 'seguisb.ttf'),
    'reg': os.path.join(WINDOWS, 'segoeui.ttf'),
}


def rounded(img, radius):
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *img.size), radius=radius, fill=255)
    return mask


def split_title(title):
    """Erstes Wort klein in Schreibschrift („Cremige“), Rest groß – nur wenn genug Wörter übrig bleiben."""
    words = title.split()
    if len(words) >= 3 and not any(c.isdigit() for c in words[0]):
        return words[0], ' '.join(words[1:])
    return None, title


def make_v2(slug, target, photo_file, photo2_file=None, focus=0.5, focus2=0.5, hero_h=560):
    r = recipe_data(slug)
    canvas = Image.new('RGB', (W, H), WARM)
    draw = ImageDraw.Draw(canvas)

    # Großes Foto oben mit runder Kante (Höhe passt make_card an, damit unten kein Leerraum bleibt)
    canvas.paste(cover(Image.open(photo_file).convert('RGB'), W, hero_h, focus), (0, 0))
    draw.pieslice((-300, hero_h - 50, W + 300, hero_h + 50), 180, 360, fill=WARM)

    # Sticker oben links
    cx, cy, rad = 130, 130, 92
    draw.ellipse((cx - rad, cy - rad, cx + rad, cy + rad), fill=WARM, outline=TERRA, width=4)
    draw.ellipse((cx - rad + 10, cy - rad + 10, cx + rad - 10, cy + rad - 10), outline=BLUSH, width=2)
    fs = font(FONTS['semi'], 22)
    for i, t in enumerate(('ECHTES', 'REZEPT VON', 'JUSTYNA')):
        draw.text((cx - draw.textlength(t, font=fs) / 2, cy - 46 + i * 28), t, font=fs, fill=BROWN)
    heart = font(FONTS['semi'], 24)
    draw.text((cx - draw.textlength('♥', font=heart) / 2, cy + 40), '♥', font=heart, fill=TERRA)

    # Zeit-Badge unten rechts am Foto, nur wenn die Zeit im Rezept steht
    if r['minutes']:
        bx, by = W - 260, hero_h - 200
        draw.rounded_rectangle((bx, by, bx + 210, by + 124), radius=24, fill=TERRA)
        f1, f2 = font(FONTS['script'], 34), font(FONTS['black'], 50)
        draw.text((bx + 105 - draw.textlength('In nur', font=f1) / 2, by + 6), 'In nur', font=f1, fill=WARM)
        t = f"{r['minutes']} Min."
        draw.text((bx + 105 - draw.textlength(t, font=f2) / 2, by + 50), t, font=f2, fill=WARM)

    # Titel: Schreibschrift-Zeile + große Zeile(n), letzte Zeile in Terrakotta
    lead, main = split_title(r['title'])
    y = hero_h + 10
    if lead:
        fl = font(FONTS['script'], 54)
        draw.text(((W - draw.textlength(lead, font=fl)) / 2, y), lead, font=fl, fill=TERRA)
        y += 78
    for size in range(74, 40, -2):
        fm = font(FONTS['black'], size)
        lines = wrap(draw, main.upper(), fm, W - 100)
        if len(lines) <= 2:
            break
    for i, line in enumerate(lines):
        color = TERRA if len(lines) > 1 and i == len(lines) - 1 else BROWN
        draw.text(((W - draw.textlength(line, font=fm)) / 2, y), line, font=fm, fill=color)
        y += int(size * 1.08)
    sub = 'MIT ALLEN ZUTATEN & SCHRITT FÜR SCHRITT ERKLÄRT'
    fsub = font(FONTS['semi'], 24)
    sw = draw.textlength(sub, font=fsub)
    draw.rounded_rectangle(((W - sw) / 2 - 26, y + 12, (W + sw) / 2 + 26, y + 56), radius=22, fill=BLUSH)
    draw.text(((W - sw) / 2, y + 18), sub, font=fsub, fill=BROWN)
    y += 78

    # Zutaten links, zweites Foto rechts. Passen die Zutaten dann nicht in lesbarer Größe (ab 22 px),
    # entfällt das zweite Foto und die Zutaten stehen in zwei Spalten über die ganze Breite.
    bottom = H - 205
    list_top = y + 70

    def layout(col_w, cols):
        for size in range(30, 17, -1):
            fi = font(FONTS['reg'], size)
            step = int(size * 1.28)
            wrapped = [wrap(draw, item, fi, col_w - 26) for item in r['ingredients']]
            heights = [len(w) * step + 4 for w in wrapped]
            if cols == 1:
                parts = [wrapped]
            else:
                half, acc, split = sum(heights) / 2, 0, len(wrapped)
                for i, h in enumerate(heights):
                    if acc >= half:
                        split = i
                        break
                    acc += h
                parts = [wrapped[:split], wrapped[split:]]
            if max(sum(len(w) * step + 4 for w in part) for part in parts) <= bottom - list_top:
                return size, fi, step, parts
        return size, fi, step, parts

    p2w = 360
    size, fi, step, parts = layout(W - 100 - (p2w + 30 if photo2_file else 0), 1)
    if photo2_file and size < 22:
        photo2_file = None
    if not photo2_file:
        size, fi, step, parts = layout((W - 100 - 40) // 2, 2) if size < 22 or len(r['ingredients']) > 10 else layout(W - 100, 1)
    if photo2_file:
        pic = cover(Image.open(photo2_file).convert('RGB'), p2w, bottom - y, focus2)
        canvas.paste(pic, (W - 50 - p2w, y), rounded(pic, 26))
    col_x = 50
    fh = font(FONTS['black'], 30)
    tw = draw.textlength('ZUTATEN', font=fh)
    draw.rounded_rectangle((col_x, y, col_x + tw + 44, y + 50), radius=12, fill=BROWN)
    draw.text((col_x + 22, y + 6), 'ZUTATEN', font=fh, fill=WARM)
    used = list_top
    for c, part in enumerate(parts):
        x0 = col_x + c * ((W - 100 - 40) // 2 + 40)
        yy = list_top
        for item_lines in part:
            draw.ellipse((x0 + 2, yy + size * 0.45, x0 + 12, yy + size * 0.45 + 10), fill=TERRA)
            for line in item_lines:
                draw.text((x0 + 26, yy), line, font=fi, fill=BROWN)
                yy += step
            yy += 4
        used = max(used, yy)
    # Ohne zweites Foto: freien Platz unter der Liste melden
    spare = 0 if photo2_file else max(0, bottom - used)

    # Faktenleiste (nur vorhandene Angaben)
    facts = [f for f in (r['servings'], r['minutes'] and f"ca. {r['minutes']} Min.", f"{r['steps']} Schritte", 'Einfach nachkochen') if f]
    ff = font(FONTS['semi'], 26)
    widths = [draw.textlength(f, font=ff) for f in facts]
    gap = 40
    x = (W - (sum(widths) + gap * (len(facts) - 1))) / 2
    fy = H - 168
    for i, (f, w) in enumerate(zip(facts, widths)):
        draw.text((x, fy), f, font=ff, fill=BROWN)
        x += w + gap
        if i < len(facts) - 1:
            draw.line((x - gap / 2, fy + 6, x - gap / 2, fy + 32), fill=TERRA, width=2)

    # Banner unten
    banner = 'GANZES REZEPT AUF JUKA-COOKING.DE ♥'
    fb = font(FONTS['black'], 32)
    bw = draw.textlength(banner, font=fb)
    draw.rounded_rectangle(((W - bw) / 2 - 40, H - 112, (W + bw) / 2 + 40, H - 46), radius=33, fill=TERRA)
    draw.text(((W - bw) / 2, H - 105), banner, font=fb, fill=WARM)

    os.makedirs(target, exist_ok=True)
    path = os.path.join(target, f'{slug}-karte-v2.jpg')
    canvas.save(path, quality=90, optimize=True, progressive=True)
    return path, spare


def make_card(slug, target, photo_file, photo2_file=None, focus=0.5, focus2=0.5):
    """Baut die Karte; bleibt unter den Zutaten Platz frei, wird das große Foto entsprechend höher."""
    path, spare = make_v2(slug, target, photo_file, photo2_file, focus, focus2)
    if spare > 40:
        path, _ = make_v2(slug, target, photo_file, photo2_file, focus, focus2, hero_h=min(560 + spare - 20, 900))
    return path


def main():
    # --foto slug=DATEI[@fokus]: eigenes Standbild (z. B. aus dem Originalvideo), fokus 0..1 = Ausschnitthöhe
    argv = sys.argv[1:]
    opts = {k: argv[i + 1] for i, k in enumerate(argv) if k in ('--ziel',)}
    photos = {}
    for i, k in enumerate(argv):
        if k == '--foto':
            slug, spec = argv[i + 1].split('=', 1)
            path, _, focus = spec.partition('@')
            photos[slug] = (path, float(focus) if focus else 0.45)
    photos2 = {}
    for i, k in enumerate(argv):
        if k == '--foto2':
            slug, spec = argv[i + 1].split('=', 1)
            path, _, focus = spec.partition('@')
            photos2[slug] = (path, float(focus) if focus else 0.5)
    skip = {i + 1 for i, k in enumerate(argv) if k in ('--ziel', '--foto', '--foto2', '--stil')}
    slugs = [a for i, a in enumerate(argv) if not a.startswith('--') and i not in skip]
    target = opts.get('--ziel', os.path.join(PUBLIC, 'pins-karten'))
    auffaellig = '--stil' in argv and argv[argv.index('--stil') + 1] == 'auffaellig'
    for slug in slugs:
        path, focus = photos.get(slug, (None, 0.45))
        if auffaellig:
            p2, f2 = photos2.get(slug, (None, 0.5))
            print(make_card(slug, target, path or recipe_data(slug)['photo'], p2, focus, f2))
        else:
            print(make(slug, target, path, focus))


main()
