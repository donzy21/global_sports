require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('MONGO_URI is missing. Add it to your .env file.');
  process.exit(1);
}

const Product = mongoose.model(
  'Product',
  new mongoose.Schema(
    {
      name: { type: String, required: true },
      price: { type: Number, required: true },
      category: { type: String, default: '' },
      description: { type: String, default: '' },
      image: { type: String, default: '' },
      stock: { type: Number, default: 0 },
      sizeType: { type: String, enum: ['none', 'clothing', 'footwear', 'custom'], default: 'none' },
      sizes: { type: [String], default: [] }
    },
    { strict: false }
  )
);

async function run() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB\n');

    const products = await Product.find({}).limit(5);
    console.log(`Sample of ${products.length} products:\n`);

    for (const product of products) {
      console.log(`Product: ${product.name}`);
      console.log(`Description length: ${product.description.length} characters`);
      console.log(`Description: ${product.description}\n`);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run();
