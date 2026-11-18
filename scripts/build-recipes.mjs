// Erzeugt Rezeptseiten aus den Beschreibungen der Beiträge.
//
// node scripts/build-recipes.mjs QUELLE.json ZIELORDNER
//
// QUELLE.json: [{ caption, permalink, image, publishedAt, recipeImage? }] mit vollständiger Beschreibung.
// recipeImage ersetzt das Titelbild nur auf der Rezeptseite (Pfad relativ zu public/).
// ZIELORDNER: eine Kopie von public/. Die Seiten landen in ZIELORDNER/rezepte/,
// dazu ZIELORDNER/rezepte-pruefen.html als Prüfliste für Justyna.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isAdvertised } from './feed-title.mjs';
import { parseRecipe, slugify } from './recipe-parse.mjs';

const root = new URL('../', import.meta.url);
const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function partnerLinks() {
  const markdown = await readFile(new URL('links.md', root), 'utf8');
  const link = (name) => new RegExp(String.raw`\[([^\]]*${name}[^\]]*)\]\((https://[^)]+)\)`, 'i').exec(markdown);
  const ninja = link('CRISPi');
  const nuts = /Shop:\s*\[[^\]]+\]\((https:\/\/naughtynuts\.de[^)]+)\)/.exec(markdown);
  const code = /Rabattcode:\s*(\S+)/.exec(markdown)?.[1];
  return [
    ninja && { match: /ninja|crispi|heißluft|airfryer/i, text: `Damit gekocht: ${ninja[1]}`, href: ninja[2] },
    nuts && { match: /naughty\s?nuts|mr\.?\s?tom|hazel creme|happy white/i, text: `Naughty Nuts${code ? ` · Code ${code}` : ''}`, href: nuts[1] },
  ].filter(Boolean);
}

const header = (prefix) => `<header class="site-header">
    <div class="wrap site-header-inner">
      <a class="brand" href="${prefix}index.html">juka<span>.</span>cooking</a>
      <nav class="section-links" aria-label="Seitennavigation">
        <a href="${prefix}rezepte/">Rezepte</a>
        <a href="${prefix}index.html#beitraege">Beiträge</a>
      </nav>
    </div>
  </header>`;

const footer = (prefix) => `<footer class="footer">
    <div class="wrap footer-inner">
      <a class="brand" href="${prefix}index.html">juka<span>.</span>cooking</a>
      <nav aria-label="Rechtliches">
        <a href="${prefix}impressum.html">Impressum</a>
        <a href="${prefix}datenschutz.html">Datenschutz</a>
        <a href="${prefix}nutzungsbedingungen.html">Nutzungsbedingungen</a>
      </nav>
    </div>
  </footer>`;

const head = (title, description, prefix) => `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escape(description)}">
  <meta name="theme-color" content="#f8f3e9">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'">
  <title>${escape(title)} · Juka Cooking</title>
  <link rel="stylesheet" href="${prefix}styles.css">
  <link rel="stylesheet" href="${prefix}recipe.css">`;

function recipePage(recipe, partners) {
  const ingredients = recipe.ingredients.map((item) => /:$/.test(item)
    ? `<li class="recipe-group">${escape(item.slice(0, -1))}</li>`
    : `<li><label><input type="checkbox"> <span>${escape(item)}</span></label></li>`).join('\n            ');
  const meta = [recipe.servings && `<li>${escape(recipe.servings)}</li>`, recipe.minutes && `<li>ca. ${recipe.minutes} Minuten</li>`].filter(Boolean).join('');
  const partner = partners.map((p) => `<a href="${escape(p.href)}" rel="sponsored noopener">${escape(p.text)}</a>`).join(' ');
  const schema = {
    '@context': 'https://schema.org', '@type': 'Recipe', name: recipe.title, description: recipe.intro || undefined,
    image: recipe.image ? `https://juka-cooking.de/${recipe.image}` : undefined,
    author: { '@type': 'Person', name: 'Justyna' }, datePublished: recipe.publishedAt?.slice(0, 10),
    recipeYield: recipe.servings || undefined, totalTime: recipe.minutes ? `PT${recipe.minutes}M` : undefined,
    recipeIngredient: recipe.ingredients.filter((item) => !/:$/.test(item)),
    recipeInstructions: recipe.steps.map((text) => ({ '@type': 'HowToStep', text })),
    keywords: recipe.tags.join(', ') || undefined, video: recipe.permalink ? { '@type': 'VideoObject', name: recipe.title, contentUrl: recipe.permalink, thumbnailUrl: recipe.image ? `https://juka-cooking.de/${recipe.image}` : undefined, uploadDate: recipe.publishedAt } : undefined,
  };
  return `${head(recipe.title, recipe.intro || recipe.title, '../')}
  <script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>
</head>
<body>
  ${header('../')}
  <main class="wrap recipe">
    <p class="recipe-back"><a href="./">← Alle Rezepte</a></p>
    <article>
      <div class="recipe-head">
        ${recipe.image ? `<img class="recipe-cover" src="../${escape(recipe.image)}" alt="" width="225" height="400">` : ''}
        <div>
          ${recipe.ad ? '<span class="ad">Anzeige</span>' : ''}
          <h1>${escape(recipe.title)}</h1>
          ${recipe.intro ? `<p class="recipe-intro">${escape(recipe.intro)}</p>` : ''}
          ${meta ? `<ul class="recipe-meta">${meta}</ul>` : ''}
          ${recipe.permalink ? `<a class="recipe-video" href="${escape(recipe.permalink)}">Video auf Instagram ansehen</a>` : ''}
        </div>
      </div>
      <div class="recipe-body">
        <section aria-labelledby="zutaten">
          <h2 id="zutaten">Zutaten</h2>
          <ul class="recipe-ingredients">
            ${ingredients}
          </ul>
        </section>
        <section aria-labelledby="zubereitung">
          <h2 id="zubereitung">Zubereitung</h2>
          <ol class="recipe-steps">
            ${recipe.steps.map((s) => `<li>${escape(s)}</li>`).join('\n            ')}
          </ol>
          ${recipe.tip ? `<p class="recipe-tip"><strong>Tipp:</strong> ${escape(recipe.tip)}</p>` : ''}
        </section>
      </div>
      ${partner ? `<aside class="recipe-partner"><span class="ad">Anzeige</span> ${partner}</aside>` : ''}
    </article>
  </main>
  ${footer('../')}
</body>
</html>
`;
}

function indexPage(recipes) {
  const cards = recipes.map((r) => `<li class="feed-item"><a href="${r.slug}.html"><div class="feed-cover">${r.image ? `<img src="../${escape(r.image)}" alt="" loading="lazy" decoding="async">` : ''}${r.ad ? '<span class="ad">Anzeige</span>' : ''}</div><h3 class="feed-title">${escape(r.title)}</h3></a></li>`).join('\n        ');
  return `${head('Rezepte', 'Alle Rezepte von Justyna – einfach, schnell und alltagstauglich.', '../')}
</head>
<body>
  ${header('../')}
  <main class="wrap recipe">
    <h1>Rezepte</h1>
    <p class="recipe-intro">${recipes.length} einfache Rezepte aus meinen Videos.</p>
    <ul class="feed-grid">
        ${cards}
    </ul>
  </main>
  ${footer('../')}
</body>
</html>
`;
}

// Auswahlblock „Original oder Vorschlag“ für die Prüfliste.
function choice(slug, key, label, original, proposal, recommended = 'vorschlag') {
  const option = (value, title, body) => `<label class="choice-option${value === recommended ? ' recommended' : ''}">
            <input type="radio" name="${slug}-${key}" value="${value}" data-choice="${key}">
            <span class="choice-title">${title}${value === recommended ? ' <em>empfohlen</em>' : ''}</span>
            ${body}
          </label>`;
  return `<fieldset class="choice"><legend>${label}</legend>
          ${option('original', 'Original', original)}
          ${option('vorschlag', 'Vorschlag', proposal)}
        </fieldset>`;
}

const stepList = (steps, marked = []) => `<ol>${steps.map((s) => {
  const added = marked.some((m) => m && (m.includes(s) || s.includes(m.replace(/\s*\(Quelle[^)]*\)\s*$/, ''))));
  return `<li${added ? ' class="added"' : ''}>${escape(s)}</li>`;
}).join('')}</ol>`;

function reviewPage(recipes, suggestions = {}) {
  const art = { parser: 'Übernahme', luecke: 'Lücke', widerspruch: 'Widerspruch', unklar: 'Unklar', sicherheit: 'Sicherheit', einleitung: 'Einleitung' };
  const statusLabel = { ok: 'Passt', hinweis: 'Hinweis', vorschlag: 'Vorschlag' };
  const rows = recipes.map((r) => {
    const v = suggestions[r.slug];
    const original = r.originalImage || r.image;
    const blocks = !v ? '' : `
        <details class="review-check">
          <summary><span class="status status-${v.status}">${statusLabel[v.status]}</span> Prüfung von Zubereitung, Bild und Text${v.befunde.length ? ` · ${v.befunde.length} ${v.befunde.length === 1 ? 'Befund' : 'Befunde'}` : ''}</summary>
          ${v.befunde.length ? `<ul class="findings">${v.befunde.map((b) => `<li><strong>${art[b.art] || 'Hinweis'}:</strong> ${escape(b.text)}${b.beleg ? `<small>Beleg: ${escape(b.beleg)}</small>` : ''}</li>`).join('')}</ul>` : '<p class="findings-ok">Die Zubereitung passt zum Original.</p>'}
          ${choice(r.slug, 'bild', 'Titelbild auf der Rezeptseite',
    `<img src="${escape(original)}" alt="" loading="lazy" width="120" height="213">`,
    `<img src="${escape(v.bild.ausschnitt)}" alt="" loading="lazy" width="120" height="150"><small>näher am Gericht, leicht nachgeschärft</small>`, v.bild.empfehlung === 'ausschnitt' ? 'vorschlag' : 'original')}
          ${v.schritte ? choice(r.slug, 'schritte', 'Zubereitung', stepList(r.steps), `${stepList(v.schritte, v.ergaenzungen)}${v.ergaenzungen.length ? '<small class="added-note">Markiert = ergänzt, steht so nicht in deiner Beschreibung.</small>' : ''}`) : ''}
          ${v.einleitung ? choice(r.slug, 'einleitung', 'Einleitung', `<p>${escape(r.intro || '(leer)')}</p>`, `<p>${escape(v.einleitung)}</p>`) : ''}
          ${v.tipp ? choice(r.slug, 'tipp', 'Tipp', `<p>${escape(r.tip || '(kein Tipp)')}</p>`, `<p>${escape(v.tipp)}</p>`) : ''}
        </details>`;
    return `<li class="review-row" data-slug="${r.slug}">
      ${r.image ? `<img src="${escape(r.image)}" alt="" loading="lazy" width="72" height="128">` : '<span></span>'}
      <div>
        <span class="review-nr">${v?.nr ? `Nr. ${v.nr}` : ''}</span>
        <a href="rezepte/${r.slug}.html" target="_blank">${escape(r.title)}</a>
        <small>${r.ingredients.filter((i) => !/:$/.test(i)).length} Zutaten · ${r.steps.length} Schritte${r.partners ? ' · mit Partnerlink' : ''}</small>${blocks}
        <div class="review-actions">
          <button type="button" data-vote="ok">Gefällt</button>
          <button type="button" data-vote="change">Ändern</button>
          <button type="button" data-vote="no">Nicht zeigen</button>
        </div>
        <textarea placeholder="Was soll anders sein?" rows="2"></textarea>
      </div>
    </li>`;
  }).join('\n    ');
  return `${head('Rezepte prüfen', 'Interne Prüfliste', '')}
  <script src="rezepte-pruefen.js" defer></script>
</head>
<body>
  <main class="wrap recipe">
    <h1>Rezepte prüfen</h1>
    <p class="recipe-intro">Bitte jedes Rezept öffnen und markieren. Unter „Prüfung“ kannst du bei Bild, Zubereitung, Einleitung und Tipp zwischen deinem Original und einem Vorschlag wählen. Ohne Auswahl bleibt dein Original. Die Auswahl bleibt in diesem Browser gespeichert. Zum Schluss „Ergebnis kopieren“ und an Kadir schicken.</p>
    <p class="review-summary"></p>
    <ul class="review-list">
    ${rows}
    </ul>
    <button type="button" class="feed-more review-copy">Ergebnis kopieren</button>
  </main>
</body>
</html>
`;
}

export async function buildRecipes(sourceFile, target, suggestionsFile) {
  const sources = JSON.parse(await readFile(sourceFile, 'utf8'));
  // Optional: Prüfergebnisse und Vorschläge (nur für die Prüfliste, ändern keine Rezeptseite).
  const suggestions = suggestionsFile ? JSON.parse(await readFile(suggestionsFile, 'utf8')) : {};
  const partners = await partnerLinks();
  const used = new Set();
  const recipes = [];
  for (const source of sources) {
    // doppeltVon: dasselbe Rezept wurde erneut gepostet, gezeigt wird nur die dort genannte Fassung.
    if (source.doppeltVon) continue;
    const recipe = parseRecipe(source.caption);
    if (!recipe || !recipe.title) continue;
    let slug = slugify(recipe.title) || 'rezept';
    for (let n = 2; used.has(slug); n++) slug = `${slugify(recipe.title)}-${n}`;
    used.add(slug);
    const matched = partners.filter((p) => p.match.test(source.caption));
    // recipeImage: eigenes Rezept-Titelbild (z. B. Standbild ohne Hände), sonst das Instagram-Titelbild.
    const repostLinks = sources.filter((s) => s.doppeltVon === source.permalink && s.permalink !== source.permalink).map((s) => s.permalink);
    recipes.push({ ...recipe, slug, permalink: source.permalink, repostLinks, image: source.recipeImage || source.image, publishedAt: source.publishedAt,
      ad: isAdvertised(source.caption), partners: matched.length, partnerLinks: matched });
  }
  await mkdir(join(target, 'rezepte'), { recursive: true });
  for (const recipe of recipes) {
    await writeFile(join(target, 'rezepte', `${recipe.slug}.html`), recipePage(recipe, recipe.partnerLinks));
  }
  await writeFile(join(target, 'rezepte', 'index.html'), indexPage(recipes));
  await writeFile(join(target, 'rezepte-pruefen.html'), reviewPage(recipes, suggestions));
  for (const asset of ['recipe.css', 'rezepte-pruefen.js']) {
    await copyFile(new URL(`recipe-assets/${asset}`, import.meta.url), join(target, asset));
  }
  return recipes;
}

if (process.argv[1]?.endsWith('build-recipes.mjs')) {
  const [source, target, suggestions] = process.argv.slice(2);
  if (!source || !target) {
    console.error('Aufruf: node scripts/build-recipes.mjs QUELLE.json ZIELORDNER [VORSCHLAEGE.json]');
    process.exit(1);
  }
  const recipes = await buildRecipes(source, target, suggestions);
  console.log(`${recipes.length} Rezeptseiten erstellt, ${recipes.filter((r) => r.partners).length} mit Partnerlink.`);
}
