// Zählt Klicks auf externe Links (Instagram, TikTok, Partner).
// Übertragen werden nur Link-Ziel und Seite – keine Cookies, keine Besucher-ID.
// Siehe datenschutz.html, Abschnitt „Klickzählung“.
(() => {
  const endpoint = 'https://qwfbzcbcfznctzyoqbky.supabase.co/functions/v1/klick';
  if (!navigator.sendBeacon) return;

  const report = (event) => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link) return;
    let target;
    try { target = new URL(link.href, location.href); } catch { return; }
    if (!/^https?:$/.test(target.protocol) || target.hostname === location.hostname) return;
    const data = JSON.stringify({ ziel: target.href, seite: location.pathname });
    try { navigator.sendBeacon(endpoint, new Blob([data], { type: 'text/plain' })); } catch { /* Zählung ist optional */ }
  };

  document.addEventListener('click', report, true);
  document.addEventListener('auxclick', report, true);
})();
