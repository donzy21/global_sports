require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET || process.env.SECRET_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'secret123';
const RIDER_JWT_SECRET = process.env.RIDER_JWT_SECRET || 'rider_secret_456';

const TWILIO_ACCOUNT_SID   = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN    = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM;
const ADMIN_WHATSAPP_TO    = process.env.ADMIN_WHATSAPP_TO;

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

const Admin = mongoose.model('Admin', new mongoose.Schema({
username: { type: String, required: true, unique: true },
password: { type: String, required: true }
}));

// Rider model
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

// ================= SSE ' REAL-TIME =================
// Store connected rider SSE clients: { riderId: res }
const riderClients = new Map();

function notifyRiders(event, data) {
riderClients.forEach((res) => {
res.write(`event: ${event}\n`);
res.write(`data: ${JSON.stringify(data)}\n\n`);
});
}

// ================= MIDDLEWARE =================
const authenticate = (req, res, next) => {
const authHeader = req.headers['authorization'] || '';
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

// ================= WHATSAPP =================
async function sendWhatsAppNotification(order) {
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM || !ADMIN_WHATSAPP_TO) {
console.log('WhatsApp env vars not set - skipping notification');
return;
}
const itemList = order.items.map(i => `• ${i.name} — GHS ${i.price}`).join('\n');
const message =
`?? *New Order ' Global Sports*\n\n` +
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
{
auth: { username: TWILIO_ACCOUNT_SID, password: TWILIO_AUTH_TOKEN },
headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
}
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
const response = await axios.get(
`https://api.paystack.co/transaction/verify/${reference}`,
{ headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
);
if (response.data.data.status === 'success') {
const amount = cart.reduce((a, b) => a + b.price, 0);
const order = await Order.create({
reference,
items: cart,
amount,
customer,
status: 'paid'
});
await sendWhatsAppNotification(order);
// Notify all connected riders of new order
notifyRiders('new_order', {
orderId:  order._id,
items:    order.items,
amount:   order.amount,
customer: {
name:     order.customer.name,
phone:    order.customer.phone,
address:  order.customer.address,
location: order.customer.location
},
date: order.date
});
return res.json({ message: 'Payment verified & order saved', order });
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

app.put('/api/orders/:id/status', authenticate, async (req, res) => {
try {
const order = await Order.findByIdAndUpdate(
req.params.id,
{ status: req.body.status },
{ new: true }
);
if (!order) return res.status(404).json({ message: 'Order not found' });
res.json({ message: 'Order status updated', order });
} catch (err) {
res.status(400).json({ message: 'Error updating order', error: err.message });
}
});

// Assign rider to order (admin)
app.put('/api/orders/:id/assign', authenticate, async (req, res) => {
try {
const { riderId } = req.body;
const rider = await Rider.findById(riderId);
if (!rider) return res.status(404).json({ message: 'Rider not found' });
const order = await Order.findByIdAndUpdate(
req.params.id,
{ riderId, riderName: rider.fullName, status: 'assigned' },
{ new: true }
);
res.json({ message: 'Rider assigned', order });
} catch (err) {
res.status(400).json({ message: 'Error assigning rider', error: err.message });
}
});

// ================= RIDER ROUTES =================

// Rider registration
app.post('/api/riders/register', async (req, res) => {
const { fullName, phone, password, ghanaCardId, vehicleLicenseId, passportPhotoUrl, ghanaCardPhotoUrl } = req.body;
if (!fullName || !phone || !password || !ghanaCardId || !vehicleLicenseId) {
return res.status(400).json({ message: 'Please fill all required fields' });
}
try {
const hashed = await bcrypt.hash(password, 10);
const rider = await Rider.create({
fullName, phone, password: hashed,
ghanaCardId, vehicleLicenseId,
passportPhotoUrl: passportPhotoUrl || '',
ghanaCardPhotoUrl: ghanaCardPhotoUrl || ''
});
res.json({ message: 'Registration submitted! Await admin approval.', rider });
} catch (err) {
if (err.code === 11000) return res.status(400).json({ message: 'Phone number already registered' });
res.status(400).json({ message: 'Error registering rider', error: err.message });
}
});

// Rider login
app.post('/api/riders/login', async (req, res) => {
const { phone, password } = req.body;
const rider = await Rider.findOne({ phone });
if (!rider) return res.status(400).json({ message: 'Invalid credentials' });
const valid = await bcrypt.compare(password, rider.password);
if (!valid) return res.status(400).json({ message: 'Invalid credentials' });
if (rider.status === 'pending') return res.status(403).json({ message: 'Your account is pending admin approval' });
if (rider.status === 'rejected') return res.status(403).json({ message: 'Your account has been rejected. Contact admin.' });
const token = jwt.sign({ id: rider._id, fullName: rider.fullName, phone: rider.phone }, RIDER_JWT_SECRET, { expiresIn: '7d' });
res.json({ message: 'Login successful', token, rider: { id: rider._id, fullName: rider.fullName, phone: rider.phone, status: rider.status, isAvailable: rider.isAvailable } });
});

// Rider SSE ' real-time order notifications
app.get('/api/riders/notifications', authenticateRider, (req, res) => {
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Connection', 'keep-alive');
res.flushHeaders();

const riderId = req.rider.id;
riderClients.set(riderId, res);

// Send heartbeat every 30s to keep connection alive
const heartbeat = setInterval(() => {
res.write('event: heartbeat\ndata: ping\n\n');
}, 30000);

req.on('close', () => {
clearInterval(heartbeat);
riderClients.delete(riderId);
});
});

// Get available (paid, unassigned) orders for riders
app.get('/api/riders/orders/available', authenticateRider, async (req, res) => {
try {
const orders = await Order.find({ status: 'paid', riderId: null }).sort({ date: -1 });
res.json(orders);
} catch (err) {
res.status(500).json({ message: 'Error fetching orders' });
}
});

// Rider accepts an order
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
// Notify other riders this order is gone
notifyRiders('order_taken', { orderId: req.params.id });
res.json({ message: 'Order accepted', order: updated });
} catch (err) {
res.status(500).json({ message: 'Error accepting order' });
}
});

// Rider rejects an order (just client-side dismissal, no backend needed, but kept for logging)
app.put('/api/riders/orders/:id/reject', authenticateRider, async (req, res) => {
res.json({ message: 'Order dismissed' });
});

// Rider marks order as delivered
app.put('/api/riders/orders/:id/delivered', authenticateRider, async (req, res) => {
try {
const order = await Order.findByIdAndUpdate(
req.params.id,
{ status: 'delivered' },
{ new: true }
);
res.json({ message: 'Order marked as delivered', order });
} catch (err) {
res.status(500).json({ message: 'Error updating order' });
}
});

// Get rider's assigned orders
app.get('/api/riders/orders/mine', authenticateRider, async (req, res) => {
try {
const orders = await Order.find({ riderId: req.rider.id }).sort({ date: -1 });
res.json(orders);
} catch (err) {
res.status(500).json({ message: 'Error fetching orders' });
}
});

// Toggle rider availability
app.put('/api/riders/availability', authenticateRider, async (req, res) => {
try {
const rider = await Rider.findByIdAndUpdate(
req.rider.id,
{ isAvailable: req.body.isAvailable },
{ new: true }
);
res.json({ message: 'Availability updated', isAvailable: rider.isAvailable });
} catch (err) {
res.status(500).json({ message: 'Error updating availability' });
}
});

// ================= ADMIN ' RIDER MANAGEMENT =================

// Get all riders
app.get('/api/admin/riders', authenticate, async (req, res) => {
const riders = await Rider.find().sort({ createdAt: -1 });
res.json(riders);
});

// Approve or reject rider
app.put('/api/admin/riders/:id/status', authenticate, async (req, res) => {
try {
const { status } = req.body;
if (!['approved', 'rejected'].includes(status)) {
return res.status(400).json({ message: 'Invalid status' });
}
const rider = await Rider.findByIdAndUpdate(req.params.id, { status }, { new: true });
if (!rider) return res.status(404).json({ message: 'Rider not found' });
res.json({ message: `Rider ${status}`, rider });
} catch (err) {
res.status(400).json({ message: 'Error updating rider', error: err.message });
}
});

// Delete rider
app.delete('/api/admin/riders/:id', authenticate, async (req, res) => {
try {
await Rider.findByIdAndDelete(req.params.id);
res.json({ message: 'Rider deleted' });
} catch (err) {
res.status(400).json({ message: 'Error deleting rider' });
}
});

// ================= TRACKING ROUTES =================

// Rider updates their live location (called every 5s from rider's phone)
app.put('/api/riders/location', authenticateRider, async (req, res) => {
const { lat, lng, orderId } = req.body;
if (!lat || !lng) return res.status(400).json({ message: 'lat and lng required' });

try {
// Store rider location on the order itself
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

// Customer polls this to get rider's live location by order reference
app.get('/api/track/:reference', async (req, res) => {
try {
const order = await Order.findOne({ reference: req.params.reference });
if (!order) return res.status(404).json({ message: 'Order not found' });

```
res.json({
  status:          order.status,
  riderName:       order.riderName || null,
  riderLocation:   order.riderLocation || null,
  customerLocation: order.customer?.location || null,
  amount:          order.amount,
  items:           order.items,
  date:            order.date
});
```

} catch (err) {
res.status(500).json({ message: 'Error fetching tracking info' });
}
});

// ================= START =================
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
