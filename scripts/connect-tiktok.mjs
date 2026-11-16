import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { getToken, listVideos, storeRefreshToken } from './tiktok-api.mjs';

const redirect = 'http://127.0.0.1:3455/callback/';
const env = process.env;
const repository = process.argv[2];
if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET || !env.TIKTOK_SECRET_WRITER || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
  console.error('App-Zugang, GitHub-Secret-Zugang und Owner/Repository gemäß README angeben.');
  process.exit(1);
}

const verifier = randomBytes(48).toString('base64url');
const state = randomBytes(32).toString('hex');
const authorize = new URL('https://www.tiktok.com/v2/auth/authorize/');
authorize.search = new URLSearchParams({
  client_key: env.TIKTOK_CLIENT_KEY,
  scope: 'user.info.basic,video.list',
  response_type: 'code',
  redirect_uri: redirect,
  state,
  code_challenge: createHash('sha256').update(verifier).digest('hex'),
  code_challenge_method: 'S256',
});

const server = createServer();
try {
  const code = await new Promise((resolve, reject) => {
    const expiry = setTimeout(() => reject(new Error('Zeit für die TikTok-Autorisierung abgelaufen.')), 10 * 60_000);
    server.once('close', () => clearTimeout(expiry));
    server.once('error', reject);
    server.on('request', (request, response) => {
      const reply = new URL(request.url, redirect);
      if (reply.pathname !== '/callback/' || reply.searchParams.get('state') !== state) {
        response.writeHead(400).end('Ungueltige Autorisierungsanfrage.');
        return;
      }
      const code = reply.searchParams.get('code');
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
      response.end('Du kannst dieses Fenster schließen. Das Ergebnis erscheint im Terminal.');
      server.close();
      if (!code) reject(new Error('Die TikTok-Freigabe wurde nicht erteilt.'));
      else resolve(code);
    });
    server.listen(3455, '127.0.0.1', () => console.log(`Öffne diese Adresse im Browser und autorisiere @juka.cooking.\n${authorize}`));
  });
  const token = await getToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirect,
    code_verifier: verifier,
  }, env);
  if (!(await listVideos(token.access_token, 1)).length) throw new Error('Die Kontoautorisierung lieferte keine öffentlichen Videos.');
  storeRefreshToken(token.refresh_token, repository, env.TIKTOK_SECRET_WRITER);
  console.log('TikTok verbunden. Das Refresh-Token liegt im GitHub-Actions-Secret.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  server.close();
}
