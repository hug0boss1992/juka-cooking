// Datensparsame Reichweitenmessung, siehe datenschutz.html, Abschnitt „Reichweitenmessung“.
// 1. Seitenaufruf: übertragen werden nur die Unterseite und die Website, von der man kam
//    (nur der Domainname). Gespeichert wird nur eine Tagessumme pro Seite und Herkunft.
// 2. Klicks auf externe Links (Instagram, TikTok, Partner): übertragen werden Link-Ziel und Seite.
// Keine Cookies, keine Besucher-ID, keine IP-Speicherung.
// Eigene Besuche nicht mitzählen: einmal juka-cooking.de/?nicht-zaehlen aufrufen
// (?zaehlen schaltet es wieder ein). Das merkt sich nur der eigene Browser.
(() => {
  const base = 'https://qwfbzcbcfznctzyoqbky.supabase.co/functions/v1/';
  if (!navigator.sendBeacon) return;
  const send = (fn, data) => {
    try { navigator.sendBeacon(base + fn, new Blob([JSON.stringify(data)], { type: 'text/plain' })); } catch { /* Zählung ist optional */ }
  };

  let skip = false;
  try {
    const params = new URLSearchParams(location.search);
    if (params.has('nicht-zaehlen')) localStorage.setItem('juka-nicht-zaehlen', '1');
    if (params.has('zaehlen')) localStorage.removeItem('juka-nicht-zaehlen');
    skip = localStorage.getItem('juka-nicht-zaehlen') === '1';
  } catch { /* ohne Speicher wird normal gezählt */ }
  if (navigator.webdriver || !/(^|\.)juka-cooking\.de$/.test(location.hostname)) skip = true;

  if (!skip) {
    let von = '';
    try { von = document.referrer ? new URL(document.referrer).hostname : ''; } catch { /* leer = direkt */ }
    send('aufruf', { seite: location.pathname, von });
  }

  const report = (event) => {
    if (skip) return;
    if (event.type === 'auxclick' && event.button !== 1) return;
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link) return;
    let target;
    try { target = new URL(link.href, location.href); } catch { return; }
    if (!/^https?:$/.test(target.protocol) || target.hostname === location.hostname) return;
    send('klick', { ziel: target.href, seite: location.pathname });
  };

  document.addEventListener('click', report, true);
  document.addEventListener('auxclick', report, true);
})();
