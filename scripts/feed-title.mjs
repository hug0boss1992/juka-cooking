// Kennzeichnungen wie „Werbung | Kooperation mit @marke“, „Anzeige/Werbung“ oder
// „Gewinnspiel | Werbung“ am Anfang einer Beschreibung.
const label = String.raw`(?:(?:unbezahlte\s+)?werbung|anzeige|affiliate[- ]link|gewinnspiel|kooperation(?:\s+mit)?)`;
const labelPrefix = new RegExp(String.raw`^\s*${label}\b\s*(?:[|:/–-]\s*)?`, 'iu');
const adWord = /\b(?:werbung|anzeige|affiliate[- ]link|kooperation)\b/iu;
const notAd = /\bkeine\s+(?:werbung|anzeige|kooperation)\b/iu;
const discountCode = /\b(?:rabatt-?code|gutschein-?code|mit meinem code|code:?\s+[a-z0-9]+-[a-z0-9]+)\b/iu;

function firstLine(caption) {
  return caption.split(/\r?\n/).find((line) => line.trim()) ?? '';
}

export function isAdvertised(caption) {
  if (typeof caption !== 'string') return false;
  const opening = firstLine(caption).slice(0, 120);
  return (adWord.test(opening) && !notAd.test(opening)) || discountCode.test(caption);
}

function stripLabels(text) {
  let rest = text;
  for (let previous; previous !== rest;) {
    previous = rest;
    rest = rest.replace(/^[^\p{L}\p{N}]+/u, '').replace(labelPrefix, '');
  }
  return rest;
}

export function feedTitle(value) {
  if (typeof value !== 'string') return '';

  for (const line of value.split(/\r?\n/)) {
    const text = stripLabels(line.replace(/(^|\s)[@#]\S+/gu, ''))
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N})!?]+$/gu, '')
      .replace(/\s+/g, ' ');
    if (!text) continue;
    const characters = Array.from(text);
    if (characters.length <= 88) return text;

    const prefix = characters.slice(0, 87).join('');
    return (prefix.replace(/\s+\S*$/u, '') || prefix) + '…';
  }
  return '';
}
