// Bildaufträge: ersetzt das Bild eines Rezepts durch ein besseres (z. B. ein Standbild aus dem
// Originalvideo), rechnet es mit Real-ESRGAN hoch (scripts/rezeptbild.py) und erneuert das
// Pinterest-Bild. Läuft auf GitHub (.github/workflows/bild-auftraege.yml), sobald sich
// data/bild-auftraege.json ändert.
//
// data/bild-auftraege.json: [{ "id": "<Instagram-Kürzel>", "quelle": "data/bild-auftraege/<datei>.png",
//                              "grund": "…" }]  – erledigte Aufträge bekommen "erledigtAm".
import { spawnSync } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { publishRecipes } from './publish-recipes.mjs';

const root = new URL('../', import.meta.url);
const file = (path) => new URL(path, root);
const shortcode = (link) => link.replace(/\/$/, '').split('/').pop();
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

const jobs = JSON.parse(await readFile(file('data/bild-auftraege.json'), 'utf8'));
const sources = JSON.parse(await readFile(file('data/rezepte-quelle.json'), 'utf8'));
const open = jobs.filter((job) => !job.erledigtAm);
const done = [];
for (const job of open) {
  const source = sources.find((s) => shortcode(s.permalink || '') === job.id);
  if (!source) { job.fehler = 'Rezept nicht gefunden'; continue; }
  const version = (source.bildVersion || 1) + 1;
  const target = `rezepte-bilder/ig-${job.id}-v${version}.jpg`;
  const result = spawnSync(python, [fileURLToPath(new URL('rezeptbild.py', import.meta.url)), fileURLToPath(file(job.quelle)), fileURLToPath(file(`public/${target}`))], { encoding: 'utf8' });
  let report = null;
  try { report = JSON.parse(result.stdout.trim().split('\n').pop()); } catch { /* unten */ }
  if (!report?.ok) { job.fehler = `Bild nicht gut genug: ${result.stdout || result.stderr}`.slice(0, 300); continue; }
  source.recipeImage = target;
  source.bildVersion = version;
  source.bild = { methode: report.method, vorher: `${report.before.width}×${report.before.height}`, nachher: `${report.after.width}×${report.after.height}`, schaerfe: report.after.sharpness, quelle: 'Bildauftrag' };
  job.erledigtAm = new Date().toISOString();
  job.ergebnis = source.bild;
  delete job.fehler;
  done.push(job.id);
}
await writeFile(file('data/rezepte-quelle.json'), `${JSON.stringify(sources, null, 1)}\n`);
await writeFile(file('data/bild-auftraege.json'), `${JSON.stringify(jobs, null, 2)}\n`);

if (done.length) {
  const { recipes } = await publishRecipes();
  // Pinterest-Bild dieser Rezepte neu zeichnen lassen.
  for (const r of recipes.filter((x) => x.links.some((link) => done.includes(shortcode(link))))) {
    await rm(file(`public/pins/${r.slug}.jpg`), { force: true });
  }
  const pins = spawnSync(python, [fileURLToPath(new URL('make-pin-images.py', import.meta.url)), '--nur-neue'], { encoding: 'utf8' });
  process.stdout.write(pins.stdout || pins.stderr);
}
console.log(`Bildaufträge erledigt: ${done.join(', ') || 'keine'}; offen mit Fehler: ${jobs.filter((j) => j.fehler).map((j) => j.id).join(', ') || 'keine'}`);
