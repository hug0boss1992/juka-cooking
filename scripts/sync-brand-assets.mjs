import { mkdir, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const outDir = new URL('public/brands/', root);
await mkdir(outDir, { recursive: true });

const sources = [
  {
    key: 'ninja-crispi',
    page: 'https://www.sharkninja.de/ninja-crispi-pro-7-in-1-glas-air-fryer-dunkelblau/AS101EUCY.html',
    type: 'og',
  },
  {
    key: 'naughty-pistazie',
    page: 'https://naughtynuts.de/products/bio-pistazienmus',
    type: 'og',
  },
  {
    key: 'ninja-logo',
    page: 'https://www.sharkninja.de/',
    type: 'logo',
    match: /ninja/i,
  },
  {
    key: 'naughty-logo',
    page: 'https://naughtynuts.de/',
    type: 'logo',
    match: /naughty/i,
  },
];

const allowedHosts = (hostname) =>
  hostname === 'www.sharkninja.de'
  || hostname === 'sharkninja.de'
  || hostname.endsWith('.sharkninja.de')
  || hostname === 'naughtynuts.de'
  || hostname.endsWith('.naughtynuts.de')
  || hostname === 'cdn.shopify.com'
  || hostname.endsWith('.shopifycdn.net')
  || hostname.endsWith('.cloudinary.com')
  || hostname.endsWith('.scene7.com')
  || hostname.endsWith('.akamaihd.net');

const decodeHtml = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function candidateUrl(raw, base) {
  if (!raw) return null;
  try {
    const url = new URL(decodeHtml(raw), base);
    if (url.protocol !== 'https:' || !allowedHosts(url.hostname)) return null;
    return url;
  } catch { return null; }
}

function attrs(tag) {
  const result = {};
  const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const m of tag.matchAll(re)) result[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return result;
}

function originalImage(html, base) {
  for (const tag of html.match(/<meta\b[^>]+>/gi) ?? []) {
    const a = attrs(tag);
    if (/^og:image(?::url)?$|^twitter:image$/.test(a.property || a.name || '')) {
      const url = candidateUrl(a.content, base);
      if (url) return url;
    }
  }
  return null;
}

function logoImage(html, base, brand) {
  const candidates = [];
  for (const tag of html.match(/<(?:img|source)\b[^>]+>/gi) ?? []) {
    const a = attrs(tag);
    const label = [a.src, a['data-src'], a.alt, a.class, a.id].join(' ');
    const logo = /logo|wordmark|brandmark|header.*brand/i.test(label);
    if (!logo || !brand.test(label)) continue;
    const src = a.src || a['data-src'] || (a.srcset || '').split(/\s+/)[0];
    const url = candidateUrl(src, base);
    if (url) candidates.push({ url, score: /logo/i.test(a.alt || '') ? 2 : 1 });
  }
  // JSON-LD organization logos are official publisher-supplied URLs.
  for (const script of html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? []) {
    const payload = script.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
    try {
      const data = JSON.parse(payload);
      const stack = Array.isArray(data) ? data : [data];
      for (const entry of stack) {
        if (!entry || typeof entry !== 'object') continue;
        const logo = typeof entry.logo === 'string' ? entry.logo : entry.logo?.url;
        if (!logo || !brand.test(String(entry.name ?? '') + ' ' + base)) continue;
        const url = candidateUrl(logo, base);
        if (url) candidates.push({ url, score: 2 });
      }
    } catch {}
  }
  candidates.sort((a,b)=>b.score-a.score);
  return candidates[0]?.url || null;
}

async function fetchBytes(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'JukaCookingBrandPreview/1.0 (+brand assets for creator link page)' }, signal: AbortSignal.timeout(20000), redirect: 'follow' });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const dest = new URL(response.url);
  if (dest.protocol !== 'https:' || !allowedHosts(dest.hostname)) throw new Error('Nicht erlaubter Bildhost');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1000 || bytes.length > 5_000_000) throw new Error('Bildgroesse nicht plausibel');
  let ext;
  const type = response.headers.get('content-type') ?? '';
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ext='png';
  else if (bytes.subarray(0,3).toString('hex')==='ffd8ff') ext='jpg';
  else if (bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP') ext='webp';
  else if (type.includes('image/svg+xml') && bytes.toString('utf8').includes('<svg')) {
    const svg = bytes.toString('utf8');
    if (/<script\b|<foreignObject\b|onload\s*=|onerror\s*=|https?:\/\/|data:/i.test(svg)) throw new Error('SVG mit externen/aktiven Inhalten');
    ext='svg';
  } else throw new Error('Kein unterstuetztes Originalbild');
  return { bytes, ext };
}

let manifest={};
try { manifest=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('manifest.json', outDir), 'utf8')); } catch {}
let count = 0;
for (const item of sources) {
  try {
    const pageRes = await fetch(item.page, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JukaCookingCreatorSite/1.0)' } });
    if (!pageRes.ok) throw new Error('Herstellerseite HTTP ' + pageRes.status);
    const html = await pageRes.text();
    const url = item.type === 'og' ? originalImage(html, item.page) : logoImage(html, item.page, item.match);
    if (!url) throw new Error('Kein sicher zuordenbares Herstellerbild gefunden');
    const { bytes, ext } = await fetchBytes(url);
    const name = item.key + '.' + ext;
    await writeFile(new URL(name, outDir), bytes);
    manifest[item.key] = { path:'brands/' + name, source: item.page };
    count += 1;
    console.log('Originalasset gespeichert:', item.key, bytes.length, 'Byte');
  } catch (error) {
    console.log('Originalasset nicht verfügbar:', item.key, error.message);
  }
}
await writeFile(new URL('manifest.json', outDir), JSON.stringify(manifest,null,2)+'\n');
console.log('Originalassets gefunden:', count, 'von', sources.length);
