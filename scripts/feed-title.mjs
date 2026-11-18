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

const cleanLine = (line) => stripLabels(line.replace(/(^|\s)[@#]\S+/gu, ''))
  .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N})!?]+$/gu, '')
  .replace(/\s+/g, ' ');

// Ein Titel, der in der Beschreibung über einen Zeilenumbruch läuft
// („Cremige⏎Hähnchen-Pfanne“, „Cheesecake (NO⏎BAKE!)“), wird wieder zusammengesetzt.
const unfinished = (text) => Array.from(text).length < 12
  || (text.match(/\(/g) || []).length > (text.match(/\)/g) || []).length;

export function feedTitle(value) {
  if (typeof value !== 'string') return '';

  const lines = value.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let text = cleanLine(lines[i]);
    if (!text) continue;
    for (let j = i + 1, joined = 0; joined < 2 && unfinished(text) && j < lines.length; j++) {
      const next = cleanLine(lines[j]);
      if (!next) break;
      text = `${text} ${next}`;
      joined++;
    }
    const characters = Array.from(text);
    if (characters.length <= 88) return text;

    const prefix = characters.slice(0, 87).join('');
    return (prefix.replace(/\s+\S*$/u, '') || prefix) + '…';
  }
  return '';
}
