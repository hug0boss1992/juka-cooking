// Rezept-Bot: macht aus neuen Instagram-Beiträgen mit Rezept Entwürfe für Rezeptseiten.
//
//   node scripts/recipe-bot.mjs                   neue Rezepte suchen und Vorschau bauen
//   node scripts/recipe-bot.mjs freigeben ID …    Entwürfe freigeben (ID = Instagram-Kürzel, oder „alle“)
//   node scripts/recipe-bot.mjs ablehnen ID …     Entwürfe nie zeigen
//   node scripts/recipe-bot.mjs liste             offene Entwürfe anzeigen
//
// Ablauf: Der tägliche Feed-Lauf auf GitHub speichert die vollständigen Beschreibungen in
// data/instagram-beschreibungen.json. Der Bot übernimmt Beiträge mit Zutaten und Zubereitung als
// status „entwurf“ in intern/rezepte-quelle.json und baut die Vorschau in intern/rezepte-entwuerfe/.
// Veröffentlicht wird erst nach der Freigabe mit scripts/publish-recipes.mjs und make-pin-images.py.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { publishRecipes } from './publish-recipes.mjs';
import { parseRecipe, slugify } from './recipe-parse.mjs';

const root = new URL('../', import.meta.url);
const file = (path) => new URL(path, root);
const sourceFile = file('intern/rezepte-quelle.json');
const captionsFile = file('data/instagram-beschreibungen.json');
const previewDir = file('intern/rezepte-entwuerfe/');
const shortcode = (link) => link.replace(/\/$/, '').split('/').pop();
const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function readJson(url, fallback) {
  try {
    return JSON.parse(await readFile(url, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function saveSources(sources) {
  await writeFile(sourceFile, `${JSON.stringify(sources, null, 1)}\n`);
}

export async function findNewRecipes() {
  const sources = await readJson(sourceFile, []);
  const captions = await readJson(captionsFile, {});
  const known = new Set(sources.map((s) => shortcode(s.permalink || '')));
  const titles = new Map(sources.filter((s) => !s.doppeltVon && s.status !== 'abgelehnt')
    .map((s) => [slugify(parseRecipe(s.caption)?.title || ''), s.permalink]));
  const added = [];
  for (const [id, post] of Object.entries(captions)) {
    if (known.has(id)) continue;
    const recipe = parseRecipe(post.caption);
    if (!recipe?.title) continue;
    const entry = { caption: post.caption, permalink: post.permalink, image: post.image, publishedAt: post.publishedAt, status: 'entwurf', gefundenAm: new Date().toISOString().slice(0, 10) };
    const twin = titles.get(slugify(recipe.title));
    if (twin) entry.moeglichesDoppelVon = twin;
    sources.unshift(entry);
    known.add(id);
    added.push({ id, title: recipe.title, twin });
  }
  if (added.length) await saveSources(sources);
  return { added, drafts: sources.filter((s) => s.status === 'entwurf') };
}

function reviewPage(drafts) {
  const rows = drafts.map((d) => `<li class="review-row" data-slug="${esc(d.id)}">
      <img src="${esc(d.image)}" alt="" loading="lazy" width="72" height="128">
      <div>
        <a href="rezepte/${esc(d.slug)}.html" target="_blank">${esc(d.title)}</a>
        <small>${d.ingredients} Zutaten · ${d.steps} Schritte · gepostet ${esc(d.date)} · ID ${esc(d.id)}${d.twin ? ' · <strong>ähnliches Rezept gibt es schon</strong>' : ''}</small>
        <div class="review-actions">
          <button type="button" data-vote="ok">Freigeben</button>
          <button type="button" data-vote="change">Ändern</button>
          <button type="button" data-vote="no">Nicht zeigen</button>
        </div>
        <textarea placeholder="Was soll anders sein?" rows="2"></textarea>
      </div>
    </li>`).join('\n    ');
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'">
  <title>Neue Rezepte prüfen · Juka Cooking</title>
  <link rel="stylesheet" href="styles.css">
  <link rel="stylesheet" href="recipe.css">
  <script src="entwuerfe.js" defer></script>
</head>
<body>
  <main class="wrap recipe">
    <h1>Neue Rezepte prüfen</h1>
    ${drafts.length ? `<p class="recipe-intro">Der Rezept-Bot hat ${drafts.length === 1 ? 'ein neues Rezept' : `${drafts.length} neue Rezepte`} aus Instagram gefunden. Bitte jedes öffnen und markieren. Zum Schluss „Ergebnis kopieren“ und an Kadir schicken. Online geht nur, was freigegeben ist.</p>
    <p class="review-summary"></p>
    <ul class="review-list">
    ${rows}
    </ul>
    <button type="button" class="feed-more review-copy">Ergebnis kopieren</button>` : '<p class="recipe-intro">Gerade gibt es keine neuen Rezepte zum Prüfen.</p>'}
  </main>
</body>
</html>
`;
}

export async function buildPreview() {
  await rm(previewDir, { recursive: true, force: true });
  await cp(file('public/'), previewDir, { recursive: true });
  const { recipes } = await publishRecipes({ drafts: true, target: new URL('rezepte/', previewDir) });
  const sources = await readJson(sourceFile, []);
  const byLink = new Map(recipes.map((r) => [r.permalink, r]));
  const drafts = sources.filter((s) => s.status === 'entwurf').map((s) => {
    const r = byLink.get(s.permalink);
    return r && { id: shortcode(s.permalink), slug: r.slug, title: r.title, image: r.image, date: s.publishedAt?.slice(0, 10) || '',
      ingredients: r.ingredients.filter((x) => !/:$/.test(x)).length, steps: r.steps.length, twin: s.moeglichesDoppelVon };
  }).filter(Boolean);
  await writeFile(new URL('entwuerfe.html', previewDir), reviewPage(drafts));
  for (const asset of ['recipe.css', 'entwuerfe.js']) {
    await cp(new URL(`recipe-assets/${asset}`, import.meta.url), new URL(asset, previewDir));
  }
  return drafts;
}

async function setStatus(ids, status) {
  const sources = await readJson(sourceFile, []);
  const all = ids.includes('alle');
  const changed = [];
  for (const s of sources) {
    if (s.status !== 'entwurf') continue;
    if (!all && !ids.includes(shortcode(s.permalink))) continue;
    if (status) s.status = status; else delete s.status;
    s[status ? 'abgelehntAm' : 'freigegebenAm'] = new Date().toISOString().slice(0, 10);
    changed.push(shortcode(s.permalink));
  }
  await saveSources(sources);
  return changed;
}

if (process.argv[1]?.endsWith('recipe-bot.mjs')) {
  const [command = 'pruefen', ...ids] = process.argv.slice(2);
  try {
    if (command === 'freigeben' || command === 'ablehnen') {
      if (!ids.length) throw new Error(`Bitte IDs angeben, zum Beispiel: node scripts/recipe-bot.mjs ${command} DfxXx-poMn6`);
      const changed = await setStatus(ids, command === 'ablehnen' ? 'abgelehnt' : null);
      console.log(changed.length ? `${command === 'ablehnen' ? 'Abgelehnt' : 'Freigegeben'}: ${changed.join(', ')}` : 'Kein passender Entwurf gefunden.');
      if (command === 'freigeben' && changed.length) console.log('Zum Veröffentlichen: node scripts/publish-recipes.mjs und python scripts/make-pin-images.py, danach committen.');
    } else if (command === 'liste') {
      const drafts = (await readJson(sourceFile, [])).filter((s) => s.status === 'entwurf');
      console.log(drafts.length ? drafts.map((s) => `${shortcode(s.permalink)}  ${parseRecipe(s.caption)?.title}`).join('\n') : 'Keine offenen Entwürfe.');
    } else if (command === 'pruefen') {
      const { added } = await findNewRecipes();
      const drafts = await buildPreview();
      console.log(added.length ? `Neu gefunden: ${added.length}\n${added.map((a) => `  ${a.id}  ${a.title}${a.twin ? '  (ähnliches Rezept vorhanden)' : ''}`).join('\n')}` : 'Keine neuen Rezepte gefunden.');
      console.log(`${drafts.length} Entwürfe warten auf Prüfung. Vorschau: intern/rezepte-entwuerfe/entwuerfe.html`);
    } else {
      throw new Error(`Unbekannter Befehl „${command}“. Möglich: pruefen, liste, freigeben, ablehnen.`);
    }
  } catch (error) {
    console.error(`Rezept-Bot: ${error.message}`);
    process.exitCode = 1;
  }
}
