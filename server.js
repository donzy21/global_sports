require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET || process.env.SECRET_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'secret123';
const TWILIO_ACCOUNT_SID   = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN    = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM;
const ADMIN_WHATSAPP_TO    = process.env.ADMIN_WHATSAPP_TO;

mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB connection error:', err));

const Product = mongoose.model('Product', new mongoose.Schema({
  name:        { type: String, required: true },
  price:       { type: Number, required: true },
  category:    { type: String, default: '' },
  description: { type: String, default: '' },
  image:       { type: String, default: '' },
  stock:       { type: Number, default: 0 }
}));

const Order = mongoose.model('Order', new mongoose.Schema({
  reference: String,
  items:     Array,
  amount:    Number,
  customer: {
    name:    String,
    email:   String,
    phone:   String,
    address: String
  },
  status: { type: String, default: 'pending' },
  date:   { type: Date,   default: Date.now }
}));

const Admin = mongoose.model('Admin', new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }
}));

const authenticate = (req, res, next) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  if (!token) return res.status(401).json({ message: 'No token provided' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};

async function sendWhatsAppNotification(order) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM || !ADMIN_WHATSAPP_TO) {
    console.log('WhatsApp env vars not set — skipping notification');
    return;
  }
  const itemList = order.items.map(i => `• ${i.name} — GHS ${i.price}`).join('\n');
  const message =
    `🛒 *New Order — Global Sports*\n\n` +
    `*Customer:* ${order.customer.name}\n` +
    `*Phone:* ${order.customer.phone}\n` +
    `*Email:* ${order.customer.email}\n` +
    (order.customer.address ? `*Address:* ${order.customer.address}\n` : '') +
    `\n*Items:*\n${itemList}\n\n` +
    `*Total:* GHS ${order.amount.toFixed(2)}\n` +
    `*Ref:* ${order.reference}\n` +
    `*Status:* ${order.status.toUpperCase()}`;
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

app.post('/api/orders/verify', async (req, res) => {
  const { reference, cart, customer } = req.body;
  try {
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
    );
    if (response.data.data.status === 'success') {
      const amount = cart.reduce((a, b) => a + b.price, 0);
      const order = await Order.create({ reference, items: cart, amount, customer, status: 'paid' });
      await sendWhatsAppNotification(order);
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

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));