// ===================== CONFIG =====================
function safeStorageGet(key) {
try { return localStorage.getItem(key); }
catch { return null; }
}

function safeStorageSet(key, value) {
try { localStorage.setItem(key, value); }
catch { /* Ignore storage access failures (privacy/tracking restrictions). */ }
}

function safeStorageRemove(key) {
try { localStorage.removeItem(key); }
catch { /* Ignore storage access failures (privacy/tracking restrictions). */ }
}

const APP_CONFIG = (() => {
  if (typeof window === 'undefined') return {};
  const candidate = window.GS_CONFIG;
  return candidate && typeof candidate === 'object' ? candidate : {};
})();

let API_URL = (() => {
const queryApi = (() => {
  try {
    return new URLSearchParams(window.location.search).get('api') || '';
  } catch {
    return '';
  }
})();
const configuredApi = String(APP_CONFIG.apiUrl || '').trim();
if (queryApi && /^https?:\/\//i.test(queryApi)) {
  return queryApi.replace(/\/+$/, '').replace(/\/api$/i, '') + '/api';
}
if (configuredApi && /^https?:\/\//i.test(configuredApi)) {
  return configuredApi.replace(/\/+$/, '').replace(/\/api$/i, '') + '/api';
}
const override = safeStorageGet('gs_api_url');
if (override && /^https?:\/\//i.test(override)) {
  return override.replace(/\/+$/, '').replace(/\/api$/i, '') + '/api';
}
const host = window.location.hostname;
if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:5001/api';
if (window.location.origin && /^https?:/i.test(window.location.origin)) {
  return `${window.location.origin.replace(/\/+$/, '')}/api`;
}
return 'https://global-sports-backend.onrender.com/api';
})();
const PAYSTACK_PUBLIC_KEY = String(APP_CONFIG.paystackPublicKey || 'pk_live_b53aa461435f588847cc2ed6ebbfd95b09a7b312').trim();

function getApiCandidates() {
const storedApi = safeStorageGet('gs_api_url') || null;
const host = String(window.location.hostname || '').toLowerCase();
const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
const configuredApi = String(APP_CONFIG.apiUrl || '').trim();
const queryApi = (() => {
  try {
    return new URLSearchParams(window.location.search).get('api') || '';
  } catch {
    return '';
  }
})();
const sameOriginApi = window.location.origin && /^https?:/i.test(window.location.origin)
  ? `${window.location.origin.replace(/\/+$/, '')}/api`
  : null;

const localCandidates = isLocal ? ['http://localhost:5001/api', 'http://localhost:5000/api'] : [];
const normalizeApiCandidate = (value) => {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw.replace(/\/+$/, '').replace(/\/api$/i, '') + '/api';
};

const list = [
normalizeApiCandidate(queryApi),
normalizeApiCandidate(configuredApi),
normalizeApiCandidate(storedApi),
normalizeApiCandidate(sameOriginApi),
API_URL,
'https://global-sports-backend.onrender.com/api',
...localCandidates
].filter(Boolean);
return [...new Set(list)];
}

async function parseJsonSafe(res) {
const text = await res.text();
if (!text) return null;
try { return JSON.parse(text); }
catch { return { message: text }; }
}

function looksLikeProductsPayload(data) {
const products = normalizeProductsPayload(data);
if (!Array.isArray(products)) return false;
if (!products.length) return true;
const sample = products[0] || {};
return typeof sample === 'object' && (
  'name' in sample || 'price' in sample || 'category' in sample
);
}

function normalizeProductsPayload(data) {
if (Array.isArray(data)) return data;
if (!data || typeof data !== 'object') return [];
if (Array.isArray(data.products)) return data.products;
if (Array.isArray(data.items)) return data.items;
if (Array.isArray(data.data)) return data.data;
if (data.data && Array.isArray(data.data.products)) return data.data.products;
return [];
}

async function fetchProductsFromBase(base) {
const res = await fetch(`${base}/products`, { cache: 'no-store' });
if (!res.ok) throw new Error(`HTTP ${res.status}`);

const contentType = String(res.headers.get('content-type') || '').toLowerCase();
if (!contentType.includes('application/json')) {
  throw new Error(`Expected JSON but got ${contentType || 'unknown content-type'}`);
}

const data = await res.json();
if (!looksLikeProductsPayload(data)) {
  throw new Error('Response is JSON but not a products payload');
}

return normalizeProductsPayload(data);
}

async function discoverApiUrl() {
for (const base of getApiCandidates()) {
try {
await fetchProductsFromBase(base);
API_URL = base;
safeStorageSet('gs_api_url', API_URL);
return;
} catch (err) {
console.warn(`Skipping API candidate ${base}:`, err.message);
// Try next candidate URL
}
}

// If none worked, clear stale override so next load can re-discover cleanly.
safeStorageRemove('gs_api_url');
}

function getSocketBase() {
return API_URL.replace(/\/api\/?$/, '');
}

function formatMoney(value) {
return Number(value || 0).toFixed(2);
}

function shortLocationLabel(addressText) {
const raw = String(addressText || '').trim();
if (!raw) return 'Location set';
const parts = raw.split(',').map(part => part.trim()).filter(Boolean);
if (!parts.length) return raw;
if (parts.length >= 3) return `${parts[0]}, ${parts[1]}`;
return parts.slice(0, 2).join(', ');
}

function renderDeliveryQuote(quote) {
const distanceEl = document.getElementById('deliveryDistance');
const feeEl = document.getElementById('deliveryFee');
const totalEl = document.getElementById('deliveryGrandTotal');
const noteEl = document.getElementById('deliveryQuoteNote');
const subtotal = cart.reduce((sum, item) => sum + Number(item.price || 0), 0);
const onlinePayment = subtotal;

if (distanceEl) {
distanceEl.textContent = quote?.requiresLocation ? 'Pin your location' : `${Number(quote.distanceKm || 0).toFixed(2)} km`;
}
if (feeEl) feeEl.textContent = `GHS ${formatMoney(quote?.deliveryFee)}`;
if (totalEl) totalEl.textContent = `GHS ${formatMoney(onlinePayment)}`;
if (noteEl) {
noteEl.textContent = quote?.requiresLocation
  ? 'Pin your location to estimate rider delivery fee (paid on delivery).'
  : quote.pricingZone === 'pickup'
    ? 'Pickup at the shop: no delivery fee is charged.'
    : quote.pricingZone === 'custom-quote'
      ? `Route estimate: about ${quote.durationMin || 0} min. This order is outside normal city bands, so price is by manual rider quote.`
      : `Route estimate: about ${quote.durationMin || 0} min. Dispatch band: ${quote.pricingZone ? quote.pricingZone.replace(/-/g, ' ') : 'standard'}. Delivery fee is paid to rider on delivery.`;
}
}

async function refreshDeliveryQuote() {
if (!selectedLocation?.lat || !selectedLocation?.lng) {
currentDeliveryQuote = null;
renderDeliveryQuote({ requiresLocation: true });
return null;
}

try {
const res = await fetch(`${API_URL}/delivery/quote?lat=${selectedLocation.lat}&lng=${selectedLocation.lng}`);
const data = await res.json();
if (!res.ok) throw new Error(data.message || 'Quote lookup failed');
currentDeliveryQuote = data;
renderDeliveryQuote(data);
return data;
} catch (err) {
console.error('Delivery quote failed:', err);
currentDeliveryQuote = null;
renderDeliveryQuote({ requiresLocation: true });
return null;
}
}

function showChatMessage(message) {
const list = document.getElementById('chatMessages');
if (!list) return;
const row = document.createElement('div');
row.className = `chat-message ${message.senderRole || 'customer'}${message.__pending ? ' pending' : ''}${message.__failed ? ' failed' : ''}`;
if (message.__messageKey) row.dataset.messageKey = message.__messageKey;
if (message.__pendingId) row.dataset.pendingId = message.__pendingId;
const meta = document.createElement('div');
meta.className = 'chat-message-meta';
const statusNote = message.__pending ? ' · Sending...' : (message.__failed ? ' · Failed' : '');
meta.textContent = `${message.senderName || 'Guest'} · ${new Date(message.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${statusNote}`;
const body = document.createElement('div');
body.className = 'chat-message-body';
body.textContent = message.text || '';
row.appendChild(meta);
row.appendChild(body);
list.appendChild(row);
list.scrollTop = list.scrollHeight;
}

function chatMessageKey(message) {
if (message?.id) return `id:${message.id}`;
const role = String(message?.senderRole || 'customer');
const name = String(message?.senderName || 'Guest');
const text = String(message?.text || '').trim();
const ts = message?.createdAt ? new Date(message.createdAt).toISOString() : '';
return `fp:${role}|${name}|${text}|${ts}`;
}

function appendChatMessageUnique(message) {
const key = chatMessageKey(message);
if (chatSeenMessageKeys.has(key)) return false;
chatSeenMessageKeys.add(key);
showChatMessage({ ...message, __messageKey: key });
return true;
}

function addPendingMessage(message, pendingId) {
const key = `pending:${pendingId}`;
chatSeenMessageKeys.add(key);
showChatMessage({
...message,
__messageKey: key,
__pendingId: pendingId,
__pending: true,
createdAt: new Date().toISOString()
});
}

function resolvePendingMessage(pendingId, serverMessage) {
const list = document.getElementById('chatMessages');
if (!list) return;
const row = list.querySelector(`[data-pending-id="${pendingId}"]`);
if (!row) {
appendChatMessageUnique(serverMessage);
return;
}

const serverKey = chatMessageKey(serverMessage);
row.dataset.messageKey = serverKey;
row.removeAttribute('data-pending-id');
row.className = `chat-message ${serverMessage.senderRole || 'customer'}`;
const meta = row.querySelector('.chat-message-meta');
const body = row.querySelector('.chat-message-body');
if (meta) {
meta.textContent = `${serverMessage.senderName || 'Guest'} · ${new Date(serverMessage.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
if (body) body.textContent = serverMessage.text || '';
chatSeenMessageKeys.delete(`pending:${pendingId}`);
chatSeenMessageKeys.add(serverKey);
}

function failPendingMessage(pendingId) {
const list = document.getElementById('chatMessages');
if (!list) return;
const row = list.querySelector(`[data-pending-id="${pendingId}"]`);
if (!row) return;
row.classList.remove('pending');
row.classList.add('failed');
const meta = row.querySelector('.chat-message-meta');
if (meta && !meta.textContent.includes('Failed')) meta.textContent += ' · Failed';
}

function renderChatHistory(messages) {
const list = document.getElementById('chatMessages');
if (!list) return;
list.innerHTML = '';
chatSeenMessageKeys.clear();
messages.forEach(msg => appendChatMessageUnique(msg));
if (!messages.length) {
list.innerHTML = '<div class="chat-empty">No messages yet. Start the conversation.</div>';
}
}

function emitWithAck(socket, eventName, payload, timeoutMs = 10000) {
return new Promise((resolve) => {
if (!socket || !socket.connected) {
resolve({ ok: false, message: 'Socket not connected' });
return;
}

let done = false;
const timer = setTimeout(() => {
if (done) return;
done = true;
resolve({ ok: false, message: 'Timed out waiting for server response' });
}, timeoutMs);

socket.emit(eventName, payload, (ack) => {
if (done) return;
done = true;
clearTimeout(timer);
resolve(ack || { ok: false, message: 'No acknowledgment received' });
});
});
}

function canShowBrowserNotifications() {
return typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted';
}

function maybeEnableBrowserNotifications() {
if (typeof window === 'undefined' || !('Notification' in window)) return;
if (Notification.permission !== 'default') return;
// This is called from a user-triggered action (opening chat), so browsers allow it.
Notification.requestPermission().catch(() => {});
}

function playChatNotificationTone() {
try {
const AudioCtx = window.AudioContext || window.webkitAudioContext;
if (!AudioCtx) return;
const ctx = new AudioCtx();
const osc = ctx.createOscillator();
const gain = ctx.createGain();
osc.type = 'sine';
osc.frequency.setValueAtTime(880, ctx.currentTime);
gain.gain.setValueAtTime(0.0001, ctx.currentTime);
gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.01);
gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
osc.connect(gain);
gain.connect(ctx.destination);
osc.start();
osc.stop(ctx.currentTime + 0.2);
} catch {
// Ignore notification tone failures silently.
}
}

function notifyIncomingChatMessage(message) {
const ctx = activeChat || chatSubscriptionContext;
if (!ctx) return;
if ((message?.senderRole || '') === (ctx.role || '')) return;

const sender = message?.senderName || (message?.senderRole === 'rider' ? 'Rider' : 'Customer');
showToast(`New message from ${sender}`, 'success');
playChatNotificationTone();

if (document.hidden && canShowBrowserNotifications()) {
try {
new Notification(`New message from ${sender}`, {
body: String(message?.text || '').slice(0, 140),
tag: `chat-${ctx.reference}`,
renotify: true
});
} catch {
// Ignore browser notification failures.
}
}
}

function totalUnreadChatCount() {
let total = 0;
chatUnreadCounts.forEach((count) => {
  total += Number(count) || 0;
});
return Math.max(0, total);
}

function updateUnreadBadgeElement(id, count) {
const el = document.getElementById(id);
if (!el) return;
const safeCount = Math.max(0, Number(count) || 0);
if (safeCount > 0) {
  el.textContent = safeCount > 99 ? '99+' : String(safeCount);
  el.style.display = 'inline-flex';
} else {
  el.textContent = '0';
  el.style.display = 'none';
}
}

function refreshGlobalChatBadges() {
const total = totalUnreadChatCount();
updateUnreadBadgeElement('trackChatAlertBadge', total);
updateUnreadBadgeElement('riderChatAlertBadge', total);
updateUnreadBadgeElement('myDeliveriesChatCount', total);
}

function getStoredChatSeenTotals() {
try {
  const raw = safeStorageGet('gs_chat_seen_totals');
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === 'object' ? parsed : {};
} catch {
  return {};
}
}

function persistChatSeenTotals() {
try {
  const payload = {};
  chatSeenTotals.forEach((count, reference) => {
    payload[reference] = Math.max(0, Number(count) || 0);
  });
  safeStorageSet('gs_chat_seen_totals', JSON.stringify(payload));
} catch {
  // Ignore storage failures.
}
}

function getChatSeenCount(reference) {
if (!reference) return 0;
return chatSeenTotals.get(reference) || 0;
}

function setChatSeenCount(reference, count) {
if (!reference) return;
const safeCount = Math.max(0, Number(count) || 0);
chatSeenTotals.set(reference, safeCount);
persistChatSeenTotals();
}

function markChatAsRead(reference, totalCount) {
if (!reference) return;
const safeTotal = Math.max(0, Number(totalCount) || 0);
setChatSeenCount(reference, safeTotal);
setChatUnreadCount(reference, 0);
}

function syncChatUnreadFromTotal(reference, totalCount, lastSenderRole, currentRole) {
if (!reference) return 0;
const safeTotal = Math.max(0, Number(totalCount) || 0);
chatMessageTotals.set(reference, safeTotal);
const seen = getChatSeenCount(reference);
const unread = Math.max(0, safeTotal - seen);
setChatUnreadCount(reference, unread);
return unread;
}

function getChatUnreadCount(reference) {
if (!reference) return 0;
return chatUnreadCounts.get(reference) || 0;
}

function setChatUnreadCount(reference, count) {
if (!reference) return;
const safeCount = Math.max(0, Number(count) || 0);
if (safeCount === 0) {
chatUnreadCounts.delete(reference);
} else {
chatUnreadCounts.set(reference, safeCount);
}
refreshChatUnreadIndicators();
}

function incrementChatUnreadCount(reference) {
setChatUnreadCount(reference, getChatUnreadCount(reference) + 1);
}

function clearChatUnreadCount(reference) {
setChatUnreadCount(reference, 0);
}

function formatChatButtonLabel(base, unreadCount) {
return unreadCount > 0 ? `${base} (${unreadCount})` : base;
}

function refreshTrackChatUnreadIndicator() {
const chatActions = document.getElementById('trackChatActions');
const chatBtn = chatActions?.querySelector('button');
if (!chatBtn || !currentTrackData?.reference) return;
const baseLabel = currentTrackData.riderName ? 'Chat with Rider' : 'Open Support Chat';
const unread = getChatUnreadCount(currentTrackData.reference);
chatBtn.textContent = formatChatButtonLabel(baseLabel, unread);
}

function refreshRiderChatUnreadIndicators() {
const buttons = document.querySelectorAll('#myOrdersList .chat-btn[data-chat-reference]');
buttons.forEach((btn) => {
const reference = btn.getAttribute('data-chat-reference') || '';
const base = btn.getAttribute('data-chat-base-label') || '💬 Chat';
btn.textContent = formatChatButtonLabel(base, getChatUnreadCount(reference));
});
}

function refreshChatUnreadIndicators() {
refreshTrackChatUnreadIndicator();
refreshRiderChatUnreadIndicators();
refreshGlobalChatBadges();
}

function handleTrackChatMeta(reference, messageCount, lastSenderRole, source = 'poll') {
if (!reference) return;
const nextCount = Math.max(0, Number(messageCount) || 0);
chatMessageTotals.set(reference, nextCount);
const isModalViewingThisChat = chatModalOpen && activeChat?.reference === reference;
if (isModalViewingThisChat) {
  markChatAsRead(reference, nextCount);
  return;
}

if (String(lastSenderRole || '') === 'customer') {
  refreshChatUnreadIndicators();
  return;
}

const seen = getChatSeenCount(reference);
const unread = Math.max(0, nextCount - seen);
setChatUnreadCount(reference, unread);

if (unread === 0) {
  return;
}

showToast(source === 'poll' ? 'New message from rider' : 'New message', 'success');
playChatNotificationTone();
if (document.hidden && canShowBrowserNotifications()) {
  try {
    new Notification('New message from rider', {
      body: 'Open chat to view the latest update.',
      tag: `chat-${reference}`,
      renotify: true
    });
  } catch {
    // Ignore browser notification failures.
  }
}
}

function buildChatHistoryUrl(context) {
const params = new URLSearchParams();
params.set('role', context.role || 'customer');
if (context.role === 'customer') {
  if (context.chatToken) params.set('chatToken', context.chatToken);
} else if (context.token) {
  params.set('token', context.token);
}
return `${API_URL}/chat/${encodeURIComponent(context.reference)}/messages?${params.toString()}`;
}

async function loadChatHistory(context, allowRetry = true) {
const listEl = document.getElementById('chatMessages');
if (!listEl) return;
try {
const res = await fetch(buildChatHistoryUrl(context));
const data = await parseJsonSafe(res);
if (!res.ok) throw new Error(data?.message || `Chat history failed (${res.status})`);
if (context?.role === 'customer' && data?.chatToken && context?.reference) {
  safeStorageSet(`gs_chat_token_${context.reference}`, data.chatToken);
  if (activeChat?.reference === context.reference) {
    activeChat = { ...activeChat, chatToken: data.chatToken };
    chatSubscriptionContext = { ...chatSubscriptionContext, chatToken: data.chatToken };
  }
}
renderChatHistory(data?.messages || []);
if (context?.reference) {
  const total = Array.isArray(data?.messages) ? data.messages.length : 0;
  chatMessageTotals.set(context.reference, total);
  if (chatModalOpen && activeChat?.reference === context.reference) {
    markChatAsRead(context.reference, total);
  }
}
} catch (err) {
const isInvalidToken = String(err?.message || '').toLowerCase().includes('invalid chat token');
if (allowRetry && context?.role === 'customer' && isInvalidToken) {
  try {
    const fresh = await fetchTrackData(context.reference);
    if (fresh?.chatToken) {
      const refreshedContext = { ...context, chatToken: fresh.chatToken };
      if (activeChat?.reference === context.reference) {
        activeChat = refreshedContext;
        chatSubscriptionContext = refreshedContext;
      }
      safeStorageSet(`gs_chat_token_${context.reference}`, fresh.chatToken);
      await loadChatHistory(refreshedContext, false);
      return;
    }
  } catch {
    // Fall through to user-visible error below.
  }
}
listEl.innerHTML = `<div class="chat-empty">${escHtml(err.message || 'Could not load chat history')}</div>`;
}
}

async function openChatModal(context) {
if (!context?.reference) {
console.error('❌ Chat: No reference provided');
return;
}
activeChat = context;
chatSubscriptionContext = { ...context };
chatModalOpen = true;
chatIsJoined = false;
chatSeenMessageKeys.clear();
clearChatUnreadCount(context.reference);
const titleEl = document.getElementById('chatModalTitle');
const contextEl = document.getElementById('chatContext');
const listEl = document.getElementById('chatMessages');
const overlayEl = document.getElementById('chatOverlay');

if (!overlayEl) {
console.error('❌ Chat: Modal elements not found in DOM');
showToast('Chat UI not available', 'error');
return;
}

if (titleEl) titleEl.textContent = context.title || 'Live Chat';
if (contextEl) contextEl.textContent = context.subtitle || `Order ${context.reference}`;
if (listEl) listEl.innerHTML = '<div class="chat-empty">Loading chat…</div>';
const toolsEl = document.getElementById('chatTools');
if (toolsEl) toolsEl.style.display = context.role === 'customer' ? 'flex' : 'none';
overlayEl.classList.add('open');
document.body.classList.add('chat-modal-open');
setTrackMapInteraction(false);
maybeEnableBrowserNotifications();

console.log('📋 Chat context:', {reference: context.reference, role: context.role, name: context.name});

// Always load REST history first
await loadChatHistory(context);

const contextForJoin = (activeChat && activeChat.reference === context.reference) ? activeChat : context;

// Try to connect Socket.IO
if (chatSocket) {
chatSocket.disconnect();
chatSocket = null;
}

// Check if io is available
if (typeof io === 'undefined') {
console.error('❌ Chat: Socket.IO library not loaded');
if (listEl && !listEl.querySelector('.chat-message')) {
listEl.innerHTML = `<div class="chat-empty">Connected via HTTP. Messages will sync when you send them.</div>`;
}
return;
}

const socketBase = getSocketBase();
console.log('📡 Chat: Attempting Socket.IO connection to', socketBase);

try {
chatSocket = io(socketBase, { 
transports: ['websocket', 'polling'], 
reconnection: true,
reconnectionDelay: 1000, 
reconnectionAttempts: 5,
timeout: 5000
});
} catch (err) {
console.error('❌ Chat: Failed to initialize Socket.IO:', err.message);
return;
}

let socketConnected = false;
let joinAttempted = false;

async function retryCustomerChatJoin() {
if (context.role !== 'customer' || context.__retryingTokenRefresh) return false;
try {
  const latest = await fetchTrackData(context.reference);
  if (!latest?.chatToken) return false;
  const refreshedContext = {
    ...context,
    chatToken: latest.chatToken,
    __retryingTokenRefresh: true
  };
  safeStorageSet(`gs_chat_token_${context.reference}`, latest.chatToken);
  if (chatSocket) chatSocket.disconnect();
  await openChatModal(refreshedContext);
  return true;
} catch (err) {
  console.error('❌ Chat token refresh failed:', err.message);
  return false;
}
}

chatSocket.on('connect', () => {
socketConnected = true;
console.log('✅ Chat Socket Connected:', chatSocket.id);

if (!joinAttempted) {
joinAttempted = true;
emitWithAck(chatSocket, 'chat:join', {
reference: contextForJoin.reference,
role: contextForJoin.role,
token: contextForJoin.token || null,
chatToken: contextForJoin.chatToken || null,
name: contextForJoin.name || ''
}).then((ack) => {
if (!ack?.ok) {
console.error('❌ Chat join failed:', ack?.message);
const invalidToken = String(ack?.message || '').toLowerCase().includes('invalid chat token');
if (invalidToken) {
  retryCustomerChatJoin().then((retried) => {
    if (retried) return;
    if (listEl) listEl.innerHTML = `<div class="chat-empty">${escHtml(ack?.message || 'Could not open chat')}</div>`;
    showToast('Chat failed: ' + (ack?.message || 'Unknown error'), 'error');
  });
  return;
}
if (listEl) listEl.innerHTML = `<div class="chat-empty">${escHtml(ack?.message || 'Could not open chat')}</div>`;
showToast('Chat failed: ' + (ack?.message || 'Unknown error'), 'error');
} else {
console.log('✅ Joined chat room for order:', context.reference);
if (contextForJoin.role === 'customer' && ack.chatToken && contextForJoin.reference) {
  safeStorageSet(`gs_chat_token_${contextForJoin.reference}`, ack.chatToken);
  if (activeChat?.reference === contextForJoin.reference) {
    activeChat = { ...activeChat, chatToken: ack.chatToken };
    chatSubscriptionContext = { ...chatSubscriptionContext, chatToken: ack.chatToken };
  }
}
chatIsJoined = true;
chatSubscriptionContext = { ...context };
}
});
}
});

chatSocket.on('chat:history', (payload) => {
if (!activeChat || payload.reference !== activeChat.reference) return;
console.log('📨 Received chat history:', payload.messages?.length || 0, 'messages');
// Don't overwrite if we already have messages from REST
if (listEl && listEl.querySelector('.chat-message')) {
console.log('💡 Chat: Keeping existing REST-loaded messages');
return;
}
renderChatHistory(payload.messages || []);
});

chatSocket.on('chat:message', (payload) => {
if (!chatSubscriptionContext || payload.reference !== chatSubscriptionContext.reference) return;
console.log('💬 New message from socket:', payload.senderName);
const appended = appendChatMessageUnique(payload);
if (!appended) return;

const currentTotal = chatMessageTotals.get(payload.reference) || 0;
chatMessageTotals.set(payload.reference, currentTotal + 1);

const isIncoming = (payload.senderRole || '') !== (chatSubscriptionContext.role || '');
const isModalViewingThisChat = chatModalOpen && activeChat?.reference === payload.reference;
if (isIncoming && !isModalViewingThisChat) {
incrementChatUnreadCount(payload.reference);
}

notifyIncomingChatMessage(payload);
});

chatSocket.on('chat:cleared', (payload) => {
if (!activeChat || payload.reference !== activeChat.reference) return;
chatSeenMessageKeys.clear();
if (listEl) listEl.innerHTML = '<div class="chat-empty">Chat cleared.</div>';
if (payload.byRole !== (activeChat.role || 'customer')) {
  showToast('Chat was cleared by customer', 'success');
}
});

chatSocket.on('disconnect', () => {
socketConnected = false;
chatIsJoined = false;
console.log('⚠️ Chat Socket Disconnected');
});

chatSocket.on('connect_error', (err) => {
socketConnected = false;
console.error('❌ Chat Connection Error:', err.message);
if (listEl && !listEl.querySelector('.chat-message')) {
listEl.innerHTML = `<div class="chat-empty">📌 Using HTTP mode (slower). Messages will sync when you send them.</div>`;
}
});

chatSocket.on('error', (err) => {
console.error('❌ Chat Socket Error:', err);
});

// Setup mobile keyboard handlers for this chat session
setTimeout(() => setupChatInputMobileHandlers(), 100);
}

// Mobile keyboard handler for iOS
function setupChatInputMobileHandlers() {
const input = document.getElementById('chatInput');
if (!input) return;

const compose = document.querySelector('.chat-compose');
const modal = document.querySelector('.chat-modal');

if (input.dataset.mobileHandlersSetup === 'true') return;
input.dataset.mobileHandlersSetup = 'true';

// Handle focus - scroll input into view on mobile keyboards
input.addEventListener('focus', (e) => {
  if (!/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) return;
  
  // Prevent zoom on input focus
  input.style.fontSize = '16px';
  
  setTimeout(() => {
    if (compose && modal) {
      const rect = compose.getBoundingClientRect();
      const modalRect = modal.getBoundingClientRect();
      
      // If compose is below viewport, scroll it into view
      if (rect.bottom > window.innerHeight) {
        compose.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    }
  }, 100);
}, { passive: true });

// Handle blur - restore styles
input.addEventListener('blur', () => {
  input.style.fontSize = '16px';
}, { passive: true });
}

function closeChatModal() {
document.getElementById('chatOverlay').classList.remove('open');
document.body.classList.remove('chat-modal-open');
setTrackMapInteraction(true);
chatModalOpen = false;
if (activeChat?.reference) clearChatUnreadCount(activeChat.reference);
activeChat = null;
chatSeenMessageKeys.clear();
if (trackMap) {
setTimeout(() => {
  try { trackMap.invalidateSize(); } catch { /* no-op */ }
}, 120);
}
}

function handleChatOverlayClick(e) {
if (e.target === document.getElementById('chatOverlay')) {
closeChatModal();
}
}

async function sendChatMessage() {
if (!activeChat) return;
const input = document.getElementById('chatInput');
const text = (input?.value || '').trim();
if (!text) return;

const message = {
reference: activeChat.reference,
senderRole: activeChat.role,
senderName: activeChat.name || 'Guest',
text,
chatToken: activeChat.chatToken || null,
token: activeChat.token || null
};

const pendingId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
addPendingMessage(message, pendingId);
if (input) input.value = '';

// Try socket first (realtime)
if (chatSocket && chatSocket.connected && chatIsJoined) {
console.log('📤 Sending via Socket.IO...');
const ack = await emitWithAck(chatSocket, 'chat:message', message, 10000);
if (!ack?.ok) {
console.error('❌ Socket send failed:', ack?.message);
showToast(ack?.message || 'Could not send message', 'error');
failPendingMessage(pendingId);
return;
}
resolvePendingMessage(pendingId, ack.message || {
reference: activeChat.reference,
senderRole: message.senderRole,
senderName: message.senderName,
text: message.text,
createdAt: new Date().toISOString()
});
markChatAsRead(activeChat.reference, chatMessageTotals.get(activeChat.reference) || 0);
} else {
// Fallback to HTTP
console.log('📤 Socket not connected, sending via HTTP...');
try {
const res = await fetch(`${API_URL}/chat/${encodeURIComponent(activeChat.reference)}/messages`, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(message)
});
const data = await res.json();
if (!res.ok) throw new Error(data.message || 'Could not send message');
console.log('✅ Message sent via HTTP');
resolvePendingMessage(pendingId, data?.chatMessage || {
reference: activeChat.reference,
senderRole: message.senderRole,
senderName: message.senderName,
text: message.text,
createdAt: new Date().toISOString()
});
markChatAsRead(activeChat.reference, chatMessageTotals.get(activeChat.reference) || 0);
} catch (err) {
console.error('❌ HTTP send failed:', err.message);
showToast(err.message, 'error');
failPendingMessage(pendingId);
}
}

async function deleteActiveChatHistory() {
if (!activeChat?.reference) return;
if (activeChat.role !== 'customer') {
  showToast('Only customers can clear this chat', 'error');
  return;
}
const confirmed = window.confirm('Delete this chat history? This cannot be undone.');
if (!confirmed) return;

try {
  const res = await fetch(`${API_URL}/chat/${encodeURIComponent(activeChat.reference)}/clear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      senderRole: 'customer',
      chatToken: activeChat.chatToken || safeStorageGet(`gs_chat_token_${activeChat.reference}`) || null,
      token: activeChat.chatToken || safeStorageGet(`gs_chat_token_${activeChat.reference}`) || null
    })
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(data?.message || 'Could not clear chat');

  chatSeenMessageKeys.clear();
  const listEl = document.getElementById('chatMessages');
  if (listEl) listEl.innerHTML = '<div class="chat-empty">Chat cleared.</div>';
  removeSavedTrackChat(activeChat.reference);
  updateRecentChatShortcut();
  showToast('Chat deleted', 'success');
} catch (err) {
  showToast(err.message || 'Could not clear chat', 'error');
}
}
}

// ===================== STATE =====================
let allProducts    = [];
let cart           = [];
let riderToken     = localStorage.getItem('gs_rider_token') || null;
let riderInfo      = JSON.parse(localStorage.getItem('gs_rider_info') || 'null');
let editingProduct = null;
let selectedLocation = null;
let checkoutMap    = null;
let checkoutMarker = null;
let riderSSE       = null;
let dismissedOrders = new Set();
let pendingProductId = null;
let selectedSize     = null;
let currentSearchQuery = '';
let currentCategory    = '';
let currentSortMode    = 'featured';
let currentDeliveryQuote = null;
let cartStockValidationTimer = null;
let cartStockValidationSeq = 0;
let chatSocket = null;
let activeChat = null;
let chatModalOpen = false;
let chatSubscriptionContext = null;
let chatIsJoined = false;
const chatUnreadCounts = new Map();
const chatMessageTotals = new Map();
const chatSeenTotals = new Map(Object.entries(getStoredChatSeenTotals()).map(([reference, count]) => [reference, Math.max(0, Number(count) || 0)]));
const chatSeenMessageKeys = new Set();
// Tracking state
let trackMap         = null;
let trackRiderMarker = null;
let trackCustMarker  = null;
let trackRouteLayer  = null;
let trackInterval    = null;
let currentTrackRef  = null;
let currentTrackData  = null;
// Rider GPS sharing state
let riderGPSWatch    = null;
let riderActiveOrder = null;
const LAST_TRACKED_REFERENCE_KEY = 'gs_last_tracked_reference';
const SAVED_TRACKS_KEY = 'gs_saved_tracks';

const SHOP_PICKUP_LOCATION = {
lat: 6.7068,
lng: -1.6398,
address: 'Global Sports Store, Kumasi-Tanoso (near AAMUSTED)'
};

// ===================== INIT =====================
window.addEventListener('DOMContentLoaded', async () => {
console.log('🚀 Global Sports app initializing...');
console.log('📍 API candidates:', getApiCandidates());
console.log('ℹ️ Open browser console (F12) to see debug messages');

setTimeout(() => {
document.getElementById('loader').classList.add('hidden');
}, 1300);

await discoverApiUrl();
console.log('✅ API URL detected:', API_URL);
console.log('🔌 Socket.IO base:', getSocketBase());
console.log('📦 Socket.IO library available:', typeof io !== 'undefined' ? '✅' : '❌');

fetchProducts();

const addressInput = document.getElementById('custAddress');
if (addressInput) {
addressInput.addEventListener('blur', () => geocodeAddress(addressInput.value));
addressInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    geocodeAddress(addressInput.value);
  }
});
}

if (riderToken && riderInfo) {
showRiderNav(true);
document.getElementById('riderWelcome').textContent = `Welcome, ${riderInfo.fullName}`;
connectRiderSSE();
}

updateRecentChatShortcut();
});

// ===================== TOAST =====================
function showToast(msg, type = '') {
const t = document.getElementById('toast');
t.textContent = msg;
t.className = `toast show ${type}`;
setTimeout(() => { t.className = 'toast'; }, 3500);
}

function setTrackMapInteraction(enabled) {
if (!trackMap) return;
const action = enabled ? 'enable' : 'disable';
try { if (trackMap.dragging && trackMap.dragging[action]) trackMap.dragging[action](); } catch {}
try { if (trackMap.touchZoom && trackMap.touchZoom[action]) trackMap.touchZoom[action](); } catch {}
try { if (trackMap.doubleClickZoom && trackMap.doubleClickZoom[action]) trackMap.doubleClickZoom[action](); } catch {}
try { if (trackMap.scrollWheelZoom && trackMap.scrollWheelZoom[action]) trackMap.scrollWheelZoom[action](); } catch {}
try { if (trackMap.boxZoom && trackMap.boxZoom[action]) trackMap.boxZoom[action](); } catch {}
try { if (trackMap.keyboard && trackMap.keyboard[action]) trackMap.keyboard[action](); } catch {}
if (trackMap.tap) {
  try { if (trackMap.tap[action]) trackMap.tap[action](); } catch {}
}
}

function getSavedTrackChats() {
try {
  const raw = safeStorageGet(SAVED_TRACKS_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];

  const unique = [];
  const seen = new Set();
  for (const item of parsed) {
    const reference = normalizeChatReference(item?.reference);
    if (!reference || seen.has(reference)) continue;
    seen.add(reference);
    unique.push({
      ...item,
      reference,
      updatedAt: item.updatedAt || new Date().toISOString()
    });
  }

  return unique.sort((a, b) => {
    const left = new Date(b.updatedAt || 0).getTime();
    const right = new Date(a.updatedAt || 0).getTime();
    if (left !== right) return left - right;
    return String(b.reference || '').localeCompare(String(a.reference || ''));
  });
} catch {
  return [];
}
}

function saveTrackedChat(data) {
const reference = normalizeChatReference(data?.reference);
if (!reference) return;

const remaining = getSavedTrackChats().filter((item) => normalizeChatReference(item.reference) !== reference);
const nextItem = {
  reference,
  riderName: data.riderName || null,
  customerName: data.customerName || null,
  chatToken: data.chatToken || safeStorageGet(`gs_chat_token_${reference}`) || null,
  status: data.status || null,
  updatedAt: new Date().toISOString()
};

safeStorageSet(SAVED_TRACKS_KEY, JSON.stringify([nextItem, ...remaining].slice(0, 8)));
safeStorageSet(LAST_TRACKED_REFERENCE_KEY, reference);
}

function removeSavedTrackChat(reference) {
const normalized = normalizeChatReference(reference);
if (!normalized) return;

const remaining = getSavedTrackChats().filter((item) => normalizeChatReference(item.reference) !== normalized);
safeStorageSet(SAVED_TRACKS_KEY, JSON.stringify(remaining));
const lastTracked = normalizeChatReference(safeStorageGet(LAST_TRACKED_REFERENCE_KEY));
if (lastTracked === normalized) {
  safeStorageRemove(LAST_TRACKED_REFERENCE_KEY);
}
}

function updateRecentChatShortcut(data) {
const card = document.getElementById('savedChatsCard');
const refEl = document.getElementById('recentChatRef');
const listEl = document.getElementById('savedChatList');
if (!card || !refEl || !listEl) return;

const saved = data?.reference ? (() => {
  saveTrackedChat(data);
  return getSavedTrackChats();
})() : getSavedTrackChats();

if (!saved.length) {
  card.style.display = 'none';
  return;
}

refEl.textContent = saved.length === 1 ? '1 saved chat' : `${saved.length} saved chats`;
listEl.innerHTML = saved.map((item) => {
  const title = item.riderName ? `Chat with ${escHtml(item.riderName)}` : 'Open Chat';
  return `
    <div class="saved-chat-item" data-chat-reference="${escHtml(item.reference)}">
      <span class="saved-chat-item-main">
        <button type="button" class="saved-chat-open" onclick="openSavedChat('${escHtml(item.reference)}')">
          <strong>${title}</strong>
          <small>Order ${escHtml(item.reference)}</small>
        </button>
      </span>
      <span class="saved-chat-item-actions">
        <button type="button" class="saved-chat-item-action" onclick="openSavedChat('${escHtml(item.reference)}')">Open</button>
        <button type="button" class="saved-chat-item-delete" onclick="deleteSavedChat('${escHtml(item.reference)}')">Delete</button>
      </span>
    </div>
  `;
}).join('');
card.style.display = 'block';
}

function deleteSavedChat(reference) {
const normalizedReference = normalizeChatReference(reference);
if (!normalizedReference) return;

const confirmed = window.confirm('Delete this saved chat from your device?');
if (!confirmed) return;

removeSavedTrackChat(normalizedReference);
safeStorageRemove(`gs_chat_token_${normalizedReference}`);

if (currentTrackData?.reference && normalizeChatReference(currentTrackData.reference) === normalizedReference) {
  currentTrackData = { ...currentTrackData, chatToken: null };
}

updateRecentChatShortcut();
showToast('Saved chat deleted', 'success');
}

async function resumeLastTrackedChat() {
const reference = normalizeChatReference(currentTrackData?.reference || safeStorageGet(LAST_TRACKED_REFERENCE_KEY) || '');
if (!reference) {
  showToast('Track an order first to open chat quickly', 'error');
  return;
}

let data = currentTrackData;
if (!data || normalizeChatReference(data.reference) !== reference) {
  data = await fetchTrackData(reference);
}

if (!data) {
  showToast('Could not load the last tracked order', 'error');
  return;
}

currentTrackData = data;
saveTrackedChat(data);
updateRecentChatShortcut(data);
openCustomerChatFromTrack();
}

async function openSavedChat(reference) {
const normalizedReference = normalizeChatReference(reference);
const saved = getSavedTrackChats().find(item => normalizeChatReference(item.reference) === normalizedReference);
if (!saved) {
  showToast('Saved chat not found', 'error');
  return;
}

let data = currentTrackData && normalizeChatReference(currentTrackData.reference) === normalizedReference ? currentTrackData : null;
if (!data) data = await fetchTrackData(normalizedReference);
if (!data) {
  showToast('Could not load saved chat order', 'error');
  return;
}

currentTrackData = { ...data, reference: normalizedReference, chatToken: data.chatToken || saved.chatToken || null };
if (currentTrackData.chatToken) safeStorageSet(`gs_chat_token_${normalizedReference}`, currentTrackData.chatToken);
saveTrackedChat(currentTrackData);
updateRecentChatShortcut(currentTrackData);
openCustomerChatFromTrack();
}

// ===================== SECTION ROUTING =====================
function showSection(name) {
document.body.classList.remove('chat-modal-open');
document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

const sectionMap = {
shop:       'shopSection',
riderLogin: 'riderLoginSection',
riderDash:  'riderDashSection',
track:      'trackSection'
};
const navMap = {
shop:      'navShop',
riderDash: 'navRiderDash',
track:     'navTrack'
};

const section = document.getElementById(sectionMap[name]);
if (section) section.classList.add('active');
const navBtn = document.getElementById(navMap[name]);
if (navBtn) navBtn.classList.add('active');

if (name === 'track' && trackMap) {
setTimeout(() => {
  try { trackMap.invalidateSize(); } catch { /* no-op */ }
}, 120);
}

if (name === 'riderDash') { loadAvailableOrders(); loadMyOrders(); }
}

function showRiderNav(show) {
document.getElementById('navRiderDash').style.display  = show ? '' : 'none';
document.getElementById('navRiderLogin').style.display = show ? 'none' : '';
}

// ===================== AUTH TABS (rider login/register) =====================
function switchAuthTab(formId, btn) {
document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
btn.classList.add('active');
document.getElementById('riderLoginForm').style.display    = formId === 'riderLoginForm' ? '' : 'none';
document.getElementById('riderRegisterForm').style.display = formId === 'riderRegisterForm' ? '' : 'none';
}

// ===================== PRODUCTS =====================
async function fetchProducts() {
try {
allProducts = await fetchProductsFromBase(API_URL);
applyProductView();
} catch (err) {
console.error('Error fetching products:', err);
try {
  await discoverApiUrl();
  allProducts = await fetchProductsFromBase(API_URL);
  applyProductView();
  return;
} catch (retryErr) {
  console.error('Retry fetching products failed:', retryErr);
}

document.getElementById('productsGrid').innerHTML =
`<div class="empty-state"><p>Could not load products right now. Check backend deployment/API URL.</p></div>`;
}
}

function applyProductView() {
let items = [...allProducts];

if (currentCategory) {
items = items.filter(p => p.category === currentCategory);
}

if (currentSearchQuery) {
const q = currentSearchQuery.toLowerCase().trim();
items = items.filter(p => {
const name = (p.name || '').toLowerCase();
const cat  = (p.category || '').toLowerCase();
const desc = (p.description || '').toLowerCase();
return name.includes(q) || cat.includes(q) || desc.includes(q);
});
}

items = getSortedProducts(items, currentSortMode);
renderProducts(items);
updateShopMeta(items.length);
}

function getSortedProducts(items, mode) {
const sorted = [...items];

if (mode === 'priceLow') {
sorted.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
return sorted;
}
if (mode === 'priceHigh') {
sorted.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
return sorted;
}
if (mode === 'nameAZ') {
sorted.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
return sorted;
}

return sorted;
}

function updateShopMeta(count) {
const el = document.getElementById('shopMeta');
if (!el) return;

const categoryLabel = currentCategory ? currentCategory : 'All Categories';
const searchLabel = currentSearchQuery ? ` | Search: "${currentSearchQuery}"` : '';
el.textContent = `${count} product${count === 1 ? '' : 's'} in ${categoryLabel}${searchLabel}`;
}

function renderProducts(products) {
const grid = document.getElementById('productsGrid');
if (!products.length) {
grid.innerHTML = ` <div class="empty-state"> <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 12V6H4v6"/><path d="M2 6h20"/><path d="M12 6V2"/><rect x="2" y="12" width="20" height="10" rx="2"/></svg> <p>No products found in this category.</p> </div>`;
return;
}
grid.innerHTML = products.map(p => {
const imgHtml = p.image
? `<img class="product-card-img" src="${escHtml(p.image)}" alt="${escHtml(p.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
: '';
const placeholderStyle = p.image ? 'style="display:none"' : '';
const stockBadge   = (p.stock !== undefined && p.stock === 0) ? `<span class="out-of-stock-badge">Out of Stock</span>` : '';
const disabledAttr = (p.stock !== undefined && p.stock === 0) ? 'disabled title="Out of stock"' : '';
const hasSizes     = p.sizeType && p.sizeType !== 'none' && p.sizes && p.sizes.length > 0;
const sizeDots     = hasSizes ? p.sizes.slice(0,5).map(function(s){ return '<span class="size-dot">' + escHtml(s) + '</span>'; }).join('') : '';
const sizeMore     = hasSizes && p.sizes.length > 5 ? '<span class="size-dot">+' + (p.sizes.length - 5) + '</span>' : '';
const sizesPreview = hasSizes ? '<div class="product-sizes-preview">' + sizeDots + sizeMore + '</div>' : '';

return `
  <div class="product-card" data-id="${p._id}">
    ${stockBadge}
    ${imgHtml}
    <div class="product-card-img placeholder" ${placeholderStyle}>🏅</div>
    <div class="product-card-body">
      <span class="product-category">${escHtml(p.category || '')}</span>
      <div class="product-name">${escHtml(p.name)}</div>
      ${p.description ? `<div class="product-desc">${escHtml(p.description)}</div>` : ''}
      ${sizesPreview}
    </div>
    <div class="product-footer">
      <div class="product-price"><span>GHS</span> ${Number(p.price).toFixed(2)}</div>
      <button class="add-to-cart-btn" data-product-id="${p._id}" ${disabledAttr}>
        ${hasSizes ? 'Select Size' : '+ Cart'}
      </button>
    </div>
  </div>`;

}).join('');

document.querySelectorAll('.add-to-cart-btn').forEach(btn => {
btn.addEventListener('click', function(e) {
e.preventDefault();
handleAddToCartClick(this.getAttribute('data-product-id'));
});
});
}


// ===================== SEARCH =====================
function searchProducts(query) {
  currentSearchQuery = (query || '').trim();
  applyProductView();
}

function clearSearch() {
  const input = document.getElementById('searchInput');
  if (input) input.value = '';
  const clearBtn = document.getElementById('searchClear');
  if (clearBtn) clearBtn.style.display = 'none';
  currentSearchQuery = '';
  applyProductView();
}

function filterCategory(cat, btn) {
document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
btn.classList.add('active');
currentCategory = cat || '';
applyProductView();
}

function sortProducts(mode) {
currentSortMode = mode || 'featured';
applyProductView();
}

// ===================== SIZE PICKER =====================
function handleAddToCartClick(productId) {
const product = allProducts.find(p => p._id === productId);
if (!product) return;

const hasSizes = product.sizeType && product.sizeType !== 'none' && product.sizes && product.sizes.length > 0;

if (hasSizes) {
openSizePicker(product);
} else {
addToCart(productId, null);
}
}

function openSizePicker(product) {
pendingProductId = product._id;
selectedSize     = null;

document.getElementById('sizeModalTitle').textContent = `Choose Size — ${product.name}`;
document.getElementById('sizeProductInfo').innerHTML = `<div class="size-product-preview"> ${product.image ?`<img src="${escHtml(product.image)}" alt="" onerror="this.style.display='none'">` : '<div class="size-product-img-placeholder">🏅</div>'} <div> <div style="font-weight:600;font-size:15px">${escHtml(product.name)}</div> <div style="color:var(--accent);font-family:var(--font-display);font-size:20px;margin-top:4px">GHS ${Number(product.price).toFixed(2)}</div> </div> </div>`;

document.getElementById('sizeOptions').innerHTML = product.sizes.map(s => `<button class="size-option" onclick="selectSize('${escHtml(s)}', this)">${escHtml(s)}</button>`).join('');

document.getElementById('sizePickerOverlay').classList.add('open');
}

function selectSize(size, btn) {
document.querySelectorAll('.size-option').forEach(b => b.classList.remove('selected'));
btn.classList.add('selected');
selectedSize = size;
}

function confirmAddToCart() {
addToCart(pendingProductId, selectedSize);
closeSizePicker();
}

function skipSize() {
addToCart(pendingProductId, null);
closeSizePicker();
}

function closeSizePicker() {
document.getElementById('sizePickerOverlay').classList.remove('open');
pendingProductId = null;
selectedSize     = null;
}

// ===================== CART =====================
function setCartStockWarning(message, tone) {
const warningEl = document.getElementById('cartStockWarning');
if (!warningEl) return;
if (!message) {
  warningEl.textContent = '';
  warningEl.style.display = 'none';
  warningEl.classList.remove('info');
  return;
}
warningEl.textContent = message;
warningEl.style.display = 'block';
warningEl.classList.toggle('info', tone === 'info');
}

function setCartCheckoutEnabled(enabled, reason) {
const btn = document.getElementById('cartCheckoutBtn');
if (!btn) return;
btn.disabled = !enabled;
btn.title = enabled ? '' : (reason || 'Please resolve stock issues before checkout');
}

function buildShortageHint(shortages) {
if (!Array.isArray(shortages) || !shortages.length) return '';
return shortages
  .slice(0, 2)
  .map(s => `${s.name || 'Item'} (requested ${Number(s.requested || 0)}, available ${Number(s.available || 0)})`)
  .join(', ');
}

function sanitizePlainMessage(value) {
const raw = String(value || '').trim();
if (!raw) return '';
return raw
  .replace(/<[^>]*>/g, ' ')
  .replace(/\s+/g, ' ')
  .replace(/^Error\s*/i, '')
  .trim();
}

function extractCartRequirements(cartItems) {
const map = new Map();
for (const entry of Array.isArray(cartItems) ? cartItems : []) {
  const id = String(entry?._id || entry?.productId || entry?.id || '').trim();
  if (!id) continue;
  const qtyRaw = Number(entry?.quantity ?? entry?.qty ?? 1);
  const qty = Number.isFinite(qtyRaw) ? Math.max(1, Math.floor(qtyRaw)) : 1;
  const prev = map.get(id) || { productId: id, quantity: 0, name: entry?.name || 'Item' };
  prev.quantity += qty;
  if (!prev.name && entry?.name) prev.name = entry.name;
  map.set(id, prev);
}
return Array.from(map.values());
}

function findShortagesFromProducts(cartItems, products) {
const requirements = extractCartRequirements(cartItems);
const byId = new Map((Array.isArray(products) ? products : []).map((p) => [String(p?._id || p?.id || ''), p]));
const shortages = [];

for (const req of requirements) {
  const product = byId.get(String(req.productId));
  if (!product) {
    shortages.push({
      productId: req.productId,
      name: req.name || 'Item',
      requested: req.quantity,
      available: 0
    });
    continue;
  }
  const available = Number(product.stock || 0);
  if (available < req.quantity) {
    shortages.push({
      productId: req.productId,
      name: product.name || req.name || 'Item',
      requested: req.quantity,
      available
    });
  }
}

return shortages;
}

async function validateStockWithFallback(cartSnapshot) {
const shortageMsgBase = 'This order is beyond available stock. Please reduce quantity and try again.';

const tryFallback = async () => {
  let products = Array.isArray(allProducts) ? allProducts : [];
  if (!products.length) {
    try {
      products = await fetchProductsFromBase(API_URL);
    } catch {
      products = [];
    }
  }
  if (!products.length) {
    return { checked: false, ok: true, message: 'Live stock check is temporarily unavailable.' };
  }
  const shortages = findShortagesFromProducts(cartSnapshot, products);
  if (shortages.length) {
    const hint = buildShortageHint(shortages);
    const message = hint ? `${shortageMsgBase} ${hint}` : shortageMsgBase;
    return { checked: true, ok: false, message, shortages };
  }
  return { checked: true, ok: true, fallback: true };
};

try {
  const res = await fetch(`${API_URL}/orders/validate-stock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cart: cartSnapshot })
  });
  const data = await parseJsonSafe(res);

  if (res.ok) {
    return { checked: true, ok: true };
  }

  const plainMsg = sanitizePlainMessage(data?.message || data);
  const endpointMissing = res.status === 404 || /cannot\s+post\s+\/api\/orders\/validate-stock/i.test(plainMsg);
  if (endpointMissing) {
    return tryFallback();
  }

  const shortages = Array.isArray(data?.stock?.shortages) ? data.stock.shortages : [];
  const hint = buildShortageHint(shortages);
  const serverMsg = plainMsg || shortageMsgBase;
  return {
    checked: true,
    ok: false,
    message: hint ? `${serverMsg} ${hint}` : serverMsg,
    shortages
  };
} catch {
  return tryFallback();
}
}

async function validateCartStockInline() {
const seq = ++cartStockValidationSeq;

if (!cart.length) {
  setCartStockWarning('');
  setCartCheckoutEnabled(false, 'Your cart is empty');
  return { checked: false, ok: false };
}

try {
  const cartSnapshot = [...cart];
  const validation = await validateStockWithFallback(cartSnapshot);

  if (seq !== cartStockValidationSeq) return { checked: false, ok: false };

  if (validation.ok) {
    setCartStockWarning('');
    setCartCheckoutEnabled(true);
    return { checked: true, ok: true, fallback: validation.fallback };
  }

  const fullMsg = validation.message || 'This order is beyond available stock. Please reduce quantity and try again.';
  setCartStockWarning(fullMsg);
  setCartCheckoutEnabled(false, fullMsg);
  return { checked: true, ok: false, message: fullMsg };
} catch {
  if (seq !== cartStockValidationSeq) return { checked: false, ok: false };
  setCartStockWarning('Could not validate stock right now. You can retry checkout.', 'info');
  setCartCheckoutEnabled(true);
  return { checked: false, ok: true };
}
}

function scheduleCartStockValidation() {
if (cartStockValidationTimer) clearTimeout(cartStockValidationTimer);
if (!cart.length) {
  setCartStockWarning('');
  setCartCheckoutEnabled(false, 'Your cart is empty');
  return;
}
cartStockValidationTimer = setTimeout(() => {
  validateCartStockInline();
}, 180);
}

function addToCart(productId, size) {
const product = allProducts.find(p => p._id === productId);
if (!product) return;
cart.push({ ...product, selectedSize: size || null });
updateCartUI();
const sizeLabel = size ? ` (${size})` : '';
showToast(`${product.name}${sizeLabel} added to cart`, 'success');
}

function removeFromCart(idx) {
cart.splice(idx, 1);
updateCartUI();
}

function updateCartUI() {
document.getElementById('cartCount').textContent = cart.length;
const itemsEl = document.getElementById('cartItems');
if (!cart.length) {
itemsEl.innerHTML = '<li class="cart-empty">Your cart is empty</li>';
document.getElementById('cartTotal').textContent = '0.00';
setCartStockWarning('');
setCartCheckoutEnabled(false, 'Your cart is empty');
return;
}
let total = 0;
itemsEl.innerHTML = cart.map((item, idx) => {
total += item.price;
const sizeLabel = item.selectedSize ? `<div class="cart-item-size">Size: ${escHtml(item.selectedSize)}</div>` : '';
return ` <li class="cart-item"> <div class="cart-item-info"> <div class="cart-item-name">${escHtml(item.name)}</div> ${sizeLabel} <div class="cart-item-price">GHS ${Number(item.price).toFixed(2)}</div> </div> <button class="cart-remove" onclick="removeFromCart(${idx})" title="Remove">✕</button> </li>`;
}).join('');
document.getElementById('cartTotal').textContent = total.toFixed(2);
scheduleCartStockValidation();
}

function toggleCart() {
const sidebar = document.getElementById('cartSidebar');
const overlay = document.getElementById('cartOverlay');
const isOpen  = sidebar.classList.contains('open');
sidebar.classList.toggle('open', !isOpen);
overlay.classList.toggle('open', !isOpen);
if (!isOpen) updateCartUI();
}

// ===================== CHECKOUT =====================
async function pay() {
if (!cart.length) { showToast('Your cart is empty', 'error'); return; }
const validation = await validateCartStockInline();
if (validation.checked && !validation.ok) {
  showToast(validation.message || 'This order is beyond available stock. Please reduce quantity and try again.', 'error');
  return;
}
const subtotal = cart.reduce((a, b) => a + Number(b.price || 0), 0);
document.getElementById('modalTotal').textContent = subtotal.toFixed(2);
document.getElementById('checkoutError').textContent = '';
// Close cart sidebar first
document.getElementById('cartSidebar').classList.remove('open');
document.getElementById('cartOverlay').classList.remove('open');
// Open checkout modal
document.getElementById('checkoutOverlay').classList.add('open');
// Init map after modal is visible
setTimeout(() => initCheckoutMap(), 300);
renderDeliveryQuote({ requiresLocation: true });
refreshDeliveryQuote();
}

function useShopPickup() {
selectedLocation = { ...SHOP_PICKUP_LOCATION };
document.getElementById('custAddress').value = selectedLocation.address;
document.getElementById('locationHint').textContent = '📍 Pickup selected at the shop - no delivery fee';
document.getElementById('locationHint').classList.add('location-set');
if (checkoutMap) checkoutMap.setView([selectedLocation.lat, selectedLocation.lng], 17);
if (checkoutMarker && checkoutMap) checkoutMap.removeLayer(checkoutMarker);
if (checkoutMap && window.L) {
  checkoutMarker = L.marker([selectedLocation.lat, selectedLocation.lng], { icon: checkoutMap._greenIcon }).addTo(checkoutMap);
}
renderDeliveryQuote({
  requiresLocation: false,
  distanceKm: 0,
  durationMin: 0,
  deliveryFee: 0,
  pricingZone: 'pickup',
  pickupRadiusKm: 0.25
});
currentDeliveryQuote = {
  requiresLocation: false,
  distanceKm: 0,
  durationMin: 0,
  deliveryFee: 0,
  pricingZone: 'pickup',
  pickupRadiusKm: 0.25
};
}

function handleCheckoutOverlayClick(e) {
// Only close if clicking the dark backdrop, not the modal itself
if (e.target === document.getElementById('checkoutOverlay')) {
closeCheckout();
}
}

function closeCheckout() {
document.getElementById('checkoutOverlay').classList.remove('open');
// Reset map so it reinitialises cleanly next time
if (checkoutMap) {
checkoutMap.remove();
checkoutMap = null;
checkoutMarker = null;
}
// Re-enable cart toggle
document.getElementById('cartSidebar').style.pointerEvents = '';
currentDeliveryQuote = null;
renderDeliveryQuote({ requiresLocation: true });
}

// ===================== LEAFLET MAP (OpenStreetMap — free) =====================
function initCheckoutMap() {
if (!window.L) return;   // Leaflet not loaded
if (checkoutMap) return; // Already initialized

const defaultCenter = [6.7068, -1.6398]; // Kumasi-Tanoso near AAMUSTED

checkoutMap = L.map('mapPicker').setView(defaultCenter, 13);

// OpenStreetMap tile layer — completely free
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
attribution: '© OpenStreetMap contributors',
maxZoom: 19
}).addTo(checkoutMap);

// Custom green marker icon
const greenIcon = L.divIcon({
className: '',
html: '<div style="width:18px;height:18px;background:#b5f13b;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>',
iconSize: [18, 18],
iconAnchor: [9, 9]
});

checkoutMap.on('click', (e) => {
placeMapMarker(e.latlng.lat, e.latlng.lng);
});

// Store icon for reuse
checkoutMap._greenIcon = greenIcon;
}

function placeMapMarker(lat, lng) {
if (checkoutMarker) checkoutMap.removeLayer(checkoutMarker);

checkoutMarker = L.marker([lat, lng], { icon: checkoutMap._greenIcon }).addTo(checkoutMap);

// Reverse geocode using free Nominatim API (OpenStreetMap)
fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`)
.then(r => r.json())
.then(data => {
const address = data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
selectedLocation = { lat, lng, address };
document.getElementById('custAddress').value = address;
document.getElementById('locationHint').textContent = `📍 ${address}`;
document.getElementById('locationHint').classList.add('location-set');
refreshDeliveryQuote();
})
.catch(() => {
selectedLocation = { lat, lng, address: `${lat.toFixed(5)}, ${lng.toFixed(5)}` };
document.getElementById('locationHint').textContent = `📍 Location pinned`;
document.getElementById('locationHint').classList.add('location-set');
refreshDeliveryQuote();
});
}

function getMyLocation() {
if (!navigator.geolocation) {
showToast('Geolocation not supported by your browser', 'error');
return;
}
navigator.geolocation.getCurrentPosition(
(pos) => {
const lat = pos.coords.latitude;
const lng = pos.coords.longitude;
if (checkoutMap) {
checkoutMap.setView([lat, lng], 16);
}
placeMapMarker(lat, lng);
},
() => showToast('Could not get your location. Try clicking the map instead.', 'error')
);
}

// ===================== PAYMENT =====================
async function processPayment() {
const name    = document.getElementById('custName').value.trim();
const email   = document.getElementById('custEmail').value.trim();
const phone   = document.getElementById('custPhone').value.trim();
const address = document.getElementById('custAddress').value.trim();
const subtotal = cart.reduce((a, b) => a + Number(b.price || 0), 0);

['custName','custEmail','custPhone'].forEach(id => {
const field = document.getElementById(id);
if (field) field.classList.remove('field-invalid');
});

if (!name || !email || !phone) {
document.getElementById('checkoutError').textContent = 'Please fill in your name, email, and phone.';
if (!name) document.getElementById('custName').classList.add('field-invalid');
if (!email) document.getElementById('custEmail').classList.add('field-invalid');
if (!phone) document.getElementById('custPhone').classList.add('field-invalid');
return;
}
if (!email.includes('@')) {
document.getElementById('checkoutError').textContent = 'Please enter a valid email address.';
document.getElementById('custEmail').classList.add('field-invalid');
return;
}

document.getElementById('checkoutError').textContent = '';

const customer = {
name, email, phone, address,
location: selectedLocation || null
};
if (!customer.location) {
document.getElementById('checkoutError').textContent = 'Please type your delivery address or pin your location so we can calculate the fee.';
return;
}
if (!currentDeliveryQuote) {
await refreshDeliveryQuote();
}
if (!currentDeliveryQuote) {
document.getElementById('checkoutError').textContent = 'Could not calculate delivery fee right now. Please try again.';
return;
}
const quoteSnapshot = { ...currentDeliveryQuote };
const deliveryFee = Number(quoteSnapshot.deliveryFee || 0);
const cartSnapshot = [...cart];

try {
const validation = await validateStockWithFallback(cartSnapshot);
if (!validation.ok) {
  const fullMsg = validation.message || 'This order is beyond available stock. Please reduce quantity and try again.';
  document.getElementById('checkoutError').textContent = fullMsg;
  showToast(fullMsg, 'error');
  return;
}
} catch (err) {
document.getElementById('checkoutError').textContent = 'Could not confirm stock right now. Please try again.';
showToast('Could not confirm stock right now. Please try again.', 'error');
return;
}

const handler = PaystackPop.setup({
key:      PAYSTACK_PUBLIC_KEY,
email:    customer.email,
amount:   Math.round(subtotal * 100),
currency: 'GHS',
ref:      'GS_' + Date.now(),
callback: function(res) {
closeCheckout();
verifyPayment(res.reference, customer, cartSnapshot, quoteSnapshot);
},
onClose: function() {
showToast('Payment cancelled', 'error');
}
});

handler.openIframe();
}

async function verifyPayment(reference, customer, cartSnapshot, deliveryQuote) {
showToast('Verifying payment...');
try {
const res  = await fetch(`${API_URL}/orders/verify`, {
method:  'POST',
headers: { 'Content-Type': 'application/json' },
body:    JSON.stringify({ reference, cart: cartSnapshot, customer, deliveryQuote })
});
const data = await res.json();
if (res.ok && data.order) {
cart = [];
selectedLocation = null;
currentDeliveryQuote = null;
if (checkoutMap) { checkoutMap.remove(); checkoutMap = null; }
checkoutMarker = null;
updateCartUI();
const ref = data.order.reference;
localStorage.setItem(`gs_chat_token_${ref}`, data.order.chatToken || '');
showToast('🎉 Order placed! Track it with ref: ' + ref, 'success');
// Pre-fill tracking input and prompt user
setTimeout(() => {
document.getElementById('trackRef').value = ref;
showSection('track');
trackOrder();
}, 3000);
} else {
showToast(data.message || 'Payment verification failed', 'error');
}
} catch (err) {
console.error(err);
showToast('Network error during verification', 'error');
}
}

// ===================== ORDER TRACKING (CUSTOMER) =====================
async function trackOrder() {
const ref    = document.getElementById('trackRef').value.trim();
const errEl  = document.getElementById('trackError');
errEl.textContent = '';

if (!ref) { errEl.textContent = 'Please enter your order reference.'; return; }

currentTrackRef = ref;

// Stop any existing polling
if (trackInterval) { clearInterval(trackInterval); trackInterval = null; }

const data = await fetchTrackData(ref);
if (!data) { errEl.textContent = 'Order not found. Check your reference and try again.'; return; }

document.getElementById('trackResult').style.display = 'block';
saveTrackedChat(data);
renderTrackResult(data);

// Start polling every 5 seconds for live updates
trackInterval = setInterval(async () => {
const updated = await fetchTrackData(currentTrackRef);
if (updated) renderTrackResult(updated);
// Stop polling if delivered
if (updated?.status === 'delivered') {
clearInterval(trackInterval);
trackInterval = null;
}
}, 5000);
}

async function fetchTrackData(ref) {
try {
const res = await fetch(`${API_URL}/track/${ref}`);
if (!res.ok) {
  console.error('Track API error', res.status, await res.text());
  return null;
}
return await res.json();
} catch (err) { console.error('Track API network error', err); return null; }
}

function renderTrackResult(data) {
currentTrackData = data;
handleTrackChatMeta(data.reference, data.chatMessageCount, data.lastChatMessageRole, 'poll');
// Status badge
document.getElementById('trackRefDisplay').textContent = currentTrackRef;
const statusEl = document.getElementById('trackStatusBadge');
statusEl.textContent  = data.status?.toUpperCase() || 'PENDING';
statusEl.className    = `track-status-badge status-${data.status || 'pending'}`;

// Info grid
const items = (data.items || []).map(i => `${i.name} × 1`).join(', ');
const date  = new Date(data.date).toLocaleDateString('en-GH', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
const subtotalAmount = Number(data.subtotal || 0);
const deliveryAmount = Number(data.deliveryFee || 0);
const grandTotal = subtotalAmount + deliveryAmount;
document.getElementById('trackInfoGrid').innerHTML = `<div class="track-info-item"><span>Customer</span><strong>${escHtml(data.customerName || 'You')}</strong></div> <div class="track-info-item"><span>Subtotal</span><strong>GHS ${subtotalAmount.toFixed(2)}</strong></div> <div class="track-info-item"><span>Paid Online</span><strong>GHS ${Number(data.amount || 0).toFixed(2)}</strong></div> <div class="track-info-item"><span>Pay Rider on Delivery</span><strong>GHS ${deliveryAmount.toFixed(2)}</strong></div> <div class="track-info-item"><span>Grand Total</span><strong>GHS ${grandTotal.toFixed(2)}</strong></div> <div class="track-info-item"><span>Distance</span><strong>${Number(data.deliveryDistanceKm || 0).toFixed(2)} km</strong></div> <div class="track-info-item"><span>Rider</span><strong>${escHtml(data.riderName || 'Not yet assigned')}</strong></div> <div class="track-info-item"><span>Ordered</span><strong>${date}</strong></div> <div class="track-info-item"><span>Chat</span><strong>${data.riderName ? 'Live with rider' : 'Support thread open'}</strong></div>`;

const chatActions = document.getElementById('trackChatActions');
if (chatActions) chatActions.style.display = 'block';
const chatBtn = chatActions?.querySelector('button');
if (chatBtn) {
const baseLabel = data.riderName ? 'Chat with Rider' : 'Open Support Chat';
chatBtn.textContent = formatChatButtonLabel(baseLabel, getChatUnreadCount(data.reference));
}

updateRecentChatShortcut(data);

// Map
initTrackMap(data);
if (trackMap) {
setTimeout(() => {
  try { trackMap.invalidateSize(); } catch { /* no-op */ }
}, 120);
}
}

function initTrackMap(data) {
const custLoc   = data.customerLocation;
const riderLoc  = data.riderLocation;

if (!custLoc?.lat || !custLoc?.lng) {
const mapEl = document.getElementById('trackMap');
if (trackMap) {
  try { trackMap.remove(); } catch { /* no-op */ }
  trackMap = null;
  trackCustMarker = null;
  trackRiderMarker = null;
  trackRouteLayer = null;
}
if (mapEl) {
  mapEl.innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:13px;padding:0 16px;text-align:center;">Delivery map is unavailable because this order has no pinned customer location.</div>';
}
document.getElementById('trackETA').innerHTML = '<span class="eta-label">No map location available</span>';
return;
}

const mapEl = document.getElementById('trackMap');
if (mapEl && mapEl.childElementCount && !trackMap) {
mapEl.innerHTML = '';
}

// Init map if not yet done
if (!trackMap) {
trackMap = L.map('trackMap').setView([custLoc.lat, custLoc.lng], 14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
attribution: '© OpenStreetMap contributors', maxZoom: 19
}).addTo(trackMap);
}

// Customer marker (green pin)
const custIcon = L.divIcon({
className: '',
html: '<div style="width:20px;height:20px;background:#b5f13b;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.4)"></div>',
iconSize: [20,20], iconAnchor: [10,10]
});
if (!trackCustMarker) {
trackCustMarker = L.marker([custLoc.lat, custLoc.lng], { icon: custIcon })
.addTo(trackMap)
.bindPopup('📍 Your delivery location');
} else {
trackCustMarker.setLatLng([custLoc.lat, custLoc.lng]);
}

// Rider marker (blue dot — moves in real time)
if (riderLoc?.lat) {
const riderIcon = L.divIcon({
className: '',
html: '<div style="width:24px;height:24px;background:#3b82f6;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-size:12px">🏍</div>',
iconSize: [24,24], iconAnchor: [12,12]
});

if (!trackRiderMarker) {
  trackRiderMarker = L.marker([riderLoc.lat, riderLoc.lng], { icon: riderIcon })
    .addTo(trackMap)
    .bindPopup(`🏍️ ${data.riderName || 'Rider'} is on the way!`);
} else {
  // Smoothly move existing marker
  trackRiderMarker.setLatLng([riderLoc.lat, riderLoc.lng]);
}

// Fit map to show both rider and customer
const bounds = L.latLngBounds(
  [custLoc.lat, custLoc.lng],
  [riderLoc.lat, riderLoc.lng]
);
trackMap.fitBounds(bounds, { padding: [40, 40] });

// Draw route between rider and customer
drawRoute(riderLoc.lat, riderLoc.lng, custLoc.lat, custLoc.lng);

// Calculate and show ETA
const etaMinutes = estimateETA(riderLoc.lat, riderLoc.lng, custLoc.lat, custLoc.lng);
document.getElementById('trackETA').innerHTML =
  `<span class="eta-label">Est. arrival</span><span class="eta-time">${etaMinutes} min</span>`;

} else {
document.getElementById('trackETA').innerHTML =
data.status === 'paid'
? '<span class="eta-label">Waiting for rider to accept order</span>'
: data.status === 'delivered'
? '<span class="eta-label" style="color:var(--accent)">✅ Delivered!</span>'
: '<span class="eta-label">Rider not yet assigned</span>';
trackMap.setView([custLoc.lat, custLoc.lng], 14);
}

try { trackMap.invalidateSize(); } catch { /* no-op */ }
}

async function drawRoute(riderLat, riderLng, custLat, custLng) {
// Remove previous route
if (trackRouteLayer) {
trackMap.removeLayer(trackRouteLayer);
trackRouteLayer = null;
}

try {
// OSRM — free routing API, no key needed
const url = `https://router.project-osrm.org/route/v1/driving/${riderLng},${riderLat};${custLng},${custLat}?overview=full&geometries=geojson`;
const res  = await fetch(url);
const data = await res.json();
if (data.routes && data.routes[0]) {
  trackRouteLayer = L.geoJSON(data.routes[0].geometry, {
    style: { color: '#3b82f6', weight: 4, opacity: 0.7, dashArray: '8,4' }
  }).addTo(trackMap);
}
} catch {
// If routing fails just draw a straight line
trackRouteLayer = L.polyline(
[[riderLat, riderLng], [custLat, custLng]],
{ color: '#3b82f6', weight: 3, opacity: 0.6, dashArray: '8,4' }
).addTo(trackMap);
}
}

function estimateETA(riderLat, riderLng, custLat, custLng) {
// Haversine formula to get distance in km
const R    = 6371;
const dLat = (custLat - riderLat) * Math.PI / 180;
const dLng = (custLng - riderLng) * Math.PI / 180;
const a    = Math.sin(dLat/2) * Math.sin(dLat/2) +
Math.cos(riderLat * Math.PI/180) * Math.cos(custLat * Math.PI/180) *
Math.sin(dLng/2) * Math.sin(dLng/2);
const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
// Assume 25 km/h average speed in Accra traffic
const minutes = Math.round((dist / 25) * 60);
return Math.max(1, minutes);
}

// ===================== RIDER GPS SHARING =====================
function startRiderGPS(orderId) {
riderActiveOrder = orderId;
if (!navigator.geolocation) {
showToast('GPS not available on this device', 'error'); return;
}

riderGPSWatch = navigator.geolocation.watchPosition(
async (pos) => {
const { latitude: lat, longitude: lng } = pos.coords;
try {
await fetch(`${API_URL}/riders/location`, {
method:  'PUT',
headers: riderAuthHeaders(),
body:    JSON.stringify({ lat, lng, orderId: riderActiveOrder })
});
} catch { /* silent fail — will retry on next position update */ }
},
(err) => console.warn('GPS error:', err.message),
{ enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
);

showToast('📍 GPS sharing started — customer can see you', 'success');
}

function stopRiderGPS() {
if (riderGPSWatch !== null) {
navigator.geolocation.clearWatch(riderGPSWatch);
riderGPSWatch    = null;
riderActiveOrder = null;
showToast('GPS sharing stopped', '');
}
}

// ===================== RIDER REGISTER =====================
async function riderRegister() {
const fullName          = document.getElementById('riderRegName').value.trim();
const phone             = document.getElementById('riderRegPhone').value.trim();
const password          = document.getElementById('riderRegPassword').value;
const ghanaCardId       = document.getElementById('riderRegGhanaCard').value.trim();
const vehicleLicenseId  = document.getElementById('riderRegLicense').value.trim();
const errEl             = document.getElementById('riderRegError');
const sucEl             = document.getElementById('riderRegSuccess');
errEl.textContent = ''; sucEl.textContent = '';

if (!fullName || !phone || !password || !ghanaCardId || !vehicleLicenseId) {
errEl.textContent = 'Please fill all required fields.'; return;
}
try {
const res  = await fetch(`${API_URL}/riders/register`, {
method: 'POST', headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ fullName, phone, password, ghanaCardId, vehicleLicenseId })
});
const data = await res.json();
if (res.ok) {
sucEl.textContent = '✅ Application submitted! Wait for admin approval before logging in.';
['riderRegName','riderRegPhone','riderRegPassword','riderRegGhanaCard','riderRegLicense']
.forEach(id => document.getElementById(id).value = '');
} else {
errEl.textContent = data.message || 'Registration failed';
}
} catch { errEl.textContent = 'Network error'; }
}

// ===================== RIDER LOGIN =====================
async function riderLogin() {
const phone    = document.getElementById('riderLoginPhone').value.trim();
const password = document.getElementById('riderLoginPassword').value;
const errEl    = document.getElementById('riderLoginError');
errEl.textContent = '';
if (!phone || !password) { errEl.textContent = 'Please enter phone and password.'; return; }
let lastError = 'Could not reach server. Please try again.';
let sawAuthError = false;

for (const base of getApiCandidates()) {
try {
const res  = await fetch(`${base}/riders/login`, {
method: 'POST', headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ phone, password })
});
const data = await parseJsonSafe(res);

if (res.status === 404) {
lastError = 'Rider login route was not found on server (404).';
continue;
}

if (res.ok && data && data.token) {
API_URL = base;
localStorage.setItem('gs_api_url', API_URL);
riderToken = data.token;
riderInfo  = data.rider;
localStorage.setItem('gs_rider_token', riderToken);
localStorage.setItem('gs_rider_info', JSON.stringify(riderInfo));
showRiderNav(true);
document.getElementById('riderWelcome').textContent = `Welcome, ${riderInfo.fullName}`;
showSection('riderDash');
connectRiderSSE();
showToast(`Welcome, ${riderInfo.fullName}!`, 'success');
return;
}

lastError = (data && data.message) ? data.message : `Login failed (${res.status})`;
if (res.status === 400 || res.status === 401 || res.status === 403) {
  sawAuthError = true;
}
continue;
} catch {
lastError = 'Network connection failed. Check internet/server and try again.';
}
}

if (!sawAuthError) {
  try {
    await discoverApiUrl();
    const res = await fetch(`${API_URL}/riders/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password })
    });
    const data = await parseJsonSafe(res);
    if (res.ok && data && data.token) {
      safeStorageSet('gs_api_url', API_URL);
      riderToken = data.token;
      riderInfo  = data.rider;
      localStorage.setItem('gs_rider_token', riderToken);
      localStorage.setItem('gs_rider_info', JSON.stringify(riderInfo));
      showRiderNav(true);
      document.getElementById('riderWelcome').textContent = `Welcome, ${riderInfo.fullName}`;
      showSection('riderDash');
      connectRiderSSE();
      showToast(`Welcome, ${riderInfo.fullName}!`, 'success');
      return;
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      errEl.textContent = (data && data.message) ? data.message : `Login failed (${res.status})`;
      return;
    }
  } catch {
    // Fall through to user-visible generic connectivity guidance.
  }

errEl.textContent = 'Could not reach rider login service. Confirm backend URL/CORS or open with ?api=https://your-backend-domain/api';
return;
}
errEl.textContent = lastError;
}

function riderLogout() {
riderToken = null; riderInfo = null;
localStorage.removeItem('gs_rider_token');
localStorage.removeItem('gs_rider_info');
showRiderNav(false);
if (riderSSE) { riderSSE.close(); riderSSE = null; }
if (chatSocket) { chatSocket.disconnect(); chatSocket = null; }
document.getElementById('chatOverlay').classList.remove('open');
chatModalOpen = false;
activeChat = null;
chatSubscriptionContext = null;
chatIsJoined = false;
chatUnreadCounts.clear();
refreshChatUnreadIndicators();
showSection('shop');
showToast('Logged out');
}

function riderAuthHeaders() {
return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${riderToken}` };
}

// ===================== RIDER SSE (REAL-TIME) =====================
function connectRiderSSE() {
if (riderSSE) riderSSE.close();
riderSSE = new EventSource(`${API_URL}/riders/notifications?token=${riderToken}`);

riderSSE.addEventListener('new_order', (e) => {
const order = JSON.parse(e.data);
showNewOrderBanner();
showToast('🔔 New order available!', 'success');
// Auto-refresh if rider is on available orders tab
if (document.getElementById('riderAvailable').classList.contains('active')) {
loadAvailableOrders();
}
});

riderSSE.addEventListener('order_taken', (e) => {
const { orderId } = JSON.parse(e.data);
// Remove from list if showing
const el = document.getElementById(`ro-${orderId}`);
if (el) el.remove();
});

riderSSE.addEventListener('chat_message', (e) => {
  try {
    const payload = JSON.parse(e.data || '{}');
    if (!payload?.reference) return;

    const viewingSameChat = chatModalOpen && activeChat?.reference === payload.reference && (activeChat?.role || '') === 'rider';
    if (!viewingSameChat && (payload.senderRole || '') !== 'rider') {
      incrementChatUnreadCount(payload.reference);
    }

    if (viewingSameChat) {
      const total = (chatMessageTotals.get(payload.reference) || 0) + 1;
      chatMessageTotals.set(payload.reference, total);
      markChatAsRead(payload.reference, total);
    }

    if ((payload.senderRole || '') !== 'rider' && !viewingSameChat) {
      const sender = payload.senderName || ((payload.senderRole || '') === 'admin' ? 'Admin' : 'Customer');
      showToast(`New message from ${sender}`, 'success');
      playChatNotificationTone();
      if (document.hidden && canShowBrowserNotifications()) {
        try {
          new Notification(`New message from ${sender}`, {
            body: String(payload.text || '').slice(0, 140),
            tag: `chat-${payload.reference}`,
            renotify: true
          });
        } catch {
          // Ignore browser notification failures.
        }
      }
    }

    if (document.getElementById('riderMine')?.classList.contains('active')) {
      loadMyOrders();
    }
  } catch (err) {
    console.warn('Chat SSE parse error:', err.message);
  }
});

riderSSE.onerror = (e) => {
console.warn('Rider SSE connection error', e);
// Reconnect after 5 seconds if connection drops
setTimeout(() => { if (riderToken) connectRiderSSE(); }, 5000);
};
}

// SSE token workaround — backend reads from query param for EventSource
// Update authenticate to support query param too
// (already handled in server.js via query fallback below — see note)

function showNewOrderBanner() {
document.getElementById('newOrderBanner').style.display = 'flex';
}
function hideNewOrderBanner() {
document.getElementById('newOrderBanner').style.display = 'none';
}

// ===================== RIDER ORDERS =====================
async function loadAvailableOrders() {
const el = document.getElementById('availableOrdersList');
el.innerHTML = '<p style="color:var(--text-muted);font-size:14px;padding:20px 0">Loading orders...</p>';
try {
const res = await fetch(`${API_URL}/riders/orders/available`, { headers: riderAuthHeaders() });
if (!res.ok) {
  const errText = await res.text();
  console.error('Rider available orders error', res.status, errText);
  if (res.status === 401) {
    el.innerHTML = '<p style="color:var(--red)">Unauthorized. Please login as rider.</p>';
    return;
  }
  el.innerHTML = `<p style="color:var(--red)">Error loading orders (status ${res.status}).</p>`;
  return;
}
const orders = await res.json();
const visible = orders.filter(o => !dismissedOrders.has(o._id));
document.getElementById('availableCount').textContent = visible.length;

if (!visible.length) {
  el.innerHTML = '<p style="color:var(--text-muted);font-size:14px;text-align:center;padding:60px 0">No available orders right now. Check back soon!</p>';
  return;
}
el.innerHTML = visible.map(o => renderRiderOrderCard(o, true)).join('');

} catch {
el.innerHTML = '<p style="color:var(--red)">Network error.</p>';
}
}

async function loadMyOrders() {
const el = document.getElementById('myOrdersList');
el.innerHTML = '<p style="color:var(--text-muted);font-size:14px;padding:20px 0">Loading your deliveries...</p>';
try {
const res = await fetch(`${API_URL}/riders/orders/mine`, { headers: riderAuthHeaders() });
if (!res.ok) {
  const errText = await res.text();
  console.error('Rider my orders error', res.status, errText);
  if (res.status === 401) {
    el.innerHTML = '<p style="color:var(--red)">Unauthorized. Please login as rider.</p>';
    return;
  }
  el.innerHTML = `<p style="color:var(--red)">Error loading your orders (status ${res.status}).</p>`;
  return;
}
const orders = await res.json();
if (!orders.length) {
el.innerHTML = '<p style="color:var(--text-muted);font-size:14px;text-align:center;padding:60px 0">No deliveries yet.</p>';
return;
}
orders.forEach((order) => {
if (!order?.reference) return;
syncChatUnreadFromTotal(order.reference, order.chatMessageCount || 0, order.lastChatMessageRole || null, 'rider');
});
el.innerHTML = orders.map(o => renderRiderOrderCard(o, false)).join('');
refreshRiderChatUnreadIndicators();
} catch (err) {
console.error('Network error loading my orders', err);
el.innerHTML = '<p style="color:var(--red)">Network error.</p>';
}
}

function renderRiderOrderCard(o, showActions) {
const date      = new Date(o.date).toLocaleDateString('en-GH', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
const itemsHtml = (o.items || []).map(i => `<li>${escHtml(i.name)} — GHS ${Number(i.price).toFixed(2)}</li>`).join('');
const locHtml   = o.customer?.location?.address ? `<div style="font-size:12px;color:var(--accent);margin-top:6px;font-weight:500">📍 ${escHtml(o.customer.location.address)}</div>` : '<div style="font-size:12px;color:var(--text-muted);margin-top:6px">📍 No location provided</div>';
const coordsDisplay = o.customer?.location?.lat ? `<div style="font-size:10px;color:var(--text-muted)">${o.customer.location.lat.toFixed(4)}, ${o.customer.location.lng.toFixed(4)}</div>` : '';
const statusClass = `status-${o.status || 'pending'}`;
if (o?.reference) {
syncChatUnreadFromTotal(o.reference, o.chatMessageCount || 0, o.lastChatMessageRole || null, 'rider');
}
const unreadCount = getChatUnreadCount(o.reference || '');
const chatBtn = !showActions
? `<button class="chat-btn" data-chat-reference="${escHtml(o.reference || '')}" data-chat-base-label="💬 Chat" onclick="openRiderChat('${o.reference || ''}', '${escHtml(o.customer?.name || 'Customer')}')">${formatChatButtonLabel('💬 Chat', unreadCount)}</button>`
: '';

const actionBtns = showActions ? `<button class="accept-btn" onclick="acceptOrder('${o._id}')">✓ Accept</button> <button class="reject-btn" onclick="dismissOrder('${o._id}')">✗ Dismiss</button> ${o.customer?.location ?`<button class="view-map-btn" onclick="viewOrderMap('${o._id}', ${o.customer.location.lat}, ${o.customer.location.lng}, '${escHtml(o.customer.location.address || '')}')">🗺 Map</button>`: ''}` : `<span class="status-badge ${statusClass}">${o.status}</span> ${o.status === 'assigned' ?`<button class="delivered-btn" onclick="markDelivered('${o._id}')">✓ Mark Delivered</button>`: ''} ${chatBtn} ${o.customer?.location ?`<button class="view-map-btn" onclick="viewOrderMap('${o._id}', ${o.customer.location.lat}, ${o.customer.location.lng}, '${escHtml(o.customer.location.address || '')}')">🗺 Map</button>`: ''}`;

return ` <div class="rider-order-card" id="ro-${o._id}"> <div class="rider-order-card-top"> <div> <div class="order-ref">Ref: ${escHtml(o.reference || '—')}</div> <div class="order-customer">${escHtml(o.customer?.name || 'Unknown')}</div> <div class="order-contact">📞 ${escHtml(o.customer?.phone || '')}</div> ${locHtml} ${coordsDisplay} <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${date}</div> </div> <div class="rider-order-amount">GHS ${Number(o.amount).toFixed(2)}</div> </div> <ul class="rider-order-items">${itemsHtml}</ul> <div class="rider-order-footer">${actionBtns}</div> </div>`;
}

async function acceptOrder(orderId) {
try {
const res  = await fetch(`${API_URL}/riders/orders/${orderId}/accept`, {
method: 'PUT', headers: riderAuthHeaders()
});
const data = await res.json();
if (res.ok) {
showToast('Order accepted! Head to the customer.', 'success');
dismissedOrders.add(orderId);
// Start sharing GPS location automatically
startRiderGPS(orderId);
loadAvailableOrders();
loadMyOrders();
switchRiderTab('mine', document.querySelectorAll('.dash-tab')[1]);
} else {
showToast(data.message || 'Could not accept order', 'error');
loadAvailableOrders();
}
} catch { showToast('Network error', 'error'); }
}

function dismissOrder(orderId) {
dismissedOrders.add(orderId);
const el = document.getElementById(`ro-${orderId}`);
if (el) el.remove();
const count = parseInt(document.getElementById('availableCount').textContent) - 1;
document.getElementById('availableCount').textContent = Math.max(0, count);
}

async function markDelivered(orderId) {
try {
const res = await fetch(`${API_URL}/riders/orders/${orderId}/delivered`, {
method: 'PUT', headers: riderAuthHeaders()
});
if (res.ok) {
stopRiderGPS();
showToast('🎉 Delivery confirmed!', 'success');
loadMyOrders();
} else showToast('Error marking delivered', 'error');
} catch { showToast('Network error', 'error'); }
}

async function toggleAvailability(isAvailable) {
try {
await fetch(`${API_URL}/riders/availability`, {
method: 'PUT', headers: riderAuthHeaders(),
body: JSON.stringify({ isAvailable })
});
showToast(isAvailable ? 'You are now available' : 'You are now offline', '');
} catch { showToast('Network error', 'error'); }
}

// ===================== MAP MODAL (Leaflet) =====================
function viewOrderMap(orderId, lat, lng, address) {
document.getElementById('riderOrderDetail').innerHTML = ` <div style="margin-bottom:12px"> <div style="font-size:12px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">Delivery Location</div> <div style="font-size:14px;font-weight:500">📍 ${escHtml(address) || 'Location pinned on map'}</div> </div>`;
document.getElementById('riderModalActions').innerHTML = ` <a class="submit-btn" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}" target="_blank" style="text-decoration:none;text-align:center;display:block"> Open in Google Maps for Navigation </a>`;
document.getElementById('riderOrderModal').classList.add('open');

setTimeout(() => {
if (!window.L) return;
const mapEl = document.getElementById('riderOrderMap');
// Destroy previous map instance if exists
if (mapEl._leaflet_id) {
mapEl._leaflet_id = null;
mapEl.innerHTML = '';
}
const map = L.map('riderOrderMap').setView([lat, lng], 15);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
attribution: '© OpenStreetMap contributors', maxZoom: 19
}).addTo(map);
const greenIcon = L.divIcon({
  className: '',
  html: '<div style="width:20px;height:20px;background:#b5f13b;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.5)"></div>',
  iconSize: [20, 20], iconAnchor: [10, 10]
});
L.marker([lat, lng], { icon: greenIcon })
  .addTo(map)
  .bindPopup(address || 'Delivery location')
  .openPopup();

}, 200);
}

function closeRiderModal() {
document.getElementById('riderOrderModal').classList.remove('open');
}

// ===================== DASHBOARD TABS =====================
function switchDashTab(name, btn) {
document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
document.querySelectorAll('.dash-panel').forEach(p => p.classList.remove('active'));
btn.classList.add('active');
document.getElementById(`dash${name.charAt(0).toUpperCase() + name.slice(1)}`).classList.add('active');
if (name === 'orders') loadOrders();
if (name === 'riders') loadAdminRiders();
}

function switchRiderTab(name, btn) {
document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
document.querySelectorAll('.dash-panel').forEach(p => p.classList.remove('active'));
btn.classList.add('active');
document.getElementById(`rider${name.charAt(0).toUpperCase() + name.slice(1)}`).classList.add('active');
if (name === 'available') loadAvailableOrders();
if (name === 'mine') loadMyOrders();
}

// ===================== UTILITY =====================
function escHtml(str) {
if (!str) return '';
return String(str)
.replace(/&/g, '&amp;')
.replace(/</g, '&lt;')
.replace(/>/g, '&gt;')
.replace(/"/g, '&quot;')
.replace(/'/g, '&#39;');
}

function normalizeChatReference(reference) {
return String(reference || '').trim();
}

function openCustomerChatFromTrack() {
if (!currentTrackData?.reference) {
showToast('Track an order first to open chat', 'error');
return;
}
clearChatUnreadCount(currentTrackData.reference);
markChatAsRead(currentTrackData.reference, chatMessageTotals.get(currentTrackData.reference) || currentTrackData.chatMessageCount || 0);
const chatToken = currentTrackData.chatToken || localStorage.getItem(`gs_chat_token_${currentTrackData.reference}`) || '';
if (chatToken) {
  safeStorageSet(`gs_chat_token_${currentTrackData.reference}`, chatToken);
  openChatModal({
    reference: currentTrackData.reference,
    role: 'customer',
    name: currentTrackData.customerName || 'Customer',
    chatToken,
    title: currentTrackData.riderName ? 'Chat with Rider' : 'Support Chat',
    subtitle: `Order ${currentTrackData.reference}`
  });
  return;
}

fetchTrackData(currentTrackData.reference).then((fresh) => {
  if (!fresh?.chatToken) {
    showToast('Could not prepare chat access yet. Track the order again.', 'error');
    return;
  }
  currentTrackData = { ...currentTrackData, ...fresh, chatToken: fresh.chatToken };
  safeStorageSet(`gs_chat_token_${currentTrackData.reference}`, fresh.chatToken);
  saveTrackedChat(currentTrackData);
  updateRecentChatShortcut(currentTrackData);
  openChatModal({
    reference: currentTrackData.reference,
    role: 'customer',
    name: currentTrackData.customerName || 'Customer',
    chatToken: fresh.chatToken,
    title: currentTrackData.riderName ? 'Chat with Rider' : 'Support Chat',
    subtitle: `Order ${currentTrackData.reference}`
  });
});
}

function openRiderChat(reference, customerName) {
if (!riderToken) {
showToast('Please login as rider first', 'error');
return;
}
clearChatUnreadCount(reference);
markChatAsRead(reference, chatMessageTotals.get(reference) || getChatSeenCount(reference) || 0);
openChatModal({
reference,
role: 'rider',
token: riderToken,
name: riderInfo?.fullName || 'Rider',
title: `Customer Chat`,
subtitle: customerName ? `Conversation with ${customerName}` : `Conversation for order ${reference}`
});
}

function openRiderAdminChat() {
const riderId = String(riderInfo?.id || riderInfo?._id || '').trim();
if (!riderToken || !riderId) {
showToast('Please login as rider first', 'error');
return;
}

const reference = `rider:${riderId}`;
clearChatUnreadCount(reference);
markChatAsRead(reference, chatMessageTotals.get(reference) || getChatSeenCount(reference) || 0);
openChatModal({
reference,
role: 'rider',
token: riderToken,
name: riderInfo.fullName || 'Rider',
title: 'Message Admin',
subtitle: 'Direct real-time chat with the admin team'
});
}

async function geocodeAddress(addressText) {
const query = String(addressText || '').trim();
if (!query) return null;

const normalized = query.toLowerCase();
if (normalized.includes('tanoso') || normalized.includes('aamusted') || normalized.includes('global sports store') || normalized.includes('pickup at the shop')) {
selectedLocation = { ...SHOP_PICKUP_LOCATION };
document.getElementById('locationHint').textContent = `📍 ${shortLocationLabel(SHOP_PICKUP_LOCATION.address)} - no delivery fee`;
document.getElementById('locationHint').classList.add('location-set');
if (checkoutMap) checkoutMap.setView([selectedLocation.lat, selectedLocation.lng], 17);
if (checkoutMarker && checkoutMap) checkoutMap.removeLayer(checkoutMarker);
if (checkoutMap && window.L) {
  checkoutMarker = L.marker([selectedLocation.lat, selectedLocation.lng], { icon: checkoutMap._greenIcon }).addTo(checkoutMap);
}
currentDeliveryQuote = {
  requiresLocation: false,
  distanceKm: 0,
  durationMin: 0,
  deliveryFee: 0,
  pricingZone: 'pickup',
  pickupRadiusKm: 0.25
};
renderDeliveryQuote(currentDeliveryQuote);
return currentDeliveryQuote;
}

try {
const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
const res = await fetch(url);
const data = await res.json();
const place = Array.isArray(data) ? data[0] : null;
if (!place) return null;

const lat = Number(place.lat);
const lng = Number(place.lon);
const address = place.display_name || query;
selectedLocation = { lat, lng, address };
document.getElementById('locationHint').textContent = `📍 ${shortLocationLabel(address)}`;
document.getElementById('locationHint').classList.add('location-set');
if (checkoutMap) checkoutMap.setView([lat, lng], 16);
if (checkoutMarker && checkoutMap) checkoutMap.removeLayer(checkoutMarker);
if (checkoutMap && window.L) {
  checkoutMarker = L.marker([lat, lng], { icon: checkoutMap._greenIcon }).addTo(checkoutMap);
}
await refreshDeliveryQuote();
return selectedLocation;
} catch (err) {
console.error('Address geocode failed:', err);
return null;
}
}
