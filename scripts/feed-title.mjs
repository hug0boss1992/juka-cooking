const adPrefix = /^\s*(?:(?:unbezahlte\s+)?werbung|anzeige|affiliate[- ]link)\b/iu;

export function isAdvertised(caption) {
  return typeof caption === 'string' && adPrefix.test(caption.replace(/^[^\p{L}\p{N}]+/u, ''));
}

export function feedTitle(value) {
  if (typeof value !== 'string') return '';

  for (const line of value.split(/\r?\n/)) {
    const text = line.replace(/(^|\s)[@#]\S+/gu, '')
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .replace(/^\s*(?:(?:unbezahlte\s+)?werbung|anzeige)\b\s*(?:[|:/–-]\s*)?(?:affiliate[- ]link\b\s*)?/iu, '')
      .replace(/^affiliate[- ]link\b\s*/iu, '')
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
