// Erzeugt public/sitemap.xml und public/robots.txt für Google, Bing und andere Suchmaschinen.
// Läuft in jedem Lauf von .github/workflows/feed.yml nach den Rezeptseiten.
//
// Mit --neue gibt das Skript zusätzlich die Adressen aus, die in der live veröffentlichten
// Sitemap noch fehlen oder ein neues Datum haben (als JSON-Liste in einer Zeile). Der Workflow
// meldet genau diese Adressen nach dem Veröffentlichen per IndexNow an Bing & Co.
import { readdir, readFile, writeFile } from 'node:fs/promises';

const site = 'https://juka-cooking.de';
const root = new URL('../', import.meta.url);
const file = (path) => new URL(path, root);

const entries = [
  { loc: `${site}/`, priority: '1.0' },
  { loc: `${site}/rezepte/`, priority: '0.9' },
  { loc: `${site}/kooperationen/`, priority: '0.5' },
];
for (const name of (await readdir(file('public/rezepte/'))).sort()) {
  if (!name.endsWith('.html') || name === 'index.html') continue;
  const html = await readFile(file(`public/rezepte/${name}`), 'utf8');
  if (/<meta name="robots" content="[^"]*noindex/.test(html)) continue;
  const date = html.match(/"dateModified":"(\d{4}-\d{2}-\d{2})/)?.[1] || html.match(/"datePublished":"(\d{4}-\d{2}-\d{2})/)?.[1];
  entries.push({ loc: `${site}/rezepte/${name}`, lastmod: date, priority: '0.8' });
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((e) => `  <url><loc>${e.loc}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}<priority>${e.priority}</priority></url>`).join('\n')}
</urlset>
`;
await writeFile(file('public/sitemap.xml'), xml);
await writeFile(file('public/robots.txt'), `User-agent: *\nAllow: /\nDisallow: /geschenk/\n\nSitemap: ${site}/sitemap.xml\n`);

if (process.argv.includes('--neue')) {
  let live = '';
  try {
    const res = await fetch(`${site}/sitemap.xml`, { signal: AbortSignal.timeout(20000) });
    if (res.ok) live = await res.text();
  } catch { /* ohne Live-Sitemap gelten alle Adressen als neu */ }
  const known = new Set([...live.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?/g)].map((m) => `${m[1]}|${m[2] || ''}`));
  const fresh = entries.filter((e) => !known.has(`${e.loc}|${e.lastmod || ''}`)).map((e) => e.loc);
  console.log(JSON.stringify(fresh));
} else {
  console.log(`Sitemap: ${entries.length} Adressen`);
}
