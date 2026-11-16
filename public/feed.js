const tabs = [...document.querySelectorAll('[role="tab"]')];
const instagramPost = /^https:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/([\w-]+)\/?(?:[?#].*)?$/;
const tiktokPost = /^https:\/\/www\.tiktok\.com\/@juka\.cooking\/video\/(\d+)\/?$/i;
const instagramImage = /^feed\/[a-f0-9]{24}\.webp$/;
const tiktokImage = /^tiktok\/\d+\.webp$/;

function selectTab(selected) {
  for (const tab of tabs) {
    const active = tab === selected;
    tab.tabIndex = active ? 0 : -1;
    tab.setAttribute('aria-selected', active);
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
  }
}

for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (event) => {
    const next = {
      ArrowLeft: (index + tabs.length - 1) % tabs.length,
      ArrowRight: (index + 1) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    }[event.key];
    if (!Number.isInteger(next)) return;
    event.preventDefault();
    selectTab(tabs[next]);
    tabs[next].focus();
  });
}
document.querySelector('.feed-tabs').hidden = false;

async function loadPosts(file) {
  try {
    const response = await fetch(file, { mode: 'same-origin', redirect: 'error', cache: 'no-cache' });
    if (!response.ok) return [];
    const { posts } = await response.json();
    return Array.isArray(posts) ? posts : [];
  } catch {
    return [];
  }
}

function renderPosts(panelId, posts, label) {
  const panel = document.getElementById(panelId);
  const grid = panel.querySelector('.feed-grid');
  const empty = panel.querySelector('.feed-empty');

  function updateVisibility() {
    grid.hidden = grid.childElementCount === 0;
    empty.hidden = !grid.hidden;
  }

  for (const [index, post] of posts.entries()) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    const image = document.createElement('img');
    link.href = post.permalink;
    image.src = post.image;
    image.alt = typeof post.alt === 'string' && post.alt.trim() ? post.alt : `${label} ${index + 1}`;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => {
      item.remove();
      updateVisibility();
    }, { once: true });
    link.append(image);
    item.append(link);
    grid.append(item);
  }

  updateVisibility();
}

function mixedTikTokPosts(posts) {
  const seen = new Set();
  const candidates = [];

  for (const post of posts) {
    const video = tiktokPost.exec(post?.permalink);
    if (!video || seen.has(video[1]) || !tiktokImage.test(post.image)) continue;

    seen.add(video[1]);
    candidates.push(post);
  }

  // Draw up to six videos from the pool without replacement.
  const selection = [];
  while (candidates.length && selection.length < 6) {
    const index = Math.floor(Math.random() * candidates.length);
    selection.push(candidates.splice(index, 1)[0]);
  }
  return selection;
}

loadPosts('./feed.json').then((posts) => {
  const visible = posts.filter((post) => instagramPost.test(post?.permalink) && instagramImage.test(post.image)).slice(0, 6);
  renderPosts('instagram-panel', visible, 'Instagram-Beitrag');
});

loadPosts('./tiktok.json').then((posts) => {
  renderPosts('tiktok-panel', mixedTikTokPosts(posts), 'TikTok-Video');
});
