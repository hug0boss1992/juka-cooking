const storageKey = 'juka-rezepte-pruefen';
const rows = [...document.querySelectorAll('.review-row')];
const summary = document.querySelector('.review-summary');
let saved = {};
try { saved = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch { saved = {}; }

function store() {
  try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch { /* nur Sitzung */ }
  const counts = { ok: 0, change: 0, no: 0 };
  for (const entry of Object.values(saved)) if (entry.state) counts[entry.state]++;
  summary.textContent = `${counts.ok} gefallen · ${counts.change} ändern · ${counts.no} nicht zeigen · ${rows.length - counts.ok - counts.change - counts.no} offen`;
}

for (const row of rows) {
  const slug = row.dataset.slug;
  const note = row.querySelector('textarea');
  const entry = saved[slug] ||= {};
  if (entry.state) row.dataset.state = entry.state;
  note.value = entry.note || '';
  row.querySelectorAll('[data-vote]').forEach((button) => button.addEventListener('click', () => {
    entry.state = entry.state === button.dataset.vote ? '' : button.dataset.vote;
    row.dataset.state = entry.state;
    store();
  }));
  note.addEventListener('input', () => { entry.note = note.value; store(); });
  // Auswahl Original oder Vorschlag (Bild, Zubereitung, Einleitung, Tipp)
  entry.wahl ||= {};
  for (const input of row.querySelectorAll('[data-choice]')) {
    if (entry.wahl[input.dataset.choice] === input.value) input.checked = true;
    input.addEventListener('change', () => { entry.wahl[input.dataset.choice] = input.value; store(); });
  }
}

document.querySelector('.review-copy').addEventListener('click', async (event) => {
  const labels = { ok: 'GEFÄLLT', change: 'ÄNDERN', no: 'NICHT ZEIGEN' };
  const text = rows.map((row) => {
    const entry = saved[row.dataset.slug] || {};
    const names = { bild: 'Bild', schritte: 'Zubereitung', einleitung: 'Einleitung', tipp: 'Tipp' };
    const wahl = Object.entries(entry.wahl || {}).map(([key, value]) => `${names[key] || key}: ${value === 'vorschlag' ? 'Vorschlag' : 'Original'}`).join(', ');
    if (!entry.state && !entry.note && !wahl) return '';
    return `${labels[entry.state] || 'OFFEN'} – ${row.querySelector('a').textContent} [${row.dataset.slug}]${wahl ? ` (${wahl})` : ''}${entry.note ? `: ${entry.note}` : ''}`;
  }).filter(Boolean).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    event.target.textContent = 'Kopiert';
  } catch {
    window.prompt('Bitte kopieren:', text);
  }
});

store();
