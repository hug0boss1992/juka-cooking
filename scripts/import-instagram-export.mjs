// Übernimmt ältere Instagram-Beiträge aus dem offiziellen Datenexport ins Website-Archiv.
//
// node scripts/import-instagram-export.mjs EXPORTORDNER BUSINESS-SUITE.csv [WEITERE.csv ...]
//
// EXPORTORDNER ist der entpackte Instagram-Export (mindestens
// your_instagram_activity/media/*.json und die darin genannten Mediendateien).
// Die CSV-Dateien stammen aus Meta Business Suite → Insights → Inhalte → Exportieren
// und liefern die Permalinks, die der Datenexport nicht enthält. Beiträge ohne
// Permalink werden übersprungen und gemeldet. ffmpeg muss im PATH liegen.
//
// Achtung: Der Export enthält nicht das gewählte Titelbild. Dieses Skript schneidet ein
// Standbild aus dem Video aus. Danach die echten Titelbilder von Instagram übernehmen
// (am 19.11.2026 für alle 161 Beiträge erledigt, 640×1136 statt 225×400).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { feedTitle, isAdvertised } from './feed-title.mjs';

const output = new URL('../public/', import.meta.url);
const instagramPost = /^https:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/([\w-]+)\/?$/;
const mediaPath = /^media\/(?:posts|other)\/\d+\.(?:mp4|heic|jpe?g|webp)$/;

// Meta schreibt UTF-8-Text im Export als Latin-1-Zeichen.
const repair = (text) => typeof text === 'string' ? Buffer.from(text, 'latin1').toString('utf8') : '';
const cleanText = (text) => text.replace(/\s+/g, ' ').trim();
const key = (text) => cleanText(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 80);

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += character;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((cells) => cells.some(Boolean));
  return body.map((cells) => Object.fromEntries(header.map((name, index) => [name.replace(/^﻿/, ''), cells[index] ?? ''])));
}

async function exportedMedia(directory) {
  const read = async (name) => JSON.parse(await readFile(join(directory, 'your_instagram_activity/media', name), 'utf8'));
  const reels = (await read('reels.json')).ig_reels_media.map(({ media: [media] }) => ({
    file: media.uri, timestamp: media.creation_timestamp, caption: repair(media.title),
  }));
  const posts = (await read('posts.json')).flatMap(({ timestamp, label_values: labels }) => {
    const media = labels.find(({ label }) => label === 'Medien')?.media ?? [];
    return media.length ? [{ file: media[0].uri, timestamp, caption: repair(media[0].title) }] : [];
  });
  return [...reels, ...posts];
}

function makeCover(source) {
  const video = source.endsWith('.mp4');
  const result = spawnSync('ffmpeg', [
    '-v', 'error', ...(video ? ['-ss', '0.5'] : []), '-i', source,
    '-vf', `${video ? 'thumbnail=30,' : ''}scale=225:400:force_original_aspect_ratio=increase,crop=225:400`,
    '-frames:v', '1', '-c:v', 'libwebp', '-quality', '78', '-f', 'webp', 'pipe:1',
  ], { maxBuffer: 5_000_000, timeout: 60_000 });
  const bytes = result.stdout;
  if (result.status !== 0 || !bytes || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error(`Titelbild konnte nicht erzeugt werden (${source.split(/[\\/]/).pop()}).`);
  }
  return bytes;
}

export async function importExport(exportDirectory, csvFiles, { directory = output } = {}) {
  const linkByCaption = new Map();
  for (const file of csvFiles) {
    for (const row of parseCsv(await readFile(file, 'utf8'))) {
      const permalink = row.Permalink?.replace(/\/?$/, '/');
      if (instagramPost.test(permalink) && row.Beschreibung) linkByCaption.set(key(row.Beschreibung), permalink);
    }
  }

  const manifestUrl = new URL('feed.json', directory);
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const hidden = new Set(manifest.excluded ?? []);
  const known = new Map(manifest.posts.map((post) => [instagramPost.exec(post.permalink)?.[1], post]));
  const imageDirectory = new URL('feed/', directory);
  await mkdir(imageDirectory, { recursive: true });

  const missing = [];
  let added = 0;
  for (const item of await exportedMedia(exportDirectory)) {
    const permalink = item.caption ? linkByCaption.get(key(item.caption)) : undefined;
    if (!permalink) { missing.push(item); continue; }
    const id = instagramPost.exec(permalink)[1];
    if (known.has(id) || hidden.has(id)) continue;
    if (!mediaPath.test(item.file)) throw new Error(`Unerwarteter Medienpfad im Export: ${item.file}`);

    let bytes;
    try {
      bytes = makeCover(join(exportDirectory, item.file));
    } catch (error) {
      missing.push({ ...item, reason: error.message });
      continue;
    }
    const filename = `${createHash('sha256').update(bytes).digest('hex').slice(0, 24)}.webp`;
    await writeFile(new URL(filename, imageDirectory), bytes);
    known.set(id, {
      permalink, image: `feed/${filename}`, alt: '', caption: cleanText(item.caption).slice(0, 300),
      title: feedTitle(item.caption),
      ...(isAdvertised(item.caption) ? { ad: true } : {}),
      publishedAt: new Date(item.timestamp * 1000).toISOString(),
    });
    added++;
  }

  const posts = [...known.values()].sort((first, second) =>
    (Date.parse(second.publishedAt) || 0) - (Date.parse(first.publishedAt) || 0));
  const next = JSON.stringify({ ...manifest, posts }, null, 2);
  const temporary = new URL('feed.json.tmp', directory);
  await writeFile(temporary, `${next}\n`);
  await rename(temporary, manifestUrl);
  return { added, total: posts.length, missing };
}

if (process.argv[1]?.endsWith('import-instagram-export.mjs')) {
  const [exportDirectory, ...csvFiles] = process.argv.slice(2);
  if (!exportDirectory || !csvFiles.length) {
    console.error('Aufruf: node scripts/import-instagram-export.mjs EXPORTORDNER BUSINESS-SUITE.csv [WEITERE.csv ...]');
    process.exit(1);
  }
  try {
    const { added, total, missing } = await importExport(exportDirectory, csvFiles);
    console.log(`${added} Beiträge übernommen, ${total} im Archiv.`);
    if (missing.length) {
      const dates = missing.map(({ timestamp }) => new Date(timestamp * 1000).toISOString().slice(0, 10)).sort();
      console.log(`${missing.length} Beiträge ohne Permalink oder Titelbild (${dates[0]} bis ${dates.at(-1)}).`);
      for (const { reason } of missing.filter(({ reason }) => reason)) console.log(`  ${reason}`);
    }
  } catch (error) {
    console.error(`Import fehlgeschlagen. ${error.message}`);
    process.exitCode = 1;
  }
}
