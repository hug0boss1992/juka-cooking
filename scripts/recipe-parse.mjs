// Liest ein Rezept aus einer Instagram- oder TikTok-Beschreibung.
// Erkennt „Zutaten“ und „Zubereitung“ mit Spiegelstrichen, Aufzählungspunkten,
// Nummern-Emojis (1️⃣), „1.“ oder einfachen Zeilen.
import { feedTitle } from './feed-title.mjs';

// Only a real heading counts: „Zutaten:“, „Zutaten (2 Portionen)“ or „Zutaten“ at line end,
// not „nur 4 Zutaten für …“ in the introduction.
const ingredientsHeading = /(?:^|\n|[^\p{L}\s]\s*)zutaten\b\s*(?:\([^)\n]*\)|für[^:\n]{0,30})?\s*(?::|\n|$)/iu;
const stepsHeading = /(?:^|\n|[^\p{L}])(?:zubereitung|so geht['’]?s|anleitung|so wird['’]?s gemacht)\b[^:\n]*:?/iu;
const keycap = /\s*(?:\d{1,2}️?⃣|🔟)\s*/u;
const numbered = /^\s*\d{1,2}[.)]\s+/u;
const bullet = /^\s*(?:[-–•*·▪︎▫️◦●]|✔️|✅)\s*/u;
const outro = /^[^\p{L}\p{N}]*(?:das ergebnis|ergebnis|tipp|fazit|guten appetit|speicher|like|markiere|folge|würdest du|schreib|probier|teile|wer probiert|perfekt (?:als|für)|einfach,|schnell gemacht|mega|so lecker)/iu;

const trimDecoration = (text) => text.replace(/^[^\p{L}\p{N}(]+/u, '').replace(/[\s\p{Extended_Pictographic}️‍]+$/u, '').trim();

function splitItems(block) {
  let items = block
    .split(/\n|•|\s+[-–]\s+(?=\p{Lu}|\d)|\s*\p{Extended_Pictographic}[️‍\p{Extended_Pictographic}]*\s*/u)
    .map((part) => trimDecoration(part.replace(bullet, '')))
    .filter((part) => part && !/^zutaten\b/i.test(part));
  // „1,5 kg Kartoffeln, 1 EL Butter, Salz und Pfeffer.“ in a single line
  if (items.length === 1 && items[0].includes(', ')) {
    items = items[0].replace(/\.$/, '').split(/,\s+|\s+(?:und|znd)\s+(?=[^,]*$)/u).map((part) => part.trim()).filter(Boolean);
  }
  return items;
}

function splitSteps(block) {
  let parts;
  if (keycap.test(block)) parts = block.split(keycap);
  else if (block.split('\n').some((line) => numbered.test(line))) parts = block.split(/\n(?=\s*\d{1,2}[.)]\s)/u).map((p) => p.replace(numbered, ''));
  else parts = block.split('\n');
  const steps = [];
  let tip = '';
  for (const raw of parts) {
    const [first, ...rest] = raw.split('\n');
    const text = trimDecoration(first.replace(bullet, ''));
    if (!text) continue;
    const tipMatch = /^(?:mein\s+|kleiner\s+)?tipp:?\s*/iu.exec(text);
    if (tipMatch && steps.length) { tip = text.slice(tipMatch[0].length); break; }
    if ((outro.test(text) || /\?$/.test(text)) && steps.length) break;
    steps.push(text);
    // Text after the last numbered step (outro, call to action) ends the steps.
    if (rest.some((line) => line.trim())) break;
  }
  // A single paragraph becomes one step per sentence.
  if (steps.length === 1 && steps[0].length > 160) {
    steps.splice(0, 1, ...steps[0].split(/(?<=[.!])\s+(?=\p{Lu})/u));
  }
  return { steps, tip };
}

export function parseRecipe(caption) {
  if (typeof caption !== 'string') return null;
  const text = caption.replace(/\r/g, '');
  const body = text.replace(/(?:\s#[\p{L}\p{N}_]+)+\s*$/u, '');
  const tags = [...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((match) => match[1].toLowerCase());

  const ing = ingredientsHeading.exec(body);
  if (!ing) return null;
  const afterIngredients = body.slice(ing.index + ing[0].length);
  const step = stepsHeading.exec(afterIngredients);
  if (!step) return null;

  const servings = /\(([^)]*(?:portion|person|stück|stk)[^)]*)\)/iu.exec(ing[0])?.[1]
    ?? /\b(?:für\s+)?(\d+(?:\s*[–-]\s*\d+)?\s+(?:portionen|personen|stück))\b/iu.exec(ing[0])?.[1];
  const ingredients = splitItems(afterIngredients.slice(0, step.index));
  const { steps, tip } = splitSteps(afterIngredients.slice(step.index + step[0].length).trim());
  if (ingredients.length < 2 || steps.length < 1) return null;

  const intro = body.slice(0, ing.index).split('\n').slice(1)
    .map((line) => line.trim()).filter((line) => line && !outro.test(line)).join(' ')
    .replace(/[\p{Extended_Pictographic}️‍]+/gu, '').replace(/\s+/g, ' ').trim();
  const minutes = /(\d+)\s*(?:min\b|minuten)/iu.exec(body.slice(0, ing.index))?.[1];

  return {
    title: feedTitle(text),
    intro: intro.slice(0, 400),
    servings: servings ? trimDecoration(servings.replace(/^für\s+/i, '')) : '',
    minutes: minutes ? Number(minutes) : null,
    ingredients,
    steps,
    tip,
    tags,
  };
}

const umlauts = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };
export function slugify(title) {
  return title.toLowerCase().replace(/[äöüß]/g, (c) => umlauts[c])
    .normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 60).replace(/-+$/, '');
}
