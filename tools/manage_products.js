require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

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

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }

    const eq = token.indexOf('=');
    if (eq > -1) {
      const key = token.slice(2, eq);
      const value = token.slice(eq + 1);
      out[key] = value;
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function toNumber(value, fieldName) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid number for ${fieldName}: ${value}`);
  }
  return n;
}

function parseSizes(value) {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function pickUpdatableFields(args) {
  const update = {};
  if (args.name !== undefined) update.name = String(args.name).trim();
  if (args.price !== undefined) update.price = toNumber(args.price, 'price');
  if (args.category !== undefined) update.category = String(args.category).trim();
  if (args.description !== undefined) update.description = String(args.description).trim();
  if (args.image !== undefined) update.image = String(args.image).trim();
  if (args.stock !== undefined) update.stock = toNumber(args.stock, 'stock');
  if (args.sizeType !== undefined) update.sizeType = String(args.sizeType).trim();
  if (args.sizes !== undefined) update.sizes = parseSizes(args.sizes);
  return update;
}

function parseFilter(args) {
  if (args.id) return { _id: String(args.id).trim() };
  if (args.name) return { name: String(args.name).trim() };
  throw new Error('Provide --id or --name as the target selector.');
}

async function cmdAdd(args) {
  if (!args.name) throw new Error('add requires --name');
  if (args.price === undefined) throw new Error('add requires --price');

  const payload = {
    name: String(args.name).trim(),
    price: toNumber(args.price, 'price'),
    category: String(args.category || '').trim(),
    description: String(args.description || '').trim(),
    image: String(args.image || '').trim(),
    stock: toNumber(args.stock || 0, 'stock'),
    sizeType: String(args.sizeType || 'none').trim(),
    sizes: parseSizes(args.sizes) || []
  };

  const created = await Product.create(payload);
  console.log(`Added product: ${created.name} (${created._id})`);
}

async function cmdUpdate(args) {
  const filter = parseFilter(args);
  const update = pickUpdatableFields(args);

  if (!Object.keys(update).length) {
    throw new Error('No fields to update. Pass at least one field like --price or --description.');
  }

  const doc = await Product.findOneAndUpdate(filter, { $set: update }, { new: true });
  if (!doc) {
    console.log('No product matched the selector.');
    return;
  }

  console.log(`Updated product: ${doc.name} (${doc._id})`);
}

async function cmdRemove(args) {
  const filter = parseFilter(args);
  const res = await Product.deleteOne(filter);
  if (!res.deletedCount) {
    console.log('No product matched the selector.');
    return;
  }
  console.log('Product removed.');
}

async function cmdBulk(args) {
  if (!args.file) {
    throw new Error('bulk requires --file pointing to a JSON file.');
  }

  const filePath = path.resolve(process.cwd(), String(args.file));
  if (!fs.existsSync(filePath)) {
    throw new Error(`Bulk file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  const operations = Array.isArray(data) ? data : data.operations;

  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error('Bulk file must be an array or { operations: [] }.');
  }

  let added = 0;
  let updated = 0;
  let removed = 0;

  for (const op of operations) {
    const action = String(op.action || '').toLowerCase();

    if (action === 'add') {
      const item = {
        name: String(op.name || '').trim(),
        price: toNumber(op.price, 'price'),
        category: String(op.category || '').trim(),
        description: String(op.description || '').trim(),
        image: String(op.image || '').trim(),
        stock: toNumber(op.stock || 0, 'stock'),
        sizeType: String(op.sizeType || 'none').trim(),
        sizes: parseSizes(op.sizes) || []
      };
      if (!item.name) throw new Error('Bulk add operation requires name.');
      if (item.price === undefined) throw new Error('Bulk add operation requires price.');
      await Product.create(item);
      added += 1;
      continue;
    }

    if (action === 'update') {
      const selector = op.id ? { _id: String(op.id).trim() } : { name: String(op.name || '').trim() };
      if (!selector._id && !selector.name) {
        throw new Error('Bulk update requires id or name.');
      }

      const fields = {
        name: op.newName,
        price: op.price,
        category: op.category,
        description: op.description,
        image: op.image,
        stock: op.stock,
        sizeType: op.sizeType,
        sizes: op.sizes
      };

      const parsed = pickUpdatableFields(fields);
      if (!Object.keys(parsed).length) {
        throw new Error('Bulk update has no update fields.');
      }

      const res = await Product.updateOne(selector, { $set: parsed });
      updated += res.modifiedCount || 0;
      continue;
    }

    if (action === 'remove' || action === 'delete') {
      const selector = op.id ? { _id: String(op.id).trim() } : { name: String(op.name || '').trim() };
      if (!selector._id && !selector.name) {
        throw new Error('Bulk remove requires id or name.');
      }
      const res = await Product.deleteOne(selector);
      removed += res.deletedCount || 0;
      continue;
    }

    throw new Error(`Unknown bulk action: ${action}`);
  }

  console.log(`Bulk complete. added=${added}, updated=${updated}, removed=${removed}`);
}

function printHelp() {
  console.log(`
Single command product manager

Usage:
  npm run product:manage -- <command> [options]

Commands:
  add
    --name "Product Name" --price 120 [--category "Football"] [--description "..."]
    [--image "https://..."] [--stock 10] [--sizeType clothing] [--sizes S,M,L]

  update
    (--id <mongoId> | --name "Product Name")
    [--name "New Name"] [--price 150] [--category "..."] [--description "..."]
    [--image "https://..."] [--stock 5] [--sizeType footwear] [--sizes 40,41,42]

  remove
    (--id <mongoId> | --name "Product Name")

  bulk
    --file ./bulk-products.json

Bulk file format example:
[
  { "action": "add", "name": "Example Kit", "price": 120, "category": "Football" },
  { "action": "update", "name": "Example Kit", "price": 130 },
  { "action": "remove", "name": "Old Product" }
]
`);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const command = String(args._[0] || '').toLowerCase();

  if (!command || command === 'help' || args.help) {
    printHelp();
    return;
  }

  await mongoose.connect(MONGO_URI);

  try {
    if (command === 'add') {
      await cmdAdd(args);
    } else if (command === 'update') {
      await cmdUpdate(args);
    } else if (command === 'remove' || command === 'delete') {
      await cmdRemove(args);
    } else if (command === 'bulk') {
      await cmdBulk(args);
    } else {
      throw new Error(`Unknown command: ${command}`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
