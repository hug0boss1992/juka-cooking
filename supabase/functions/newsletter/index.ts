// Newsletter-Anmeldung von juka-cooking.de: startet bei Brevo den Double-Opt-in
// (Bestätigungsmail). Gespeichert wird hier nichts außer einem Tageszähler gegen Missbrauch;
// die Adresse liegt nur bei Brevo. Secret BREVO_API_KEY wird im Supabase-Dashboard gesetzt.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const ORIGINS = new Set(['https://juka-cooking.de', 'https://www.juka-cooking.de']);
const headers = { 'Access-Control-Allow-Origin': 'https://juka-cooking.de', 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };
const LIST_ID = Number(Deno.env.get('BREVO_LIST_ID') || 0);
const TEMPLATE_ID = Number(Deno.env.get('BREVO_DOI_TEMPLATE_ID') || 0);
const TAGESLIMIT = 300;
const answer = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return answer(405, { ok: false });
  if (!ORIGINS.has(req.headers.get('origin') ?? '')) return answer(403, { ok: false });
  let body: { email?: unknown; website?: unknown };
  try { body = JSON.parse((await req.text()).slice(0, 1000)); } catch { return answer(400, { ok: false, fehler: 'ungueltig' }); }
  // Verstecktes Feld: Bots füllen es aus, Menschen sehen es nicht.
  if (String(body.website ?? '') !== '') return answer(200, { ok: true });
  const email = String(body.email ?? '').trim().toLowerCase();
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return answer(400, { ok: false, fehler: 'adresse' });
  const key = Deno.env.get('BREVO_API_KEY');
  if (!key || !LIST_ID || !TEMPLATE_ID) return answer(503, { ok: false, fehler: 'einrichtung' });
  const { data: anzahl, error } = await db.rpc('newsletter_anfrage_zaehlen');
  if (error) return answer(500, { ok: false });
  if (anzahl > TAGESLIMIT) return answer(429, { ok: false, fehler: 'limit' });
  const res = await fetch('https://api.brevo.com/v3/contacts/doubleOptinConfirmation', {
    method: 'POST',
    headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ email, includeListIds: [LIST_ID], templateId: TEMPLATE_ID, redirectionUrl: 'https://juka-cooking.de/newsletter-danke.html' }),
  });
  if (res.ok) return answer(200, { ok: true });
  const text = await res.text();
  // Schon eingetragen: gleiche Antwort wie bei Erfolg (verrät nicht, wer angemeldet ist).
  if (res.status === 400 && /duplicate|already/i.test(text)) return answer(200, { ok: true });
  console.error('Brevo', res.status, text.slice(0, 200));
  return answer(502, { ok: false });
});
