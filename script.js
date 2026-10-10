const CLOUDINARY_CLOUD_NAME = 'pcjnaclc';
const CLOUDINARY_PRESET = 'v3ppgbw7';

const SUPABASE_URL = 'https://kxwjamrojtgjsctvouul.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_fKj4xun5x0QwiKyfnOq1Yw_47OVArCt';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let localPromptsCache = [];
let searchQuery = '';
let typeFilter = 'all';
let sortBy = 'new';
let catFilter = '';
let modelFilter = '';
const PAGE = 24;
let visible = PAGE, lastKey = '';
let collections = JSON.parse(localStorage.getItem('collections') || '[]');
let openColId = null;
const autoplayOn = () => localStorage.getItem('autoplay') !== '0';
const CATS = { portrait:/portrait|face|woman|girl|\bman\b|boy|character|headshot/, anime:/anime|manga|ghibli|chibi/, cyber:/cyberpunk|neon|futuristic|sci-?fi/, fantasy:/fantasy|dragon|magic|wizard|elf|mythic/, logo:/logo|brand|icon|emblem/, product:/product|packaging|bottle|mockup|advert/, landscape:/landscape|mountain|forest|city|ocean|sunset|nature/, '3d':/3d|octane|render|isometric|blender/, realistic:/realistic|photo|cinematic|8k|dslr|hyper/ };
function modelOf(i){if(i.model)return i.model;const t=((i.title||'')+' '+(i.prompt_text||'')).toLowerCase();
  if(/midjourney|--v\s?\d|--ar\s?\d/.test(t))return 'Midjourney';if(/dall-?e/.test(t))return 'DALL·E';if(/stable diffusion|sdxl/.test(t))return 'Stable Diffusion';if(/\bsora\b/.test(t))return 'Sora';if(/\bveo\b/.test(t))return 'Veo';if(/runway/.test(t))return 'Runway';if(/\bflux\b/.test(t))return 'Flux';return null;}
function badgesHTML(i){const v=checkIsVideo(i.media_url),m=modelOf(i);return `<span class="pill">${v?'Video':'Image'}</span>`+(m?`<span class="pill pill-model">${m}</span>`:'');}
let currentId = null;
let lastListRoute = '#/explore';
let likedPrompts = new Set(JSON.parse(localStorage.getItem('liked_prompts') || '[]'));

// DOM Elements
const $ = (id) => document.getElementById(id);
const feedPage = $('feedPage'), uploadPage = $('uploadPage');
const promptGrid = $('promptGrid'), likedGrid = $('likedGrid');
const searchInput = $('searchInput'), clearSearchBtn = $('clearSearchBtn');
const uploadForm = $('uploadForm'), statusMsg = $('statusMsg'), submitBtn = $('submitBtn');
const mediaFileInput = $('mediaFile'), fileNameDisplay = $('fileNameDisplay'), dropZone = $('dropZone');

// Full Preview Elements
const previewPage = $('previewPage'), closePreviewBtn = $('closePreviewBtn');
const modalMediaContainer = $('modalMediaContainer'), modalTitle = $('modalTitle');
const modalPromptText = $('modalPromptText'), modalCopyBtn = $('modalCopyBtn'), modalLikeBtn = $('modalLikeBtn');

/* Toast */
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* Page Switcher */
function switchPage(pageId) {
  const same = document.querySelector('.page-view.active')?.id === pageId;
  if (!same && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(() => applyPage(pageId));
  else applyPage(pageId);
}
function applyPage(pageId) {
  document.querySelectorAll('.page-view').forEach(p => p.classList.remove('active'));
  $(pageId).classList.add('active');
  document.body.style.overflow = pageId === 'previewPage' ? 'hidden' : '';
  const map = { feedPage: 'explore', uploadPage: 'create', profilePage: 'profile' };
  const key = map[pageId];
  if (key) document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.route === key));
  if (pageId !== 'previewPage') window.scrollTo({ top: 0 });
}

/* Hash Router: #/explore  #/liked  #/create  #/prompt/<id> */
function route() {
  const hash = location.hash || '#/explore';
  const m = hash.match(/^#\/prompt\/(.+)$/);
  if (m) {
    if (localPromptsCache.length) openFullPreviewPage(decodeURIComponent(m[1]), true);
    return;
  }
  if (hash === '#/liked' || hash === '#/profile') { lastListRoute = '#/profile'; renderLiked(); switchPage('profilePage'); }
  else if (hash === '#/about') { switchPage('aboutPage'); document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active')); }
  else if (hash === '#/create') { switchPage('uploadPage'); }
  else if (hash === '#/studio') { switchPage('studioPage'); }
  else if (hash === '#/help') { switchPage('helpPage'); }
  else { lastListRoute = '#/explore'; switchPage('feedPage'); }
}
window.addEventListener('hashchange', route);

$('logoBtn')?.addEventListener('click', () => (location.hash = '#/explore'));
$('topCreateBtn')?.addEventListener('click', () => (location.hash = '#/create'));

/* Media File Helper + live preview */
function setFile(file) {
  if (file && file.size > (file.type.startsWith('video/') ? 100 : 10) * 1048576) {
    toast('Large file: upload may take longer or fail (usual limit 10 MB image, 100 MB video)');
  }
  if (file) {
    fileNameDisplay.innerHTML = `Selected: <strong>${escapeHTML(file.name)}</strong>`;
  } else {
    fileNameDisplay.innerHTML = `<strong>Choose media file</strong> or drag & drop`;
  }
  updateLivePreview();
}
mediaFileInput?.addEventListener('change', (e) => setFile(e.target.files[0]));

['dragenter', 'dragover'].forEach(ev => dropZone?.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => dropZone?.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.remove('drag'); }));
dropZone?.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file && /^(image|video)\//.test(file.type)) {
    mediaFileInput.files = e.dataTransfer.files;
    setFile(file);
  } else {
    toast('Only image or video files are supported.');
  }
});

let previewURL = null;
function updateLivePreview() {
  const file = mediaFileInput.files[0];
  const box = $('lpMedia');
  if (previewURL) URL.revokeObjectURL(previewURL);
  previewURL = null;
  if (file) {
    previewURL = URL.createObjectURL(file);
    box.innerHTML = file.type.startsWith('video/')
      ? `<video src="${previewURL}" autoplay loop muted playsinline></video>`
      : `<img src="${previewURL}" alt="Preview">`;
  } else {
    box.innerHTML = `<div class="lp-empty">Your media appears here</div>`;
  }
  $('lpTitle').textContent = $('promptTitle').value.trim() || 'Untitled prompt';
  $('titleCount').textContent = `${$('promptTitle').value.length} / 80`;
  $('textCount').textContent = `${$('promptText').value.length} characters`;
  localStorage.setItem('upload_draft', JSON.stringify({ t: $('promptTitle').value, p: $('promptText').value }));
}
$('promptTitle')?.addEventListener('input', updateLivePreview);
$('promptText')?.addEventListener('input', updateLivePreview);

/* Search Input Handler */
searchInput?.addEventListener('input', (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  clearSearchBtn.classList.toggle('hidden', searchQuery === '');
  if (!['#/explore', '#/liked', ''].includes(location.hash)) location.hash = '#/explore';
  renderPrompts();
  renderLiked();
});

clearSearchBtn?.addEventListener('click', () => {
  searchInput.value = '';
  searchQuery = '';
  clearSearchBtn.classList.add('hidden');
  renderPrompts();
  renderLiked();
  searchInput.focus();
});

/* Categories + hero tags */
$('catChips')?.addEventListener('click', (e) => {
  const b = e.target.closest('.cat'); if (!b) return;
  catFilter = b.dataset.cat;
  document.querySelectorAll('#catChips .cat').forEach(c => c.classList.toggle('active', c === b));
  renderPrompts(); renderLiked();
});
$('heroTags')?.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || !b.dataset.q) return;
  searchInput.value = b.dataset.q;
  searchInput.dispatchEvent(new Event('input'));
  document.querySelector('.cats')?.scrollIntoView({ behavior: 'smooth' });
});

/* Filters & Sorting */
$('typeChips')?.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  typeFilter = chip.dataset.type;
  document.querySelectorAll('#typeChips .chip').forEach(c => c.classList.toggle('active', c === chip));
  renderPrompts();
});
$('sortSelect')?.addEventListener('change', (e) => { sortBy = e.target.value; renderPrompts(); });

/* Grid density */
function setDensity(d) {
  localStorage.setItem('grid_density', d);
  [promptGrid, likedGrid].forEach(g => (g.dataset.density = d));
  document.querySelectorAll('#densityBtns .chip').forEach(c => c.classList.toggle('active', c.dataset.d === d));
}
$('densityBtns')?.addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (b) setDensity(b.dataset.d);
});
setDensity(localStorage.getItem('grid_density') || 'comfy');

/* Database Fetching */
async function fetchPrompts() {
  try {
    const { data: prompts, error } = await supabaseClient
      .from('prompts')
      .select('*')
      .order('id', { ascending: false });

    if (error) throw error;
    localPromptsCache = prompts || [];
    $('totalCount').textContent = localPromptsCache.length;
    buildModelOptions();
    if ($('heroVideos')) $('heroVideos').textContent = localPromptsCache.filter(p => checkIsVideo(p.media_url)).length;
    renderPrompts();
    renderLiked();
    renderCatCounts();
    applyExt();
    route();
  } catch (err) {
    console.error('Fetch error:', err);
    promptGrid.innerHTML = `<div class="empty-state"><h3>Couldn't load prompts</h3><p style="color:#f0524f;margin-bottom:1rem">${escapeHTML(err.message)}</p><button class="btn-ghost" onclick="fetchPrompts()">Try again</button></div>`;
  }
}

/* Card builder */
const ICON_COPY = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const ICON_HEART = '<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
function buildCard(item) {
  const isVideo = checkIsVideo(item.media_url);
  const card = document.createElement('div');
  card.className = 'glass-card-item';
  card.tabIndex = 0;
  card.onclick = () => openFullPreviewPage(item.id);
  card.onkeydown = (e) => { if (e.key === 'Enter') openFullPreviewPage(item.id); };
  const mediaHTML = isVideo
    ? (autoplayOn() ? `<video src="${item.media_url}" autoplay loop muted playsinline preload="auto"></video>` : `<video src="${item.media_url}#t=0.1" loop muted playsinline preload="metadata" onmouseenter="this.play()" onmouseleave="this.pause()"></video>`)
    : `<img src="${item.media_url}" alt="${escapeHTML(item.title)}" loading="lazy" decoding="async" onload="this.classList.add('loaded')" onerror="this.classList.add('loaded')">`;
  card.innerHTML = `
    <div class="thumbnail-container">${mediaHTML}</div>
    <div class="card-info">
      <div class="card-title">${escapeHTML(item.title)}</div>
      <div class="card-meta">
        <span class="badges">${badgesHTML(item)}</span>
        <span class="card-actions">
          <button class="icon-mini card-copy" aria-label="Copy prompt" title="Copy prompt">${ICON_COPY}</button>
          <button class="icon-mini card-like ${likedPrompts.has(item.id) ? 'on' : ''}" aria-label="Like" title="Like">${ICON_HEART}</button>
        </span>
      </div>
    </div>`;
  card.querySelector('.card-copy').onclick = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(item.prompt_text || '').then(() => { bumpCopies(); toast('Prompt copied'); });
  };
  card.querySelector('.card-like').onclick = (e) => toggleLike(e, item.id);
  return card;
}

function catMatch(item, k) {
  return item.category ? item.category === k : CATS[k].test(((item.title || '') + ' ' + (item.prompt_text || '')).toLowerCase());
}
function matchesSearch(item) {
  if (catFilter && !catMatch(item, catFilter)) return false;
  return [item.title, item.prompt_text, item.tags, item.author].some(v => (v || '').toLowerCase().includes(searchQuery));
}

/* Render Prompt Grid Thumbnails */
function renderFeatured(show) {
  const potd = $('potd'), wrap = $('latestWrap'), n = localPromptsCache.length;
  potd.hidden = !(show && n); wrap.hidden = !(show && n > 4);
  if (!show || !n) return;
  const d = new Date(), p = localPromptsCache[(d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate()) % n];
  const media = checkIsVideo(p.media_url)
    ? `<video src="${p.media_url}" autoplay loop muted playsinline></video>`
    : `<img src="${p.media_url}" alt="${escapeHTML(p.title)}">`;
  const text = (p.prompt_text || '');
  potd.innerHTML = `<div class="potd-media">${media}</div><div class="potd-body"><span class="eyebrow">Prompt of the day</span><h2>${escapeHTML(p.title)}</h2><p>${escapeHTML(text.slice(0, 180))}${text.length > 180 ? '...' : ''}</p><div class="potd-actions"><button class="btn-primary">View prompt</button><button class="btn-ghost" data-copy="1">Copy prompt</button></div></div>`;
  potd.onclick = (e) => {
    if (e.target.closest('[data-copy]')) navigator.clipboard.writeText(text).then(() => { bumpCopies(); toast('Prompt copied'); });
    else openFullPreviewPage(p.id);
  };
  const rail = $('latestRail');
  rail.innerHTML = '';
  [...localPromptsCache].sort((a, b) => b.id - a.id).slice(0, 10).forEach(i => rail.appendChild(buildCard(i)));
}

function renderPrompts() {
  renderFeatured(!searchQuery && !catFilter && typeFilter === 'all' && sortBy === 'new');
  let list = localPromptsCache.filter(item => {
    if (!matchesSearch(item)) return false;
    if (modelFilter && modelOf(item) !== modelFilter) return false;
    if (typeFilter === 'video') return checkIsVideo(item.media_url);
    if (typeFilter === 'image') return !checkIsVideo(item.media_url);
    return true;
  });

  if (sortBy === 'old') list.sort((a, b) => a.id - b.id);
  else if (sortBy === 'az') list.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  else if (sortBy === 'liked') list.sort((a, b) => likedPrompts.has(b.id) - likedPrompts.has(a.id) || b.id - a.id);

  const key = [searchQuery, catFilter, typeFilter, sortBy, modelFilter].join('|');
  if (key !== lastKey) { visible = PAGE; lastKey = key; }
  const feat = !(searchQuery || catFilter || modelFilter || typeFilter !== 'all') && localPromptsCache.length;
  $('featuredSection').hidden = !feat;
  if (feat) renderFeatured();
  $('resultInfo').textContent = searchQuery || catFilter || typeFilter !== 'all'
    ? `${list.length} result${list.length === 1 ? '' : 's'}`
    : 'Browse prompts with their rendered results.';

  if (list.length === 0) {
    $('loadMoreBtn').hidden = true;
    promptGrid.innerHTML = `<div class="empty-state"><h3>No matching prompts</h3><p>Try another search, or <a href="#/create">create one</a>.</p></div>`;
    return;
  }
  promptGrid.innerHTML = '';
  list.slice(0, visible).forEach(item => promptGrid.appendChild(buildCard(item)));
  $('loadMoreBtn').hidden = list.length <= visible;
  $('loadMoreBtn').textContent = `Show more (${list.length - visible} left)`;
}

/* Liked page */
function renderLiked() {
  renderProfile();
  const list = localPromptsCache.filter(i => likedPrompts.has(i.id));
  $('likedBadge').textContent = likedPrompts.size;
  $('likedBadge').dataset.n = likedPrompts.size;
  if ($('heroLiked')) $('heroLiked').textContent = likedPrompts.size;
  $('clearLikedBtn').style.display = likedPrompts.size ? '' : 'none';
  if (list.length === 0) {
    likedGrid.innerHTML = `<div class="empty-state"><h3>${likedPrompts.size ? 'No liked prompts match your search' : 'Nothing liked yet'}</h3><p>${likedPrompts.size ? '' : 'Tap the heart on any prompt to save it here.'}</p></div>`;
    return;
  }
  likedGrid.innerHTML = '';
  list.forEach(item => likedGrid.appendChild(buildCard(item)));
}
$('clearLikedBtn')?.addEventListener('click', () => {
  if (!likedPrompts.size || !confirm('Remove all liked prompts?')) return;
  likedPrompts.clear();
  localStorage.setItem('liked_prompts', '[]');
  renderLiked(); renderPrompts();
  toast('Liked list cleared');
});

/* Toggle Heart/Like */
function toggleLike(e, id) {
  if (e) e.stopPropagation();
  if (likedPrompts.has(id)) {
    likedPrompts.delete(id);
  } else {
    likedPrompts.add(id);
  }
  localStorage.setItem('liked_prompts', JSON.stringify([...likedPrompts]));
  updateModalLikeState(id);
  renderPrompts();
  renderLiked();
}

/* Detail view: card tap opens full page */
function findItem(id) { return localPromptsCache.find(p => String(p.id) === String(id)); }

function openFullPreviewPage(id, fromRoute) {
  const item = findItem(id);
  if (!item) { toast('Prompt not found'); location.hash = lastListRoute; return; }
  id = item.id;
  currentId = id;
  if (!fromRoute) { location.hash = `#/prompt/${encodeURIComponent(id)}`; return; }

  const isVideo = checkIsVideo(item.media_url);
  modalMediaContainer.innerHTML = isVideo
    ? `<video src="${item.media_url}" controls autoplay loop muted playsinline></video>`
    : `<img src="${item.media_url}" alt="${escapeHTML(item.title)}">`;

  modalTitle.innerText = item.title;
  $('modalBadges').innerHTML = badgesHTML(item);
  $('modalChatBtn').href = 'https://chatgpt.com/?q=' + encodeURIComponent(item.prompt_text || '');
  $('modalAuthor').hidden = !item.author;
  $('modalAuthor').textContent = item.author ? 'by ' + item.author : '';
  renderAnatomy(item);
  modalPromptText.innerText = item.prompt_text;
  const pt = item.prompt_text || '';
  $('modalMeta').textContent = '';
  $('modalParams').innerHTML = [...parseParams(pt), `${pt.trim().split(/\s+/).filter(Boolean).length} words`, `~${Math.ceil(pt.length / 4)} tokens`].map(x => `<span class="pill">${escapeHTML(x)}</span>`).join('');
  setupCustomize(item);
  $('modalDownloadBtn').href = item.media_url.replace('/upload/', '/upload/fl_attachment/');

  // Copy Prompt Action
  modalCopyBtn.onclick = () => {
    navigator.clipboard.writeText(item.prompt_text).then(() => {
      bumpCopies();
      const copySpan = modalCopyBtn.querySelector('.btn-text');
      if (copySpan) copySpan.innerText = 'Copied to Clipboard!';
      setTimeout(() => { if (copySpan) copySpan.innerText = 'Copy Prompt'; }, 2000);
    });
  };
  $('modalShareBtn').onclick = () => {
    if (navigator.share) navigator.share({ title: item.title, url: location.href }).catch(() => {});
    else navigator.clipboard.writeText(location.href).then(() => toast('Link copied'));
  };

  // Like Action
  updateModalLikeState(id);
  if (modalLikeBtn) modalLikeBtn.onclick = (e) => toggleLike(e, id);

  trackRecent(id);
  previewPage.scrollTop = 0;
  document.querySelector('.preview-details-sidebar').scrollTop = 0;
  $('modalSaveBtn').onclick = () => openSaveSheet(id);
  renderRelated(item);
  switchPage('previewPage');
}

function renderRelated(item) {
  const words = new Set((item.title || '').toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const score = (p) => (p.title || '').toLowerCase().split(/\W+/).filter(w => words.has(w)).length;
  const others = localPromptsCache.filter(p => p.id !== item.id)
    .sort((a, b) => score(b) - score(a) || b.id - a.id).slice(0, 6);
  $('relatedSection').style.display = others.length ? '' : 'none';
  $('relatedGrid').innerHTML = '';
  others.forEach(p => $('relatedGrid').appendChild(buildCard(p)));
}

function stepPrompt(dir) {
  const list = localPromptsCache;
  const i = list.findIndex(p => p.id === currentId);
  if (i < 0 || !list.length) return;
  const next = list[(i + dir + list.length) % list.length];
  location.replace(`#/prompt/${encodeURIComponent(next.id)}`);
}
$('prevPromptBtn')?.addEventListener('click', () => stepPrompt(-1));
$('nextPromptBtn')?.addEventListener('click', () => stepPrompt(1));

function updateModalLikeState(id) {
  if (!modalLikeBtn) return;
  const isLiked = likedPrompts.has(id);
  const heartIcon = modalLikeBtn.querySelector('svg');
  if (heartIcon) {
    heartIcon.setAttribute('fill', isLiked ? '#ef4444' : 'none');
    heartIcon.setAttribute('stroke', isLiked ? '#ef4444' : 'currentColor');
  }
}

closePreviewBtn?.addEventListener('click', () => (location.hash = lastListRoute));

/* Keyboard shortcuts */
document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (e.key === 'Escape' && !$('lightbox').hidden) $('lightbox').hidden = true;
  else if (e.key === 'Escape' && !$('saveSheet').hidden) closeSheet();
  else if (e.key === 'Escape' && previewPage.classList.contains('active')) location.hash = lastListRoute;
  else if (e.key === '/' && !typing) { e.preventDefault(); if (!previewPage.classList.contains('active')) searchInput.focus(); }
  else if (!typing && previewPage.classList.contains('active')) {
    if (e.key === 'ArrowLeft') stepPrompt(-1);
    if (e.key === 'ArrowRight') stepPrompt(1);
  }
});

/* Achievements + data backup */
const copies = () => +localStorage.getItem('copy_count') || 0;
const ACH = [
  ['First like', 'Like a prompt', () => likedPrompts.size >= 1],
  ['Collector', 'Like 10 prompts', () => likedPrompts.size >= 10],
  ['Copy master', 'Copy 10 prompts', () => copies() >= 10],
  ['Curator', 'Create a collection', () => collections.length >= 1],
  ['Explorer', 'View 5 prompts', () => JSON.parse(localStorage.getItem('recent_prompts') || '[]').length >= 5],
  ['Regular', '3 day streak', () => (+localStorage.getItem('streak') || 1) >= 3]
];
const DATA_KEYS = ['liked_prompts', 'collections', 'recent_prompts', 'copy_count', 'user_name', 'recent_searches', 'grid_density', 'autoplay', 'streak', 'last_visit'];
$('exportBtn')?.addEventListener('click', () => {
  const o = {};
  DATA_KEYS.forEach(k => { const v = localStorage.getItem(k); if (v !== null) o[k] = v; });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(o, null, 2)], { type: 'application/json' }));
  a.download = 'prompt-arena-backup.json';
  a.click();
  toast('Backup downloaded');
});
$('importFile')?.addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const o = JSON.parse(await f.text());
    Object.keys(o).filter(k => DATA_KEYS.includes(k)).forEach(k => localStorage.setItem(k, String(o[k])));
    location.reload();
  } catch (err) { toast('Invalid backup file'); }
});

/* Profile: name, stats, recently viewed */
function bumpCopies() { localStorage.setItem('copy_count', (+localStorage.getItem('copy_count') || 0) + 1); renderProfile(); }
function trackRecent(id) {
  const r = JSON.parse(localStorage.getItem('recent_prompts') || '[]').filter(x => x !== id);
  r.unshift(id);
  localStorage.setItem('recent_prompts', JSON.stringify(r.slice(0, 12)));
  localStorage.setItem('view_count', (+localStorage.getItem('view_count') || 0) + 1);
}
function renderProfile() {
  const name = localStorage.getItem('user_name') || 'Guest';
  if (document.activeElement !== $('profileName')) $('profileName').value = name;
  $('profileAvatar').textContent = (name.trim()[0] || 'G').toUpperCase();
  const recent = JSON.parse(localStorage.getItem('recent_prompts') || '[]');
  $('statLiked').textContent = likedPrompts.size;
  $('statCopied').textContent = localStorage.getItem('copy_count') || 0;
  $('statViewed').textContent = recent.length;
  $('statStreak').textContent = localStorage.getItem('streak') || 1;
  $('achievements').innerHTML = ACH.map(([n, d, f]) => `<span class="ach ${f() ? 'on' : ''}" title="${d}">${n}</span>`).join('');
  const items = recent.map(findItem).filter(Boolean);
  $('recentGrid').innerHTML = items.length ? '' : '<div class="empty-state"><h3>Nothing viewed yet</h3><p>Prompts you open will show up here.</p></div>';
  items.forEach(i => $('recentGrid').appendChild(buildCard(i)));
  renderAchievements();
}
$('profileName')?.addEventListener('change', (e) => {
  localStorage.setItem('user_name', e.target.value.trim() || 'Guest');
  renderProfile(); toast('Name saved');
});
$('profileName')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('profileTabs')?.addEventListener('click', (e) => {
  const b = e.target.closest('.cat'); if (!b) return;
  document.querySelectorAll('#profileTabs .cat').forEach(c => c.classList.toggle('active', c === b));
  const panes = { liked: likedGrid, recent: $('recentGrid'), collections: $('collectionsPane'), settings: $('settingsPane') };
  Object.entries(panes).forEach(([k, el]) => (el.hidden = k !== b.dataset.tab));
  $('clearLikedBtn').style.visibility = b.dataset.tab === 'liked' ? '' : 'hidden';
  if (b.dataset.tab === 'collections') { openColId = null; renderCollections(); }
});
$('surpriseBtn')?.addEventListener('click', () => {
  if (!localPromptsCache.length) return toast('Prompts are still loading');
  const p = localPromptsCache[Math.floor(Math.random() * localPromptsCache.length)];
  location.hash = `#/prompt/${encodeURIComponent(p.id)}`;
});

/* Form Upload Handler */
uploadForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  statusMsg.style.color = 'var(--accent-cyan)';
  statusMsg.innerText = 'Uploading media...';

  const file = mediaFileInput.files[0];
  const title = $('promptTitle').value.trim();
  const promptText = $('promptText').value;

  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_PRESET);

    const isVideoFile = file.type.startsWith('video/');
    const uploadType = isVideoFile ? 'video' : 'image';

    const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${uploadType}/upload`, {
      method: 'POST',
      body: formData
    });

    const uploadData = await uploadRes.json();
    if (!uploadData.secure_url) throw new Error(uploadData.error?.message || 'Media upload failed.');

    const mediaUrl = uploadData.secure_url;
    statusMsg.innerText = 'Saving prompt...';

    const row = { title, prompt_text: promptText, media_url: mediaUrl };
    if (extOn()) Object.assign(row, { category: $('promptCategory').value || null, model: $('promptModel').value || null, tags: $('promptTags').value.trim() || null, author: localStorage.getItem('user_name') || 'Guest' });
    let { error } = await supabaseClient
      .from('prompts')
      .insert([row]);

    // If the extra columns (category, model, tags, author) are missing in Supabase, retry with the 3 basic fields
    if (error && Object.keys(row).length > 3) {
      console.warn('Extended insert failed, retrying with basic fields:', error.message);
      ({ error } = await supabaseClient
        .from('prompts')
        .insert([{ title, prompt_text: promptText, media_url: mediaUrl }]));
      if (!error) { localStorage.setItem('ext', '0'); applyExt(); }
    }

    if (error) throw error;

    statusMsg.style.color = '#34d399';
    statusMsg.innerText = 'Published';
    toast('Published');

    uploadForm.reset();
    setFile(null);

    setTimeout(() => {
      statusMsg.innerText = '';
      location.hash = '#/explore';
      fetchPrompts();
    }, 900);

  } catch (err) {
    console.error('Upload Error:', err);
    statusMsg.style.color = '#f0524f';
    statusMsg.innerText = 'Upload failed: ' + err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

function checkIsVideo(url) {
  if (!url) return false;
  return url.includes('/video/') || /\.(mp4|webm|ogg|mov|m4v)$/i.test(url);
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&#34;'
  }[tag] || tag));
}

/* Featured, models, params, customize, suggestions, lightbox */
function renderFeatured() {
  const n = localPromptsCache.length, day = localPromptsCache[Math.floor(Date.now() / 864e5) % n];
  const pt = day.prompt_text || '';
  $('featMain').innerHTML = `<div class="feat-media">${checkIsVideo(day.media_url) ? `<video src="${day.media_url}" autoplay loop muted playsinline></video>` : `<img src="${day.media_url}" alt="${escapeHTML(day.title)}">`}</div>
    <div class="feat-body"><span class="eyebrow">Prompt of the day</span><h2>${escapeHTML(day.title)}</h2>
    <p>${escapeHTML(pt.slice(0, 150))}${pt.length > 150 ? '…' : ''}</p><div class="badges">${badgesHTML(day)}</div>
    <div class="feat-actions"><button class="btn-primary" data-a="open">View prompt</button><button class="btn-ghost" data-a="copy">Copy</button></div></div>`;
  $('featMain').onclick = (e) => {
    if (e.target.closest('[data-a="copy"]')) navigator.clipboard.writeText(pt).then(() => { bumpCopies(); toast('Prompt copied'); });
    else openFullPreviewPage(day.id);
  };
  $('newRail').innerHTML = '';
  localPromptsCache.slice(0, 10).forEach(i => $('newRail').appendChild(buildCard(i)));
}
function buildModelOptions() {
  const ms = [...new Set(localPromptsCache.map(modelOf).filter(Boolean))].sort();
  $('modelSelect').innerHTML = '<option value="">All models</option>' + ms.map(m => `<option>${m}</option>`).join('');
  $('modelSelect').hidden = !ms.length;
  $('modelSelect').value = modelFilter;
}
$('modelSelect')?.addEventListener('change', (e) => { modelFilter = e.target.value; renderPrompts(); });

function parseParams(t) {
  const names = { ar: 'Aspect ratio', v: 'Version', s: 'Stylize', q: 'Quality', c: 'Chaos' }, out = [];
  (t || '').replace(/--([a-z]+)\s+([^\s-][^\s]*)/gi, (m, k, v) => out.push(`${names[k.toLowerCase()] || k[0].toUpperCase() + k.slice(1)} ${v}`));
  return out.slice(0, 5);
}
function setupCustomize(item) {
  const text = item.prompt_text || '', re = /\[([^\[\]\n]{2,40})\]|\{([^{}\n]{2,40})\}/g;
  const names = [...new Set([...text.matchAll(re)].map(m => m[1] || m[2]))].slice(0, 8);
  $('customSection').hidden = !names.length;
  if (!names.length) return;
  $('customFields').innerHTML = names.map(n => `<label class="var-field"><span>${escapeHTML(n)}</span><input class="form-control" placeholder="${escapeHTML(n)}"></label>`).join('');
  const build = () => {
    const vals = [...$('customFields').querySelectorAll('input')].map(i => i.value.trim());
    return text.replace(re, (m, a, b) => vals[names.indexOf(a || b)] || m);
  };
  $('customFields').oninput = () => { modalPromptText.innerText = build(); };
  $('customCopyBtn').onclick = () => navigator.clipboard.writeText(build()).then(() => { bumpCopies(); toast('Customized prompt copied'); });
}

const suggestBox = $('suggestBox');
function renderSuggest() {
  if (searchQuery.length < 2) { suggestBox.hidden = true; return; }
  const m = localPromptsCache.filter(i => (i.title || '').toLowerCase().includes(searchQuery)).slice(0, 5);
  suggestBox.hidden = !m.length;
  suggestBox.innerHTML = m.map(i => `<button data-id="${i.id}"><span class="sg-thumb">${checkIsVideo(i.media_url) ? '' : `<img src="${i.media_url}" alt="">`}</span><span>${escapeHTML(i.title)}</span></button>`).join('');
}
searchInput?.addEventListener('input', renderSuggest);
searchInput?.addEventListener('focus', renderSuggest);
searchInput?.addEventListener('blur', () => setTimeout(() => (suggestBox.hidden = true), 220));
suggestBox?.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  suggestBox.hidden = true; location.hash = `#/prompt/${encodeURIComponent(b.dataset.id)}`;
});

modalMediaContainer.addEventListener('click', (e) => {
  if (e.target.tagName !== 'IMG') return;
  $('lightbox').innerHTML = `<img src="${e.target.src}" alt="">`;
  $('lightbox').hidden = false;
});
$('lightbox')?.addEventListener('click', () => ($('lightbox').hidden = true));
if ('IntersectionObserver' in window) {
  new IntersectionObserver((es) => { if (es[0].isIntersecting && !$('loadMoreBtn').hidden) $('loadMoreBtn').click(); }, { rootMargin: '500px' }).observe($('loadMoreBtn'));
}

/* Marketplace extras */
const extOn = () => {
  const f = localStorage.getItem('ext');
  if (f === '0') return false;
  return f === '1' || !!(localPromptsCache[0] && 'category' in localPromptsCache[0]);
};
function applyExt() { $('extFields').hidden = !extOn(); $('setExt').checked = extOn(); }
$('setExt')?.addEventListener('change', (e) => { localStorage.setItem('ext', e.target.checked ? '1' : '0'); applyExt(); });

function renderCatCounts() {
  document.querySelectorAll('#catChips .cat').forEach(c => {
    const k = c.dataset.cat; if (!k) return;
    c.dataset.label = c.dataset.label || c.textContent;
    c.innerHTML = `${c.dataset.label} <i>${localPromptsCache.filter(i => catMatch(i, k)).length}</i>`;
  });
}

function renderAnatomy(item) {
  const t = item.prompt_text || '';
  const kws = [...new Set(t.split(/[,.;\n]/).map(s => s.trim()).filter(s => s.length > 2 && s.length < 36))].slice(0, 10);
  const tags = (item.tags || '').split(',').map(s => s.trim()).filter(Boolean);
  const chips = (arr, cls = '') => arr.map(x => `<button class="kw ${cls}" data-q="${escapeHTML(x)}">${escapeHTML(x)}</button>`).join('');
  $('anatomy').innerHTML = (tags.length ? `<p class="anat-label">Tags</p><div class="kws">${chips(tags, 'tag')}</div>` : '')
    + (kws.length ? `<p class="anat-label">Key phrases</p><div class="kws">${chips(kws)}</div>` : '');
  $('anatomyWrap').hidden = !tags.length && !kws.length;
}
$('anatomy')?.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-q]'); if (!b) return;
  searchInput.value = b.dataset.q; searchInput.dispatchEvent(new Event('input'));
  location.hash = '#/explore';
});

function renderAchievements() {
  const n = (k) => +localStorage.getItem(k) || 0;
  const list = [
    ['Explorer', 'View 10 prompts', n('view_count') >= 10],
    ['Collector', 'Like 5 prompts', likedPrompts.size >= 5],
    ['Curator', 'Create a collection', collections.length > 0],
    ['Prompt Master', 'Copy 15 prompts', n('copy_count') >= 15]
  ];
  $('achievements').innerHTML = list.map(([a, b, on]) => `<div class="ach ${on ? 'on' : ''}"><b>${a}</b><span>${b}</span></div>`).join('');
}

/* Collections */
function saveCols() { localStorage.setItem('collections', JSON.stringify(collections)); renderCollections(); }
const inCol = (c, id) => c.ids.map(String).includes(String(id));
function renderCollections() {
  const pane = $('collectionsPane');
  const col = collections.find(c => c.id === openColId);
  if (col) {
    pane.innerHTML = `<div class="col-head"><button class="btn-ghost" data-act="back">Back</button><b>${escapeHTML(col.name)}</b><button class="btn-ghost" data-act="del">Delete</button></div><div class="prompt-grid" id="colGrid"></div>`;
    const items = col.ids.map(findItem).filter(Boolean);
    if (!items.length) $('colGrid').innerHTML = '<div class="empty-state"><h3>Empty collection</h3><p>Open any prompt and tap Save to add it here.</p></div>';
    items.forEach(i => $('colGrid').appendChild(buildCard(i)));
    return;
  }
  pane.innerHTML = `<form class="new-col" id="colCreateForm"><input class="form-control" id="colCreateName" maxlength="30" placeholder="New collection name" required /><button class="btn-primary btn-add">Create</button></form>
    <div class="col-list">${collections.map(c => {
      const t = c.ids.map(findItem).filter(Boolean).slice(0, 3).map(i => checkIsVideo(i.media_url) ? '<span></span>' : `<img src="${i.media_url}" alt="" loading="lazy">`).join('');
      return `<div class="col-item" data-id="${c.id}"><div class="col-thumbs">${t}</div><div class="col-meta"><b>${escapeHTML(c.name)}</b><span>${c.ids.length} prompt${c.ids.length === 1 ? '' : 's'}</span></div></div>`;
    }).join('') || '<div class="empty-state"><h3>No collections yet</h3><p>Group prompts into folders like Portraits or Logo ideas.</p></div>'}</div>`;
}
$('collectionsPane')?.addEventListener('click', (e) => {
  const item = e.target.closest('.col-item'), act = e.target.closest('[data-act]')?.dataset.act;
  if (item) { openColId = item.dataset.id; renderCollections(); }
  else if (act === 'back') { openColId = null; renderCollections(); }
  else if (act === 'del' && confirm('Delete this collection?')) { collections = collections.filter(c => c.id !== openColId); openColId = null; saveCols(); toast('Collection deleted'); }
});
$('collectionsPane')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('colCreateName').value.trim();
  if (name) { collections.push({ id: String(Date.now()), name, ids: [] }); saveCols(); toast('Collection created'); }
});
function openSaveSheet(id) {
  const draw = () => {
    $('sheetList').innerHTML = collections.map(c => `<label class="sheet-row"><input type="checkbox" data-cid="${c.id}" ${inCol(c, id) ? 'checked' : ''}><span>${escapeHTML(c.name)}</span><em>${c.ids.length}</em></label>`).join('') || '<p class="sheet-empty">Create your first collection below.</p>';
  };
  draw();
  $('saveSheet').hidden = false;
  $('sheetList').onchange = (e) => {
    const c = collections.find(x => x.id === e.target.dataset.cid); if (!c) return;
    c.ids = e.target.checked ? [...c.ids, id] : c.ids.filter(x => String(x) !== String(id));
    saveCols(); draw(); toast(e.target.checked ? 'Saved to ' + c.name : 'Removed');
  };
  $('newColForm').onsubmit = (e) => {
    e.preventDefault();
    const name = $('newColName').value.trim(); if (!name) return;
    collections.push({ id: String(Date.now()), name, ids: [id] });
    $('newColName').value = ''; saveCols(); draw(); toast('Saved to ' + name);
  };
}
function closeSheet() { $('saveSheet').hidden = true; }
$('sheetClose')?.addEventListener('click', closeSheet);
$('saveSheet')?.addEventListener('click', (e) => { if (e.target.id === 'saveSheet') closeSheet(); });

/* Load more, recent searches, settings */
$('loadMoreBtn')?.addEventListener('click', () => { visible += PAGE; renderPrompts(); });
function renderRecentSearches() {
  const r = JSON.parse(localStorage.getItem('recent_searches') || '[]');
  const box = $('recentSearches');
  box.hidden = !r.length || !!searchQuery;
  box.innerHTML = r.length ? '<span>Recent</span>' + r.map(q => `<button data-q="${escapeHTML(q)}">${escapeHTML(q)}</button>`).join('') + '<button data-clear="1" class="rs-clear">Clear</button>' : '';
}
$('recentSearches')?.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.clear) { localStorage.removeItem('recent_searches'); return renderRecentSearches(); }
  searchInput.value = b.dataset.q; searchInput.dispatchEvent(new Event('input'));
});
searchInput?.addEventListener('keydown', (e) => {
  const q = searchInput.value.trim();
  if (e.key !== 'Enter' || q.length < 2) return;
  const r = JSON.parse(localStorage.getItem('recent_searches') || '[]').filter(x => x.toLowerCase() !== q.toLowerCase());
  localStorage.setItem('recent_searches', JSON.stringify([q, ...r].slice(0, 5)));
  searchInput.blur();
});
searchInput?.addEventListener('input', renderRecentSearches);
$('setAutoplay').checked = autoplayOn();
$('setAutoplay')?.addEventListener('change', (e) => {
  localStorage.setItem('autoplay', e.target.checked ? '1' : '0');
  renderPrompts(); renderLiked();
});
$('resetDataBtn')?.addEventListener('click', () => {
  if (!confirm('Reset all local data on this device?')) return;
  ['liked_prompts','view_count','ext','collections','recent_prompts','copy_count','user_name','recent_searches','upload_draft','grid_density','autoplay'].forEach(k => localStorage.removeItem(k));
  location.reload();
});

/* Prompt Studio */
const ST = {
  style: ['Cinematic', 'Anime', '3D render', 'Watercolor', 'Cyberpunk', 'Photorealistic', 'Oil painting', 'Minimal vector'],
  light: ['Golden hour', 'Neon glow', 'Soft studio', 'Moody low-key', 'Volumetric fog'],
  camera: ['Close-up portrait', 'Wide angle', 'Aerial view', 'Macro', '35mm film'],
  mood: ['Epic', 'Calm', 'Dreamy', 'Dark', 'Joyful'],
  ar: ['1:1', '16:9', '9:16', '4:5', '3:2'],
  model: ['Any', 'Midjourney', 'DALL·E', 'Stable Diffusion', 'Flux']
};
const ST_LABELS = { style: 'Style', light: 'Lighting', camera: 'Camera', mood: 'Mood', ar: 'Aspect ratio', model: 'Target model' };
const ST_SUBJECTS = ['a lone samurai on a neon rooftop', 'a cozy cabin in a snowy forest', 'a astronaut reading a book on Mars', 'a futuristic city above the clouds', 'a fox spirit in a glowing bamboo forest', 'a vintage sports car on a coastal road'];
const stSel = {};
function stBuild() {
  const p = [$('stSubject').value.trim() || 'a subject of your choice'];
  if (stSel.style) p.push(stSel.style + ' style');
  if (stSel.light) p.push(stSel.light + ' lighting');
  if (stSel.camera) p.push(stSel.camera);
  if (stSel.mood) p.push(stSel.mood + ' mood');
  p.push('highly detailed, sharp focus');
  let t = p.join(', ');
  const mj = stSel.model === 'Midjourney';
  if (stSel.ar) t += mj ? ` --ar ${stSel.ar} --v 6` : `, aspect ratio ${stSel.ar}`;
  else if (mj) t += ' --v 6';
  if (stSel.model && !mj) t += `, made for ${stSel.model}`;
  $('stOutput').textContent = t;
  $('stChat').href = 'https://chatgpt.com/?q=' + encodeURIComponent(t);
  document.querySelectorAll('#studioOpts button').forEach(b => b.classList.toggle('on', stSel[b.parentNode.dataset.k] === b.textContent));
  return t;
}
function buildStudio() {
  $('studioOpts').innerHTML = Object.keys(ST).map(k => `<div class="form-group"><label>${ST_LABELS[k]}</label><div class="opts" data-k="${k}">${ST[k].map(v => `<button type="button">${escapeHTML(v)}</button>`).join('')}</div></div>`).join('');
  stBuild();
}
$('studioOpts')?.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const k = b.parentNode.dataset.k, v = b.textContent;
  if (stSel[k] === v || v === 'Any') delete stSel[k]; else stSel[k] = v;
  stBuild();
});
$('stSubject')?.addEventListener('input', stBuild);
$('stShuffle')?.addEventListener('click', () => {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  $('stSubject').value = pick(ST_SUBJECTS);
  ['style', 'light', 'camera', 'mood', 'ar'].forEach(k => (stSel[k] = pick(ST[k])));
  stBuild();
});
$('stCopy')?.addEventListener('click', () => navigator.clipboard.writeText(stBuild()).then(() => { bumpCopies(); toast('Prompt copied'); }));
$('stUse')?.addEventListener('click', () => {
  const t = stBuild();
  $('promptText').value = t;
  if (!$('promptTitle').value.trim()) $('promptTitle').value = ($('stSubject').value.trim() || 'Studio prompt').slice(0, 80);
  updateLivePreview();
  location.hash = '#/create';
  toast('Prompt sent to Create');
});

/* Command palette (Ctrl/Cmd + K) */
const PAGES = [['Explore', '#/explore'], ['Create a prompt', '#/create'], ['Prompt Studio', '#/studio'], ['Your profile', '#/profile'], ['Help and shortcuts', '#/help']];
let palIdx = 0, palItems = [];
function openPalette() { $('palette').hidden = false; $('palInput').value = ''; renderPalette(); setTimeout(() => $('palInput').focus(), 20); }
function closePalette() { $('palette').hidden = true; }
function renderPalette() {
  const q = $('palInput').value.trim().toLowerCase();
  palItems = PAGES.filter(p => !q || p[0].toLowerCase().includes(q)).map(p => ({ t: p[0], s: 'Page', go: () => (location.hash = p[1]) }));
  if (!q || 'surprise random'.includes(q)) palItems.push({ t: 'Surprise me', s: 'Action', go: () => $('surpriseBtn').click() });
  if (q) localPromptsCache.filter(i => (i.title || '').toLowerCase().includes(q) || (i.prompt_text || '').toLowerCase().includes(q)).slice(0, 6)
    .forEach(i => palItems.push({ t: i.title, s: 'Prompt', go: () => (location.hash = '#/prompt/' + encodeURIComponent(i.id)) }));
  palIdx = 0; paintPalette();
}
function paintPalette() {
  $('palList').innerHTML = palItems.map((it, i) => `<button class="pal-item ${i === palIdx ? 'on' : ''}" data-i="${i}"><span>${escapeHTML(it.t)}</span><em>${it.s}</em></button>`).join('') || '<p class="sheet-empty">No results</p>';
  $('palList').querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}
function runPalette(i) { const it = palItems[i]; if (!it) return; closePalette(); it.go(); }
$('palInput')?.addEventListener('input', renderPalette);
$('palInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); palIdx = Math.min(palIdx + 1, palItems.length - 1); paintPalette(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palIdx = Math.max(palIdx - 1, 0); paintPalette(); }
  else if (e.key === 'Enter') runPalette(palIdx);
  else if (e.key === 'Escape') { e.stopPropagation(); closePalette(); }
});
$('palList')?.addEventListener('click', (e) => { const b = e.target.closest('.pal-item'); if (b) runPalette(+b.dataset.i); });
$('palette')?.addEventListener('click', (e) => { if (e.target.id === 'palette') closePalette(); });
$('paletteBtn')?.addEventListener('click', openPalette);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('palette').hidden ? openPalette() : closePalette(); }
});

/* Back to top */
window.addEventListener('scroll', () => $('toTop').classList.toggle('show', window.scrollY > 900), { passive: true });
$('toTop')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

window.addEventListener('DOMContentLoaded', () => {
  buildStudio();
  try {
    const d = JSON.parse(localStorage.getItem('upload_draft') || 'null');
    if (d) { $('promptTitle').value = d.t || ''; $('promptText').value = d.p || ''; updateLivePreview(); }
  } catch (e) {}
  const today = new Date().toISOString().slice(0, 10), last = localStorage.getItem('last_visit');
  if (last !== today) {
    const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    localStorage.setItem('streak', last === y ? (+localStorage.getItem('streak') || 0) + 1 : 1);
    localStorage.setItem('last_visit', today);
  }
  renderRecentSearches();
  route(); fetchPrompts();
});
