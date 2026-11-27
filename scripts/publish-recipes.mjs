// Baut die öffentlichen Rezeptseiten nach public/rezepte/.
//
// node scripts/publish-recipes.mjs
//
// Quellen (im Repository): data/rezepte-quelle.json (vollständige Beschreibungen),
// data/rezepte-korrekturen.json (geprüfte Zubereitung, Einleitung, Tipp) und
// data/rezepte-rang.json (Reihenfolge nach Beliebtheit, ohne Aufrufzahlen).
// Ergebnis (wird veröffentlicht): public/rezepte/*.html, rezepte.json, rezepte.css, rezepte.js.
// Die Startseite liest public/rezepte/rezepte.json für den Bereich „Beliebteste Rezepte“.
import { existsSync, readFileSync } from 'node:fs';
import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { isAdvertised } from './feed-title.mjs';
import { parseRecipe, slugify } from './recipe-parse.mjs';

const root = new URL('../', import.meta.url);
const file = (path) => new URL(path, root);
const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const shortcode = (link) => link.replace(/\/$/, '').split('/').pop();

// Rezepte mit offener Frage, die nicht in Justynas Beschreibung beantwortet ist. Erst nach Klärung zeigen.
const hidden = {
  'croissant-caprese-der-perfekte-fingerfood-snack': 'Backzeit fehlt',
  'wenn-nudeln-wuerstchen-und-curry-aufeinandertreffen-entsteht': 'Ofentemperatur fehlt',
  'diese-cheesy-garlic-rolls-sind-aussen-goldbraun-innen-fluffi': 'Backzeit fehlt',
  'cremiest-lotus-biscoff-cheesecake-no-bake': '„3 Frischkäse“ gegenüber 500 g unklar',
};

// Titel, die ein Satz oder Werbespruch sind: Gerichtname aus Justynas eigener Einleitung oder Zutatenliste.
const titles = {
  'diese-cremige-champignon-suppe-ist-echtes-soulfood': 'Cremige Champignon-Suppe',
  'cremiger-tortellini-mit-schinken-aus-dem-ninja-crispipro-nin': 'Cremige Tortellini mit Schinken aus der Ninja CRISPi',
  'wenns-schnell-gehen-soll-aber-trotzdem-richtig-lecker-sein-m': 'Cremige Fusilli mit Hackbällchen in Tomatensoße',
  'der-aufstrich-den-ich-immer-wieder-mache': 'Thunfisch-Ei-Aufstrich mit Butter-Baguette',
  'diese-ofen-tomatensuppe-schmeckt-wie-herbst-im-teller': 'Ofen-Tomatensuppe',
  'pasta-trifft-brokkoli-und-das-ergebnis-ist-einfach-genial': 'One-Pot Brokkoli-Pasta',
  'diese-broetchen-sind-so-weich-dass-keins-uebrig-bleibt': 'Fluffige Butterbrötchen',
  'diese-kartoffelpfanne-macht-suechtig': 'Cremige Kartoffelpfanne mit Bacon & Champignons',
  'der-reis-der-jedes-hauptgericht-uebertrifft': 'Butterreis mit gerösteten Suppennudeln',
  'maxi-king-schnitte-ohne-backen': 'Maxi-King-Schnitte ohne Backen',
  'manchmal-braucht-es-kein-besonderes-rezept-nur-ein-gericht-d': 'Hackbällchen in Paprika-Sahne-Soße',
  'dieses-pasta-rezept-hat-absolutes-suchtpotenzial': 'Farfalle in cremiger Spinat-Speck-Soße',
  'dieses-pasta-rezept-sieht-nach-viel-aufwand-aus-ist-aber-fas': 'Ofen-Pasta mit Schinken und Käse – ohne Vorkochen',
  'so-hast-du-milchbroetchen-noch-nie-gegessen': 'Milchbrötchen mit Zuckerkruste',
  'diese-one-pot-pasta-ist-der-inbegriff-von-comfort-food': 'One-Pot-Rigatoni mit Frischkäse & Cheddar',
  'dieser-chorizo-gnocchi-auflauf-ist-pures-comfort-food': 'Chorizo-Gnocchi-Auflauf',
  'one-pot-orzo-alfredo-mit-haehnchen': 'One-Pot Orzo Alfredo mit Hähnchen',
  'knusprige-kaese-wienerrollen-aus-dem-ninja-crispi-pro-glas-h': 'Knusprige Käse-Wienerrollen aus der Heißluftfritteuse',
  'coban-salatas-der-erfrischende-klassiker-aus-der-tuerkischen': 'Çoban Salatası – türkischer Bauernsalat',
  'mini-sandwiches-zum-verlieben-3-schnelle-ideen-fuer-brunch-g': 'Mini-Sandwiches – 3 schnelle Ideen',
  'wuerziger-penne-bolognese-auflauf-aus-meiner-ninja-crispipro': 'Würziger Penne-Bolognese-Auflauf aus der Ninja CRISPi',
};

// Kategorien für die Filter auf der Rezeptseite.
const groups = [
  ['pasta', 'Pasta & Nudeln', /pasta|nudel|tagliatelle|penne|orzo|gnocchi|spaghetti|tortellini|rigatoni|farfalle|fusilli/i],
  ['auflauf', 'Aufläufe', /auflauf|ofen-pasta|gratin/i],
  ['schnell', 'Schnell (bis 20 Min.)', null],
  ['kartoffel', 'Kartoffeln', /kartoffel/i],
  ['haehnchen', 'Hähnchen', /hähnchen|chicken/i],
  ['hack', 'Hackfleisch', /hack|bolognese/i],
  ['snack', 'Snacks & Fingerfood', /snack|fingerfood|röllchen|rolle|bagel|sandwich|aufstrich|brötchen|kartoffelringe|mini-paprika|wienerrollen|butterkartoffeln|pfannkuchen/i],
  ['suppe', 'Suppen & Eintöpfe', /suppe|eintopf|leczo/i],
  ['salat', 'Salate & Beilagen', /salat|salatası|taboul|reis mit|butterreis/i],
  ['suess', 'Süßes', /(?<!würstchen-pfann)kuchen|cheesecake|waffel|dream|maxi-king|cinnamon|knödel|milchbrötchen|schnitte|cookie|keks/i],
];
const tagsOf = (r) => groups.filter(([key, , re]) => (key === 'schnell' ? r.minutes && r.minutes <= 20 : re.test(r.title))).map(([key]) => key);

async function partnerLinks() {
  const markdown = await readFile(file('links.md'), 'utf8');
  const product = /-\s*!\[\]\(([^)]+)\)\s*\[([^\]]*CRISPi[^\]]*)\]\((https:\/\/[^)]+)\)/i.exec(markdown);
  const nuts = /Shop:\s*\[[^\]]+\]\((https:\/\/naughtynuts\.de[^)]+)\)/.exec(markdown);
  const code = /Rabattcode:\s*(\S+)/.exec(markdown)?.[1];
  return [
    product && { match: /ninja|crispi/i, image: product[1], name: product[2], note: 'Die Glas-Heißluftfritteuse aus dem Video.', href: product[3], amazon: true },
    nuts && { match: /naughty\s?nuts|mr\.?\s?tom|hazel creme|happy white/i, image: 'products/naughty-nuts-logo.png', name: `Naughty Nuts${code ? ` · Code ${code}` : ''}`, note: 'Die Aufstriche aus dem Video.', href: nuts[1] },
  ].filter(Boolean);
}

// Titelbilder unter feed/ gehören dem täglichen Feed-Lauf: Bei den neuesten Beiträgen lädt er sie neu
// und löscht die alten Dateien. Rezeptseiten bekommen deshalb eine feste Kopie unter rezepte-bilder/.
// Fehlt die Datei schon, wird das aktuelle Titelbild desselben Beitrags aus feed.json genommen.
async function stableImage(source, siteRoot) {
  const current = source.recipeImage || source.image;
  if (!current?.startsWith('feed/')) return current;
  const name = `rezepte-bilder/ig-${shortcode(source.permalink)}.webp`;
  const target = new URL(name, siteRoot);
  const exists = async (url) => access(url).then(() => true, () => false);
  if (await exists(target)) return name;
  let from = new URL(current, siteRoot);
  if (!(await exists(from))) {
    const feed = JSON.parse(await readFile(new URL('feed.json', siteRoot), 'utf8')).posts;
    const post = feed.find((p) => shortcode(p.permalink) === shortcode(source.permalink));
    if (!post) return current;
    from = new URL(post.image, siteRoot);
  }
  await mkdir(new URL('rezepte-bilder/', siteRoot), { recursive: true });
  await copyFile(from, target);
  return name;
}

// Glättet automatisch erkannte Titel, ohne etwas zu erfinden: Großschrift wird zu normaler
// Schreibung, und Satz-Titel wie „Diese cremige Brokkoli-Käse-Pasta ist echtes Soulfood“
// werden auf den Gerichtnamen gekürzt („Cremige Brokkoli-Käse-Pasta“).
const smallWords = new Set(['mit', 'und', 'oder', 'aus', 'dem', 'der', 'den', 'des', 'die', 'das', 'in', 'im', 'ins', 'für', 'auf',
  'von', 'vom', 'zu', 'zum', 'zur', 'ohne', 'nach', 'an', 'am', 'à', 'la', 'al', 'nur']);
export function smoothTitle(text) {
  let title = text.trim();
  const letters = title.replace(/[^\p{L}]/gu, '');
  if (letters.length > 4 && letters === letters.toUpperCase()) {
    title = title.toLowerCase().split(/(\s+)/).map((word, index) => {
      if (/^\s+$/.test(word) || (index > 0 && smallWords.has(word))) return word;
      return word.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('-');
    }).join('');
  }
  const sentence = /^(?:diese[rsn]?|dieses|mein(?:e[rsn]?)?|unser(?:e[rsn]?)?)\s+(.+?)\s+(?:ist|sind|macht|machen|schmeckt|schmecken|wird|werden|war|hat|haben|bringt|gelingt)\b/iu.exec(title);
  // Nur übernehmen, wenn ein echter Gerichtname übrig bleibt (nicht „Pasta-Rezept“ o. Ä.).
  if (sentence && sentence[1].split(/\s+/).length <= 7 && !/(rezept|gericht|idee|essen|snack)$/iu.test(sentence[1])) title = sentence[1];
  return title.charAt(0).toUpperCase() + title.slice(1);
}

const cleanText = (text) => (text || '').replace(/\s*@\S+/g, '').replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/\s+/g, ' ').trim();

const head = (title, description, extra = '') => `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${esc(description)}">
  <meta name="theme-color" content="#f8f3e9">
  <meta name="robots" content="max-image-preview:large">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self' https://qwfbzcbcfznctzyoqbky.supabase.co; base-uri 'none'; form-action 'none'">
  <title>${esc(title)}</title>
  <link rel="stylesheet" href="../styles.css">
  <link rel="stylesheet" href="rezepte.css">
  <script src="../klick.js" defer></script>${extra}`;

const header = `<header class="site-header">
    <div class="wrap site-header-inner">
      <a class="brand" href="../index.html">juka<span>.</span>cooking</a>
      <nav class="section-links" aria-label="Seitennavigation">
        <a href="./" aria-current="page">Rezepte</a>
        <a href="../index.html#beitraege">Beiträge</a>
        <a href="../kooperationen/">Kooperationen</a>
      </nav>
    </div>
  </header>`;


const footer = `<footer class="footer">
    <div class="wrap footer-inner">
      <a class="brand" href="../index.html">juka<span>.</span>cooking</a>
      <nav aria-label="Rechtliches">
        <a href="../impressum.html">Impressum</a>
        <a href="../datenschutz.html">Datenschutz</a>
        <a href="../nutzungsbedingungen.html">Nutzungsbedingungen</a>
      </nav>
    </div>
  </footer>`;

// Google zeigt etwa 155 Zeichen der Beschreibung. Darum: Einleitung am Wortende kürzen und die
// Fakten anhängen, die wirklich im Rezept stehen (Zeit, Portionen, Zutaten).
function metaDescription(r, count) {
  const tail = ` Rezept mit ${count} Zutaten${r.minutes ? `, fertig in ca. ${r.minutes} Minuten` : ''} – Schritt für Schritt erklärt.`;
  let lead = (r.intro || r.title).replace(/\s+/g, ' ').trim();
  const room = 158 - tail.length;
  if (lead.length > room) {
    const firstSentence = /^.{40,}?[.!?](?=\s|$)/.exec(lead)?.[0];
    lead = firstSentence && firstSentence.length <= room ? firstSentence : `${lead.slice(0, room - 1).replace(/[\s,;:–-]+\S*$/, '')}…`;
  }
  if (!/[.!?…]$/.test(lead)) lead += '.';
  return lead + tail;
}

// Kategorie für Google (recipeCategory) aus den Filter-Kategorien, ohne etwas zu erfinden.
const categoryOf = (r) => (r.tags.includes('suess') ? 'Dessert & Gebäck'
  : r.tags.includes('suppe') ? 'Suppe & Eintopf'
    : r.tags.includes('salat') ? 'Salat & Beilage'
      : r.tags.includes('snack') ? 'Snack & Fingerfood' : 'Hauptgericht');

// Bis zu 4 ähnliche Rezepte: meiste gemeinsame Kategorien, bei Gleichstand das beliebtere.
function relatedOf(r, all) {
  return all.filter((o) => o !== r && !o.entwurf)
    .map((o) => ({ o, score: o.tags.filter((t) => t !== 'schnell' && r.tags.includes(t)).length }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => (b.score - a.score) || (a.o.rank - b.o.rank))
    .slice(0, 4).map(({ o }) => o);
}

function recipePage(r, all = []) {
  const ingredients = r.ingredients.map((item) => /:$/.test(item)
    ? `<li class="group">${esc(item.slice(0, -1))}</li>`
    : `<li><label><input type="checkbox"> <span>${esc(item)}</span></label></li>`).join('\n              ');
  const count = r.ingredients.filter((x) => !/:$/.test(x)).length;
  const facts = [r.servings && esc(r.servings), r.minutes && `ca. ${r.minutes} Min.`, `${count} Zutaten`, `${r.steps.length} Schritte`]
    .filter(Boolean).map((f) => `<li>${f}</li>`).join('');
  const products = r.partners.map((p) => `<a class="product" href="${esc(p.href)}" rel="sponsored noopener"><img src="../${esc(p.image)}" alt="" width="96" height="96"><span><span class="ad">Anzeige</span><strong>${esc(p.name)}</strong><small>${esc(p.note)}</small><em>Produkt ansehen ↗</em></span></a>${p.amazon ? '<p class="partner-disclosure">Als Amazon-Partner verdiene ich an qualifizierten Verkäufen.</p>' : ''}`).join('');
  const url = `https://juka-cooking.de/rezepte/${r.slug}.html`;
  const description = metaDescription(r, count);
  const related = relatedOf(r, all);
  const keywords = [r.title, `${r.title} Rezept`, ...r.tags.map((t) => groups.find(([key]) => key === t)?.[1]).filter(Boolean)].join(', ');
  // Instagram-Reels sind keine Videodatei, darum als Einbettung (embedUrl) statt contentUrl.
  const embed = /instagram\.com\/(?:reel|p)\//.test(r.permalink) ? `${r.permalink.replace(/\/$/, '')}/embed/` : undefined;
  const schema = [{
    '@context': 'https://schema.org', '@type': 'Recipe', name: r.title, description: r.intro || description,
    // Große Bilder (1:1, 4:3, 16:9, je 1200 px) aus scripts/make-google-images.py, sofern schon erzeugt.
    image: [...r.googleImages.map((name) => `https://juka-cooking.de/${name}`), `https://juka-cooking.de/pins/${r.slug}.jpg`, `https://juka-cooking.de/${r.image}`],
    author: { '@type': 'Person', name: 'Justyna', url: 'https://juka-cooking.de/' },
    datePublished: r.publishedAt?.slice(0, 10), recipeYield: r.servings || undefined, totalTime: r.minutes ? `PT${r.minutes}M` : undefined,
    recipeCategory: categoryOf(r), keywords,
    recipeIngredient: r.ingredients.filter((x) => !/:$/.test(x)),
    // name + url je Schritt (Hinweis der Search Console); Sprungmarken #schritt-N stehen an den <li> der Seite.
    recipeInstructions: r.steps.map((text, i) => ({ '@type': 'HowToStep', position: i + 1, name: `Schritt ${i + 1}`, text, url: `${url}#schritt-${i + 1}` })),
    video: embed && { '@type': 'VideoObject', name: r.title, description: r.intro || r.title, embedUrl: embed, thumbnailUrl: `https://juka-cooking.de/${r.image}`, uploadDate: r.publishedAt },
  }, {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Startseite', item: 'https://juka-cooking.de/' },
      { '@type': 'ListItem', position: 2, name: 'Rezepte', item: 'https://juka-cooking.de/rezepte/' },
      { '@type': 'ListItem', position: 3, name: r.title, item: url },
    ],
  }];
  const pin = `https://juka-cooking.de/pins/${r.slug}.jpg`;
  // Open-Graph-Angaben: Vorschaubild für Pinterest (2:3), WhatsApp und Facebook.
  const og = `
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Juka Cooking">
  <meta property="og:title" content="${esc(r.title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${pin}">
  <meta property="og:image:width" content="1000">
  <meta property="og:image:height" content="1500">`;
  const pageTitle = `${r.title} – Rezept${r.minutes ? ` in ${r.minutes} Min.` : ''} | Juka Cooking`;
  const relatedBox = r.entwurf || !related.length ? '' : `<section class="rn-related" aria-labelledby="aehnlich"><h2 id="aehnlich">Das könnte dir auch schmecken</h2>
        <ul class="rz-grid">
          ${related.map((o) => `<li class="rz-card"><a href="${o.slug}.html"><div class="rz-cover"><img src="../${esc(o.image)}" alt="" loading="lazy" decoding="async" width="640" height="800"></div><h3 class="rz-title">${esc(o.title)}</h3></a></li>`).join('\n          ')}
        </ul>
      </section>`;
  return `${head(pageTitle, description, og)}
  <script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>
</head>
<body>
  ${header}
  <main class="wrap rn">
    <p class="rn-back"><a href="./">← Alle Rezepte</a></p>${r.entwurf ? '\n    <p class="rn-tip"><strong>Entwurf:</strong> Diese Seite ist noch nicht veröffentlicht und wartet auf Justynas Freigabe.</p>' : ''}
    <article>
      <div class="rn-top">
        <figure class="rn-cover"><img src="../${esc(r.image)}" alt="${esc(r.title)} – Rezept von Justyna" width="640" height="800" fetchpriority="high"></figure>
        <div class="rn-side">
          ${r.ad ? '<span class="ad">Anzeige</span>' : ''}
          <h1>${esc(r.title)}</h1>
          ${r.intro ? `<p class="rn-intro">${esc(r.intro)}</p>` : ''}
          <ul class="rn-facts">${facts}</ul>
          <p class="rn-actions"><a class="rn-btn" href="#zubereitung">Zur Zubereitung</a> <a class="rn-btn rn-btn-light" href="${esc(r.permalink)}">Video ansehen ↗</a></p>
          <section class="rn-ingredients" aria-labelledby="zutaten"><h2 id="zutaten">Zutaten</h2>
            <ul>
              ${ingredients}
            </ul>
          </section>
          ${products}
        </div>
      </div>
      <section class="rn-steps" aria-labelledby="zubereitung"><h2 id="zubereitung">Zubereitung</h2>
        <ol>
          ${r.steps.map((s, i) => `<li id="schritt-${i + 1}">${esc(s)}</li>`).join('\n          ')}
        </ol>
        ${r.tip ? `<p class="rn-tip"><strong>Tipp:</strong> ${esc(r.tip)}</p>` : ''}
      </section>
      ${r.entwurf ? '' : `<aside class="rn-save" aria-label="Rezept merken">
        <img src="../pins/${esc(r.slug)}.jpg" alt="${esc(r.title)} – Rezeptbild zum Merken" width="1000" height="1500" loading="lazy" decoding="async">
        <div>
          <h2>Rezept für später merken</h2>
          <p>Speichere das Bild auf Pinterest oder teile den Link dieser Seite – dann findest du das Rezept jederzeit wieder.</p>
        </div>
      </aside>`}
      ${relatedBox}
    </article>
  </main>
  ${footer}
</body>
</html>
`;
}

function card(r) {
  return `<li class="rz-card" data-tags="${r.tags.join(' ')}" data-rank="${r.rank}" data-date="${r.publishedAt?.slice(0, 10) || ''}" data-search="${esc(`${r.title} ${r.ingredients.join(' ')}`.toLowerCase())}">
          <a href="${r.slug}.html">
            <div class="rz-cover"><img src="../${esc(r.image)}" alt="" loading="lazy" decoding="async" width="640" height="800">${r.rank <= 6 ? '<span class="rz-badge">Beliebt</span>' : ''}${r.ad ? '<span class="ad">Anzeige</span>' : ''}</div>
            <h2 class="rz-title">${esc(r.title)}</h2>
            <p class="rz-meta">${[r.minutes && `ca. ${r.minutes} Min.`, `${r.ingredients.filter((x) => !/:$/.test(x)).length} Zutaten`].filter(Boolean).join(' · ')}</p>
          </a>
        </li>`;
}

function indexPage(recipes) {
  const chips = [['alle', `Alle (${recipes.length})`], ...groups.map(([key, label]) => [key, `${label} (${recipes.filter((r) => r.tags.includes(key)).length})`])]
    .map(([key, label], i) => `<button type="button" class="chip" data-filter="${key}" aria-pressed="${i === 0}">${label}</button>`).join('\n          ');
  return `${head(`Einfache Rezepte für jeden Tag – ${recipes.length} Rezepte | Juka Cooking`, `${recipes.length} einfache Rezepte von Justyna: Pasta, Aufläufe, Snacks und Süßes – mit Zutaten, Zubereitung und Video.`, '\n  <script src="rezepte.js" defer></script>')}
</head>
<body>
  ${header}
  <main class="wrap rz">
    <section class="rz-hero">
      <p class="rz-kicker">Rezepte von Justyna</p>
      <h1>Einfach nachkochen</h1>
      <p class="rz-lead">${recipes.length} Rezepte aus meinen Videos – mit allen Zutaten, Schritt für Schritt erklärt. Ganz oben stehen die Rezepte, die ihr am liebsten nachkocht.</p>
      <label class="rz-search"><span>Rezept oder Zutat suchen</span><input type="search" placeholder="z. B. Hähnchen, Brokkoli, Tortilla" autocomplete="off"></label>
    </section>
    <div class="rz-tools">
      <div class="chips" role="group" aria-label="Nach Kategorie filtern">
          ${chips}
      </div>
      <label class="rz-sort">Sortieren <select>
        <option value="rank">Beliebteste zuerst</option>
        <option value="date">Neueste zuerst</option>
      </select></label>
    </div>
    <p class="rz-count" aria-live="polite"></p>
    <ul class="rz-grid">
        ${recipes.map(card).join('\n        ')}
    </ul>
    <p class="rz-empty" hidden>Kein Rezept gefunden. Versuch es mit einer anderen Zutat.</p>
  </main>
  ${footer}
</body>
</html>
`;
}

// RSS-Feed für Pinterest („Pins automatisch aus RSS veröffentlichen“). Enthält nur Rezepte, die der
// Rezept-Bot automatisch veröffentlicht hat. Ältere Rezepte werden von Hand gepinnt (siehe
// intern/pinterest/PINTEREST-STAND.md), damit keine doppelten Pins entstehen.
// Pro Pinterest-Pinnwand ein Feed (Pinterest füllt mit einem Feed genau eine Pinnwand).
// Jedes Rezept kommt in genau einen Feed, Reihenfolge der Prüfung = Vorrang.
export const pinterestBoards = [
  ['kuchen-desserts', 'Kuchen & Desserts', (r) => r.tags.includes('suess')],
  ['snacks-fruehstueck', 'Snacks & Frühstück', (r) => r.tags.includes('snack') || /frühstück|toast|brunch/i.test(`${r.title} ${r.intro}`)],
  ['schnelle-rezepte', 'Schnelle Rezepte in 15 Minuten', (r) => (r.minutes && r.minutes <= 15) || /\b([1-9]|1[0-5])[\s-]*min/i.test(r.title)],
  ['pasta-nudelgerichte', 'Pasta & Nudelgerichte', (r) => r.tags.includes('pasta')],
  ['auflaeufe-hauptgerichte', 'Aufläufe & Hauptgerichte', () => true],
];
// pinterestPinnwand in der Quelle hält ein schon gepinntes Rezept in seinem Feed. Wechselt es den Feed,
// pinnt Pinterest es dort ein zweites Mal (so beim Cookie-Rezept, Pin von Hand auf Kuchen verschoben).
const boardOf = (r) => r.pinterestPinnwand || pinterestBoards.find(([, , test]) => test(r))[0];

// Rezeptkarten (data/pinterest-karten.json): ab dem geplanten Tag als eigener Eintrag im Feed der
// Pinnwand. Eigene guid (<url>#karte), damit Pinterest sie als neuen Pin anlegt; Link bleibt die Rezeptseite.
function cardItem(r, card) {
  const url = `https://juka-cooking.de/rezepte/${r.slug}.html`;
  const img = `https://juka-cooking.de/pins-karten/${r.slug}.jpg`;
  const text = `Alle Zutaten auf einen Blick – ${r.title}. Die Zubereitung Schritt für Schritt findest du auf juka-cooking.de.`;
  return { date: `${card.ab}T07:00:00Z`, xml: `    <item>
      <title>${esc(r.title)} – Rezept mit Zutaten</title>
      <link>${url}</link>
      <guid isPermaLink="false">${url}#karte</guid>
      <pubDate>${new Date(`${card.ab}T07:00:00Z`).toUTCString()}</pubDate>
      <description>${esc(text)}</description>
      <enclosure url="${img}" type="image/jpeg" length="0"/>
      <media:content url="${img}" medium="image" type="image/jpeg" width="1000" height="1500"/>
    </item>` };
}

function pinterestFeed(recipes, boardTitle = 'neue Rezepte', cards = []) {
  const recipeItems = recipes.sort((a, b) => String(b.automatischAm).localeCompare(String(a.automatischAm))).slice(0, 50).map((r) => {
    const url = `https://juka-cooking.de/rezepte/${r.slug}.html`;
    const pin = `https://juka-cooking.de/pins/${r.slug}.jpg`;
    const lead = (r.intro || r.title).trim().replace(/[\s,;:–-]+$/, '');
    const text = `${/[.!?…]$/.test(lead) ? lead : `${lead}.`} Mit allen Zutaten und Schritt-für-Schritt-Anleitung auf juka-cooking.de.`;
    return `    <item>
      <title>${esc(r.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${new Date(r.automatischAm).toUTCString()}</pubDate>
      <description>${esc(text)}</description>
      <enclosure url="${pin}" type="image/jpeg" length="0"/>
      <media:content url="${pin}" medium="image" type="image/jpeg" width="1000" height="1500"/>
    </item>`;
  }).map((xml, i, all) => ({ date: '', xml }));
  // Rezept-Einträge behalten ihre Reihenfolge; Karten kommen nach Datum sortiert davor (neueste zuerst).
  const cardItems = cards.sort((a, b) => b.date.localeCompare(a.date));
  const items = [...cardItems, ...recipeItems].map((x) => x.xml).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Juka Cooking – ${esc(boardTitle)}</title>
    <link>https://juka-cooking.de/rezepte/</link>
    <description>Neue einfache Rezepte von Justyna mit Zutaten und Zubereitung.</description>
    <language>de-de</language>
${items}
  </channel>
</rss>
`;
}

// Neue Rezepte vom Rezept-Bot stehen mit status „entwurf“ in der Quelle und werden erst nach
// Justynas Freigabe veröffentlicht. „abgelehnt“ wird nie gezeigt. Mit drafts: true baut die
// Funktion zusätzlich die Entwürfe, für die Vorschau in einen anderen Zielordner.
export async function publishRecipes({ drafts = false, target: targetDir = file('public/rezepte/') } = {}) {
  // Seit 20.11.2026 im Repository (data/), damit der tägliche GitHub-Lauf neue Rezepte selbst
  // veröffentlichen kann. rezepte-rang.json enthält nur die Reihenfolge, keine Aufrufzahlen.
  const sources = JSON.parse(await readFile(file('data/rezepte-quelle.json'), 'utf8'));
  const checked = JSON.parse(await readFile(file('data/rezepte-korrekturen.json'), 'utf8'));
  const rank = JSON.parse(await readFile(file('data/rezepte-rang.json'), 'utf8'));
  const partners = await partnerLinks();
  const siteRoot = new URL('../', targetDir);
  const googleSource = new URL('google-bilder/quelle.json', siteRoot);
  const googleMade = existsSync(googleSource) ? JSON.parse(readFileSync(googleSource, 'utf8')) : {};
  // Nur Bilder verwenden, die zum aktuellen Titelbild gehören (nach einem Bildauftrag sonst veraltet).
  const googleImagesOf = (slug, image) => (googleMade[slug] === image
    ? ['1x1', '4x3', '16x9'].map((k) => `google-bilder/${slug}-${k}.webp`).filter((name) => existsSync(new URL(name, siteRoot)))
    : []);
  const used = new Set();
  const slugs = new Set();
  const recipes = [];
  for (const source of sources) {
    if (source.doppeltVon || source.status === 'abgelehnt') continue;
    if ((source.status === 'entwurf' || source.status === 'zurueckgehalten') && !drafts) continue;
    const parsed = parseRecipe(source.caption);
    if (!parsed?.title) continue;
    let key = slugify(parsed.title) || 'rezept';
    for (let n = 2; used.has(key); n++) key = `${slugify(parsed.title)}-${n}`;
    used.add(key);
    if (hidden[key]) continue;
    const v = checked[key] || {};
    const rawTitle = titles[key] || cleanText(parsed.title).replace(/\s+–\s+.*$/, '').replace(/[!…]+$/, '').trim();
    // Die Adresse (slug) kommt weiter aus dem ungeglätteten Titel, damit Links und Pins gültig bleiben.
    const title = titles[key] ? rawTitle : smoothTitle(rawTitle);
    let slug = slugify(rawTitle);
    for (let n = 2; slugs.has(slug); n++) slug = `${slugify(rawTitle)}-${n}`;
    slugs.add(slug);
    const links = [source.permalink, ...sources.filter((s) => s.doppeltVon === source.permalink && s.permalink !== source.permalink).map((s) => s.permalink)];
    recipes.push({
      ...parsed,
      // Zwischenüberschriften ohne Doppelpunkt („Zum Servieren nach Belieben“) nicht als Zutat zählen.
      ingredients: parsed.ingredients.map((x) => (/^(zum (servieren|garnieren|bestreuen|bestäuben|dekorieren|toppen)|für (den|die|das) [\p{L}-]+)( nach belieben)?$/iu.test(x.trim()) ? `${x.trim()}:` : x)),
      key, slug, title, entwurf: Boolean(source.status), pinterestPinnwand: source.pinterestPinnwand, pinterestAus: Boolean(source.pinterestAus), automatischAm: source.automatischAm || source.pinterestAb,
      intro: cleanText(v.einleitung || parsed.intro),
      steps: v.schritte || parsed.steps,
      tip: cleanText(v.tipp || parsed.tip),
      image: await stableImage(source, new URL('../', targetDir)),
      permalink: source.permalink, links, publishedAt: source.publishedAt,
      ad: isAdvertised(source.caption),
      partners: partners.filter((p) => p.match.test(source.caption)),
      order: rank[shortcode(source.permalink)] ?? Infinity,
    });
  }
  // Beliebteste zuerst; neue Rezepte ohne Rang hinten, neueste davon zuerst.
  recipes.sort((a, b) => (a.order - b.order) || String(b.publishedAt).localeCompare(String(a.publishedAt)));
  recipes.forEach((r, i) => { r.rank = i + 1; r.tags = tagsOf(r); r.googleImages = googleImagesOf(r.slug, r.image); });

  const target = targetDir;
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  for (const r of recipes) await writeFile(new URL(`${r.slug}.html`, target), recipePage(r, recipes));
  await writeFile(new URL('index.html', target), indexPage(recipes));
  // Für Startseite und Beitragskarten: nur Rang, keine Aufrufzahlen.
  const summary = recipes.map((r) => ({ slug: r.slug, title: r.title, image: r.image, rank: r.rank, minutes: r.minutes || null, links: r.links }));
  await writeFile(new URL('rezepte.json', target), `${JSON.stringify({ recipes: summary }, null, 2)}\n`);
  for (const asset of ['rezepte.css', 'rezepte.js']) await copyFile(new URL(`recipe-assets/${asset}`, import.meta.url), new URL(asset, target));
  // pinterestAus: Rezept steht in keinem Feed mehr (sein Pin bleibt bestehen, Pinterest pinnt nicht nach).
  const pinnable = recipes.filter((r) => r.automatischAm && !r.entwurf && !r.pinterestAus);
  // Freigeschaltete Rezeptkarten: Datum erreicht (Berliner Zeit) und Bild vorhanden
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  const plan = existsSync(file('data/pinterest-karten.json')) ? JSON.parse(readFileSync(file('data/pinterest-karten.json'), 'utf8')).karten : [];
  const plannedCards = plan.filter((c) => c.ab <= today && existsSync(new URL(`pins-karten/${c.slug}.jpg`, siteRoot)));
  const bySlug = new Map(recipes.filter((r) => !r.entwurf).map((r) => [r.slug, r]));
  await rm(new URL('pinterest.xml', target), { force: true });
  for (const [key, title] of pinterestBoards) {
    const cards = plannedCards.filter((c) => c.pinnwand === key && bySlug.has(c.slug)).map((c) => cardItem(bySlug.get(c.slug), c));
    await writeFile(new URL(`pinterest-${key}.xml`, target), pinterestFeed(pinnable.filter((r) => boardOf(r) === key), title, cards));
  }
  return { recipes, hidden: Object.entries(hidden) };
}

if (process.argv[1]?.endsWith('publish-recipes.mjs')) {
  const { recipes, hidden: held } = await publishRecipes();
  console.log(`${recipes.length} Rezepte veröffentlicht, ${held.length} zurückgehalten (${held.map(([, why]) => why).join(', ')}).`);
  const untagged = recipes.filter((r) => !r.tags.length).map((r) => r.title);
  if (untagged.length) console.log(`Ohne Kategorie: ${untagged.join(' | ')}`);
}
