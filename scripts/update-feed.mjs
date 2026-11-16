import { createHash } from 'node:crypto';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const output = new URL('../public/', import.meta.url);
const feedEndpoint = /^https:\/\/feeds\.behold\.so\/[a-z0-9_-]+\/?$/i;
const instagramPost = /^https:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[\w-]+\/?$/;
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

async function downloadPost(post, index, fetchResource) {
  const link = new URL(post.permalink);
  const permalink = `${link.origin}${link.pathname.replace(/\/?$/, '/')}`;
  if (link.username || link.password || !instagramPost.test(permalink)) {
    throw new Error(`Ungültiger Instagram-Permalink für Beitrag ${index + 1}.`);
  }

  const source = post.sizes?.small?.mediaUrl || post.sizes?.medium?.mediaUrl;
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
  const alt = cleanText(post.altText) || cleanText(post.prunedCaption) || cleanText(post.caption);
  const caption = cleanText(post.prunedCaption) || cleanText(post.caption);
  return { bytes, filename, entry: { permalink, image: `feed/${filename}`, alt: alt.slice(0, 160), caption: caption.slice(0, 300) } };
}

export async function updateFeed(feedUrl, { directory = output, fetchResource = fetch } = {}) {
  if (!feedEndpoint.test(feedUrl)) throw new Error('BEHOLD_FEED_URL muss eine öffentliche feeds.behold.so-Adresse sein.');
  const response = await request(feedUrl, 'application/json', fetchResource);
  const feed = await response.json();
  if (cleanText(feed?.username).toLowerCase() !== 'juka.cooking' || !Array.isArray(feed.posts)) {
    throw new Error('Erwartet wird ein Behold-JSON-Feed für @juka.cooking.');
  }

  const datedPosts = feed.posts.map((post) => {
    const date = Date.parse(post?.timestamp);
    if (!Number.isFinite(date)) throw new Error('Ein Beitrag enthält kein gültiges Veröffentlichungsdatum.');
    return { post, date };
  });
  datedPosts.sort((first, second) => second.date - first.date);

  // Complete all downloads before replacing any part of the live snapshot.
  const downloads = await Promise.all(datedPosts.slice(0, 6).map(({ post }, index) => downloadPost(post, index, fetchResource)));
  const imageDirectory = new URL('feed/', directory);
  await mkdir(imageDirectory, { recursive: true });
  for (const { filename, bytes } of downloads) {
    await writeFile(new URL(filename, imageDirectory), bytes);
  }

  const manifest = JSON.stringify({ posts: downloads.map(({ entry }) => entry) }, null, 2);
  const nextManifest = new URL('feed.json.tmp', directory);
  await writeFile(nextManifest, `${manifest}\n`);
  await rename(nextManifest, new URL('feed.json', directory));

  const retained = new Set(downloads.map(({ filename }) => filename));
  for (const filename of await readdir(imageDirectory)) {
    if (imageName.test(filename) && !retained.has(filename)) await rm(new URL(filename, imageDirectory));
  }
  return downloads.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const count = await updateFeed(process.env.BEHOLD_FEED_URL);
    console.log(`${count} Beiträge verarbeitet.`);
  } catch (error) {
    console.error(`Feed-Aktualisierung fehlgeschlagen. ${error.message}`);
    process.exitCode = 1;
  }
}
