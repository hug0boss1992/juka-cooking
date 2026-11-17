import { spawnSync } from 'node:child_process';
import { access, cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { describeCredentials } from './tiktok-api.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));

function run(program, args, env = process.env) {
  const result = spawnSync(program, args, { cwd: project, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Der lokale TikTok-Test wurde unterbrochen oder ist fehlgeschlagen.');
}

async function readCredentials() {
  if (!process.stdin.isTTY) throw new Error('Starte den Test in einem interaktiven Terminal.');
  const mutedOutput = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const terminal = createInterface({ input: process.stdin, output: mutedOutput, terminal: true, historySize: 0 });
  const cancelled = new AbortController();
  terminal.on('SIGINT', () => cancelled.abort());

  async function readValue(label) {
    const prompt = `${label} (verdeckt): `;
    function showInputStatus(_character, key) {
      if (key?.name === 'return' || key?.name === 'enter') return;
      process.stdout.cursorTo(0);
      process.stdout.clearLine(0);
      process.stdout.write(prompt + (terminal.line.trim() ? '[Eingabe vorhanden]' : ''));
    }

    while (true) {
      process.stdout.write(prompt);
      process.stdin.on('keypress', showInputStatus);
      let value;
      try {
        value = (await terminal.question('', { signal: cancelled.signal })).trim();
      } finally {
        process.stdin.off('keypress', showInputStatus);
        process.stdout.write('\n');
      }
      if (value) return value;
      console.log('Das Feld ist leer. Bitte den Wert einfügen und Enter drücken.');
    }
  }

  try {
    let key = await readValue('Client key aus der TikTok-Sandbox');
    while (!key.startsWith('sb')) {
      console.log('Dieser Key gehört nicht zur Sandbox (Sandbox-Keys beginnen mit "sb"). Bitte oben im Portal auf "Sandbox" umschalten und den Key dort kopieren.');
      key = await readValue('Client key aus der TikTok-Sandbox');
    }
    let secret = await readValue('Client secret aus der TikTok-Sandbox');
    while (secret === key) {
      console.log('Das ist noch einmal der Client key. Bitte beim Client secret auf das Augen- oder Kopiersymbol klicken und diesen Wert einfügen.');
      secret = await readValue('Client secret aus der TikTok-Sandbox');
    }
    return { TIKTOK_CLIENT_KEY: key, TIKTOK_CLIENT_SECRET: secret };
  } finally {
    terminal.close();
  }
}

try {
  const ffmpeg = join(process.env.LOCALAPPDATA, 'Temp', 'juka-tiktok-ffmpeg-9.0.2',
    'ffmpeg-9.0.2-essentials_build', 'bin', 'ffmpeg.exe');
  await access(ffmpeg);
  run(process.execPath, ['scripts/build-site.mjs']);
  const preview = await mkdtemp(join(tmpdir(), 'juka-tiktok-preview-'));
  await cp(join(project, 'public'), preview, { recursive: true });
  const credentials = await readCredentials();
  console.log('Prüfung der Eingaben (ohne Inhalt):');
  for (const line of describeCredentials(credentials)) console.log(`  ${line}`);
  console.log('Öffne die ausgegebene Adresse und autorisiere @juka.cooking direkt bei TikTok.');
  try {
    run(process.execPath, ['scripts/connect-tiktok.mjs', '--sandbox', preview], {
      ...process.env,
      ...credentials,
      PATH: dirname(ffmpeg) + delimiter + process.env.PATH,
    });
  } finally {
    delete credentials.TIKTOK_CLIENT_KEY;
    delete credentials.TIKTOK_CLIENT_SECRET;
  }
  console.log('Öffne http://127.0.0.1:8576/#beitraege und wähle TikTok. Strg+C beendet die Vorschau.');
  run('python.exe', ['-m', 'http.server', '8576', '--bind', '127.0.0.1', '--directory', preview]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
