// ===================== CONFIG =====================
// FIX: Use your deployed backend URL in production. For local dev keep localhost.
const API_URL = 'https://global-sports-backend.onrender.com/api';

// FIX: Move Paystack public key out of hardcoded inline script.
// Your public key is safe client-side; private key must ONLY be in .env on the server.
const PAYSTACK_PUBLIC_KEY = 'pk_live_b53aa461435f588847cc2ed6ebbfd95b09a7b312';

// ===================== STATE =====================
let allProducts    = [];
let cart           = [];
let adminToken     = localStorage.getItem('gs_admin_token') || null;
let editingProduct = null;

// ===================== INIT =====================
window.addEventListener('DOMContentLoaded', () => {
  // Hide loader after short delay
  setTimeout(() => {
    document.getElementById('loader').classList.add('hidden');
  }, 1300);

  fetchProducts();

  // Restore admin session if token saved
  if (adminToken) {
    showAdminNav(true);
  }
});

// ===================== TOAST =====================
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  setTimeout(() => { t.className = 'toast'; }, 3000);
}

// ===================== SECTION ROUTING =====================
function showSection(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const sectionMap = {
    shop:  'shopSection',
    login: 'loginSection',
    admin: 'adminSection'
  };
  const navMap = {
    shop:  'navShop',
    admin: 'navAdmin'
  };

  const section = document.getElementById(sectionMap[name]);
  if (section) section.classList.add('active');

  const navBtn = document.getElementById(navMap[name]);
  if (navBtn) navBtn.classList.add('active');

  if (name === 'admin') loadAdminData();
}

function showAdminOrLogin() {
  if (adminToken) showSection('admin');
  else showSection('login');
}

function showAdminNav(show) {
  document.getElementById('navAdmin').style.display = show ? '' : 'none';
  document.getElementById('navLogin').style.display = show ? 'none' : '';
}

// ===================== PRODUCTS — PUBLIC =====================
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
    grid.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 12V6H4v6"/><path d="M2 6h20"/><path d="M12 6V2"/><rect x="2" y="12" width="20" height="10" rx="2"/></svg>
        <p>No products found in this category.</p>
      </div>`;
    return;
  }

  grid.innerHTML = products.map(p => {
    const imgHtml = p.image
      ? `<img class="product-card-img" src="${escHtml(p.image)}" alt="${escHtml(p.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      : '';
    const placeholderStyle = p.image ? 'style="display:none"' : '';
    const stockBadge = (p.stock !== undefined && p.stock === 0)
      ? `<span class="out-of-stock-badge">Out of Stock</span>` : '';
    const disabledAttr = (p.stock !== undefined && p.stock === 0) ? 'disabled title="Out of stock"' : '';

    return `
      <div class="product-card" data-id="${p._id}">
        ${stockBadge}
        ${imgHtml}
        <div class="product-card-img placeholder" ${placeholderStyle}>🏅</div>
        <div class="product-card-body">
          <span class="product-category">${escHtml(p.category || '')}</span>
          <div class="product-name">${escHtml(p.name)}</div>
          ${p.description ? `<div class="product-desc">${escHtml(p.description)}</div>` : ''}
        </div>
        <div class="product-footer">
          <div class="product-price"><span>GHS</span> ${Number(p.price).toFixed(2)}</div>
          <button class="add-to-cart-btn" data-product-id="${p._id}" ${disabledAttr}>+ Cart</button>
        </div>
      </div>`;
  }).join('');

  // Attach click handlers to all add-to-cart buttons
  document.querySelectorAll('.add-to-cart-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      const productId = this.getAttribute('data-product-id');
      addToCart(productId);
    });
  });
}

function filterCategory(cat, btn) {
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  const filtered = cat ? allProducts.filter(p => p.category === cat) : allProducts;
  renderProducts(filtered);
}

function handleAddToCartClick(e) {
  e.preventDefault();
  const btn = e.currentTarget;
  const productId = btn.getAttribute('data-product-id');
  if (productId) {
    addToCart(productId);
  }
}

// ===================== CART =====================
function addToCart(productId) {
  const product = allProducts.find(p => p._id === productId);
  if (!product) return;
  cart.push({ ...product });
  updateCartUI();
  showToast(`${product.name} added to cart`, 'success');
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
    return `
      <li class="cart-item">
        <div class="cart-item-info">
          <div class="cart-item-name">${escHtml(item.name)}</div>
          <div class="cart-item-price">GHS ${Number(item.price).toFixed(2)}</div>
        </div>
        <button class="cart-remove" onclick="removeFromCart(${idx})" title="Remove">✕</button>
      </li>`;
  }).join('');

  document.getElementById('cartTotal').textContent = total.toFixed(2);
}

function toggleCart() {
  const sidebar  = document.getElementById('cartSidebar');
  const overlay  = document.getElementById('cartOverlay');
  const isOpen   = sidebar.classList.contains('open');
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
  document.getElementById('checkoutOverlay').classList.add('open');
}

function closeCheckout() {
  document.getElementById('checkoutOverlay').classList.remove('open');
}

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

  const customer = { name, email, phone, address };
  const total    = cart.reduce((a, b) => a + b.price, 0);

  closeCheckout();
  toggleCart(); // close cart sidebar

  const handler = PaystackPop.setup({
    key:      PAYSTACK_PUBLIC_KEY,
    email:    customer.email,
    amount:   Math.round(total * 100), // pesewas
    currency: 'GHS',
    callback: function(res) {
      verifyPayment(res.reference, customer);
    },
    onClose: function() {
      showToast('Payment cancelled', 'error');
    }
  });

  handler.openIframe();
}

async function verifyPayment(reference, customer) {
  showToast('Verifying payment...');
  try {
    // FIX: corrected endpoint from /api/verify → /api/orders/verify
    const res  = await fetch(`${API_URL}/orders/verify`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ reference, cart, customer })
    });
    const data = await res.json();

    if (res.ok && data.order) {
      cart = [];
      updateCartUI();
      showToast('🎉 Order placed successfully! Thank you.', 'success');
    } else {
      showToast(data.message || 'Payment verification failed', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('Network error during verification', 'error');
  }
}

// ===================== ADMIN LOGIN =====================
async function adminLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl    = document.getElementById('loginError');
  errEl.textContent = '';

  if (!username || !password) {
    errEl.textContent = 'Please enter username and password.';
    return;
  }

  try {
    const res  = await fetch(`${API_URL}/admin/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password })
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
  } catch {
    errEl.textContent = 'Could not connect to server.';
  }
}

function adminLogout() {
  adminToken = null;
  localStorage.removeItem('gs_admin_token');
  showAdminNav(false);
  showSection('shop');
  showToast('Logged out');
}

// ===================== ADMIN — AUTH HEADER =====================
// FIX: always send token in Authorization header for protected routes
function authHeaders() {
  return {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${adminToken}`
  };
}

// ===================== ADMIN — LOAD DATA =====================
function loadAdminData() {
  loadAdminProducts();
  loadOrders();
}

async function loadAdminProducts() {
  try {
    const res      = await fetch(`${API_URL}/products`);
    allProducts    = await res.json();
    renderAdminProductList(allProducts);
    document.getElementById('productCount').textContent = allProducts.length;
  } catch {
    showToast('Error loading products', 'error');
  }
}

function renderAdminProductList(products) {
  const el = document.getElementById('adminProductList');
  if (!products.length) {
    el.innerHTML = '<p style="color:var(--text-muted);font-size:14px;text-align:center;padding:40px 0">No products yet. Add one!</p>';
    return;
  }
  el.innerHTML = products.map(p => `
    <div class="admin-product-row" id="adr-${p._id}">
      ${p.image
        ? `<img class="adr-img" src="${escHtml(p.image)}" alt="" onerror="this.src=''">`
        : `<div class="adr-img" style="display:flex;align-items:center;justify-content:center;font-size:22px">🏅</div>`}
      <div class="adr-info">
        <div class="adr-name">${escHtml(p.name)}</div>
        <div class="adr-meta">${escHtml(p.category || '—')} · Stock: ${p.stock ?? '?'}</div>
      </div>
      <div class="adr-price">GHS ${Number(p.price).toFixed(2)}</div>
      <div class="adr-actions">
        <button class="edit-btn"   onclick="startEditProduct('${p._id}')">Edit</button>
        <button class="delete-btn" onclick="deleteProduct('${p._id}')">✕</button>
      </div>
    </div>`).join('');
}

// ===================== ADMIN — ADD PRODUCT =====================
async function submitProduct() {
  const name        = document.getElementById('productName').value.trim();
  const price       = parseFloat(document.getElementById('productPrice').value);
  const stock       = parseInt(document.getElementById('productStock').value);
  const category    = document.getElementById('productCategory').value;
  const description = document.getElementById('productDescription').value.trim();
  const image       = document.getElementById('productImage').value.trim();

  if (!name || isNaN(price) || price <= 0 || !category || isNaN(stock) || stock < 0) {
    showToast('Please fill all required fields correctly', 'error');
    return;
  }

  const payload = { name, price, stock, category, description, image };
  const isEditing = !!editingProduct;

  try {
    const url    = isEditing ? `${API_URL}/products/${editingProduct}` : `${API_URL}/products`;
    const method = isEditing ? 'PUT' : 'POST';

    const res  = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();

    if (res.ok) {
      showToast(isEditing ? 'Product updated!' : 'Product added!', 'success');
      resetProductForm();
      loadAdminProducts();
      fetchProducts(); // also refresh shop
    } else if (res.status === 401) {
      showToast('Session expired. Please log in again.', 'error');
      adminLogout();
    } else {
      showToast(data.message || 'Error saving product', 'error');
    }
  } catch {
    showToast('Network error', 'error');
  }
}

// ===================== ADMIN — EDIT PRODUCT =====================
function startEditProduct(id) {
  const product = allProducts.find(p => p._id === id);
  if (!product) return;

  editingProduct = id;
  document.getElementById('formTitle').textContent       = 'Edit Product';
  document.getElementById('productName').value          = product.name;
  document.getElementById('productPrice').value         = product.price;
  document.getElementById('productStock').value         = product.stock ?? 0;
  document.getElementById('productCategory').value      = product.category || '';
  document.getElementById('productDescription').value   = product.description || '';
  document.getElementById('productImage').value         = product.image || '';
  document.getElementById('formSubmitBtn').textContent  = 'Save Changes';
  document.getElementById('formCancelBtn').style.display = '';

  // Scroll to form
  document.getElementById('productName').scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('productName').focus();
}

function resetProductForm() {
  editingProduct = null;
  ['productName','productPrice','productStock','productDescription','productImage'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('productCategory').value     = '';
  document.getElementById('formTitle').textContent     = 'Add New Product';
  document.getElementById('formSubmitBtn').textContent = 'Add Product';
  document.getElementById('formCancelBtn').style.display = 'none';
}

// ===================== ADMIN — DELETE PRODUCT =====================
async function deleteProduct(id) {
  const product = allProducts.find(p => p._id === id);
  if (!confirm(`Delete "${product?.name || 'this product'}"? This cannot be undone.`)) return;

  try {
    const res = await fetch(`${API_URL}/products/${id}`, {
      method:  'DELETE',
      headers: authHeaders()
    });

    if (res.ok) {
      showToast('Product deleted', 'success');
      loadAdminProducts();
      fetchProducts();
    } else if (res.status === 401) {
      showToast('Session expired. Please log in again.', 'error');
      adminLogout();
    } else {
      showToast('Error deleting product', 'error');
    }
  } catch {
    showToast('Network error', 'error');
  }
}

// ===================== ADMIN — ORDERS =====================
async function loadOrders() {
  const el = document.getElementById('ordersList');
  el.innerHTML = '<p style="color:var(--text-muted);font-size:14px;padding:20px 0">Loading orders...</p>';

  try {
    const res    = await fetch(`${API_URL}/orders`, { headers: authHeaders() });
    const orders = await res.json();

    if (!res.ok) {
      if (res.status === 401) { showToast('Session expired', 'error'); adminLogout(); return; }
      el.innerHTML = '<p style="color:var(--red);font-size:14px">Error loading orders.</p>';
      return;
    }

    if (!orders.length) {
      el.innerHTML = '<p style="color:var(--text-muted);font-size:14px;text-align:center;padding:60px 0">No orders yet.</p>';
      return;
    }

    el.innerHTML = orders.map(o => {
      const date     = new Date(o.date).toLocaleDateString('en-GH', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
      const itemsHtml = (o.items || []).map(i => `<li>${escHtml(i.name)} — GHS ${Number(i.price).toFixed(2)}</li>`).join('');
      const statusClass = `status-${o.status || 'pending'}`;

      return `
        <div class="order-card">
          <div class="order-card-top">
            <div>
              <div class="order-ref">Ref: ${escHtml(o.reference || '—')}</div>
              <div class="order-customer">${escHtml(o.customer?.name || 'Unknown')}</div>
              <div class="order-contact">${escHtml(o.customer?.email || '')} · ${escHtml(o.customer?.phone || '')}</div>
              ${o.customer?.address ? `<div class="order-contact">📍 ${escHtml(o.customer.address)}</div>` : ''}
            </div>
            <div class="order-amount">GHS ${Number(o.amount).toFixed(2)}</div>
          </div>
          <ul class="order-items">${itemsHtml}</ul>
          <div class="order-footer">
            <span class="status-badge ${statusClass}">${o.status || 'pending'}</span>
            <span class="order-date">${date}</span>
            <select class="status-select" onchange="updateOrderStatus('${o._id}', this.value)">
              <option value="">Update status...</option>
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
              <option value="shipped">Shipped</option>
              <option value="delivered">Delivered</option>
            </select>
          </div>
        </div>`;
    }).join('');

  } catch {
    el.innerHTML = '<p style="color:var(--red);font-size:14px">Network error loading orders.</p>';
  }
}

async function updateOrderStatus(orderId, status) {
  if (!status) return;
  try {
    const res = await fetch(`${API_URL}/orders/${orderId}/status`, {
      method:  'PUT',
      headers: authHeaders(),
      body:    JSON.stringify({ status })
    });
    if (res.ok) {
      showToast(`Order marked as ${status}`, 'success');
      loadOrders();
    } else {
      showToast('Error updating order status', 'error');
    }
  } catch {
    showToast('Network error', 'error');
  }
}

// ===================== DASHBOARD TABS =====================
function switchDashTab(name, btn) {
  document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.dash-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`dash${name.charAt(0).toUpperCase() + name.slice(1)}`).classList.add('active');
  if (name === 'orders') loadOrders();
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
