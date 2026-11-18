import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const headings = new Map([['## Bio', 'bio'], ['## Links', 'links'], ['## Partnerlinks', 'partners']]);
const linkLine = /^-\s+(?:(.*?)\s+)?\[([^\]]+)\]\((\S+)\)(?:\s+[–-]\s+(.+))?$/u;
const productImage = /^!\[\]\((products\/[a-z0-9][a-z0-9._-]*\.(?:webp|avif|jpe?g|png|svg))\)$/i;
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
  let partner;
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

    if (section === 'partners' && line.startsWith('### ')) {
      const label = line.slice(4).trim();
      if (!label) throw new Error(`links.md, Zeile ${index + 1}: Der Partner braucht einen Namen.`);
      partner = { label: escape(label), products: [] };
      content.partners.push(partner);
      continue;
    }

    if (section === 'partners' && partner && line.startsWith('- Logo: ')) {
      const logo = productImage.exec(line.slice(8));
      if (!logo || partner.logo) throw new Error(`links.md, Zeile ${index + 1}: Verwende einmal pro Partner - Logo: ![](products/logo.svg).`);
      partner.logo = logo[1];
      continue;
    }

    if (section === 'partners' && partner && line.startsWith('- Rabattcode: ')) {
      const code = line.slice(14);
      if (!/^[a-z0-9][a-z0-9-]*$/i.test(code) || partner.discountCode) {
        throw new Error(`links.md, Zeile ${index + 1}: Verwende einmal pro Partner - Rabattcode: DEIN-CODE.`);
      }
      partner.discountCode = code;
      continue;
    }

    const link = linkLine.exec(line);
    if (!link || !link[2].trim()) throw new Error(`links.md, Zeile ${index + 1}: Verwende - [Name](https://adresse).`);

    const [, icon, label, href, note] = link;
    const url = URL.parse(href);
    const webLink = url?.protocol === 'https:' && /^https:\/\//i.test(href) && !url.username && !url.password;
    const emailLink = section === 'links' && /^mailto:[^\s@]+@[^\s@]+$/i.test(href);
    if (!webLink && !emailLink) throw new Error(`links.md, Zeile ${index + 1}: Die Adresse muss mit https:// beginnen. Für E-Mail-Links ist mailto: möglich.`);
    const item = { label: escape(label.trim()), href: escape(url.href), note: escape(note || '') };
    if (section === 'links') {
      content.links.push(item);
    } else if (!partner) {
      content.partners.push({ label: item.label, products: [], shop: item });
    } else if (icon === 'Shop:') {
      if (partner.shop) throw new Error(`links.md, Zeile ${index + 1}: Pro Partner ist ein Shoplink möglich.`);
      partner.shop = item;
    } else {
      const offer = icon?.startsWith('Angebot: ') ?? false;
      const image = icon && productImage.exec(offer ? icon.slice(9) : icon);
      if (icon && !image) throw new Error(`links.md, Zeile ${index + 1}: Verwende ein lokales Produktbild wie ![](products/bild.webp).`);
      partner.products.push({ ...item, image: image?.[1], offer });
    }
  }
  if (sections.size !== headings.size) throw new Error('links.md braucht die Überschriften Bio, Links und Partnerlinks.');
  return content;
}

function renderPartners(partners) {
  if (!partners.length) return '';
  // Der Amazon-Hinweis steht direkt im jeweiligen Partnerbereich unter den Amazon-Links.
  const amazonLink = (item) => item && /^https:\/\/(?:link\.amazon|amzn\.(?:eu|to)|(?:www\.)?amazon\.de)\//i.test(item.href);
  const items = partners.map(({ label, logo, discountCode, shop, products }) => `
      <details class="partner">
        <summary>
          ${logo ? `<img class="partner-logo" src="${logo}" alt="${label}" decoding="async">` : `<strong>${label}</strong>`}
          <span class="partner-labels">
            ${discountCode ? `<span class="partner-discount">Rabattcode <strong>${discountCode}</strong></span>` : ''}
            <span class="ad">Anzeige</span>
          </span>
          <span class="partner-toggle" aria-hidden="true"></span>
        </summary>
        <div class="partner-content">${products.length ? `
          <ul class="partner-products">
            ${products.map((product) => `<li>${renderProduct(product)}</li>`).join('\n            ')}
          </ul>` : ''}${shop ? `
          <p class="partner-shop">${shop.note ? `<span>${shop.note}</span>` : ''}
            <a href="${shop.href}" rel="sponsored noopener">${shop.label}</a>
          </p>` : ''}${!products.length && !shop ? `
          <p class="partner-empty">Produktempfehlungen folgen.</p>` : ''}${[shop, ...products].some(amazonLink) ? `
          <p class="partner-disclosure">Als Amazon-Partner verdiene ich an qualifizierten Verkäufen.</p>` : ''}
        </div>
      </details>`);
  return `<section id="empfehlungen" class="wrap partners" aria-labelledby="partners-title">
      <h2 id="partners-title">Meine Empfehlungen</h2>
      <div class="partner-list">${items.join('')}
      </div>
    </section>`;
}

function renderProduct({ label, href, note, image, offer }) {
  return `<a class="partner-product${offer ? ' partner-offer' : ''}" href="${href}" rel="sponsored noopener">
              ${image ? `<img src="${image}" alt="" loading="lazy" decoding="async">` : ''}
              <span class="partner-product-copy">
                <strong>${label}</strong>
                ${note ? `<small>${note}</small>` : ''}
                <span class="partner-product-link">${offer ? 'Angebote ansehen' : 'Produkt ansehen'} ↗</span>
              </span>
            </a>`;
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

// Bereich „Beliebteste Rezepte“ aus public/rezepte/rezepte.json (erzeugt von scripts/publish-recipes.mjs).
function renderRecipes(recipes) {
  if (!recipes.length) return '';
  const cards = recipes.slice(0, 6).map((recipe) => `
          <li><a href="rezepte/${escape(recipe.slug)}.html">
            <img src="${escape(recipe.image)}" alt="" loading="lazy" decoding="async" width="640" height="800">
            <span class="top-recipe-rank">${recipe.rank}</span>
            <span class="top-recipe-title">${escape(recipe.title)}</span>
          </a></li>`).join('');
  return `<section id="rezepte" class="top-recipes" aria-labelledby="top-recipes-title">
      <div class="wrap">
        <div class="top-recipes-heading">
          <div>
            <p class="top-recipes-kicker">Am häufigsten nachgekocht</p>
            <h2 id="top-recipes-title">Beliebteste Rezepte</h2>
          </div>
          <a class="top-recipes-all" href="rezepte/">Alle ${recipes.length} Rezepte ansehen →</a>
        </div>
        <ol class="top-recipes-grid">${cards}
        </ol>
      </div>
    </section>`;
}

async function readRecipes() {
  try {
    return JSON.parse(await readFile(new URL('public/rezepte/rezepte.json', root), 'utf8')).recipes || [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

const [config, template, recipes] = await Promise.all([
  readFile(new URL('links.md', root), 'utf8'),
  readFile(new URL('./index.template.html', import.meta.url), 'utf8'),
  readRecipes(),
]);
try {
  const { bio, links, partners } = readContent(config);
  const page = template.replace('<!-- BIO -->', () => bio.join('<br>'))
    .replace('<!-- RECIPE_NAV -->', () => recipes.length ? '<a href="rezepte/">Rezepte</a>' : '')
    .replace('<!-- RECIPE_BUTTON -->', () => recipes.length ? `<a class="hero-recipes" href="rezepte/">Alle ${recipes.length} Rezepte</a>` : '')
    .replace('<!-- RECIPES -->', () => renderRecipes(recipes))
    .replace('<!-- CONTACT_LINKS -->', () => renderContactLinks(links))
    .replace('<!-- PARTNER_NAV -->', () => partners.length ? '<a href="#empfehlungen">Empfehlungen</a>' : '')
    .replace('<!-- PROFILE_NAV -->', () => renderProfileLinks(links))
    .replace('<!-- PARTNERLINKS -->', () => renderPartners(partners));
  await writeFile(new URL('public/index.html', root), page);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
