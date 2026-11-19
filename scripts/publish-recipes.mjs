// Baut die öffentlichen Rezeptseiten nach public/rezepte/.
//
// node scripts/publish-recipes.mjs
//
// Quellen (lokal, nicht im Repository): intern/rezepte-quelle.json (vollständige Beschreibungen),
// intern/rezepte-vorschlaege.json (geprüfte Zubereitung, Einleitung, Tipp) und
// intern/rezepte-beliebtheit.json (Aufrufe je Reel aus dem Instagram-Export).
// Ergebnis (wird veröffentlicht): public/rezepte/*.html, rezepte.json, rezepte.css, rezepte.js.
// Die Startseite liest public/rezepte/rezepte.json für den Bereich „Beliebteste Rezepte“.
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
  ['suess', 'Süßes', /(?<!würstchen-pfann)kuchen|cheesecake|waffel|dream|maxi-king|cinnamon|knödel|milchbrötchen|schnitte/i],
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

const cleanText = (text) => (text || '').replace(/\s*@\S+/g, '').replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/\s+/g, ' ').trim();

const head = (title, description, extra = '') => `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${esc(description)}">
  <meta name="theme-color" content="#f8f3e9">
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

function recipePage(r) {
  const ingredients = r.ingredients.map((item) => /:$/.test(item)
    ? `<li class="group">${esc(item.slice(0, -1))}</li>`
    : `<li><label><input type="checkbox"> <span>${esc(item)}</span></label></li>`).join('\n              ');
  const count = r.ingredients.filter((x) => !/:$/.test(x)).length;
  const facts = [r.servings && esc(r.servings), r.minutes && `ca. ${r.minutes} Min.`, `${count} Zutaten`, `${r.steps.length} Schritte`]
    .filter(Boolean).map((f) => `<li>${f}</li>`).join('');
  const products = r.partners.map((p) => `<a class="product" href="${esc(p.href)}" rel="sponsored noopener"><img src="../${esc(p.image)}" alt="" width="96" height="96"><span><span class="ad">Anzeige</span><strong>${esc(p.name)}</strong><small>${esc(p.note)}</small><em>Produkt ansehen ↗</em></span></a>${p.amazon ? '<p class="partner-disclosure">Als Amazon-Partner verdiene ich an qualifizierten Verkäufen.</p>' : ''}`).join('');
  const schema = {
    '@context': 'https://schema.org', '@type': 'Recipe', name: r.title, description: r.intro || undefined,
    image: [`https://juka-cooking.de/pins/${r.slug}.jpg`, `https://juka-cooking.de/${r.image}`], author: { '@type': 'Person', name: 'Justyna' },
    datePublished: r.publishedAt?.slice(0, 10), recipeYield: r.servings || undefined, totalTime: r.minutes ? `PT${r.minutes}M` : undefined,
    recipeIngredient: r.ingredients.filter((x) => !/:$/.test(x)),
    recipeInstructions: r.steps.map((text) => ({ '@type': 'HowToStep', text })),
    video: { '@type': 'VideoObject', name: r.title, description: r.intro || r.title, contentUrl: r.permalink, thumbnailUrl: `https://juka-cooking.de/${r.image}`, uploadDate: r.publishedAt },
  };
  const url = `https://juka-cooking.de/rezepte/${r.slug}.html`;
  const pin = `https://juka-cooking.de/pins/${r.slug}.jpg`;
  // Open-Graph-Angaben: Vorschaubild für Pinterest (2:3), WhatsApp und Facebook.
  const og = `
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Juka Cooking">
  <meta property="og:title" content="${esc(r.title)}">
  <meta property="og:description" content="${esc(r.intro || r.title)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${pin}">
  <meta property="og:image:width" content="1000">
  <meta property="og:image:height" content="1500">`;
  return `${head(`${r.title} · Rezept von Juka Cooking`, r.intro || r.title, og)}
  <script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>
</head>
<body>
  ${header}
  <main class="wrap rn">
    <p class="rn-back"><a href="./">← Alle Rezepte</a></p>
    <article>
      <div class="rn-top">
        <figure class="rn-cover"><img src="../${esc(r.image)}" alt="${esc(r.title)}" width="640" height="800"></figure>
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
          ${r.steps.map((s) => `<li>${esc(s)}</li>`).join('\n          ')}
        </ol>
        ${r.tip ? `<p class="rn-tip"><strong>Tipp:</strong> ${esc(r.tip)}</p>` : ''}
      </section>
      <aside class="rn-save" aria-label="Rezept merken">
        <img src="../pins/${esc(r.slug)}.jpg" alt="${esc(r.title)} – Rezeptbild zum Merken" width="1000" height="1500" loading="lazy" decoding="async">
        <div>
          <h2>Rezept für später merken</h2>
          <p>Speichere das Bild auf Pinterest oder teile den Link dieser Seite – dann findest du das Rezept jederzeit wieder.</p>
        </div>
      </aside>
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
  return `${head('Rezepte · Juka Cooking', `${recipes.length} einfache Rezepte von Justyna: Pasta, Aufläufe, Snacks und Süßes – mit Zutaten, Zubereitung und Video.`, '\n  <script src="rezepte.js" defer></script>')}
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

export async function publishRecipes() {
  const sources = JSON.parse(await readFile(file('intern/rezepte-quelle.json'), 'utf8'));
  const checked = JSON.parse(await readFile(file('intern/rezepte-vorschlaege.json'), 'utf8'));
  const views = JSON.parse(await readFile(file('intern/rezepte-beliebtheit.json'), 'utf8'));
  const partners = await partnerLinks();
  const used = new Set();
  const slugs = new Set();
  const recipes = [];
  for (const source of sources) {
    if (source.doppeltVon) continue;
    const parsed = parseRecipe(source.caption);
    if (!parsed?.title) continue;
    let key = slugify(parsed.title) || 'rezept';
    for (let n = 2; used.has(key); n++) key = `${slugify(parsed.title)}-${n}`;
    used.add(key);
    if (hidden[key]) continue;
    const v = checked[key] || {};
    const title = titles[key] || cleanText(parsed.title).replace(/\s+–\s+.*$/, '').replace(/[!…]+$/, '').trim();
    let slug = slugify(title);
    for (let n = 2; slugs.has(slug); n++) slug = `${slugify(title)}-${n}`;
    slugs.add(slug);
    const links = [source.permalink, ...sources.filter((s) => s.doppeltVon === source.permalink && s.permalink !== source.permalink).map((s) => s.permalink)];
    recipes.push({
      ...parsed, key, slug, title,
      intro: cleanText(v.einleitung || parsed.intro),
      steps: v.schritte || parsed.steps,
      tip: cleanText(v.tipp || parsed.tip),
      image: source.recipeImage || source.image,
      permalink: source.permalink, links, publishedAt: source.publishedAt,
      ad: isAdvertised(source.caption),
      partners: partners.filter((p) => p.match.test(source.caption)),
      views: links.reduce((sum, link) => sum + (views[shortcode(link)]?.views || 0), 0),
    });
  }
  recipes.sort((a, b) => b.views - a.views);
  recipes.forEach((r, i) => { r.rank = i + 1; r.tags = tagsOf(r); });

  const target = file('public/rezepte/');
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  for (const r of recipes) await writeFile(new URL(`${r.slug}.html`, target), recipePage(r));
  await writeFile(new URL('index.html', target), indexPage(recipes));
  // Für Startseite und Beitragskarten: nur Rang, keine Aufrufzahlen.
  const summary = recipes.map((r) => ({ slug: r.slug, title: r.title, image: r.image, rank: r.rank, minutes: r.minutes || null, links: r.links }));
  await writeFile(new URL('rezepte.json', target), `${JSON.stringify({ recipes: summary }, null, 2)}\n`);
  for (const asset of ['rezepte.css', 'rezepte.js']) await copyFile(new URL(`recipe-assets/${asset}`, import.meta.url), new URL(asset, target));
  return { recipes, hidden: Object.entries(hidden) };
}

if (process.argv[1]?.endsWith('publish-recipes.mjs')) {
  const { recipes, hidden: held } = await publishRecipes();
  console.log(`${recipes.length} Rezepte veröffentlicht, ${held.length} zurückgehalten (${held.map(([, why]) => why).join(', ')}).`);
  const untagged = recipes.filter((r) => !r.tags.length).map((r) => r.title);
  if (untagged.length) console.log(`Ohne Kategorie: ${untagged.join(' | ')}`);
}
