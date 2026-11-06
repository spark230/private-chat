/* ═══════════════════════════════════════════════════════════════
   PRIVATE CHAT — Supabase-powered client
   ═══════════════════════════════════════════════════════════════ */

// ── State ───────────────────────────────────────────────────────
let sb;           // Supabase client
let channel;      // Realtime channel
let myUsername = '';
let lastDateShown = '';
let typingTimeout = null;
let pendingFile = null;
let activeDropdown = null;
const renderedIds = new Set(); // deduplicate messages

// ── DOM Refs ────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const $login        = $('login-screen');
const $full         = $('full-screen');
const $chat         = $('chat-screen');
const $usernameIn   = $('username-input');
const $joinBtn      = $('join-btn');
const $loginError   = $('login-error');
const $messages     = $('messages');
const $msgContainer = $('messages-container');
const $msgInput     = $('message-input');
const $sendBtn      = $('send-btn');
const $imageInput   = $('image-input');
const $previewOvl   = $('image-preview-overlay');
const $previewImg   = $('preview-image');
const $previewName  = $('preview-filename');
const $captionIn    = $('image-caption');
const $cancelPrev   = $('cancel-preview');
const $sendImgBtn   = $('send-image-btn');
const $viewer       = $('image-viewer');
const $viewerImg    = $('viewer-image');
const $viewerDlBtn  = $('viewer-download-btn');
const $viewerClose  = $('viewer-close-btn');
const $partnerName  = $('partner-name');
const $partnerAvatar= $('partner-avatar');
const $partnerStatus= $('partner-status');
const $onlineDot    = $('online-dot');
const $typingInd    = $('typing-indicator');
const $typingName   = $('typing-name');

// ── Helpers ─────────────────────────────────────────────────────
function showScreen(screen) {
  [$login, $full, $chat].forEach(s => s.classList.remove('active'));
  screen.classList.add('active');
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function scrollToBottom() {
  requestAnimationFrame(() => { $msgContainer.scrollTop = $msgContainer.scrollHeight; });
}

function escapeHtml(text) {
  const d = document.createElement('div'); d.textContent = text; return d.innerHTML;
}

function linkify(text) {
  return escapeHtml(text).replace(
    /(https?:\/\/[^\s]+)/g,
    '<a href="$1" target="_blank" rel="noopener" style="color:#53bdeb">$1</a>'
  );
}

// ── Notification sound ──────────────────────────────────────────
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playNotifSound() {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.frequency.value = 800;
  gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
  osc.start(); osc.stop(audioCtx.currentTime + 0.15);
}

// ── Service Worker for Background Notifications ──────────────────
let swRegistration = null;
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => {
        swRegistration = reg;
        console.log('Service Worker registered');
      })
      .catch(err => console.log('SW registration error:', err));
  });
}

// ── Chrome Browser Notifications ────────────────────────────────
let notifPermission = ('Notification' in window) ? Notification.permission : 'denied';
let titleBlinkInterval = null;
const originalTitle = document.title;

async function requestNotifPermission() {
  if (!('Notification' in window)) return;
  try {
    const perm = await Notification.requestPermission();
    notifPermission = perm;
  } catch (err) {
    console.error('Notification permission error:', err);
  }
}

// Blink tab title for unread messages
function startTitleBlink(senderName) {
  if (titleBlinkInterval) return;
  let show = true;
  titleBlinkInterval = setInterval(() => {
    document.title = show ? `💬 ${senderName} sent a message` : originalTitle;
    show = !show;
  }, 1000);
}

function stopTitleBlink() {
  if (titleBlinkInterval) {
    clearInterval(titleBlinkInterval);
    titleBlinkInterval = null;
    document.title = originalTitle;
  }
}

// Stop blinking when user focuses the tab
window.addEventListener('focus', stopTitleBlink);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') stopTitleBlink();
});

function generateAvatarDataUrl(initial) {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#00a884';
  ctx.beginPath(); ctx.arc(48, 48, 48, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 40px Inter, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText((initial || 'P').toUpperCase(), 48, 50);
  return c.toDataURL();
}

async function showBrowserNotification(msg) {
  // Only show when tab is hidden or not focused
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  if (notifPermission !== 'granted') return;

  const title = msg.sender || 'Private Chat';
  let body;
  if (msg.type === 'image') {
    body = msg.caption ? `📷 Photo: ${msg.caption}` : '📷 Photo';
  } else {
    body = msg.text && msg.text.length > 100 ? msg.text.substring(0, 100) + '…' : (msg.text || '');
  }

  const avatar = generateAvatarDataUrl(title.charAt(0));
  const options = {
    body: body,
    icon: avatar,
    badge: avatar,
    tag: 'private-chat-' + (msg.id || Date.now()),
    renotify: true,
    requireInteraction: false,
    vibrate: [200, 100, 200]
  };

  // 1. Try Service Worker showNotification (works in background / minimized tabs)
  try {
    if (swRegistration && 'showNotification' in swRegistration) {
      await swRegistration.showNotification(title, options);
      return;
    }
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      if (reg && 'showNotification' in reg) {
        await reg.showNotification(title, options);
        return;
      }
    }
  } catch (e) {
    console.warn('SW notification fallback to window notification', e);
  }

  // 2. Fallback to standard window Notification
  try {
    const notif = new Notification(title, options);
    notif.onclick = () => {
      window.focus();
      notif.close();
    };
    setTimeout(() => notif.close(), 6000);
  } catch (e) {
    console.error('Notification error:', e);
  }
}

// ═══════════════════════════════════════════════════════════════
// SUPABASE CONFIG & INIT
// ═══════════════════════════════════════════════════════════════
const SUPABASE_URL = 'https://kvxawxyzywwklnbhehsl.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_19_JK_H9kBDNaIO45qaMLA_aH--9y25';

async function initApp() {
  try {
    // Connect directly with Supabase public credentials
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (err) {
    $loginError.textContent = '⚠ Could not initialize Supabase connection.';
    console.error(err);
  }
}
initApp();

// ═══════════════════════════════════════════════════════════════
// JOIN
// ═══════════════════════════════════════════════════════════════
$joinBtn.onclick = tryJoin;
$usernameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryJoin(); });

async function tryJoin() {
  if (!sb) return;
  const name = $usernameIn.value.trim();
  if (!name) { $loginError.textContent = 'Please enter your name'; return; }
  $joinBtn.disabled = true;
  $joinBtn.textContent = 'Connecting…';
  myUsername = name;

  // Create realtime channel
  channel = sb.channel('private-chat');

  // ── Presence ──
  channel.on('presence', { event: 'sync' }, () => {
    const state = channel.presenceState();
    const users = [];
    for (const key of Object.keys(state)) {
      const entries = state[key];
      if (entries && entries.length > 0) users.push(entries[0].username);
    }
    updatePartnerUI(users);
  });

  // ── Broadcast: new message ──
  channel.on('broadcast', { event: 'new-message' }, ({ payload }) => {
    handleIncomingMessage(payload);
  });

  // ── Postgres Database Changes: ensures messages are received even if broadcast drops in background ──
  channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
    if (payload && payload.new) {
      handleIncomingMessage(payload.new);
    }
  });

  channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => {
    if (payload && payload.new && payload.new.is_edited) {
      updateMessageInDOM(payload.new);
    }
  });

  // ── Broadcast: edit message ──
  channel.on('broadcast', { event: 'edit-message' }, ({ payload }) => {
    if (payload.editedBy === myUsername) return; // already updated locally
    updateMessageInDOM(payload);
  });

  // ── Broadcast: seen ──
  channel.on('broadcast', { event: 'seen' }, ({ payload }) => {
    if (payload.seenBy === myUsername) return;
    const el = document.querySelector(`[data-id="${payload.messageId}"] .seen-check`);
    if (el) el.classList.add('seen');
  });

  // ── Broadcast: typing ──
  channel.on('broadcast', { event: 'typing' }, ({ payload }) => {
    if (payload.username === myUsername) return;
    $typingName.textContent = payload.username;
    $typingInd.classList.remove('typing-hidden');
    scrollToBottom();
  });
  channel.on('broadcast', { event: 'stop-typing' }, ({ payload }) => {
    if (payload.username === myUsername) return;
    $typingInd.classList.add('typing-hidden');
  });

  // ── Broadcast: user joined/left system messages ──
  channel.on('broadcast', { event: 'user-joined' }, ({ payload }) => {
    if (payload.username !== myUsername) addSystemMessage(`${payload.username} joined the chat`);
  });
  channel.on('broadcast', { event: 'user-left' }, ({ payload }) => {
    addSystemMessage(`${payload.username} left the chat`);
  });

  // ── Subscribe ──
  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      // Track presence
      await channel.track({ username: myUsername, online_at: new Date().toISOString() });

      // Broadcast join
      channel.send({ type: 'broadcast', event: 'user-joined', payload: { username: myUsername } });

      // Load chat history
      await loadHistory();
      showScreen($chat);
      $msgInput.focus();
      requestNotifPermission();
    }
  });

  // Handle tab close → broadcast leave
  window.addEventListener('beforeunload', () => {
    channel.send({ type: 'broadcast', event: 'user-left', payload: { username: myUsername } });
    channel.untrack();
  });
}

// ═══════════════════════════════════════════════════════════════
// PARTNER UI (Presence)
// ═══════════════════════════════════════════════════════════════
function updatePartnerUI(users) {
  const uniqueUsers = [...new Set(users)];
  const partner = uniqueUsers.find(u => u !== myUsername);
  if (partner) {
    $partnerName.textContent = partner;
    $partnerAvatar.textContent = partner.charAt(0).toUpperCase();
    $partnerStatus.textContent = 'online';
    $partnerStatus.classList.add('online');
    $onlineDot.classList.add('online');
  } else {
    $partnerName.textContent = 'Waiting for partner…';
    $partnerAvatar.textContent = '?';
    $partnerStatus.textContent = 'offline';
    $partnerStatus.classList.remove('online');
    $onlineDot.classList.remove('online');
  }
}

function addSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'date-separator';
  div.textContent = text;
  $messages.appendChild(div);
  scrollToBottom();
}

// ═══════════════════════════════════════════════════════════════
// LOAD HISTORY from Supabase
// ═══════════════════════════════════════════════════════════════
async function loadHistory() {
  const { data, error } = await sb
    .from('messages')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) { console.error('Load history error:', error); return; }

  lastDateShown = '';
  (data || []).forEach(msg => renderMessage(msg, false));
  scrollToBottom();

  // Mark partner's unseen messages as seen
  const unseen = (data || []).filter(m => m.sender !== myUsername && !m.seen);
  for (const m of unseen) markAsSeen(m.id);
}

// ── Background Polling & Inactive Tab Sync ──────────────────────
async function syncMissedMessages() {
  if (!sb || !myUsername) return;
  try {
    const { data, error } = await sb
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error || !data) return;

    const recent = data.reverse();
    for (const m of recent) {
      if (!renderedIds.has(m.id)) {
        if (typeof handleIncomingMessage === 'function') {
          handleIncomingMessage(m);
        }
      }
    }
  } catch (err) {
    console.warn('Sync check:', err);
  }
}

// Poll every 6 seconds as a background safety net
setInterval(syncMissedMessages, 6000);

// Re-check immediately when tab is clicked or unhidden
window.addEventListener('focus', syncMissedMessages);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncMissedMessages();
});

// ═══════════════════════════════════════════════════════════════
// SEND TEXT MESSAGE
// ═══════════════════════════════════════════════════════════════
$sendBtn.onclick = sendText;
$msgInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); }
});

async function sendText() {
  const text = $msgInput.value.trim();
  if (!text) return;

  const msg = {
    id: crypto.randomUUID(),
    type: 'text',
    sender: myUsername,
    text: text,
    caption: '',
    is_edited: false,
    seen: false,
    created_at: new Date().toISOString()
  };

  $msgInput.value = '';
  $msgInput.style.height = 'auto';
  channel.send({ type: 'broadcast', event: 'stop-typing', payload: { username: myUsername } });

  // Optimistic render
  renderMessage(msg, true);
  scrollToBottom();

  // Persist to Supabase
  const { error } = await sb.from('messages').insert(msg);
  if (error) console.error('Send error:', error);

  // Broadcast to partner
  channel.send({ type: 'broadcast', event: 'new-message', payload: msg });
}

// ── Auto-resize textarea + typing indicator ─────────────────────
$msgInput.addEventListener('input', () => {
  $msgInput.style.height = 'auto';
  $msgInput.style.height = Math.min($msgInput.scrollHeight, 120) + 'px';
  channel.send({ type: 'broadcast', event: 'typing', payload: { username: myUsername } });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    channel.send({ type: 'broadcast', event: 'stop-typing', payload: { username: myUsername } });
  }, 1500);
});

// ═══════════════════════════════════════════════════════════════
// IMAGE — select, preview, upload, send
// ═══════════════════════════════════════════════════════════════
$imageInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  pendingFile = file;
  $previewName.textContent = file.name;
  $captionIn.value = '';
  const reader = new FileReader();
  reader.onload = (ev) => {
    $previewImg.src = ev.target.result;
    $previewOvl.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
  $imageInput.value = '';
});

$cancelPrev.onclick = () => {
  $previewOvl.classList.add('hidden');
  pendingFile = null;
};

$sendImgBtn.onclick = sendImage;

async function sendImage() {
  if (!pendingFile) return;
  $sendImgBtn.disabled = true;

  try {
    // Upload to Supabase Storage
    const ext = pendingFile.name.split('.').pop();
    const storagePath = `${Date.now()}_${crypto.randomUUID()}.${ext}`;

    const { data: uploadData, error: uploadErr } = await sb.storage
      .from('chat-images')
      .upload(storagePath, pendingFile);

    if (uploadErr) throw uploadErr;

    // Get public URL
    const { data: urlData } = sb.storage
      .from('chat-images')
      .getPublicUrl(uploadData.path);

    const msg = {
      id: crypto.randomUUID(),
      type: 'image',
      sender: myUsername,
      text: null,
      image_url: urlData.publicUrl,
      image_path: uploadData.path,
      caption: $captionIn.value.trim(),
      is_edited: false,
      seen: false,
      created_at: new Date().toISOString()
    };

    $previewOvl.classList.add('hidden');
    pendingFile = null;

    // Optimistic render
    renderMessage(msg, true);
    scrollToBottom();

    // Persist
    const { error } = await sb.from('messages').insert(msg);
    if (error) console.error('Image send error:', error);

    // Broadcast
    channel.send({ type: 'broadcast', event: 'new-message', payload: msg });
  } catch (err) {
    alert('Failed to upload image: ' + err.message);
    console.error(err);
  }
  $sendImgBtn.disabled = false;
}

// ═══════════════════════════════════════════════════════════════
// INCOMING MESSAGE HANDLER & RENDER
// ═══════════════════════════════════════════════════════════════
function handleIncomingMessage(msg) {
  if (!msg || !msg.id) return;
  if (msg.sender === myUsername) return; // ignore our own
  if (renderedIds.has(msg.id)) return;  // avoid duplicates

  renderMessage(msg, true);
  scrollToBottom();
  playNotifSound();
  showBrowserNotification(msg);
  if (document.hidden || !document.hasFocus()) startTitleBlink(msg.sender);
  markAsSeen(msg.id);
}

function renderMessage(msg, animate) {
  if (renderedIds.has(msg.id)) return;
  renderedIds.add(msg.id);

  // Date separator
  const dateStr = formatDate(msg.created_at);
  if (dateStr !== lastDateShown) {
    lastDateShown = dateStr;
    const sep = document.createElement('div');
    sep.className = 'date-separator';
    sep.textContent = dateStr;
    $messages.appendChild(sep);
  }

  const isMine = msg.sender === myUsername;
  const div = document.createElement('div');
  div.className = `msg ${isMine ? 'sent' : 'recv'}`;
  div.dataset.id = msg.id;
  if (!animate) div.style.animation = 'none';

  let html = `<div class="sender">${escapeHtml(msg.sender)}</div>`;

  // Actions dropdown (edit) — only for sender's own messages
  if (isMine) {
    html += `
      <div class="msg-actions">
        <button class="msg-actions-btn" onclick="toggleDropdown(event, '${msg.id}')" title="Options">▾</button>
        <div class="msg-dropdown hidden" id="dropdown-${msg.id}">
          ${msg.type === 'text' ? `
          <button onclick="startEdit('${msg.id}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit
          </button>` : ''}
          ${msg.type === 'image' && msg.caption ? `
          <button onclick="startEditCaption('${msg.id}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit caption
          </button>` : ''}
        </div>
      </div>`;
  }

  if (msg.type === 'image') {
    html += `
      <div class="chat-image-wrap" onclick="openImageViewer('${msg.image_url}', '${msg.image_path || ''}')">
        <img src="${msg.image_url}" alt="image" loading="lazy" />
        <div class="download-badge">
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="#fff" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
        </div>
      </div>`;
    if (msg.caption) {
      html += `<div class="caption" id="caption-${msg.id}">${escapeHtml(msg.caption)}</div>`;
    }
  } else {
    html += `<div class="text" id="text-${msg.id}">${linkify(msg.text)}</div>`;
  }

  const editedLabel = msg.is_edited ? `<span class="edited-label">edited</span>` : '';
  const checkClass = isMine ? (msg.seen ? 'seen-check seen' : 'seen-check') : '';
  html += `
    <div class="meta">
      ${editedLabel}
      <span class="time">${formatTime(msg.created_at)}</span>
      ${isMine ? `<span class="${checkClass}">✓✓</span>` : ''}
    </div>`;

  div.innerHTML = html;
  $messages.appendChild(div);
}

// ═══════════════════════════════════════════════════════════════
// EDIT MESSAGE
// ═══════════════════════════════════════════════════════════════
function toggleDropdown(e, msgId) {
  e.stopPropagation();
  // Close any open dropdown
  if (activeDropdown && activeDropdown !== msgId) {
    const prev = document.getElementById(`dropdown-${activeDropdown}`);
    if (prev) prev.classList.add('hidden');
  }
  const dd = document.getElementById(`dropdown-${msgId}`);
  dd.classList.toggle('hidden');
  activeDropdown = dd.classList.contains('hidden') ? null : msgId;
}

// Close dropdowns on outside click
document.addEventListener('click', () => {
  if (activeDropdown) {
    const dd = document.getElementById(`dropdown-${activeDropdown}`);
    if (dd) dd.classList.add('hidden');
    activeDropdown = null;
  }
});

function startEdit(msgId) {
  // Close dropdown
  const dd = document.getElementById(`dropdown-${msgId}`);
  if (dd) dd.classList.add('hidden');
  activeDropdown = null;

  const textEl = document.getElementById(`text-${msgId}`);
  if (!textEl) return;
  const currentText = textEl.textContent;

  // Replace text with edit area
  const editArea = document.createElement('div');
  editArea.className = 'edit-area';
  editArea.innerHTML = `
    <textarea id="edit-input-${msgId}" rows="2">${escapeHtml(currentText)}</textarea>
    <div class="edit-actions">
      <button class="edit-cancel" onclick="cancelEdit('${msgId}', ${JSON.stringify(currentText).replace(/'/g, "\\'")})">Cancel</button>
      <button class="edit-save" onclick="saveEdit('${msgId}')">Save</button>
    </div>
  `;
  textEl.replaceWith(editArea);

  const input = document.getElementById(`edit-input-${msgId}`);
  input.focus();
  input.selectionStart = input.value.length;

  // Enter to save, Escape to cancel
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(msgId); }
    if (e.key === 'Escape') cancelEdit(msgId, currentText);
  });
}

function startEditCaption(msgId) {
  const dd = document.getElementById(`dropdown-${msgId}`);
  if (dd) dd.classList.add('hidden');
  activeDropdown = null;

  const captionEl = document.getElementById(`caption-${msgId}`);
  if (!captionEl) return;
  const currentCaption = captionEl.textContent;

  const editArea = document.createElement('div');
  editArea.className = 'edit-area';
  editArea.id = `caption-${msgId}`;
  editArea.innerHTML = `
    <textarea id="edit-input-${msgId}" rows="1">${escapeHtml(currentCaption)}</textarea>
    <div class="edit-actions">
      <button class="edit-cancel" onclick="cancelEditCaption('${msgId}', ${JSON.stringify(currentCaption).replace(/'/g, "\\'")})">Cancel</button>
      <button class="edit-save" onclick="saveEditCaption('${msgId}')">Save</button>
    </div>
  `;
  captionEl.replaceWith(editArea);

  const input = document.getElementById(`edit-input-${msgId}`);
  input.focus();
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEditCaption(msgId); }
    if (e.key === 'Escape') cancelEditCaption(msgId, currentCaption);
  });
}

function cancelEdit(msgId, originalText) {
  const msgEl = document.querySelector(`[data-id="${msgId}"]`);
  const editArea = msgEl.querySelector('.edit-area');
  if (!editArea) return;
  const textDiv = document.createElement('div');
  textDiv.className = 'text';
  textDiv.id = `text-${msgId}`;
  textDiv.innerHTML = linkify(originalText);
  editArea.replaceWith(textDiv);
}

function cancelEditCaption(msgId, originalCaption) {
  const msgEl = document.querySelector(`[data-id="${msgId}"]`);
  const editArea = msgEl.querySelector('.edit-area');
  if (!editArea) return;
  const capDiv = document.createElement('div');
  capDiv.className = 'caption';
  capDiv.id = `caption-${msgId}`;
  capDiv.textContent = originalCaption;
  editArea.replaceWith(capDiv);
}

async function saveEdit(msgId) {
  const input = document.getElementById(`edit-input-${msgId}`);
  if (!input) return;
  const newText = input.value.trim();
  if (!newText) return;

  const editedAt = new Date().toISOString();

  // Update DOM
  const msgEl = document.querySelector(`[data-id="${msgId}"]`);
  const editArea = msgEl.querySelector('.edit-area');
  const textDiv = document.createElement('div');
  textDiv.className = 'text';
  textDiv.id = `text-${msgId}`;
  textDiv.innerHTML = linkify(newText);
  editArea.replaceWith(textDiv);

  // Add "edited" label if not present
  const meta = msgEl.querySelector('.meta');
  if (meta && !meta.querySelector('.edited-label')) {
    meta.insertAdjacentHTML('afterbegin', '<span class="edited-label">edited</span>');
  }

  // Update in Supabase
  const { error } = await sb.from('messages')
    .update({ text: newText, is_edited: true, edited_at: editedAt })
    .eq('id', msgId);
  if (error) console.error('Edit error:', error);

  // Broadcast edit
  channel.send({
    type: 'broadcast',
    event: 'edit-message',
    payload: { id: msgId, text: newText, is_edited: true, edited_at: editedAt, editedBy: myUsername, field: 'text' }
  });
}

async function saveEditCaption(msgId) {
  const input = document.getElementById(`edit-input-${msgId}`);
  if (!input) return;
  const newCaption = input.value.trim();

  const editedAt = new Date().toISOString();

  // Update DOM
  const msgEl = document.querySelector(`[data-id="${msgId}"]`);
  const editArea = msgEl.querySelector('.edit-area');
  const capDiv = document.createElement('div');
  capDiv.className = 'caption';
  capDiv.id = `caption-${msgId}`;
  capDiv.textContent = newCaption;
  editArea.replaceWith(capDiv);

  const meta = msgEl.querySelector('.meta');
  if (meta && !meta.querySelector('.edited-label')) {
    meta.insertAdjacentHTML('afterbegin', '<span class="edited-label">edited</span>');
  }

  const { error } = await sb.from('messages')
    .update({ caption: newCaption, is_edited: true, edited_at: editedAt })
    .eq('id', msgId);
  if (error) console.error('Edit caption error:', error);

  channel.send({
    type: 'broadcast',
    event: 'edit-message',
    payload: { id: msgId, caption: newCaption, is_edited: true, edited_at: editedAt, editedBy: myUsername, field: 'caption' }
  });
}

// ── Update message in DOM (from partner's edit broadcast) ───────
function updateMessageInDOM(payload) {
  const msgEl = document.querySelector(`[data-id="${payload.id}"]`);
  if (!msgEl) return;

  if (payload.field === 'text') {
    const textEl = msgEl.querySelector('.text') || document.getElementById(`text-${payload.id}`);
    if (textEl) textEl.innerHTML = linkify(payload.text);
  } else if (payload.field === 'caption') {
    const capEl = msgEl.querySelector('.caption') || document.getElementById(`caption-${payload.id}`);
    if (capEl) capEl.textContent = payload.caption;
  }

  // Add "edited" label
  const meta = msgEl.querySelector('.meta');
  if (meta && !meta.querySelector('.edited-label')) {
    meta.insertAdjacentHTML('afterbegin', '<span class="edited-label">edited</span>');
  }
}

// ═══════════════════════════════════════════════════════════════
// SEEN RECEIPTS
// ═══════════════════════════════════════════════════════════════
async function markAsSeen(messageId) {
  // Update in DB
  await sb.from('messages').update({ seen: true }).eq('id', messageId);
  // Broadcast
  channel.send({
    type: 'broadcast',
    event: 'seen',
    payload: { messageId, seenBy: myUsername }
  });
}

// ═══════════════════════════════════════════════════════════════
// IMAGE VIEWER + DOWNLOAD
// ═══════════════════════════════════════════════════════════════
let currentViewerUrl = '';
let currentViewerPath = '';

function openImageViewer(url, storagePath) {
  currentViewerUrl = url;
  currentViewerPath = storagePath;
  $viewerImg.src = url;
  $viewer.classList.remove('hidden');
}

function closeImageViewer() {
  $viewer.classList.add('hidden');
}

$viewerClose.onclick = closeImageViewer;
$viewer.onclick = (e) => {
  if (e.target === $viewer) closeImageViewer();
};

$viewerDlBtn.onclick = async (e) => {
  e.stopPropagation();
  try {
    // Fetch as blob to force download (handles CORS)
    const res = await fetch(currentViewerUrl);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    // Extract filename from path or URL
    const name = currentViewerPath
      ? currentViewerPath.split('/').pop()
      : currentViewerUrl.split('/').pop().split('?')[0];
    a.download = name || 'image';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  } catch (err) {
    // Fallback: open in new tab
    window.open(currentViewerUrl, '_blank');
  }
};

// ═══════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════════════
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$viewer.classList.contains('hidden')) closeImageViewer();
    if (!$previewOvl.classList.contains('hidden')) {
      $previewOvl.classList.add('hidden');
      pendingFile = null;
    }
  }
});
