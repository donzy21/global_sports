require('dotenv').config();
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ================= MIDDLEWARE =================
app.use(cors({ origin: '*' }));
app.use((req, res, next) => {
  // Allow resources from this backend to be embedded/loaded by other origins.
  // If you later serve everything from one site only, change this to `same-site`.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});
app.use(express.json());

// ================= KEEP-ALIVE ROUTE =================
app.get('/ping', (req, res) => {
  console.log('Keep-alive heartbeat received at:', new Date().toISOString());
  res.status(200).send('Server is awake');
});

// ================= CONFIGURATION =================
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET || process.env.SECRET_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'secret123';
const RIDER_JWT_SECRET = process.env.RIDER_JWT_SECRET || 'rider_secret_456';
const SHOP_LOCATION = {
  // Default base location is Kumasi unless overridden by environment variables.
  lat: Number(process.env.SHOP_LAT || 6.6885),
  lng: Number(process.env.SHOP_LNG || -1.6244),
  address: process.env.SHOP_ADDRESS || 'Global Sports Store, Kumasi'
};

const TWILIO_ACCOUNT_SID   = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN    = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM;
const ADMIN_WHATSAPP_TO    = process.env.ADMIN_WHATSAPP_TO;
const CHAT_RETENTION_DAYS = Math.max(1, Number(process.env.CHAT_RETENTION_DAYS || 90));
const CHAT_RETENTION_SECONDS = CHAT_RETENTION_DAYS * 24 * 60 * 60;
const CHAT_RETENTION_SWEEP_MS = Math.max(60 * 60 * 1000, Number(process.env.CHAT_RETENTION_SWEEP_MS || (6 * 60 * 60 * 1000)));

// ================= DATABASE CONNECTION =================
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// ================= MODELS =================
const Product = mongoose.model('Product', new mongoose.Schema({
  name:        { type: String, required: true },
  price:       { type: Number, required: true },
  category:    { type: String, default: '' },
  description: { type: String, default: '' },
  image:       { type: String, default: '' },
  stock:       { type: Number, default: 0 },
  sizeType:    { type: String, enum: ['none', 'clothing', 'footwear', 'custom'], default: 'none' },
  sizes:       { type: [String], default: [] }
}));

const Order = mongoose.model('Order', new mongoose.Schema({
  reference: String,
  subtotal: { type: Number, default: 0 },
  deliveryFee: { type: Number, default: 0 },
  deliveryDistanceKm: { type: Number, default: 0 },
  deliveryDurationMin: { type: Number, default: 0 },
  chatToken: { type: String, default: () => crypto.randomBytes(16).toString('hex'), index: true },
  items:     Array,
  amount:    Number,
  customer: {
    name:    String,
    email:   String,
    phone:   String,
    address: String,
    location: {
      lat: Number,
      lng: Number,
      address: String
    }
  },
  status:      { type: String, default: 'pending' },
  riderId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Rider', default: null },
  riderName:   { type: String, default: null },
  riderLocation: {
    lat:       { type: Number, default: null },
    lng:       { type: Number, default: null },
    updatedAt: { type: Date, default: null }
  },
  date:        { type: Date, default: Date.now }
}));

const ChatMessage = mongoose.model('ChatMessage', new mongoose.Schema({
  reference: { type: String, index: true, required: true },
  senderRole: { type: String, enum: ['customer', 'rider', 'admin', 'system'], required: true },
  senderId: { type: String, default: null },
  senderName: { type: String, required: true },
  text: { type: String, required: true },
  // TTL index keeps chat history bounded on free-tier MongoDB.
  createdAt: { type: Date, default: Date.now, expires: CHAT_RETENTION_SECONDS }
}));

async function runChatRetentionSweep() {
  try {
    const cutoff = new Date(Date.now() - CHAT_RETENTION_SECONDS * 1000);
    const result = await ChatMessage.deleteMany({ createdAt: { $lt: cutoff } });
    if (result.deletedCount) {
      console.log(`Chat retention sweep removed ${result.deletedCount} messages older than ${CHAT_RETENTION_DAYS} days`);
    }
  } catch (err) {
    console.warn('Chat retention sweep failed:', err.message);
  }
}

async function ensureChatIndexes() {
  try {
    await ChatMessage.collection.createIndex({ createdAt: 1 }, {
      expireAfterSeconds: CHAT_RETENTION_SECONDS,
      name: 'chat_createdAt_ttl'
    });
    console.log(`Chat TTL index ready (${CHAT_RETENTION_DAYS} days retention)`);
  } catch (err) {
    console.warn('Chat TTL index setup warning:', err.message);
  }
}

const Admin = mongoose.model('Admin', new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }
}));

const Rider = mongoose.model('Rider', new mongoose.Schema({
  fullName:        { type: String, required: true },
  phone:           { type: String, required: true, unique: true },
  password:        { type: String, required: true },
  ghanaCardId:     { type: String, required: true },
  vehicleLicenseId:{ type: String, required: true },
  passportPhotoUrl:{ type: String, default: '' },
  ghanaCardPhotoUrl:{ type: String, default: '' },
  status:          { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  isAvailable:     { type: Boolean, default: true },
  createdAt:       { type: Date, default: Date.now }
}));

async function initializeDbMaintenance() {
  await ensureChatIndexes();
  await runChatRetentionSweep();
  setInterval(runChatRetentionSweep, CHAT_RETENTION_SWEEP_MS);
}

if (mongoose.connection.readyState === 1) {
  initializeDbMaintenance().catch(err => console.warn('DB maintenance init failed:', err.message));
} else {
  mongoose.connection.once('open', () => {
    initializeDbMaintenance().catch(err => console.warn('DB maintenance init failed:', err.message));
  });
}

async function healthHandler(req, res) {
  const startedAt = Date.now();
  const stateMap = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const dbState = stateMap[mongoose.connection.readyState] || 'unknown';
  let db = { ok: false, state: dbState, latencyMs: null, error: null };

  if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
    try {
      await mongoose.connection.db.admin().ping();
      db.ok = true;
      db.latencyMs = Date.now() - startedAt;
    } catch (err) {
      db.error = err.message;
    }
  } else {
    db.error = 'Database is not connected';
  }

  const body = {
    ok: db.ok,
    service: 'global-sports-backend',
    timestamp: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    env: process.env.NODE_ENV || 'development',
    db,
    chatRetentionDays: CHAT_RETENTION_DAYS
  };

  res.status(db.ok ? 200 : 503).json(body);
}

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// ================= SSE REAL-TIME =================
const riderClients = new Map();
function notifyRiders(event, data) {
  riderClients.forEach((res) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}

function normalizeLocation(location) {
  if (!location || location.lat == null || location.lng == null) return null;
  return { lat: Number(location.lat), lng: Number(location.lng) };
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const aa = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
}

async function getRouteMetrics(origin, destination) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=false`;
    const response = await axios.get(url, { timeout: 8000 });
    const route = response.data?.routes?.[0];
    if (route) {
      return {
        distanceKm: route.distance / 1000,
        durationMin: route.duration / 60
      };
    }
  } catch (err) {
    console.warn('Route lookup failed, using straight-line fallback:', err.message);
  }

  const distanceKm = haversineKm(origin, destination);
  const durationMin = Math.max(5, (distanceKm / 28) * 60);
  return { distanceKm, durationMin };
}

function roundToNearestHalf(value) {
  return Math.round(value * 2) / 2;
}

function calculateDeliveryFee(distanceKm, durationMin) {
  // Realistic urban courier pricing for Accra (motorbike delivery)
  // Tuned to common market bands: short trips ~12-16 GHS, medium ~16-24 GHS.
  const safeDistance = Math.max(0, Number(distanceKm) || 0);
  const safeDuration = Math.max(1, Number(durationMin) || 1);

  const pickupFee = 7.0;
  const serviceFee = 2.0;
  const minimumFare = 12.0;

  // Tiered per-km rates
  const firstBandKm = 2;
  const secondBandKm = 8;
  const firstBandRate = 2.2;   // 0-2 km
  const secondBandRate = 1.6;  // 2-8 km
  const longHaulRate = 1.2;    // 8+ km

  const firstBandDistance = Math.min(safeDistance, firstBandKm);
  const secondBandDistance = Math.max(0, Math.min(safeDistance, secondBandKm) - firstBandKm);
  const longHaulDistance = Math.max(0, safeDistance - secondBandKm);

  const distanceComponent =
    (firstBandDistance * firstBandRate) +
    (secondBandDistance * secondBandRate) +
    (longHaulDistance * longHaulRate);

  // Traffic surcharge applies only for delay beyond baseline travel expectation.
  const baselineDuration = Math.max(8, safeDistance * 3.2);
  const trafficDelayMin = Math.max(0, safeDuration - baselineDuration);
  const trafficSurcharge = Math.min(6, trafficDelayMin * 0.12);

  // Peak period multiplier (moderate, avoids price shocks)
  const hour = new Date().getHours();
  const isPeakHour = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 20);
  const peakMultiplier = isPeakHour ? 1.1 : 1.0;

  const rawFee = (pickupFee + serviceFee + distanceComponent + trafficSurcharge) * peakMultiplier;
  const finalFee = Math.max(minimumFare, rawFee);

  return roundToNearestHalf(finalFee);
}

async function buildDeliveryQuote(customerLocation, adminLocation = null) {
  const destination = normalizeLocation(customerLocation);
  if (!destination) {
    return { distanceKm: 0, durationMin: 0, deliveryFee: 0, requiresLocation: true };
  }

  const origin = normalizeLocation(adminLocation) || normalizeLocation(SHOP_LOCATION);
  const { distanceKm, durationMin } = await getRouteMetrics(origin, destination);
  const deliveryFee = calculateDeliveryFee(distanceKm, durationMin);

  return {
    distanceKm: Number(distanceKm.toFixed(2)),
    durationMin: Math.max(1, Math.round(durationMin)),
    deliveryFee,
    requiresLocation: false,
    shopLocation: SHOP_LOCATION,
    adminLocation: origin
  };
}

function chatRoom(reference) {
  return `order:${reference}`;
}

async function authorizeChatAccess(reference, access = {}) {
  const order = await Order.findOne({ reference });
  if (!order) return { ok: false, status: 404, message: 'Order not found' };

  if (!order.chatToken) {
    order.chatToken = crypto.randomBytes(16).toString('hex');
    await order.save();
  }

  if (access.role === 'customer') {
    if (!access.chatToken || access.chatToken !== order.chatToken) {
      return { ok: false, status: 401, message: 'Invalid chat token' };
    }
    return { ok: true, order };
  }

  if (access.role === 'rider') {
    try {
      const rider = jwt.verify(access.token, RIDER_JWT_SECRET);
      if (order.riderId && String(order.riderId) !== String(rider.id)) {
        return { ok: false, status: 403, message: 'This order is not assigned to you' };
      }
      return { ok: true, order, rider };
    } catch {
      return { ok: false, status: 401, message: 'Invalid rider token' };
    }
  }

  if (access.role === 'admin') {
    try {
      const admin = jwt.verify(access.token, JWT_SECRET);
      return { ok: true, order, admin };
    } catch {
      return { ok: false, status: 401, message: 'Invalid admin token' };
    }
  }

  return { ok: false, status: 400, message: 'Unsupported chat role' };
}

// ================= AUTH MIDDLEWARE (FIXED) =================
const authenticate = (req, res, next) => {
  const authHeader = req.headers['authorization'] || '';
  // FIX: Properly handle Bearer prefix and fallback to query token
  let token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  if (!token && req.query && req.query.token) token = req.query.token;
  
  if (!token) return res.status(401).json({ message: 'No token provided' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};

const authenticateRider = (req, res, next) => {
  const authHeader = req.headers['authorization'] || '';
  // FIX: Properly handle Bearer prefix and fallback to query token
  let token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  if (!token && req.query && req.query.token) token = req.query.token;

  if (!token) return res.status(401).json({ message: 'No token provided' });
  try {
    req.rider = jwt.verify(token, RIDER_JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};

// ================= WHATSAPP NOTIFICATIONS =================
async function sendWhatsAppNotification(order) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM || !ADMIN_WHATSAPP_TO) {
    console.log('WhatsApp env vars not set - skipping notification');
    return;
  }
  const itemList = order.items.map(i => `• ${i.name} — GHS ${i.price}`).join('\n');
  const message =
  `📦 *New Order | Global Sports*\n\n` +
  `*Customer:* ${order.customer.name}\n` +
  `*Phone:* ${order.customer.phone}\n` +
  `*Email:* ${order.customer.email}\n` +
  (order.customer.location?.address ? `*Location:* ${order.customer.location.address}\n` : '') +
  `\n*Items:*\n${itemList}\n\n` +
  `*Total:* GHS ${order.amount.toFixed(2)}\n` +
  `*Ref:* ${order.reference}`;
  try {
    await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      new URLSearchParams({ From: TWILIO_WHATSAPP_FROM, To: ADMIN_WHATSAPP_TO, Body: message }),
      { auth: { username: TWILIO_ACCOUNT_SID, password: TWILIO_AUTH_TOKEN }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    console.log('WhatsApp notification sent');
  } catch (err) {
    console.error('WhatsApp notification failed:', err.response?.data || err.message);
  }
}

// ================= ADMIN ROUTES =================
app.post('/api/admin/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ message: 'Fill all fields' });
  try {
    const hashed = await bcrypt.hash(password, 10);
    const admin = await Admin.create({ username, password: hashed });
    res.json({ message: 'Admin created', admin });
  } catch {
    res.status(400).json({ message: 'Username already exists' });
  }
});

app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  const admin = await Admin.findOne({ username });
  if (!admin) return res.status(400).json({ message: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, admin.password);
  if (!valid) return res.status(400).json({ message: 'Invalid credentials' });
  const token = jwt.sign({ id: admin._id, username: admin.username }, JWT_SECRET, { expiresIn: '1d' });
  res.json({ message: 'Login successful', token });
});

// ================= PRODUCT ROUTES =================
app.get('/api/products', async (req, res) => {
  const products = await Product.find();
  res.json(products);
});

app.post('/api/products', authenticate, async (req, res) => {
  try {
    const product = await Product.create(req.body);
    res.json({ message: 'Product added', product });
  } catch (err) {
    res.status(400).json({ message: 'Error adding product', error: err.message });
  }
});

app.put('/api/products/:id', authenticate, async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json({ message: 'Product updated', product });
  } catch (err) {
    res.status(400).json({ message: 'Error updating product', error: err.message });
  }
});

app.delete('/api/products/:id', authenticate, async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(400).json({ message: 'Error deleting product', error: err.message });
  }
});

// ================= ORDER ROUTES =================
app.post('/api/orders/verify', async (req, res) => {
  const { reference, cart, customer } = req.body;
  try {
    if (!customer?.location) {
      return res.status(400).json({ message: 'Please pin your delivery location so we can calculate distance-based delivery fees.' });
    }
    const subtotal = cart.reduce((a, b) => a + Number(b.price || 0), 0);
    const deliveryQuote = await buildDeliveryQuote(customer.location);
    const expectedTotal = subtotal + deliveryQuote.deliveryFee;

    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
    );
    if (response.data.data.status === 'success') {
      const paidAmount = Number(response.data.data.amount || 0) / 100;
      if (Math.abs(paidAmount - expectedTotal) > 0.5) {
        return res.status(400).json({ message: 'Payment amount does not match the quoted delivery total.' });
      }
      const order = await Order.create({
        reference,
        subtotal,
        deliveryFee: deliveryQuote.deliveryFee,
        deliveryDistanceKm: deliveryQuote.distanceKm,
        deliveryDurationMin: deliveryQuote.durationMin,
        chatToken: crypto.randomBytes(16).toString('hex'),
        items: cart,
        amount: expectedTotal,
        customer,
        status: 'paid'
      });
      await sendWhatsAppNotification(order);
      notifyRiders('new_order', {
        orderId:  order._id,
        reference: order.reference,
        items:    order.items,
        amount:   order.amount,
        deliveryFee: order.deliveryFee,
        distanceKm: order.deliveryDistanceKm,
        customer: {
          name:     order.customer.name,
          phone:    order.customer.phone,
          address:  order.customer.address,
          location: order.customer.location
        },
        date: order.date
      });
      return res.json({ message: 'Payment verified & order saved', order, deliveryQuote });
    } else {
      return res.json({ message: 'Payment failed or incomplete' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error verifying payment' });
  }
});

app.get('/api/orders', authenticate, async (req, res) => {
  const orders = await Order.find().sort({ date: -1 });
  res.json(orders);
});

// ================= DELIVERY QUOTE =================
app.get('/api/delivery/quote', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const originLat = req.query.originLat == null ? null : Number(req.query.originLat);
    const originLng = req.query.originLng == null ? null : Number(req.query.originLng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ message: 'lat and lng are required' });
    }
    let adminOrigin = null;
    if (originLat != null || originLng != null) {
      if (Number.isNaN(originLat) || Number.isNaN(originLng)) {
        return res.status(400).json({ message: 'originLat and originLng must both be valid numbers when provided' });
      }
      adminOrigin = { lat: originLat, lng: originLng };
    }

    const quote = await buildDeliveryQuote({ lat, lng }, adminOrigin);
    res.json(quote);
  } catch (err) {
    res.status(500).json({ message: 'Error calculating delivery quote', error: err.message });
  }
});

// ================= RIDER SSE =================
app.get('/api/riders/notifications', authenticateRider, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const riderId = req.rider.id;
  riderClients.set(riderId, res);

  const heartbeat = setInterval(() => {
    res.write('event: heartbeat\ndata: ping\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    riderClients.delete(riderId);
  });
});

// ================= TRACKING =================
app.get('/api/track/:reference', async (req, res) => {
  try {
    const order = await Order.findOne({ reference: req.params.reference });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (!order.chatToken) {
      order.chatToken = crypto.randomBytes(16).toString('hex');
      await order.save();
    }
    res.json({
      reference:       order.reference,
      status:          order.status,
      riderName:       order.riderName || null,
      riderLocation:   order.riderLocation || null,
      customerLocation: order.customer?.location || null,
      customerName:    order.customer?.name || null,
      subtotal:        order.subtotal || 0,
      deliveryFee:     order.deliveryFee || 0,
      deliveryDistanceKm: order.deliveryDistanceKm || 0,
      deliveryDurationMin: order.deliveryDurationMin || 0,
      chatToken:       order.chatToken || null,
      amount:          order.amount,
      items:           order.items,
      date:            order.date
    });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching tracking info' });
  }
});


// ================= ORDER STATUS UPDATE =================
app.put('/api/orders/:id/status', authenticate, async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(
      req.params.id, { status: req.body.status }, { new: true }
    );
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.json({ message: 'Order status updated', order });
  } catch (err) {
    res.status(400).json({ message: 'Error updating order', error: err.message });
  }
});

// ================= RIDER REGISTER =================
app.post('/api/riders/register', async (req, res) => {
  const { fullName, phone, password, ghanaCardId, vehicleLicenseId } = req.body;
  if (!fullName || !phone || !password || !ghanaCardId || !vehicleLicenseId)
    return res.status(400).json({ message: 'Please fill all required fields' });
  try {
    const hashed = await bcrypt.hash(password, 10);
    const rider  = await Rider.create({ fullName, phone, password: hashed, ghanaCardId, vehicleLicenseId });
    res.json({ message: 'Registration submitted! Await admin approval.', rider });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: 'Phone number already registered' });
    res.status(400).json({ message: 'Error registering rider', error: err.message });
  }
});

// ================= RIDER LOGIN =================
app.post('/api/riders/login', async (req, res) => {
  const { phone, password } = req.body;
  const rider = await Rider.findOne({ phone });
  if (!rider) return res.status(400).json({ message: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, rider.password);
  if (!valid) return res.status(400).json({ message: 'Invalid credentials' });
  if (rider.status === 'pending')  return res.status(403).json({ message: 'Your account is pending admin approval' });
  if (rider.status === 'rejected') return res.status(403).json({ message: 'Your account has been rejected. Contact admin.' });
  const token = jwt.sign(
    { id: rider._id, fullName: rider.fullName, phone: rider.phone },
    RIDER_JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.json({
    message: 'Login successful', token,
    rider: { id: rider._id, fullName: rider.fullName, phone: rider.phone, status: rider.status, isAvailable: rider.isAvailable }
  });
});

// ================= RIDER AVAILABLE ORDERS =================
app.get('/api/riders/orders/available', authenticateRider, async (req, res) => {
  try {
    const orders = await Order.find({ status: 'paid', riderId: null }).sort({ date: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching orders' });
  }
});

// ================= RIDER MY ORDERS =================
app.get('/api/riders/orders/mine', authenticateRider, async (req, res) => {
  try {
    const orders = await Order.find({ riderId: req.rider.id }).sort({ date: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching orders' });
  }
});

// ================= RIDER ACCEPT ORDER =================
app.put('/api/riders/orders/:id/accept', authenticateRider, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.riderId) return res.status(400).json({ message: 'Order already taken by another rider' });
    const updated = await Order.findByIdAndUpdate(
      req.params.id,
      { riderId: req.rider.id, riderName: req.rider.fullName, status: 'assigned' },
      { new: true }
    );
    notifyRiders('order_taken', { orderId: req.params.id });
    res.json({ message: 'Order accepted', order: updated });
  } catch (err) {
    res.status(500).json({ message: 'Error accepting order' });
  }
});

// ================= RIDER REJECT ORDER =================
app.put('/api/riders/orders/:id/reject', authenticateRider, async (req, res) => {
  res.json({ message: 'Order dismissed' });
});

// ================= RIDER MARK DELIVERED =================
app.put('/api/riders/orders/:id/delivered', authenticateRider, async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(
      req.params.id, { status: 'delivered' }, { new: true }
    );
    res.json({ message: 'Order marked as delivered', order });
  } catch (err) {
    res.status(500).json({ message: 'Error updating order' });
  }
});

// ================= RIDER AVAILABILITY =================
app.put('/api/riders/availability', authenticateRider, async (req, res) => {
  try {
    const rider = await Rider.findByIdAndUpdate(
      req.rider.id, { isAvailable: req.body.isAvailable }, { new: true }
    );
    res.json({ message: 'Availability updated', isAvailable: rider.isAvailable });
  } catch (err) {
    res.status(500).json({ message: 'Error updating availability' });
  }
});

// ================= RIDER LOCATION UPDATE =================
app.put('/api/riders/location', authenticateRider, async (req, res) => {
  const { lat, lng, orderId } = req.body;
  if (!lat || !lng) return res.status(400).json({ message: 'lat and lng required' });
  try {
    if (orderId) {
      await Order.findByIdAndUpdate(orderId, {
        riderLocation: { lat, lng, updatedAt: new Date() }
      });
    }
    res.json({ message: 'Location updated' });
  } catch (err) {
    res.status(500).json({ message: 'Error updating location' });
  }
});

// ================= CHAT =================
app.get('/api/chat/:reference/messages', async (req, res) => {
  try {
    const access = {
      role: req.query.role || 'customer',
      token: req.query.token || req.headers.authorization?.replace(/^Bearer\s+/i, ''),
      chatToken: req.query.chatToken || req.query.token
    };
    const auth = await authorizeChatAccess(req.params.reference, access);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    const messages = await ChatMessage.find({ reference: req.params.reference }).sort({ createdAt: 1 }).limit(200);
    res.json({
      reference: req.params.reference,
      messages: messages.map(msg => ({
        id: msg._id,
        senderRole: msg.senderRole,
        senderName: msg.senderName,
        text: msg.text,
        createdAt: msg.createdAt
      }))
    });
  } catch (err) {
    res.status(500).json({ message: 'Error loading messages', error: err.message });
  }
});

app.post('/api/chat/:reference/messages', async (req, res) => {
  try {
    const { senderRole, senderName, text, chatToken, token } = req.body;
    const access = { role: senderRole, token, chatToken };
    const auth = await authorizeChatAccess(req.params.reference, access);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    const cleanText = String(text || '').trim();
    if (!cleanText) return res.status(400).json({ message: 'Message cannot be empty' });

    const message = await ChatMessage.create({
      reference: req.params.reference,
      senderRole,
      senderId: auth.rider?.id || auth.admin?.id || null,
      senderName: String(senderName || auth.rider?.fullName || auth.admin?.username || 'Guest').trim(),
      text: cleanText
    });

    const payload = {
      id: message._id,
      reference: message.reference,
      senderRole: message.senderRole,
      senderName: message.senderName,
      text: message.text,
      createdAt: message.createdAt
    };

    io.to(chatRoom(req.params.reference)).emit('chat:message', payload);
    res.json({ message: 'Message sent', chatMessage: payload });
  } catch (err) {
    res.status(500).json({ message: 'Error sending message', error: err.message });
  }
});

io.on('connection', (socket) => {
  console.log('🔌 New Socket.IO connection:', socket.id);
  
  socket.on('chat:join', async (payload = {}, ack) => {
    try {
      const reference = String(payload.reference || '').trim();
      const role = String(payload.role || '').trim();
      console.log(`📨 [${socket.id}] chat:join - reference: ${reference}, role: ${role}`);
      
      const auth = await authorizeChatAccess(reference, {
        role,
        token: payload.token,
        chatToken: payload.chatToken
      });
      if (!auth.ok) {
        console.error(`❌ [${socket.id}] Auth failed: ${auth.message}`);
        if (typeof ack === 'function') ack({ ok: false, message: auth.message });
        return;
      }

      socket.data.chat = {
        reference,
        role,
        name: String(payload.name || auth.order?.customer?.name || auth.rider?.fullName || auth.admin?.username || 'Guest').trim(),
        token: payload.token || null,
        chatToken: payload.chatToken || null
      };
      socket.join(chatRoom(reference));
      console.log(`✅ [${socket.id}] Joined room: ${chatRoom(reference)}`);

      const messages = await ChatMessage.find({ reference }).sort({ createdAt: 1 }).limit(200);
      console.log(`📤 [${socket.id}] Sending ${messages.length} messages to history`);
      
      socket.emit('chat:history', {
        reference,
        messages: messages.map(msg => ({
          id: msg._id,
          senderRole: msg.senderRole,
          senderName: msg.senderName,
          text: msg.text,
          createdAt: msg.createdAt
        }))
      });

      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      console.error(`❌ [${socket.id}] Error in chat:join:`, err.message);
      if (typeof ack === 'function') ack({ ok: false, message: err.message });
    }
  });

  socket.on('chat:message', async (payload = {}, ack) => {
    try {
      const chat = socket.data.chat;
      if (!chat?.reference) {
        console.error(`❌ [${socket.id}] Not in a chat room`);
        if (typeof ack === 'function') ack({ ok: false, message: 'Join a chat room first' });
        return;
      }

      const cleanText = String(payload.text || '').trim();
      if (!cleanText) {
        if (typeof ack === 'function') ack({ ok: false, message: 'Message cannot be empty' });
        return;
      }

      console.log(`💬 [${socket.id}] Sending message to ${chat.reference}: "${cleanText.substring(0, 50)}..."`);
      
      const auth = await authorizeChatAccess(chat.reference, {
        role: chat.role,
        token: chat.token,
        chatToken: chat.chatToken
      });
      if (!auth.ok) {
        console.error(`❌ [${socket.id}] Re-auth failed: ${auth.message}`);
        if (typeof ack === 'function') ack({ ok: false, message: auth.message });
        return;
      }

      const message = await ChatMessage.create({
        reference: chat.reference,
        senderRole: chat.role,
        senderId: auth.rider?.id || auth.admin?.id || null,
        senderName: String(payload.senderName || chat.name || auth.rider?.fullName || auth.admin?.username || 'Guest').trim(),
        text: cleanText
      });

      const outgoing = {
        id: message._id,
        reference: message.reference,
        senderRole: message.senderRole,
        senderName: message.senderName,
        text: message.text,
        createdAt: message.createdAt
      };

      console.log(`📡 [${socket.id}] Broadcasting message to room: ${chatRoom(chat.reference)}`);
      io.to(chatRoom(chat.reference)).emit('chat:message', outgoing);
      if (typeof ack === 'function') ack({ ok: true, message: outgoing });
    } catch (err) {
      console.error(`❌ [${socket.id}] Error in chat:message:`, err.message);
      if (typeof ack === 'function') ack({ ok: false, message: err.message });
    }
  });

  socket.on('disconnect', () => {
    console.log(`👋 Socket disconnected: ${socket.id}`);
  });
});

// ================= ADMIN GET ALL RIDERS =================
app.get('/api/admin/riders', authenticate, async (req, res) => {
  const riders = await Rider.find().sort({ createdAt: -1 });
  res.json(riders);
});

// ================= ADMIN APPROVE/REJECT RIDER =================
app.put('/api/admin/riders/:id/status', authenticate, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status))
      return res.status(400).json({ message: 'Invalid status' });
    const rider = await Rider.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!rider) return res.status(404).json({ message: 'Rider not found' });
    res.json({ message: `Rider ${status}`, rider });
  } catch (err) {
    res.status(400).json({ message: 'Error updating rider', error: err.message });
  }
});

// ================= ADMIN DELETE RIDER =================
app.delete('/api/admin/riders/:id', authenticate, async (req, res) => {
  try {
    await Rider.findByIdAndDelete(req.params.id);
    res.json({ message: 'Rider deleted' });
  } catch (err) {
    res.status(400).json({ message: 'Error deleting rider' });
  }
});

// ================= ADMIN DASHBOARD STATS =================
app.get('/api/admin/dashboard/stats', authenticate, async (req, res) => {
  try {
    const totalOrders = await Order.countDocuments();
    const totalProducts = await Product.countDocuments();
    const totalRiders = await Rider.countDocuments();
    const pendingRiders = await Rider.countDocuments({ status: 'pending' });
    const totalRevenue = (await Order.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]))[0]?.total || 0;
    
    res.json({
      totalOrders,
      totalProducts,
      totalRiders,
      pendingRiders,
      totalRevenue
    });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching dashboard stats', error: err.message });
  }
});

// ================= SERVER START =================
server.listen(PORT, () => console.log(`🚀 Global Sports Backend running on port ${PORT}`));