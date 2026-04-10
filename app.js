// ===================== CONFIG =====================
let API_URL = (() => {
const override = localStorage.getItem('gs_api_url');
if (override) return override;
const host = window.location.hostname;
if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:5001/api';
return 'https://global-sports-backend.onrender.com/api';
})();
const PAYSTACK_PUBLIC_KEY='pk_live_b53aa461435f588847cc2ed6ebbfd95b09a7b312';

function getApiCandidates() {
const sameOriginApi = window.location.origin && window.location.origin.startsWith('http')
? `${window.location.origin}/api`
: null;
const list = [
localStorage.getItem('gs_api_url') || null,
API_URL,
sameOriginApi,
'http://localhost:5001/api',
'http://localhost:5000/api',
'https://global-sports-backend.onrender.com/api'
].filter(Boolean);
return [...new Set(list)];
}

async function parseJsonSafe(res) {
const text = await res.text();
if (!text) return null;
try { return JSON.parse(text); }
catch { return { message: text }; }
}

async function discoverApiUrl() {
for (const base of getApiCandidates()) {
try {
const res = await fetch(`${base}/products`);
if (!res.ok) continue;
API_URL = base;
localStorage.setItem('gs_api_url', API_URL);
return;
} catch {
// Try next candidate URL
}
}
}

// ===================== STATE =====================
let allProducts    = [];
let cart           = [];
let adminToken     = localStorage.getItem('gs_admin_token') || null;
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
// Tracking state
let trackMap         = null;
let trackRiderMarker = null;
let trackCustMarker  = null;
let trackRouteLayer  = null;
let trackInterval    = null;
let currentTrackRef  = null;
// Rider GPS sharing state
let riderGPSWatch    = null;
let riderActiveOrder = null;

// ===================== INIT =====================
window.addEventListener('DOMContentLoaded', async () => {
setTimeout(() => {
document.getElementById('loader').classList.add('hidden');
}, 1300);

await discoverApiUrl();
fetchProducts();

if (adminToken) showAdminNav(true);
if (riderToken && riderInfo) {
showRiderNav(true);
document.getElementById('riderWelcome').textContent = `Welcome, ${riderInfo.fullName}`;
connectRiderSSE();
}
});

// ===================== TOAST =====================
function showToast(msg, type = '') {
const t = document.getElementById('toast');
t.textContent = msg;
t.className = `toast show ${type}`;
setTimeout(() => { t.className = 'toast'; }, 3500);
}

// ===================== SECTION ROUTING =====================
function showSection(name) {
document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

const sectionMap = {
shop:       'shopSection',
login:      'loginSection',
admin:      'adminSection',
riderLogin: 'riderLoginSection',
riderDash:  'riderDashSection',
track:      'trackSection'
};
const navMap = {
shop:      'navShop',
admin:     'navAdmin',
riderDash: 'navRiderDash',
track:     'navTrack'
};

const section = document.getElementById(sectionMap[name]);
if (section) section.classList.add('active');
const navBtn = document.getElementById(navMap[name]);
if (navBtn) navBtn.classList.add('active');

if (name === 'admin') loadAdminData();
if (name === 'riderDash') { loadAvailableOrders(); loadMyOrders(); }
}

function showAdminOrLogin() {
if (adminToken) showSection('admin');
else showSection('login');
}

function showAdminNav(show) {
document.getElementById('navAdmin').style.display    = show ? '' : 'none';
document.getElementById('navLogin').style.display    = show ? 'none' : '';
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
const res = await fetch(`${API_URL}/products`);
allProducts = await res.json();
renderProducts(allProducts);
} catch (err) {
console.error('Error fetching products:', err);
document.getElementById('productsGrid').innerHTML =
`<div class="empty-state"><p>Could not load products. Is the server running?</p></div>`;
}
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
  const q = (query || '').toLowerCase().trim();
  // Clear category filter chips when searching
  if (q) {
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  }
  if (!q) {
    renderProducts(allProducts);
    return;
  }
  const filtered = allProducts.filter(p => {
    const name = (p.name || '').toLowerCase();
    const cat  = (p.category || '').toLowerCase();
    const desc = (p.description || '').toLowerCase();
    return name.includes(q) || cat.includes(q) || desc.includes(q);
  });
  renderProducts(filtered);
  // Show result count
  const grid = document.getElementById('productsGrid');
  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-state"><p>No products found for "' + escHtml(query) + '"</p></div>';
  }
}

function clearSearch() {
  const input = document.getElementById('searchInput');
  if (input) input.value = '';
  document.getElementById('searchClear').style.display = 'none';
  // Re-activate All filter
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  const allChip = document.querySelector('.filter-chip');
  if (allChip) allChip.classList.add('active');
  renderProducts(allProducts);
}

function filterCategory(cat, btn) {
document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
btn.classList.add('active');
renderProducts(cat ? allProducts.filter(p => p.category === cat) : allProducts);
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
return;
}
let total = 0;
itemsEl.innerHTML = cart.map((item, idx) => {
total += item.price;
const sizeLabel = item.selectedSize ? `<div class="cart-item-size">Size: ${escHtml(item.selectedSize)}</div>` : '';
return ` <li class="cart-item"> <div class="cart-item-info"> <div class="cart-item-name">${escHtml(item.name)}</div> ${sizeLabel} <div class="cart-item-price">GHS ${Number(item.price).toFixed(2)}</div> </div> <button class="cart-remove" onclick="removeFromCart(${idx})" title="Remove">✕</button> </li>`;
}).join('');
document.getElementById('cartTotal').textContent = total.toFixed(2);
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
function pay() {
if (!cart.length) { showToast('Your cart is empty', 'error'); return; }
const total = cart.reduce((a, b) => a + b.price, 0);
document.getElementById('modalTotal').textContent = total.toFixed(2);
document.getElementById('checkoutError').textContent = '';
// Close cart sidebar first
document.getElementById('cartSidebar').classList.remove('open');
document.getElementById('cartOverlay').classList.remove('open');
// Open checkout modal
document.getElementById('checkoutOverlay').classList.add('open');
// Init map after modal is visible
setTimeout(() => initCheckoutMap(), 300);
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
}

// ===================== LEAFLET MAP (OpenStreetMap — free) =====================
function initCheckoutMap() {
if (!window.L) return;   // Leaflet not loaded
if (checkoutMap) return; // Already initialized

const defaultCenter = [5.6037, -0.1870]; // Accra

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
})
.catch(() => {
selectedLocation = { lat, lng, address: `${lat.toFixed(5)}, ${lng.toFixed(5)}` };
document.getElementById('locationHint').textContent = `📍 Location pinned`;
document.getElementById('locationHint').classList.add('location-set');
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
function processPayment() {
const name    = document.getElementById('custName').value.trim();
const email   = document.getElementById('custEmail').value.trim();
const phone   = document.getElementById('custPhone').value.trim();
const address = document.getElementById('custAddress').value.trim();

if (!name || !email || !phone) {
document.getElementById('checkoutError').textContent = 'Please fill in your name, email, and phone.';
return;
}
if (!email.includes('@')) {
document.getElementById('checkoutError').textContent = 'Please enter a valid email address.';
return;
}

const customer = {
name, email, phone, address,
location: selectedLocation || null
};
const total        = cart.reduce((a, b) => a + b.price, 0);
const cartSnapshot = [...cart];

const handler = PaystackPop.setup({
key:      PAYSTACK_PUBLIC_KEY,
email:    customer.email,
amount:   Math.round(total * 100),
currency: 'GHS',
ref:      'GS_' + Date.now(),
callback: function(res) {
closeCheckout();
verifyPayment(res.reference, customer, cartSnapshot);
},
onClose: function() {
showToast('Payment cancelled', 'error');
}
});

handler.openIframe();
}

async function verifyPayment(reference, customer, cartSnapshot) {
showToast('Verifying payment...');
try {
const res  = await fetch(`${API_URL}/orders/verify`, {
method:  'POST',
headers: { 'Content-Type': 'application/json' },
body:    JSON.stringify({ reference, cart: cartSnapshot, customer })
});
const data = await res.json();
if (res.ok && data.order) {
cart = [];
selectedLocation = null;
if (checkoutMap) { checkoutMap.remove(); checkoutMap = null; }
checkoutMarker = null;
updateCartUI();
const ref = data.order.reference;
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
// Status badge
document.getElementById('trackRefDisplay').textContent = currentTrackRef;
const statusEl = document.getElementById('trackStatusBadge');
statusEl.textContent  = data.status?.toUpperCase() || 'PENDING';
statusEl.className    = `track-status-badge status-${data.status || 'pending'}`;

// Info grid
const items = (data.items || []).map(i => `${i.name} × 1`).join(', ');
const date  = new Date(data.date).toLocaleDateString('en-GH', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
document.getElementById('trackInfoGrid').innerHTML = `<div class="track-info-item"><span>Items</span><strong>${escHtml(items)}</strong></div> <div class="track-info-item"><span>Amount</span><strong>GHS ${Number(data.amount).toFixed(2)}</strong></div> <div class="track-info-item"><span>Rider</span><strong>${escHtml(data.riderName || 'Not yet assigned')}</strong></div> <div class="track-info-item"><span>Ordered</span><strong>${date}</strong></div>`;

// Map
initTrackMap(data);
}

function initTrackMap(data) {
const custLoc   = data.customerLocation;
const riderLoc  = data.riderLocation;

if (!custLoc?.lat) return; // No customer location pinned

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
}
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

// ===================== ADMIN LOGIN =====================
async function adminLogin() {
const username = document.getElementById('loginUsername').value.trim();
const password = document.getElementById('loginPassword').value;
const errEl    = document.getElementById('loginError');
errEl.textContent = '';
if (!username || !password) { errEl.textContent = 'Please enter username and password.'; return; }
try {
const res  = await fetch(`${API_URL}/admin/login`, {
method: 'POST', headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ username, password })
});
const data = await res.json();
if (res.ok && data.token) {
adminToken = data.token;
localStorage.setItem('gs_admin_token', adminToken);
showAdminNav(true);
showSection('admin');
showToast('Welcome back!', 'success');
} else {
errEl.textContent = data.message || 'Login failed';
}
} catch { errEl.textContent = 'Could not connect to server.'; }
}

function adminLogout() {
adminToken = null;
localStorage.removeItem('gs_admin_token');
showAdminNav(false);
showSection('shop');
showToast('Logged out');
}

function authHeaders() {
return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` };
}



// ===================== ADMIN DATA =====================
function loadAdminData() {
loadAdminProducts();
loadOrders();
loadAdminRiders();
}

async function loadAdminProducts() {
try {
const res   = await fetch(`${API_URL}/products`);
allProducts = await res.json();
renderAdminProductList(allProducts);
document.getElementById('productCount').textContent = allProducts.length;
} catch { showToast('Error loading products', 'error'); }
}

function renderAdminProductList(products) {
const el = document.getElementById('adminProductList');
if (!products.length) {
el.innerHTML = '<p style="color:var(--text-muted);font-size:14px;text-align:center;padding:40px 0">No products yet. Add one!</p>';
return;
}
el.innerHTML = products.map(p => `<div class="admin-product-row" id="adr-${p._id}"> ${p.image ?`<img class="adr-img" src="${escHtml(p.image)}" alt="" onerror="this.src=''">` : `<div class="adr-img" style="display:flex;align-items:center;justify-content:center;font-size:22px">🏅</div>`} <div class="adr-info"> <div class="adr-name">${escHtml(p.name)}</div> <div class="adr-meta">${escHtml(p.category || '—')} · Stock: ${p.stock ?? '?'}</div> </div> <div class="adr-price">GHS ${Number(p.price).toFixed(2)}</div> <div class="adr-actions"> <button class="edit-btn"   onclick="startEditProduct('${p._id}')">Edit</button> <button class="delete-btn" onclick="deleteProduct('${p._id}')">✕</button> </div> </div>`).join('');
}

async function submitProduct() {
const name        = document.getElementById('productName').value.trim();
const price       = parseFloat(document.getElementById('productPrice').value);
const stock       = parseInt(document.getElementById('productStock').value);
const category    = document.getElementById('productCategory').value;
const description = document.getElementById('productDescription').value.trim();
const image       = document.getElementById('productImage').value.trim();
const sizeType    = document.getElementById('productSizeType').value;

if (!name || isNaN(price) || price <= 0 || !category || isNaN(stock) || stock < 0) {
showToast('Please fill all required fields correctly', 'error'); return;
}

// Build sizes array based on sizeType
let sizes = [];
if (sizeType === 'clothing') {
sizes = ['S', 'M', 'L', 'XL', 'XXL'];
} else if (sizeType === 'footwear') {
sizes = ['36','37','38','39','40','41','42','43','44','45'];
} else if (sizeType === 'custom') {
const raw = document.getElementById('productCustomSizes').value.trim();
sizes = raw.split(',').map(s => s.trim()).filter(Boolean);
}

const payload   = { name, price, stock, category, description, image, sizeType, sizes };
const isEditing = !!editingProduct;
try {
const url    = isEditing ? `${API_URL}/products/${editingProduct}` : `${API_URL}/products`;
const method = isEditing ? 'PUT' : 'POST';
const res    = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(payload) });
const data   = await res.json();
if (res.ok) {
showToast(isEditing ? 'Product updated!' : 'Product added!', 'success');
resetProductForm(); loadAdminProducts(); fetchProducts();
} else if (res.status === 401) { showToast('Session expired', 'error'); adminLogout(); }
else { showToast(data.message || 'Error saving product', 'error'); }
} catch { showToast('Network error', 'error'); }
}

function startEditProduct(id) {
const product = allProducts.find(p => p._id === id);
if (!product) return;
editingProduct = id;
document.getElementById('formTitle').textContent      = 'Edit Product';
document.getElementById('productName').value          = product.name;
document.getElementById('productPrice').value         = product.price;
document.getElementById('productStock').value         = product.stock ?? 0;
document.getElementById('productCategory').value      = product.category || '';
document.getElementById('productDescription').value   = product.description || '';
document.getElementById('productImage').value         = product.image || '';
document.getElementById('productSizeType').value      = product.sizeType || 'none';
handleSizeTypeChange(product.sizeType || 'none');
if (product.sizeType === 'custom') {
document.getElementById('productCustomSizes').value = (product.sizes || []).join(', ');
}
document.getElementById('formSubmitBtn').textContent  = 'Save Changes';
document.getElementById('formCancelBtn').style.display = '';
document.getElementById('productName').scrollIntoView({ behavior: 'smooth', block: 'center' });
document.getElementById('productName').focus();
}

function resetProductForm() {
editingProduct = null;
['productName','productPrice','productStock','productDescription','productImage','productCustomSizes'].forEach(id => {
document.getElementById(id).value = '';
});
document.getElementById('productCategory').value      = '';
document.getElementById('productSizeType').value      = 'none';
document.getElementById('customSizesGroup').style.display = 'none';
document.getElementById('formTitle').textContent      = 'Add New Product';
document.getElementById('formSubmitBtn').textContent  = 'Add Product';
document.getElementById('formCancelBtn').style.display = 'none';
}

function handleSizeTypeChange(value) {
const customGroup = document.getElementById('customSizesGroup');
customGroup.style.display = value === 'custom' ? '' : 'none';
}

async function deleteProduct(id) {
const product = allProducts.find(p => p._id === id);
if (!confirm(`Delete "${product?.name || 'this product'}"? This cannot be undone.`)) return;
try {
const res = await fetch(`${API_URL}/products/${id}`, { method: 'DELETE', headers: authHeaders() });
if (res.ok) { showToast('Product deleted', 'success'); loadAdminProducts(); fetchProducts(); }
else if (res.status === 401) { showToast('Session expired', 'error'); adminLogout(); }
else showToast('Error deleting product', 'error');
} catch { showToast('Network error', 'error'); }
}

// ===================== ADMIN ORDERS =====================
async function loadOrders() {
const el = document.getElementById('ordersList');
el.innerHTML = '<p style="color:var(--text-muted);font-size:14px;padding:20px 0">Loading orders...</p>';
try {
const res    = await fetch(`${API_URL}/orders`, { headers: authHeaders() });
const orders = await res.json();
if (!res.ok) {
if (res.status === 401) { showToast('Session expired', 'error'); adminLogout(); return; }
el.innerHTML = '<p style="color:var(--red);font-size:14px">Error loading orders.</p>'; return;
}
if (!orders.length) {
el.innerHTML = '<p style="color:var(--text-muted);font-size:14px;text-align:center;padding:60px 0">No orders yet.</p>'; return;
}
el.innerHTML = orders.map(o => {
const date       = new Date(o.date).toLocaleDateString('en-GH', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
const itemsHtml  = (o.items || []).map(i => `<li>${escHtml(i.name)} — GHS ${Number(i.price).toFixed(2)}</li>`).join('');
const statusClass = `status-${o.status || 'pending'}`;
const locationHtml = o.customer?.location?.address
? `<div class="order-contact">📍 ${escHtml(o.customer.location.address)}</div>` : '';
const riderHtml = o.riderName
? `<div class="order-contact">🏍️ Rider: ${escHtml(o.riderName)}</div>` : '';
return ` <div class="order-card"> <div class="order-card-top"> <div> <div class="order-ref">Ref: ${escHtml(o.reference || '—')}</div> <div class="order-customer">${escHtml(o.customer?.name || 'Unknown')}</div> <div class="order-contact">${escHtml(o.customer?.email || '')} · ${escHtml(o.customer?.phone || '')}</div> ${locationHtml}${riderHtml} </div> <div class="order-amount">GHS ${Number(o.amount).toFixed(2)}</div> </div> <ul class="order-items">${itemsHtml}</ul> <div class="order-footer"> <span class="status-badge ${statusClass}">${o.status || 'pending'}</span> <span class="order-date">${date}</span> <select class="status-select" onchange="updateOrderStatus('${o._id}', this.value)"> <option value="">Update status...</option> <option value="pending">Pending</option> <option value="paid">Paid</option> <option value="assigned">Assigned</option> <option value="shipped">Shipped</option> <option value="delivered">Delivered</option> </select> </div> </div>`;
}).join('');
} catch {
el.innerHTML = '<p style="color:var(--red);font-size:14px">Network error loading orders.</p>';
}
}

async function updateOrderStatus(orderId, status) {
if (!status) return;
try {
const res = await fetch(`${API_URL}/orders/${orderId}/status`, {
method: 'PUT', headers: authHeaders(), body: JSON.stringify({ status })
});
if (res.ok) { showToast(`Order marked as ${status}`, 'success'); loadOrders(); }
else showToast('Error updating order status', 'error');
} catch { showToast('Network error', 'error'); }
}

// ===================== ADMIN — RIDERS =====================
async function loadAdminRiders() {
const el = document.getElementById('ridersList');
el.innerHTML = '<p style="color:var(--text-muted);font-size:14px;padding:20px 0">Loading riders...</p>';
try {
const res    = await fetch(`${API_URL}/admin/riders`, { headers: authHeaders() });
const riders = await res.json();
if (!riders.length) {
el.innerHTML = '<p style="color:var(--text-muted);font-size:14px;text-align:center;padding:60px 0">No rider applications yet.</p>';
return;
}
el.innerHTML = riders.map(r => {
const statusClass = `status-${r.status}`;
const avatar = r.passportPhotoUrl
? `<img class="rider-avatar" src="${escHtml(r.passportPhotoUrl)}" alt="" onerror="this.outerHTML='<div class=\\'rider-avatar\\'>🏍️</div>'">`
: `<div class="rider-avatar">🏍️</div>`;
return `<div class="rider-card"> ${avatar} <div class="rider-card-info"> <div class="rider-card-name">${escHtml(r.fullName)}</div> <div class="rider-card-meta"> <span>📞 ${escHtml(r.phone)}</span> <span>🪪 Ghana Card: ${escHtml(r.ghanaCardId)}</span> <span>🚗 License: ${escHtml(r.vehicleLicenseId)}</span> <span>📅 Applied: ${new Date(r.createdAt).toLocaleDateString('en-GH')}</span> </div> </div> <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start"> <span class="status-badge ${statusClass}">${r.status}</span> <div class="rider-card-actions"> ${r.status !== 'approved' ?`<button class="approve-btn" onclick="updateRiderStatus('${r._id}', 'approved')">Approve</button>`: ''} ${r.status !== 'rejected' ?`<button class="reject-rider-btn" onclick="updateRiderStatus('${r._id}', 'rejected')">Reject</button>`: ''} ${r.ghanaCardPhotoUrl ?`<a class="view-docs-btn" href="${escHtml(r.ghanaCardPhotoUrl)}" target="_blank">View ID</a>` : ''} </div> </div> </div>`;
}).join('');
} catch {
el.innerHTML = '<p style="color:var(--red);font-size:14px">Error loading riders.</p>';
}
}

async function updateRiderStatus(riderId, status) {
try {
const res = await fetch(`${API_URL}/admin/riders/${riderId}/status`, {
method: 'PUT', headers: authHeaders(), body: JSON.stringify({ status })
});
if (res.ok) { showToast(`Rider ${status}!`, 'success'); loadAdminRiders(); }
else showToast('Error updating rider', 'error');
} catch { showToast('Network error', 'error'); }
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
break;
} catch {
lastError = 'Network connection failed. Check internet/server and try again.';
}
}

errEl.textContent = lastError;
}

function riderLogout() {
riderToken = null; riderInfo = null;
localStorage.removeItem('gs_rider_token');
localStorage.removeItem('gs_rider_info');
showRiderNav(false);
if (riderSSE) { riderSSE.close(); riderSSE = null; }
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
el.innerHTML = orders.map(o => renderRiderOrderCard(o, false)).join('');
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

const actionBtns = showActions ? `<button class="accept-btn" onclick="acceptOrder('${o._id}')">✓ Accept</button> <button class="reject-btn" onclick="dismissOrder('${o._id}')">✗ Dismiss</button> ${o.customer?.location ?`<button class="view-map-btn" onclick="viewOrderMap('${o._id}', ${o.customer.location.lat}, ${o.customer.location.lng}, '${escHtml(o.customer.location.address || '')}')">🗺 Map</button>`: ''}` : `<span class="status-badge ${statusClass}">${o.status}</span> ${o.status === 'assigned' ?`<button class="delivered-btn" onclick="markDelivered('${o._id}')">✓ Mark Delivered</button>`: ''} ${o.customer?.location ?`<button class="view-map-btn" onclick="viewOrderMap('${o._id}', ${o.customer.location.lat}, ${o.customer.location.lng}, '${escHtml(o.customer.location.address || '')}')">🗺 Map</button>`: ''}`;

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