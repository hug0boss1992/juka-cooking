import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const headings = new Map([['## Bio', 'bio'], ['## Links', 'links'], ['## Partnerlinks', 'partners']]);
const linkLine = /^-\s+(?:(.*?)\s+)?\[([^\]]+)\]\((\S+)\)(?:\s+[–-]\s+(.+))?$/u;
const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (value) => value.replace(/[&<>"']/g, (character) => entities[character]);
const profileIcons = new Map([
  ['instagram', `<rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
        <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/>
        <circle cx="17.6" cy="6.5" r="1.15"/>`],
  // TikTok glyph from Simple Icons.
  ['tiktok', '<path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>'],
]);

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

function renderProfileLinks(links) {
  const profiles = links.filter(({ label }) => profileIcons.has(label.toLowerCase()));
  if (!profiles.length) return '';

  return `<nav class="profile-links" aria-label="Social-Media-Profile">
${profiles.map(({ label, href }) => `      <a href="${href}" aria-label="${label}-Profil" title="${label}">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">${profileIcons.get(label.toLowerCase())}</svg>
      </a>`).join('\n')}
    </nav>`;
}

function renderContactLinks(links) {
  const contactLinks = links.filter(({ label }) => !profileIcons.has(label.toLowerCase()));
  if (!contactLinks.length) return '';

  const items = contactLinks.map(({ label, href }) => `<a href="${href}">${label}</a>`);
  return `<nav class="contact-links" aria-label="Kontakt und weitere Links">${items.join('')}</nav>`;
}

const [config, template] = await Promise.all([
  readFile(new URL('links.md', root), 'utf8'),
  readFile(new URL('./index.template.html', import.meta.url), 'utf8'),
]);
try {
  const { bio, links, partners } = readContent(config);
  const page = template.replace('<!-- BIO -->', () => bio.join('<br>'))
    .replace('<!-- CONTACT_LINKS -->', () => renderContactLinks(links))
    .replace('<!-- PARTNER_NAV -->', () => partners.length ? '<a href="#empfehlungen">Empfehlungen</a>' : '')
    .replace('<!-- PROFILE_NAV -->', () => renderProfileLinks(links))
    .replace('<!-- PARTNERLINKS -->', () => renderPartners(partners));
  await writeFile(new URL('public/index.html', root), page);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
