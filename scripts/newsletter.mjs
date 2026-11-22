// Newsletter über Brevo (EU). Läuft nur auf GitHub (.github/workflows/newsletter.yml),
// der API-Schlüssel kommt aus dem GitHub-Secret BREVO_API_KEY und steht nirgends im Repository.
//
//   node scripts/newsletter.mjs einrichten   Liste + Bestätigungsmail (Double-Opt-in) anlegen, IDs in data/newsletter.json
//   node scripts/newsletter.mjs senden       Neue Rezepte seit dem letzten Versand als Mail an die Liste schicken
//   node scripts/newsletter.mjs stand        Anzahl Abonnenten ausgeben
//
// data/newsletter.json: { listId, doiTemplateId, gesendet: [slugs], letzterVersand, versand: [...] }
import { readFile, writeFile } from 'node:fs/promises';

const site = 'https://juka-cooking.de';
const sender = { name: 'Juka Cooking', email: 'rezepte@juka-cooking.de' };
const replyTo = 'juka.cooking@gmail.com';
const root = new URL('../', import.meta.url);
const file = (path) => new URL(path, root);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const key = process.env.BREVO_API_KEY;
if (!key) { console.error('BREVO_API_KEY fehlt (GitHub-Secret).'); process.exit(1); }

async function brevo(method, path, body) {
  const res = await fetch(`https://api.brevo.com/v3${path}`, {
    method,
    headers: { 'api-key': key, accept: 'application/json', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Brevo ${method} ${path}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

const stateFile = file('data/newsletter.json');
const state = JSON.parse(await readFile(stateFile, 'utf8').catch(() => '{}'));
const save = () => writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
const { recipes } = JSON.parse(await readFile(file('public/rezepte/rezepte.json'), 'utf8'));

const shell = (inner, preheader) => `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Juka Cooking</title></head>
<body style="margin:0;background:#faf8f3;font-family:Arial,Helvetica,sans-serif;color:#2b3327">
<span style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f3"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf8;border:1px solid #ded7c8;border-radius:14px">
<tr><td style="padding:26px 28px 8px;text-align:center"><a href="${site}/" style="font:700 26px Georgia,serif;color:#3a4932;text-decoration:none">juka<span style="color:#bd784f">.</span>cooking</a></td></tr>
${inner}
<tr><td style="padding:18px 28px 26px;border-top:1px solid #ded7c8;font-size:12px;line-height:1.6;color:#565c50;text-align:center">
Du bekommst diese Mail, weil du dich auf juka-cooking.de für neue Rezepte eingetragen hast.<br>
<a href="{{ unsubscribe }}" style="color:#8a4c32">Abmelden</a> · <a href="${site}/impressum.html" style="color:#8a4c32">Impressum</a> · <a href="${site}/datenschutz.html#newsletter" style="color:#8a4c32">Datenschutz</a><br>
Justyna Alieva · Juka Cooking · Elsenpfuhlstr. 6 · 13437 Berlin</td></tr>
</table></td></tr></table></body></html>`;

async function einrichten() {
  if (!state.listId) {
    const folder = await brevo('POST', '/contacts/folders', { name: 'Juka Cooking' });
    const list = await brevo('POST', '/contacts/lists', { name: 'Newsletter – neue Rezepte', folderId: folder.id });
    state.listId = list.id;
  }
  if (!state.doiTemplateId) {
    const html = shell(`<tr><td style="padding:10px 28px 24px;text-align:center">
<h1 style="font:700 24px/1.25 Georgia,serif;margin:8px 0 12px">Nur noch ein Klick!</h1>
<p style="font-size:15px;line-height:1.6;margin:0 0 20px">Bitte bestätige, dass du die neuen Rezepte von Juka Cooking per Mail bekommen möchtest. Danach kannst du sofort das Rezeptheft mit den 10 beliebtesten Rezepten herunterladen.</p>
<a href="{{ doubleoptin }}" style="display:inline-block;background:#3e593f;color:#ffffff;font-weight:bold;font-size:16px;padding:13px 26px;border-radius:999px;text-decoration:none">Anmeldung bestätigen</a>
<p style="font-size:13px;line-height:1.6;color:#565c50;margin:20px 0 0">Du hast dich nicht angemeldet? Dann ignoriere diese Mail einfach – ohne Bestätigung bekommst du nichts.</p>
</td></tr>`, 'Bitte bestätige deine Anmeldung').replace(/<tr><td style="padding:18px[\s\S]*?<\/td><\/tr>/, `<tr><td style="padding:18px 28px 26px;border-top:1px solid #ded7c8;font-size:12px;line-height:1.6;color:#565c50;text-align:center">
<a href="${site}/impressum.html" style="color:#8a4c32">Impressum</a> · <a href="${site}/datenschutz.html#newsletter" style="color:#8a4c32">Datenschutz</a><br>Justyna Alieva · Juka Cooking · Elsenpfuhlstr. 6 · 13437 Berlin</td></tr>`);
    const tpl = await brevo('POST', '/smtp/templates', {
      templateName: 'Juka – Anmeldung bestätigen (Double-Opt-in)',
      subject: 'Bitte bestätige deine Anmeldung – Juka Cooking',
      sender, replyTo, htmlContent: html, isActive: true, tag: 'optin',
    });
    state.doiTemplateId = tpl.id;
  }
  if (!state.gesendet) {
    // Bestehende Rezepte gelten als „schon bekannt“, damit die erste Mail nicht alle 67 enthält.
    state.gesendet = recipes.map((r) => r.slug).sort();
    state.versand = [];
  }
  await save();
  console.log(`Newsletter eingerichtet: Liste ${state.listId}, Bestätigungsmail ${state.doiTemplateId}.`);
}

async function recipeInfo(r) {
  const html = await readFile(file(`public/rezepte/${r.slug}.html`), 'utf8');
  const d = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const text = (d.description || '').replace(/\s+/g, ' ').trim();
  return { ...r, description: text.length > 170 ? `${text.slice(0, 167).replace(/\s+\S*$/, '')} …` : text };
}

async function senden() {
  if (!state.listId) throw new Error('Erst „einrichten“ ausführen.');
  const neu = recipes.filter((r) => !state.gesendet.includes(r.slug));
  if (!neu.length) { console.log('Keine neuen Rezepte seit dem letzten Versand – keine Mail.'); return; }
  const list = await brevo('GET', `/contacts/lists/${state.listId}`);
  const abonnenten = list.uniqueSubscribers ?? list.totalSubscribers ?? 0;
  const items = await Promise.all(neu.map(recipeInfo));
  if (abonnenten > 0) {
    const cards = items.map((r) => `<tr><td style="padding:14px 28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="150" valign="top"><a href="${site}/rezepte/${r.slug}.html"><img src="${site}/pins/${r.slug}.jpg" width="150" alt="${esc(r.title)}" style="display:block;width:150px;height:auto;border-radius:10px;border:0"></a></td>
<td valign="top" style="padding-left:18px">
<h2 style="font:700 19px/1.3 Georgia,serif;margin:0 0 8px"><a href="${site}/rezepte/${r.slug}.html" style="color:#2b3327;text-decoration:none">${esc(r.title)}</a></h2>
${r.minutes ? `<p style="margin:0 0 8px;font-size:13px;color:#8a4c32">ca. ${r.minutes} Min.</p>` : ''}
<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#565c50">${esc(r.description)}</p>
<a href="${site}/rezepte/${r.slug}.html" style="display:inline-block;background:#3e593f;color:#ffffff;font-weight:bold;font-size:14px;padding:9px 18px;border-radius:999px;text-decoration:none">Zum Rezept</a>
</td></tr></table></td></tr>`).join('\n');
    const intro = items.length === 1 ? 'diese Woche gibt es ein neues Rezept' : `diese Woche gibt es ${items.length} neue Rezepte`;
    const html = shell(`<tr><td style="padding:8px 28px 6px"><p style="font-size:15px;line-height:1.6;margin:0">Hallo, ${intro} – mit allen Zutaten und Schritt für Schritt erklärt. Viel Spaß beim Nachkochen!<br>Deine Justyna</p></td></tr>
${cards}
<tr><td style="padding:10px 28px 22px;text-align:center"><a href="${site}/rezepte/" style="color:#8a4c32;font-size:14px">Alle Rezepte ansehen</a></td></tr>`, items.map((r) => r.title).join(' · '));
    const subject = items.length === 1 ? `Neues Rezept: ${items[0].title}` : `${items.length} neue Rezepte: ${items[0].title} & mehr`;
    const campaign = await brevo('POST', '/emailCampaigns', {
      name: `Neue Rezepte ${new Date().toISOString().slice(0, 10)}`,
      subject: subject.slice(0, 150), sender, replyTo, htmlContent: html,
      recipients: { listIds: [state.listId] },
    });
    await brevo('POST', `/emailCampaigns/${campaign.id}/sendNow`);
    console.log(`Newsletter verschickt an ${abonnenten} Abonnenten: ${subject}`);
    state.versand.push({ am: new Date().toISOString(), kampagne: campaign.id, abonnenten, rezepte: items.map((r) => r.slug) });
  } else {
    console.log(`Noch keine Abonnenten – ${items.length} neue Rezepte werden als bekannt markiert.`);
  }
  state.gesendet = [...new Set([...state.gesendet, ...neu.map((r) => r.slug)])].sort();
  state.letzterVersand = new Date().toISOString();
  await save();
}

async function stand() {
  const list = await brevo('GET', `/contacts/lists/${state.listId}`);
  console.log(`Abonnenten: ${list.uniqueSubscribers ?? list.totalSubscribers ?? 0}`);
}

const command = process.argv[2];
if (command === 'einrichten') await einrichten();
else if (command === 'senden') await senden();
else if (command === 'stand') await stand();
else { console.error('Befehl: einrichten | senden | stand'); process.exit(1); }
