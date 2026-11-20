// Rezept-Bot: macht aus neuen Instagram-Beiträgen mit Rezept Entwürfe für Rezeptseiten.
//
//   node scripts/recipe-bot.mjs                   neue Rezepte suchen und Vorschau bauen
//   node scripts/recipe-bot.mjs freigeben ID …    Entwürfe freigeben (ID = Instagram-Kürzel, oder „alle“)
//   node scripts/recipe-bot.mjs ablehnen ID …     Entwürfe nie zeigen
//   node scripts/recipe-bot.mjs liste             offene Entwürfe anzeigen
//
// Ablauf: Der tägliche Feed-Lauf auf GitHub speichert die vollständigen Beschreibungen in
// data/instagram-beschreibungen.json. Der Bot übernimmt Beiträge mit Zutaten und Zubereitung als
// status „entwurf“ in data/rezepte-quelle.json. Täglich auf GitHub: „auto“ prüft streng, macht das Bild
// hochauflösend (rezeptbild.py, Real-ESRGAN) und veröffentlicht oder hält mit Grund zurück. Lokal: Vorschau in intern/rezepte-entwuerfe/.
import { spawnSync } from 'node:child_process';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { publishRecipes } from './publish-recipes.mjs';
import { parseRecipe, slugify } from './recipe-parse.mjs';

const root = new URL('../', import.meta.url);
const file = (path) => new URL(path, root);
const sourceFile = file('data/rezepte-quelle.json');
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

// Strenge Prüfung für den Automatik-Modus: lieber zurückhalten als ein fehlerhaftes Rezept zeigen.
export function qualityProblems(source) {
  const recipe = parseRecipe(source.caption);
  if (!recipe) return ['kein vollständiges Rezept erkannt'];
  const problems = [];
  const ingredients = recipe.ingredients.filter((item) => !/:$/.test(item));
  const steps = recipe.steps.join(' ');
  if (ingredients.length < 3) problems.push(`nur ${ingredients.length} Zutaten erkannt`);
  if (recipe.steps.length < 2) problems.push(`nur ${recipe.steps.length} Zubereitungsschritt erkannt`);
  if (recipe.title.length < 4 || recipe.title.length > 90 || /[@#]/.test(recipe.title)) problems.push('Titel unklar');
  if (ingredients.some((item) => item.length > 120) || recipe.steps.some((step) => step.length > 600)) problems.push('Zutaten oder Schritte ungewöhnlich lang');
  if (/\b(backen|ofen|backofen|überbacken)\b/i.test(steps)) {
    if (!/\d+\s*(°|grad)/i.test(steps)) problems.push('Ofentemperatur fehlt');
    if (!/\d+\s*(min|minuten|std|stunden)\b/i.test(steps)) problems.push('Backzeit fehlt');
  }
  if (source.moeglichesDoppelVon) problems.push(`ähnliches Rezept gibt es schon (${source.moeglichesDoppelVon})`);
  return problems;
}

function makeImage(source, target) {
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const result = spawnSync(python, [fileURLToPath(new URL('rezeptbild.py', import.meta.url)), source, fileURLToPath(target)], { encoding: 'utf8', timeout: 1_000_000 });
  let report = null;
  try { report = JSON.parse(result.stdout.trim().split('\n').pop()); } catch { /* unten gemeldet */ }
  if (result.status !== 0 && result.status !== 2) throw new Error(`Bildprüfung fehlgeschlagen: ${(result.stderr || result.error?.message || '').trim().split('\n').pop()}`);
  return report;
}

// Täglicher Lauf auf GitHub: neue Rezepte prüfen, Bild hochauflösend machen, veröffentlichen
// oder mit Grund zurückhalten. Schreibt einen kurzen Bericht für die Benachrichtigung.
export async function autoPublish({ reportFile } = {}) {
  const { added } = await findNewRecipes();
  const sources = await readJson(sourceFile, []);
  const captions = await readJson(captionsFile, {});
  const published = [];
  const held = [];
  for (const source of sources.filter((s) => s.status === 'entwurf')) {
    const id = shortcode(source.permalink);
    const title = parseRecipe(source.caption)?.title || id;
    const problems = source.manuellFreigegeben ? [] : qualityProblems(source);
    if (!problems.length) {
      const post = captions[id] || {};
      const candidates = [post.imageUrlOriginal, post.imageUrl, source.image && fileURLToPath(file(`public/${source.image}`))].filter(Boolean);
      const target = file(`public/rezepte-bilder/ig-${id}.jpg`);
      let report = null;
      for (const candidate of candidates) {
        try {
          report = makeImage(candidate, target);
          if (report) break;
        } catch (error) {
          report = { error: error.message };
        }
      }
      if (!report || report.error) problems.push(`Bild konnte nicht geladen werden${report?.error ? ` (${report.error})` : ''}`);
      else if (!report.ok) problems.push(`Bild zu unscharf oder zu klein (${report.after.width} px, Schärfe ${report.after.sharpness})`);
      else {
        source.recipeImage = `rezepte-bilder/ig-${id}.jpg`;
        source.bild = { methode: report.method, vorher: `${report.before.width}×${report.before.height}`, nachher: `${report.after.width}×${report.after.height}`, schaerfe: report.after.sharpness };
      }
    }
    if (problems.length) {
      source.status = 'zurueckgehalten';
      source.grund = problems.join('; ');
      held.push({ id, title, reasons: problems, link: source.permalink });
    } else {
      delete source.status;
      source.automatischAm = new Date().toISOString();
      published.push({ id, title, link: source.permalink, image: source.bild });
    }
  }
  await saveSources(sources);
  if (reportFile && held.length) {
    const lines = [
      'Der Rezept-Bot hat neue Rezepte gefunden, die er **nicht automatisch** veröffentlicht hat:', '',
      ...held.map((h) => `- **${h.title}** ([Beitrag](${h.link}), ID \`${h.id}\`): ${h.reasons.join('; ')}`), '',
      'Was tun: Claude den Text dieser Meldung schicken. Nach Klärung wird das Rezept mit `node scripts/recipe-bot.mjs freigeben ID` veröffentlicht oder mit `ablehnen ID` dauerhaft ausgeblendet.',
    ];
    await writeFile(reportFile, `${lines.join('\n')}\n`);
  }
  return { added, published, held };
}

async function setStatus(ids, status) {
  const sources = await readJson(sourceFile, []);
  const all = ids.includes('alle');
  const changed = [];
  for (const s of sources) {
    if (s.status !== 'entwurf' && s.status !== 'zurueckgehalten') continue;
    if (!all && !ids.includes(shortcode(s.permalink))) continue;
    // Freigegebene Rezepte bleiben Entwurf, überspringen aber die Inhaltsprüfung. Bild, Seite und
    // Pin erzeugt der nächste tägliche Lauf auf GitHub.
    s.status = status || 'entwurf';
    if (!status) { s.manuellFreigegeben = true; delete s.grund; }
    s[status ? 'abgelehntAm' : 'freigegebenAm'] = new Date().toISOString().slice(0, 10);
    changed.push(shortcode(s.permalink));
  }
  await saveSources(sources);
  return changed;
}

if (process.argv[1]?.endsWith('recipe-bot.mjs')) {
  const [command = 'pruefen', ...ids] = process.argv.slice(2);
  try {
    if (command === 'offen') {
      // Für den GitHub-Lauf: übernimmt neue Rezepte als Entwurf und gibt nur die Anzahl offener Entwürfe aus.
      const { drafts } = await findNewRecipes();
      process.stdout.write(String(drafts.length));
    } else if (command === 'auto') {
      const { published, held } = await autoPublish({ reportFile: process.env.RECIPE_BOT_REPORT });
      console.log(`Automatisch veröffentlicht: ${published.length}${published.map((p) => `\n  ${p.id}  ${p.title}  (Bild ${p.image?.vorher} → ${p.image?.nachher}, ${p.image?.methode})`).join('')}`);
      console.log(`Zurückgehalten: ${held.length}${held.map((h) => `\n  ${h.id}  ${h.title}: ${h.reasons.join('; ')}`).join('')}`);
    } else if (command === 'freigeben' || command === 'ablehnen') {
      if (!ids.length) throw new Error(`Bitte IDs angeben, zum Beispiel: node scripts/recipe-bot.mjs ${command} DfxXx-poMn6`);
      const changed = await setStatus(ids, command === 'ablehnen' ? 'abgelehnt' : null);
      console.log(changed.length ? `${command === 'ablehnen' ? 'Abgelehnt' : 'Freigegeben'}: ${changed.join(', ')}` : 'Kein passender Entwurf gefunden.');
      if (command === 'freigeben' && changed.length) console.log('Committen und pushen: Der nächste tägliche Lauf erzeugt Bild, Seite und Pin.');
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
