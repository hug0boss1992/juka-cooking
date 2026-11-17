import { spawnSync } from 'node:child_process';

const endpoint = 'https://open.tiktokapis.com/v2/';
const videoUrl = /^https:\/\/www\.tiktok\.com\/@juka\.cooking\/video\/(\d+)\/?$/i;
const oauthErrors = new Set([
  'access_denied', 'invalid_client', 'invalid_grant', 'invalid_request', 'invalid_scope',
  'unauthorized_client', 'unsupported_grant_type', 'unsupported_response_type',
  'server_error', 'temporarily_unavailable',
]);

// Zeigt nur Merkmale der Eingaben, nie den Inhalt selbst.
export function describeCredentials({ TIKTOK_CLIENT_KEY: key, TIKTOK_CLIENT_SECRET: secret }) {
  function traits(value) {
    const unusual = [...value].filter((character) => !/[A-Za-z0-9]/.test(character)).length;
    return `${value.length} Zeichen, ${unusual ? `${unusual} Zeichen außer Buchstaben und Ziffern` : 'nur Buchstaben und Ziffern'}`;
  }
  const lines = [
    `Client key: ${traits(key)}, ${key.startsWith('sb') ? 'beginnt mit "sb" (Sandbox)' : 'beginnt NICHT mit "sb" (eher kein Sandbox-Key)'}`,
    `Client secret: ${traits(secret)}${secret.length === 32 ? '' : ' (erwartet sind üblicherweise 32)'}`,
  ];
  if (key === secret) lines.push('Warnung: Key und Secret sind identisch, vermutlich wurde zweimal derselbe Wert eingefügt.');
  return lines;
}

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
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token || !data?.refresh_token) {
    const code = oauthErrors.has(data?.error) ? data.error : 'unbekannter_fehler';
    const logId = typeof data?.log_id === 'string' && /^[\w-]{1,64}$/.test(data.log_id) ? `, log_id ${data.log_id}` : '';
    throw new Error(`TikTok-Autorisierung fehlgeschlagen (${code}, HTTP ${response.status}${logId}).`);
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
