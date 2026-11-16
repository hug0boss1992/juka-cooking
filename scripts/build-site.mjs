import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const headings = new Map([['## Bio', 'bio'], ['## Links', 'links'], ['## Partnerlinks', 'partners']]);
const linkLine = /^-\s+(?:(.*?)\s+)?\[([^\]]+)\]\((\S+)\)(?:\s+[–-]\s+(.+))?$/u;
const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (value) => value.replace(/[&<>"']/g, (character) => entities[character]);

function readContent(source) {
  const content = { bio: [], links: [], partners: [] };
  const sections = new Set();
  let section;
  for (const [index, entry] of source.split(/\r?\n/).entries()) {
    const line = entry.trim();
    if (headings.has(line)) {
      section = headings.get(line);
      if (sections.has(section)) throw new Error(`links.md, Zeile ${index + 1}: Dieser Abschnitt ist doppelt vorhanden.`);
      sections.add(section);
      continue;
    }
    if (!line || !section) continue;
    if (section === 'bio') {
      if (line.startsWith('#')) throw new Error(`links.md, Zeile ${index + 1}: Unbekannte Überschrift.`);
      content.bio.push(escape(line));
      continue;
    }

    const link = linkLine.exec(line);
    if (!link || !link[2].trim()) throw new Error(`links.md, Zeile ${index + 1}: Verwende - [Name](https://adresse).`);

    const [, icon, label, href, note] = link;
    const url = URL.parse(href);
    const webLink = url?.protocol === 'https:' && /^https:\/\//i.test(href) && !url.username && !url.password;
    const emailLink = section === 'links' && /^mailto:[^\s@]+@[^\s@]+$/i.test(href);
    if (!webLink && !emailLink) throw new Error(`links.md, Zeile ${index + 1}: Die Adresse muss mit https:// beginnen. Für E-Mail-Links ist mailto: möglich.`);
    content[section].push({ icon: escape(icon || ''), label: escape(label.trim()), href: escape(url.href), note: escape(note || '') });
  }
  if (sections.size !== headings.size) throw new Error('links.md braucht die Überschriften Bio, Links und Partnerlinks.');
  return content;
}

function renderPartners(partners) {
  if (!partners.length) return '';
  const items = partners.map(({ icon, label, href, note }) => `
      <a class="partner" href="${href}" rel="sponsored noopener">
        <span class="partner-icon" aria-hidden="true">${icon || '↗'}</span>
        <span><strong>${label}</strong>${note ? `<small>${note}</small>` : ''}</span>
        <span class="ad">Anzeige</span>
      </a>`);
  return `<section id="empfehlungen" class="wrap partners" aria-labelledby="partners-title">
      <h2 id="partners-title">Meine Empfehlungen</h2>
      <div class="partner-grid">${items.join('')}
      </div>
    </section>`;
}

const [config, template] = await Promise.all([
  readFile(new URL('links.md', root), 'utf8'),
  readFile(new URL('./index.template.html', import.meta.url), 'utf8'),
]);
try {
  const { bio, links, partners } = readContent(config);
  const buttons = links.map(({ label, href }, index) => `            <a${index === 0 ? ' class="primary"' : ''} href="${href}">${label}</a>`);
  const page = template.replace('<!-- BIO -->', () => bio.join('<br>'))
    .replace('            <!-- LINKS -->', () => buttons.join('\n'))
    .replace('<!-- PARTNER_NAV -->', () => partners.length ? '<a href="#empfehlungen">Empfehlungen</a>' : '')
    .replace('<!-- PARTNERLINKS -->', () => renderPartners(partners));
  await writeFile(new URL('public/index.html', root), page);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
