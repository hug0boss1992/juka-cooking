import { spawnSync } from 'node:child_process';

const endpoint = 'https://open.tiktokapis.com/v2/';
const videoUrl = /^https:\/\/www\.tiktok\.com\/@juka\.cooking\/video\/(\d+)\/?$/i;

export async function getToken(grant, env, fetchResource = fetch) {
  if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) throw new Error('TikTok-App-Zugang fehlt.');
  const response = await fetchResource(endpoint + 'oauth/token/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: env.TIKTOK_CLIENT_KEY,
      client_secret: env.TIKTOK_CLIENT_SECRET,
      ...grant,
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token || !data.refresh_token) {
    throw new Error(`TikTok-Autorisierung fehlgeschlagen (HTTP ${response.status}).`);
  }
  return data;
}

export function storeRefreshToken(token, repository, githubToken) {
  if (!githubToken || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    throw new Error('Repository oder GitHub-Zugang für die Token-Aktualisierung fehlt.');
  }
  const result = spawnSync('gh', ['secret', 'set', 'TIKTOK_REFRESH_TOKEN', '--repo', repository, '--env', 'tiktok-feed'], {
    input: token,
    stdio: ['pipe', 'ignore', 'ignore'],
    env: { ...process.env, GH_TOKEN: githubToken, GH_DEBUG: '' },
    timeout: 20_000,
  });
  if (result.status !== 0) throw new Error('GitHub konnte den TikTok-Refresh-Token nicht im Secret speichern.');
}

export async function listVideos(accessToken, pages = 3, fetchResource = fetch) {
  const latest = [];
  let cursor;
  for (let page = 0; page < pages; page++) {
    const response = await fetchResource(endpoint + 'video/list/?fields=id,share_url,cover_image_url,title,video_description', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ max_count: 20, cursor }),
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
    const { data, error } = await response.json();
    if (!response.ok || error?.code !== 'ok' || !Array.isArray(data?.videos)) {
      throw new Error(`TikTok-Videoliste konnte nicht abgerufen werden (HTTP ${response.status}).`);
    }
    for (const video of data.videos) {
      const permalink = new URL(video.share_url);
      const canonical = permalink.origin + permalink.pathname;
      if (permalink.username || permalink.password || videoUrl.exec(canonical)?.[1] !== video.id) {
        throw new Error('Die TikTok-Videoliste gehört nicht zu @juka.cooking.');
      }
      latest.push({ ...video, permalink: canonical });
    }
    if (!data.has_more) break;
    if (!Number.isSafeInteger(data.cursor) || data.cursor === cursor) throw new Error('TikTok lieferte einen ungültigen Video-Cursor.');
    cursor = data.cursor;
  }
  return [...new Map(latest.map((video) => [video.id, video])).values()];
}
