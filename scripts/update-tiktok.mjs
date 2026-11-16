import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { getToken, listVideos, storeRefreshToken } from './tiktok-api.mjs';
import { feedTitle, isAdvertised } from './feed-title.mjs';

const output = new URL('../public/', import.meta.url);
const tiktokCdn = /(?:^|\.)tiktokcdn(?:-us|-eu)?\.com$/i;

function convertImage(bytes, args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-frames:v', '1', '-threads', '1', ...args, 'pipe:1'], {
    input: bytes,
    timeout: 8_000,
    maxBuffer: 3_000_000,
  });
  if (result.status !== 0 || !result.stdout.length) throw new Error('Ein Titelbild konnte nicht verarbeitet werden.');
  return result.stdout;
}

function fingerprints(bytes) {
  // Compare both the full frame and its central square to handle different platform crops.
  return ['scale=9:8:flags=area', "crop='min(iw,ih)':'min(iw,ih)',scale=9:8:flags=area"].map((filter) => {
    const pixels = convertImage(bytes, ['-vf', filter, '-pix_fmt', 'gray', '-f', 'rawvideo']);
    if (pixels.length !== 72) throw new Error('Ein Titelbild konnte nicht verglichen werden.');
    return Array.from({ length: 64 }, (_, index) => {
      const offset = index + Math.floor(index / 8);
      return pixels[offset] > pixels[offset + 1];
    });
  });
}

function words(text) {
  const plain = (text || '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
  return new Set(plain.replace(/https?:\/\/\S+|[@#]\S+/g, '').match(/\p{L}{4,}/gu) || []);
}

export function isCrosspost(first, second) {
  const common = [...first.words].filter((word) => second.words.has(word)).length;
  if (common >= 4 && common / Math.min(first.words.size, second.words.size) >= 0.8) return true;
  return first.hashes.some((hash) => second.hashes.some((other) => hash.filter((bit, index) => bit !== other[index]).length <= 5));
}

async function loadCover(source, fetchResource) {
  const url = new URL(source);
  if (url.protocol !== 'https:' || !tiktokCdn.test(url.hostname) || url.port || url.username || url.password) {
    throw new Error('TikTok lieferte eine unerwartete Titelbild-Adresse.');
  }
  const response = await fetchResource(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) {
    throw new Error('Ein TikTok-Titelbild war nicht verfügbar.');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 8_000_000) throw new Error('Ein TikTok-Titelbild hatte eine ungültige Größe.');
  return bytes;
}

export async function buildTikTokFeed(videos, {
  directory = output, fetchResource = fetch, fingerprint = fingerprints,
  encode = (bytes) => convertImage(bytes, ['-vf', 'scale=400:400:force_original_aspect_ratio=decrease', '-c:v', 'libwebp', '-quality', '82', '-f', 'webp']),
} = {}) {
  const { posts } = JSON.parse(await readFile(new URL('feed.json', directory), 'utf8'));
  const instagram = await Promise.all(posts.map(async (post) => {
    if (!/^feed\/[a-f0-9]{24}\.webp$/.test(post.image)) throw new Error('Das Instagram-Titelbild ist ungültig.');
    const bytes = await readFile(new URL(post.image, directory));
    return { words: words(post.alt + ' ' + (post.caption || '')), hashes: fingerprint(bytes) };
  }));

  // Sample across the result, including older videos, before the browser draws its six.
  const slots = Math.min(videos.length, 24);
  const candidates = Array.from({ length: slots }, (_, index) =>
    videos[Math.round(index * (videos.length - 1) / Math.max(1, slots - 1))]);
  const kept = [];
  let failed = 0;
  for (let index = 0; index < candidates.length; index += 4) {
    const batch = await Promise.allSettled(candidates.slice(index, index + 4).map(async (video) => {
      const bytes = await loadCover(video.cover_image_url, fetchResource);
      const title = feedTitle(video.title) || feedTitle(video.video_description);
      const signature = { words: words(video.video_description || video.title), hashes: fingerprint(bytes) };
      if (instagram.some((post) => isCrosspost(signature, post))) return null;
      return { signature, entry: {
        permalink: video.permalink, image: `tiktok/${video.id}.webp`, title,
        ...(isAdvertised(video.video_description || video.title) ? { ad: true } : {}),
      }, bytes: encode(bytes) };
    }));
    for (const result of batch) {
      if (result.status === 'rejected') failed++;
      else if (result.value && !kept.some((post) => isCrosspost(result.value.signature, post.signature))) kept.push(result.value);
    }
  }
  if (candidates.length && failed === candidates.length) throw new Error('Kein TikTok-Titelbild konnte abgerufen und verarbeitet werden.');

  await mkdir(new URL('tiktok/', directory), { recursive: true });
  for (const { entry, bytes } of kept) await writeFile(new URL(entry.image, directory), bytes);
  await writeFile(new URL('tiktok.json', directory), JSON.stringify({ posts: kept.map(({ entry }) => entry) }, null, 2) + '\n');
  return { shown: kept.length, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  try {
    if (!env.TIKTOK_REFRESH_TOKEN || !env.TIKTOK_SECRET_WRITER) throw new Error('TikTok-Verbindung oder GitHub-Secret-Zugang fehlt.');
    const token = await getToken({ grant_type: 'refresh_token', refresh_token: env.TIKTOK_REFRESH_TOKEN }, env);
    if (token.refresh_token !== env.TIKTOK_REFRESH_TOKEN) {
      storeRefreshToken(token.refresh_token, env.GITHUB_REPOSITORY, env.TIKTOK_SECRET_WRITER);
    }
    const { shown, failed } = await buildTikTokFeed(await listVideos(token.access_token));
    console.log(`${shown} TikTok-Videos im Mix.`);
    if (failed) console.log(`::warning::${failed} TikTok-Titelbilder konnten nicht verarbeitet werden.`);
  } catch (error) {
    console.error(`::warning::TikTok-Aktualisierung fehlgeschlagen. ${error.message}`);
    process.exitCode = 1;
  }
}
