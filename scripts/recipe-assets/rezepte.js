// Filter, Suche und Sortierung der Rezeptübersicht. Ohne JavaScript bleiben alle Rezepte sichtbar.
const grid = document.querySelector('.rz-grid');
const cards = [...grid.children];
const chips = [...document.querySelectorAll('.chip')];
const search = document.querySelector('.rz-search input');
const sort = document.querySelector('.rz-sort select');
const count = document.querySelector('.rz-count');
const empty = document.querySelector('.rz-empty');
let filter = 'alle';

function update() {
  const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
  const order = sort.value === 'date'
    ? (a, b) => b.dataset.date.localeCompare(a.dataset.date)
    : (a, b) => Number(a.dataset.rank) - Number(b.dataset.rank);
  let shown = 0;
  for (const card of [...cards].sort(order)) {
    const visible = (filter === 'alle' || card.dataset.tags.split(' ').includes(filter))
      && words.every((word) => card.dataset.search.includes(word));
    card.hidden = !visible;
    if (visible) shown++;
    grid.append(card);
  }
  count.textContent = `${shown} ${shown === 1 ? 'Rezept' : 'Rezepte'}`;
  empty.hidden = shown > 0;
}

for (const chip of chips) {
  chip.addEventListener('click', () => {
    filter = chip.dataset.filter;
    for (const other of chips) other.setAttribute('aria-pressed', String(other === chip));
    update();
  });
}
search.addEventListener('input', update);
sort.addEventListener('change', update);
update();
