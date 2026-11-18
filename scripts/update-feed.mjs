import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { feedTitle, isAdvertised } from './feed-title.mjs';

const output = new URL('../public/', import.meta.url);
const feedEndpoint = /^https:\/\/feeds\.behold\.so\/[a-z0-9_-]+\/?$/i;
const instagramPost = /^https:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/([\w-]+)\/?$/;
const beholdImage = /^https:\/\/(?:[a-z0-9-]+\.)*behold\.pictures\//i;
const imageName = /^[a-f0-9]{24}\.webp$/;

async function request(url, accept, fetchResource) {
  const resource = await fetchResource(url, {
    headers: { accept },
    redirect: 'error',
    signal: AbortSignal.timeout(25_000),
  });
  if (!resource.ok) throw new Error(`Abruf fehlgeschlagen (HTTP ${resource.status}).`);
  return resource;
}

function cleanText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function postLink(value, index) {
  const link = new URL(value);
  const permalink = `${link.origin}${link.pathname.replace(/\/?$/, '/')}`;
  const id = instagramPost.exec(permalink)?.[1];
  if (link.username || link.password || !id) {
    throw new Error(`Ungültiger Instagram-Permalink für Beitrag ${index + 1}.`);
  }
  return { id, permalink };
}

async function downloadPost({ post, date, permalink }, index, fetchResource) {
  // Größtes verfügbares Titelbild bevorzugen, damit Vorschaubilder und Rezeptseiten scharf bleiben.
  const source = post.sizes?.large?.mediaUrl || post.sizes?.medium?.mediaUrl || post.sizes?.small?.mediaUrl;
  if (typeof source !== 'string' || !beholdImage.test(source)) {
    throw new Error(`Kein Behold-Titelbild für Beitrag ${index + 1}.`);
  }

  const response = await request(source, 'image/webp', fetchResource);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 16 || bytes.length > 5_000_000 || bytes.toString('ascii', 0, 4) !== 'RIFF'
      || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 !== bytes.length) {
    throw new Error(`Ungültiges WebP-Titelbild für Beitrag ${index + 1}.`);
  }

  const filename = `${createHash('sha256').update(bytes).digest('hex').slice(0, 24)}.webp`;
  const alt = cleanText(post.altText);
  const description = post.prunedCaption || post.caption;
  return { bytes, filename, entry: {
    permalink, image: `feed/${filename}`, alt: alt.slice(0, 160), caption: cleanText(description).slice(0, 300),
    title: feedTitle(post.title) || feedTitle(description),
    ...(isAdvertised(post.caption || description) ? { ad: true } : {}),
    publishedAt: new Date(date).toISOString(),
  } };
}

export async function updateFeed(feedUrl, { directory = output, fetchResource = fetch } = {}) {
  if (!feedEndpoint.test(feedUrl)) throw new Error('BEHOLD_FEED_URL muss eine öffentliche feeds.behold.so-Adresse sein.');
  const response = await request(feedUrl, 'application/json', fetchResource);
  const feed = await response.json();
  // Some Behold feeds omit the username from their account metadata.
  if (!Array.isArray(feed?.posts) || (feed.username !== undefined && cleanText(feed.username).toLowerCase() !== 'juka.cooking')) {
    throw new Error('Erwartet wird ein Behold-JSON-Feed für @juka.cooking.');
  }

  const manifestUrl = new URL('feed.json', directory);
  const { posts: archived, excluded = [] } = await readFile(manifestUrl, 'utf8')
    .then(JSON.parse).catch((error) => {
      if (error.code === 'ENOENT') return { posts: [] };
      throw error;
    });
  if (!Array.isArray(archived) || !Array.isArray(excluded) || excluded.some((id) => !/^[\w-]+$/.test(id))) {
    throw new Error('feed.json enthält kein gültiges Instagram-Archiv.');
  }
  const hidden = new Set(excluded);
  const datedPosts = feed.posts.map((post, index) => {
    const date = Date.parse(post?.timestamp);
    if (!Number.isFinite(date)) throw new Error('Ein Beitrag enthält kein gültiges Veröffentlichungsdatum.');
    return { post, date, ...postLink(post.permalink, index) };
  });
  datedPosts.sort((first, second) => second.date - first.date);
  const recent = [...new Map(datedPosts.slice(0, 6).map((post) => [post.id, post])).values()]
    .filter(({ id }) => !hidden.has(id));

  // Complete all downloads before changing the archive or replacing existing covers.
  const downloads = await Promise.all(recent.map((post, index) => downloadPost(post, index, fetchResource)));
  const merged = new Map(recent.map(({ id }, index) => [id, downloads[index].entry]));
  for (const [index, entry] of archived.entries()) {
    const { id } = postLink(entry.permalink, index);
    if (hidden.has(id)) continue;
    const latest = merged.get(id);
    if (latest) {
      if (entry.titleOverride) latest.titleOverride = entry.titleOverride;
      continue;
    }
    if (!/^feed\/[a-f0-9]{24}\.webp$/.test(entry.image)) throw new Error('Ungültiges Titelbild im Instagram-Archiv.');
    merged.set(id, entry);
  }
  const posts = [...merged.values()].sort((first, second) =>
    (Date.parse(second.publishedAt) || 0) - (Date.parse(first.publishedAt) || 0));

  const imageDirectory = new URL('feed/', directory);
  await mkdir(imageDirectory, { recursive: true });
  for (const { filename, bytes } of downloads) {
    await writeFile(new URL(filename, imageDirectory), bytes);
  }

  const manifest = JSON.stringify(excluded.length ? { posts, excluded } : { posts }, null, 2);
  const nextManifest = new URL('feed.json.tmp', directory);
  await writeFile(nextManifest, `${manifest}\n`);
  await rename(nextManifest, manifestUrl);

  const retained = new Set(posts.map(({ image }) => image.slice('feed/'.length)));
  for (const filename of await readdir(imageDirectory)) {
    if (imageName.test(filename) && !retained.has(filename)) await rm(new URL(filename, imageDirectory));
  }
  return posts.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const count = await updateFeed(process.env.BEHOLD_FEED_URL);
    console.log(`${count} Beiträge im Instagram-Archiv.`);
  } catch (error) {
    console.error(`Feed-Aktualisierung fehlgeschlagen. ${error.message}`);
    process.exitCode = 1;
  }
}
