const CLOUDINARY_CLOUD_NAME = 'pcjnaclc';
const CLOUDINARY_PRESET = 'v3ppgbw7';

const SUPABASE_URL = 'https://kxwjamrojtgjsctvouul.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_fKj4xun5x0QwiKyfnOq1Yw_47OVArCt';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let localPromptsCache = [];
let searchQuery = '';
let likedPrompts = new Set(JSON.parse(localStorage.getItem('liked_prompts') || '[]'));

// DOM Elements
const feedPage = document.getElementById('feedPage');
const uploadPage = document.getElementById('uploadPage');
const promptGrid = document.getElementById('promptGrid');
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const uploadForm = document.getElementById('uploadForm');
const statusMsg = document.getElementById('statusMsg');
const submitBtn = document.getElementById('submitBtn');
const mediaFileInput = document.getElementById('mediaFile');
const fileNameDisplay = document.getElementById('fileNameDisplay');

// Full Preview Elements
const previewPage = document.getElementById('previewPage');
const closePreviewBtn = document.getElementById('closePreviewBtn');
const modalMediaContainer = document.getElementById('modalMediaContainer');
const modalTitle = document.getElementById('modalTitle');
const modalPromptText = document.getElementById('modalPromptText');
const modalCopyBtn = document.getElementById('modalCopyBtn');
const modalLikeBtn = document.getElementById('modalLikeBtn');

/* Page Switcher */
function switchPage(pageId) {
  document.querySelectorAll('.page-view').forEach(p => p.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.getElementById('openUploadBtn')?.addEventListener('click', () => switchPage('uploadPage'));
document.getElementById('backToFeedBtn')?.addEventListener('click', () => switchPage('feedPage'));
document.getElementById('logoBtn')?.addEventListener('click', () => switchPage('feedPage'));

/* Media File Helper */
mediaFileInput?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    fileNameDisplay.innerHTML = `Selected: <strong>${escapeHTML(file.name)}</strong>`;
  } else {
    fileNameDisplay.innerHTML = `<strong>Choose media file</strong> or drag & drop`;
  }
});

/* Search Input Handler */
searchInput?.addEventListener('input', (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  clearSearchBtn.classList.toggle('hidden', searchQuery === '');
  renderPrompts();
});

clearSearchBtn?.addEventListener('click', () => {
  searchInput.value = '';
  searchQuery = '';
  clearSearchBtn.classList.add('hidden');
  renderPrompts();
});

/* Database Fetching */
async function fetchPrompts() {
  try {
    const { data: prompts, error } = await supabaseClient
      .from('prompts')
      .select('*')
      .order('id', { ascending: false });

    if (error) throw error;
    localPromptsCache = prompts || [];
    renderPrompts();

  } catch (err) {
    console.error('Fetch error:', err);
    promptGrid.innerHTML = `<div class="empty-state"><p style="color: #ef4444;">Failed to load prompt gallery: ${escapeHTML(err.message)}</p></div>`;
  }
}

/* Render Prompt Grid Thumbnails */
function renderPrompts() {
  const filtered = localPromptsCache.filter(item => {
    const titleMatch = (item.title || '').toLowerCase().includes(searchQuery);
    const promptMatch = (item.prompt_text || '').toLowerCase().includes(searchQuery);
    return titleMatch || promptMatch;
  });

  if (filtered.length === 0) {
    promptGrid.innerHTML = `<div class="empty-state"><p>No matching prompts found.</p></div>`;
    return;
  }

  promptGrid.innerHTML = '';

  filtered.forEach(item => {
    const isVideo = checkIsVideo(item.media_url);
    const card = document.createElement('div');
    card.className = 'glass-card-item';
    card.onclick = () => openFullPreviewPage(item.id);

    const mediaHTML = isVideo
      ? `<video src="${item.media_url}" autoplay loop muted playsinline preload="auto"></video>`
      : `<img src="${item.media_url}" alt="${escapeHTML(item.title)}" loading="lazy">`;

    card.innerHTML = `
      <div class="thumbnail-container">
        ${mediaHTML}
      </div>
      <div class="card-info">
        <div class="card-title">${escapeHTML(item.title)}</div>
      </div>
    `;

    promptGrid.appendChild(card);
  });
}

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
}

/* CARD TAP PAR FULL PAGE OPEN HOGA */
function openFullPreviewPage(id) {
  const item = localPromptsCache.find(p => p.id === id);
  if (!item) return;

  const isVideo = checkIsVideo(item.media_url);

  modalMediaContainer.innerHTML = isVideo
    ? `<video src="${item.media_url}" controls autoplay loop muted playsinline></video>`
    : `<img src="${item.media_url}" alt="${escapeHTML(item.title)}">`;

  modalTitle.innerText = item.title;
  modalPromptText.innerText = item.prompt_text;

  // Copy Prompt Action
  modalCopyBtn.onclick = () => {
    navigator.clipboard.writeText(item.prompt_text).then(() => {
      const copySpan = modalCopyBtn.querySelector('.btn-text');
      if (copySpan) copySpan.innerText = 'Copied to Clipboard!';
      setTimeout(() => {
        if (copySpan) copySpan.innerText = 'Copy Prompt';
      }, 2000);
    });
  };

  // Like Action
  updateModalLikeState(id);
  if (modalLikeBtn) {
    modalLikeBtn.onclick = (e) => toggleLike(e, id);
  }

  switchPage('previewPage');
}

function updateModalLikeState(id) {
  if (!modalLikeBtn) return;
  const isLiked = likedPrompts.has(id);
  const heartIcon = modalLikeBtn.querySelector('svg');
  if (heartIcon) {
    heartIcon.setAttribute('fill', isLiked ? '#ef4444' : 'none');
    heartIcon.setAttribute('stroke', isLiked ? '#ef4444' : '#ffffff');
  }
}

closePreviewBtn?.addEventListener('click', () => switchPage('feedPage'));

/* Form Upload Handler */
uploadForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  statusMsg.style.color = 'var(--accent-cyan)';
  statusMsg.innerText = '⏳ Uploading high quality media...';

  const file = mediaFileInput.files[0];
  const title = document.getElementById('promptTitle').value;
  const promptText = document.getElementById('promptText').value;

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
    statusMsg.innerText = '⚡ Saving prompt configuration...';

    const { error } = await supabaseClient
      .from('prompts')
      .insert([{ title, prompt_text: promptText, media_url: mediaUrl }]);

    if (error) throw error;

    statusMsg.style.color = '#22c55e';
    statusMsg.innerText = '✅ Successfully published!';
    
    uploadForm.reset();
    fileNameDisplay.innerHTML = `<strong>Choose media file</strong> or drag & drop`;

    setTimeout(() => {
      statusMsg.innerText = '';
      switchPage('feedPage');
      fetchPrompts();
    }, 1200);

  } catch (err) {
    console.error('Upload Error:', err);
    statusMsg.style.color = '#ef4444';
    statusMsg.innerText = '❌ Error: ' + err.message;
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

window.addEventListener('DOMContentLoaded', fetchPrompts);
