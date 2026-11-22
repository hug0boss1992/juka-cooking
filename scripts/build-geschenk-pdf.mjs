// Baut das Geschenk-PDF für Newsletter-Anmeldungen: die 10 beliebtesten Rezepte (rezepte.json „rank“).
// Inhalt kommt nur aus den Strukturdaten der Rezeptseiten (nichts dazuerfunden).
// Erzeugt intern/geschenk/geschenk.html; das PDF druckt danach Chrome lokal:
//   chrome --headless --print-to-pdf=public/geschenk/juka-top-10-rezepte.pdf --no-pdf-header-footer intern/geschenk/geschenk.html
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const file = (path) => new URL(path, root);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const { recipes } = JSON.parse(await readFile(file('public/rezepte/rezepte.json'), 'utf8'));
const top = recipes.filter((r) => r.rank).sort((a, b) => a.rank - b.rank).slice(0, 10);

const minutes = (iso) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(iso || ''); return m ? (+(m[1] || 0)) * 60 + (+(m[2] || 0)) : 0; };
// Verkleinerte JPEG-Kopien (intern/geschenk/img/, per ffmpeg, max. 1100 px) halten das PDF klein;
// fehlt eine Kopie, wird das Originalbild genommen.
const small = new Set(await readdir(file('intern/geschenk/img/')).catch(() => []));
const local = (url) => {
  const path = url.replace('https://juka-cooking.de/', '');
  const name = path.split('/').pop().replace(/\.[a-z]+$/, '.jpg');
  return pathToFileURL(fileURLToPath(file(small.has(name) ? `intern/geschenk/img/${name}` : `public/${path}`))).href;
};

const pages = [];
for (const [i, r] of top.entries()) {
  const html = await readFile(file(`public/rezepte/${r.slug}.html`), 'utf8');
  const d = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const images = [].concat(d.image || []);
  const photo = images.find((u) => !u.includes('/pins/')) || images[0];
  const meta = [minutes(d.totalTime) ? `${minutes(d.totalTime)} Min.` : '', d.recipeYield || ''].filter(Boolean).join(' · ');
  pages.push(`
  <section class="recipe">
    <div class="photo" style="background-image:url('${local(photo)}')"><span class="nr">${i + 1}</span></div>
    <h2>${esc(d.name)}</h2>
    ${meta ? `<p class="meta">${esc(meta)}</p>` : ''}
    <div class="cols">
      <div><h3>Zutaten</h3><ul>${d.recipeIngredient.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div><h3>Zubereitung</h3><ol>${d.recipeInstructions.map((x) => `<li>${esc(x.text || x)}</li>`).join('')}</ol></div>
    </div>
    <p class="link">Video &amp; Rezept online: <a href="https://juka-cooking.de/rezepte/${r.slug}.html">juka-cooking.de/rezepte/${r.slug}.html</a></p>
  </section>`);
}

const doc = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Die 10 beliebtesten Rezepte von Juka Cooking</title>
<style>
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Segoe UI', Arial, sans-serif; color: #2b2420; background: #fff; }
h1, h2 { font-family: Georgia, 'Times New Roman', serif; }
.cover { height: 297mm; padding: 30mm 22mm; background: #f8f3e9; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; page-break-after: always; }
.cover img { width: 46mm; height: 46mm; border-radius: 50%; object-fit: cover; border: 3mm solid #fff; box-shadow: 0 2mm 6mm rgba(0,0,0,.12); }
.cover .kicker { margin-top: 14mm; letter-spacing: .2em; text-transform: uppercase; font-size: 10pt; color: #b0643c; }
.cover h1 { font-size: 34pt; line-height: 1.15; margin: 5mm 0; }
.cover p { font-size: 13pt; max-width: 130mm; line-height: 1.5; color: #5a4d44; }
.cover .list { margin-top: 10mm; text-align: left; font-size: 11pt; line-height: 1.8; columns: 1; }
.cover .site { margin-top: auto; font-size: 11pt; color: #b0643c; }
.recipe { height: 297mm; padding: 14mm 16mm 12mm; page-break-after: always; display: flex; flex-direction: column; overflow: hidden; }
.photo { height: 92mm; border-radius: 4mm; background-size: cover; background-position: center; position: relative; flex: none; }
.nr { position: absolute; left: 5mm; top: 5mm; width: 13mm; height: 13mm; border-radius: 50%; background: #b0643c; color: #fff; font: bold 16pt Georgia, serif; display: flex; align-items: center; justify-content: center; }
h2 { font-size: 20pt; margin: 7mm 0 1mm; line-height: 1.2; }
.meta { margin: 0 0 3mm; color: #b0643c; font-size: 10.5pt; }
.cols { display: grid; grid-template-columns: 60mm 1fr; gap: 9mm; font-size: 10pt; line-height: 1.45; flex: 1; min-height: 0; }
h3 { font-size: 10pt; text-transform: uppercase; letter-spacing: .12em; color: #b0643c; margin: 3mm 0 2mm; }
ul, ol { margin: 0; padding-left: 5mm; } li { margin-bottom: 1.3mm; }
.link { font-size: 9pt; color: #7a6c62; margin: 3mm 0 0; border-top: .3mm solid #eadfce; padding-top: 3mm; }
.link a { color: #b0643c; text-decoration: none; }
.end { height: 297mm; padding: 40mm 22mm; background: #f8f3e9; text-align: center; display: flex; flex-direction: column; justify-content: center; }
.end h2 { font-size: 24pt; } .end p { font-size: 12pt; line-height: 1.6; color: #5a4d44; }
.end a { color: #b0643c; text-decoration: none; font-weight: 600; }
</style></head><body>
<section class="cover">
  <img src="${local('https://juka-cooking.de/profil.jpg')}" alt="">
  <div class="kicker">Juka Cooking · Rezeptheft</div>
  <h1>Die 10 beliebtesten<br>Rezepte von Justyna</h1>
  <p>Cremig, einfach und alltagstauglich – die Gerichte, die bei euch am besten ankommen. Viel Spaß beim Nachkochen!</p>
  <ol class="list">${top.map((r) => `<li>${esc(r.title)}</li>`).join('')}</ol>
  <div class="site">juka-cooking.de · @juka.cooking</div>
</section>
${pages.join('\n')}
<section class="end">
  <h2>Hat's geschmeckt?</h2>
  <p>Jeden Sonntag gibt es die neuen Rezepte per Mail.<br>Alle Videos findest du auf Instagram und TikTok unter <strong>@juka.cooking</strong>.</p>
  <p><a href="https://juka-cooking.de/">juka-cooking.de</a></p>
</section>
</body></html>`;

await mkdir(file('intern/geschenk/'), { recursive: true });
await mkdir(file('public/geschenk/'), { recursive: true });
await writeFile(file('intern/geschenk/geschenk.html'), doc);
console.log(`Geschenk-HTML mit ${top.length} Rezepten geschrieben.`);
