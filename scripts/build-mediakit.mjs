// Erzeugt die Mediakit-Seite juka-cooking.de/kooperationen aus mediakit.json.
//
// node scripts/build-mediakit.mjs            → public/kooperationen/ (Live-Fassung, fehlende Werte ausgeblendet)
// node scripts/build-mediakit.mjs --vorschau → intern/mediakit-vorschau/ (Kopie von public/ plus Seite,
//                                              fehlende Werte als Platzhalter markiert)
//
// Beispielbilder kommen aus public/feed.json (Einträge mit ad: true).
// Gleiche CSP und Klickzählung (klick.js, ohne Cookies) wie die Rezeptseiten. Keine externen Skripte oder Embeds.
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const file = (path) => new URL(path, root);
const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const de = (n, digits = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const big = (n) => (n >= 1e6 ? `${de(n / 1e6, 1)} Mio.` : de(n));
const pct = (n) => `${de(n, 1)} %`;

const head = (title, description, robots) => `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${esc(description)}">
  <meta name="theme-color" content="#f8f3e9">
  <meta name="referrer" content="no-referrer">${robots ? '\n  <meta name="robots" content="noindex">' : ''}
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self' https://qwfbzcbcfznctzyoqbky.supabase.co; base-uri 'none'; form-action 'none'">
  <title>${esc(title)}</title>
  <link rel="stylesheet" href="../styles.css">
  <link rel="stylesheet" href="mediakit.css">
  <script src="../klick.js" defer></script>
  <link rel="canonical" href="https://juka-cooking.de/kooperationen/">
</head>`;

const header = `<header class="site-header">
    <div class="wrap site-header-inner">
      <a class="brand" href="../index.html">juka<span>.</span>cooking</a>
      <nav class="section-links" aria-label="Seitennavigation">
        <a href="../rezepte/">Rezepte</a>
        <a href="../index.html#beitraege">Beiträge</a>
        <a href="./" aria-current="page">Kooperationen</a>
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

// Balken als SVG: Breiten über Attribute, damit die CSP ohne Inline-Stile auskommt.
const bar = (value, max = 100) => `<svg class="mk-bar" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect class="mk-bar-bg" width="100" height="10" rx="5"/><rect class="mk-bar-fg" width="${(value / max * 100).toFixed(1)}" height="10" rx="5"/></svg>`;

function page(data, feed, { preview, withPrices, priceIdeas }) {
  const ig = data.instagram;
  const tt = data.tiktok;
  const zg = data.zielgruppe;
  // Fehlender Wert: in der Vorschau sichtbar markiert, live ausgeblendet.
  const todo = (label, hint) => (preview ? `<div class="mk-stat mk-todo"><span class="mk-todo-tag">Fehlt noch</span><strong>${esc(label)}</strong><small>${esc(hint)}</small></div>` : '');
  const stat = (value, label, note) => `<div class="mk-stat"><strong>${value}</strong><span>${esc(label)}</span>${note ? `<small>${esc(note)}</small>` : ''}</div>`;

  const mail = `mailto:${data.kontakt.mail}?subject=${encodeURIComponent(data.kontakt.betreff)}&body=${encodeURIComponent(data.kontakt.vorlage)}`;

  const banner = preview ? `<div class="mk-preview">
    <div class="wrap mk-preview-inner">
      <strong>Vorschau · nicht veröffentlicht</strong>
      <span class="mk-preview-note">Gestrichelte Felder fehlen noch und erscheinen live nicht.</span>
    </div>
  </div>` : '';

  const igStats = [
    stat(de(ig.follower), 'Follower', `+${ig.wachstumQuartal} % im letzten Quartal`),
    stat(big(ig.erreichteKonten), 'erreichte Konten', `letztes Quartal, ${de(ig.nichtFollowerAnteil, 1)} % davon keine Follower`),
    stat(big(ig.impressionen), 'Impressionen', 'letztes Quartal'),
    stat(de(ig.medianWiedergaben), 'Wiedergaben pro Reel', 'typisches Reel (Median)'),
    stat(`über ${de(ig.oberesViertelAb)}`, 'Wiedergaben', 'bei jedem vierten Reel'),
    stat(String(ig.reelsUeber1Mio), 'Reels über 1 Mio.', `${ig.reelsUeber100k} Reels über 100.000`),
  ].join('\n          ');

  const ttStats = [
    stat(de(tt.follower), 'Follower', `${de(tt.likes)} Likes insgesamt`),
    stat(big(tt.aufrufe12Monate), 'Video-Aufrufe', 'letzte 12 Monate'),
    stat(big(tt.aufrufe60Tage), 'Video-Aufrufe', `letzte 60 Tage, +${de(tt.wachstumAufrufe60Tage, 1)} %`),
    stat(big(tt.neueZuschauer60Tage), 'neue Zuschauer', `letzte 60 Tage, ${de(tt.anteilFuerDich, 1)} % über „Für dich“`),
    stat(tt.topVideos.map((v) => de(v / 1e6, 1)).join(' · '), 'Mio. Aufrufe', 'die drei stärksten Videos'),
    tt.durchschnittAufrufe ? stat(de(tt.durchschnittAufrufe), 'Aufrufe pro Video', 'Durchschnitt') : stat(big(tt.geteilt12Monate), 'mal geteilt', 'letzte 12 Monate'),
  ].join('\n          ');

  const rows = (items, key, labelKey, max = 40) => items.map((x) => `<li><span>${esc(x[labelKey])}</span>${bar(x[key], max)}<b>${pct(x[key])}</b></li>`).join('\n              ');
  const sum = (list) => list.reduce((s, x) => s + x.anteil, 0);
  const share = (list, test) => sum(list.filter((x) => test.test(x.gruppe)));
  // Drei Karten (Geschlecht, Alter, Länder) für eine Plattform.
  const audience = (title, g) => `<h3 class="mk-audience-title">${esc(title)}</h3>
      <div class="mk-audience">
        <div class="mk-card">
          <h4>Geschlecht</h4>
          <p class="mk-big">${pct(g.frauen)} <span>Frauen</span></p>
          ${bar(g.frauen)}
          <p class="mk-small">${pct(g.maenner)} Männer</p>
        </div>
        <div class="mk-card">
          <h4>Alter</h4>
          <ul class="mk-rows">
              ${rows(g.alter, 'anteil', 'gruppe')}
          </ul>
          <p class="mk-small">${pct(share(g.alter, /^(35|45)/))} sind zwischen 35 und 54 Jahre alt.</p>
        </div>
        <div class="mk-card">
          <h4>Länder</h4>
          <ul class="mk-rows">
              ${rows(g.laender, 'anteil', 'land', 50)}
              <li><span>Andere</span>${bar(100 - sum(g.laender), 50)}<b>${pct(100 - sum(g.laender))}</b></li>
          </ul>
        </div>
      </div>
      <p class="mk-source">${esc(g.quelle)}</p>`;

  const posts = new Map(feed.posts.filter((p) => p.ad).map((p) => [p.permalink, p]));
  const partners = data.partner.map((p) => {
    const cards = p.beispiele.map((b) => posts.get(b.link) && { ...b, image: posts.get(b.link).image }).filter(Boolean)
      .map((b) => `<li><a href="${esc(b.link)}"><div class="feed-cover"><img src="../${esc(b.image)}" alt="" loading="lazy" decoding="async" width="640" height="800"><span class="ad">Anzeige</span></div><h4 class="feed-title">${esc(b.titel)}</h4></a></li>`)
      .join('\n            ');
    return `<article class="mk-partner">
          <div class="mk-partner-head">
            ${p.logo ? `<img class="mk-partner-logo" src="../${esc(p.logo)}" alt="${esc(p.name)}" height="40">` : `<h3 class="mk-partner-name">${esc(p.name)}</h3>`}
            <p>${esc(p.text)}</p>
          </div>
          <ul class="feed-grid mk-examples">
            ${cards}
          </ul>
        </article>`;
  }).join('\n        ');

  const offers = data.angebote.map((a) => {
    let price = '<p class="mk-price">Preis auf Anfrage</p>';
    if (withPrices) {
      if (a.preis) price = `<p class="mk-price">${esc(a.preis)}</p>`;
      else if (preview && priceIdeas[a.id]) price = `<p class="mk-price mk-todo-inline"><span class="mk-todo-tag">Vorschlag</span> ${esc(priceIdeas[a.id])}</p>`;
    }
    return `<li class="mk-card">
            <h3>${esc(a.titel)}</h3>
            <p>${esc(a.text)}</p>
            ${price}
          </li>`;
  }).join('\n          ');

  return `${head('Kooperationen · Juka Cooking', `${data.kopf.name}, ${data.kopf.rolle}: Reichweite, Zielgruppe und Angebote für Marken.`, preview)}
<body>
  ${banner}
  ${header}
  <main>
    <section class="hero" aria-labelledby="mk-title">
      <div class="wrap profile">
        <div class="portrait">
          <img src="../profil.jpg" alt="Porträt von Justyna" width="192" height="192">
        </div>
        <div class="profile-copy">
          <p class="mk-kicker">Mediakit · Kooperationen</p>
          <h1 id="mk-title">${esc(data.kopf.name)}</h1>
          <p class="tagline">${esc(data.kopf.rolle)}.</p>
          <p class="handle">@juka.cooking · Instagram &amp; TikTok</p>
          <p class="bio">${esc(data.kopf.claim)} ${esc(data.kopf.text)}</p>
          <p class="mk-actions"><a class="mk-button" href="${esc(mail)}">Kooperation anfragen</a></p>
        </div>
      </div>
    </section>

    <section class="wrap mk-section" aria-labelledby="mk-reach">
      <h2 id="mk-reach">Reichweite</h2>
      <div class="mk-platforms">
        <div class="mk-platform">
          <h3><a href="${esc(ig.profil)}">Instagram</a></h3>
          <div class="mk-stats">
          ${igStats}
          </div>
          <p class="mk-source">Instagram-Statistik, ${esc(data.stand.instagram)}${data.stand.instagramFollower ? ` · Follower: Stand ${esc(data.stand.instagramFollower)}, täglich aktualisiert` : ''}</p>
        </div>
        <div class="mk-platform">
          <h3><a href="${esc(tt.profil)}">TikTok</a></h3>
          <div class="mk-stats">
          ${ttStats}
          </div>
          <p class="mk-source">${esc(data.stand.tiktok)}</p>
        </div>
      </div>
    </section>

    <section class="mk-band" aria-labelledby="mk-engagement">
      <div class="wrap mk-section">
        <h2 id="mk-engagement">Interaktion</h2>
        <div class="mk-stats mk-stats-two">
          ${stat(pct(ig.speicherrate), 'Speicherrate', `${de(ig.gespeichertQuartal)}-mal gespeichert im letzten Quartal`)}
          ${stat(pct(ig.teilrate), 'Teilrate', `${de(ig.geteiltQuartal)}-mal geteilt im letzten Quartal`)}
        </div>
        <p class="mk-lead">Meine Rezepte werden fast so oft gespeichert wie geliked. Die Leute wollen das Gericht nachkochen, und das Produkt im Video landet mit in der Merkliste.</p>
        <p class="mk-source">Anteil an allen Reel-Wiedergaben auf Instagram</p>
      </div>
    </section>

    <section class="wrap mk-section" aria-labelledby="mk-audience">
      <h2 id="mk-audience">Zielgruppe</h2>
      <p class="mk-lead">${esc(zg.hinweisAusland)}</p>
      ${audience('Instagram', zg.instagram)}
      ${audience('TikTok', zg.tiktok)}
    </section>

    <section class="mk-band" aria-labelledby="mk-partners">
      <div class="wrap mk-section">
        <h2 id="mk-partners">Bisherige Partner</h2>
        ${partners}
      </div>
    </section>

    <section class="wrap mk-section" aria-labelledby="mk-offers">
      <h2 id="mk-offers">Angebote</h2>
      <ul class="mk-offers">
          ${offers}
      </ul>
      <p class="mk-small">Pakete aus mehreren Formaten und längere Zusammenarbeit sind möglich. Werbung wird immer als „Anzeige“ gekennzeichnet.</p>
    </section>

    <section class="mk-band mk-contact" aria-labelledby="mk-contact">
      <div class="wrap mk-section">
        <h2 id="mk-contact">Kontakt</h2>
        <p class="mk-lead">Schreiben Sie mir kurz, um welches Produkt es geht, welches Format Sie sich vorstellen und in welchem Zeitraum. Ich melde mich in der Regel innerhalb weniger Tage.</p>
        <p class="mk-actions"><a class="mk-button" href="${esc(mail)}">E-Mail an ${esc(data.kontakt.mail)}</a></p>
      </div>
    </section>
  </main>
  ${footer}
</body>
</html>
`;
}

export async function buildMediakit({ preview = false } = {}) {
  const data = JSON.parse(await readFile(file('mediakit.json'), 'utf8'));
  const feed = JSON.parse(await readFile(file('public/feed.json'), 'utf8'));
  const target = fileURLToPath(file(preview ? 'intern/mediakit-vorschau/' : 'public/'));
  if (preview) {
    await rm(target, { recursive: true, force: true });
    await cp(fileURLToPath(file('public/')), target, { recursive: true });
  }
  const dir = `${target}kooperationen/`;
  await mkdir(dir, { recursive: true });
  await copyFile(new URL('mediakit-assets/mediakit.css', import.meta.url), `${dir}mediakit.css`);
  if (preview) {
    await writeFile(`${dir}index.html`, page(data, feed, { preview, withPrices: false, priceIdeas: {} }));
  } else {
    await writeFile(`${dir}index.html`, page(data, feed, { preview, withPrices: data.preiseAnzeigen, priceIdeas: {} }));
  }
  return dir;
}

if (process.argv[1]?.endsWith('build-mediakit.mjs')) {
  const dir = await buildMediakit({ preview: process.argv.includes('--vorschau') });
  console.log(`Mediakit erstellt: ${dir}`);
}
