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

// Real-world product intelligence database
const productDatabase = {
  // Football Jerseys
  'Inter Miami': 'Official MLS club jersey with breathable mesh technology and premium stitching. Perfect for match days and everyday fan wear.',
  'Athletico de Madrid': 'European football club authentic jersey with ergonomic design and moisture-wicking fabric. Ideal for players and supporters.',
  'Barcelona': 'Elite football performance jersey with advanced fabric technology for comfort and durability. Designed for competitive play and fan casual wear.',
  'Manchester United': 'Premier League official jersey with signature stripe design and breathable material. Built for active performance and style.',
  'Real Madrid': 'Professional football club jersey with premium construction and moisture management. Essential for players and devoted fans.',
  'AC Milan': 'Iconic red and black striped jersey with quality fabric and modern fit. Perfect for training and match occasions.',
  'Chelsea': 'Premier League authentic jersey with contemporary design and performance fabric. Suitable for competitive and recreational use.',
  'Liverpool': 'Professional football kit with heritage design and quality construction. Great for match days and everyday wear.',
  'Bayern Munich': 'Bundesliga official jersey with performance-driven fabric technology. Ideal for players, training, and fan celebrations.',
  'Juventus': 'Italian Serie A jersey with premium materials and classic aesthetic. Perfect for training sessions and casual wear.',
  'Paris Saint-Germain': 'Ligue 1 official jersey with luxury fabric and modern design elements. Built for performance and high-fashion appeal.',
  'Doncaster Rovers': 'English Football League authentic kit with quality construction and comfortable fit. Suitable for competitive play and support wear.',
  'Celta de Vigo': 'Spanish La Liga jersey with premium fabric and traditional design. Great for match play and supporter events.',
  'FC Santos': 'Brazilian league authentic jersey with lightweight fabric and performance features. Ideal for training and competitive matches.',
  'Ghana': 'National team official jersey with authentic design and quality construction. Perfect for international matches and supporter wear.',
  'Kotoko': 'African football club authentic jersey with quality material and modern design. Great for competitive and recreational play.',
  
  // Basketball
  'Basketball Jersey': 'Professional basketball jersey with moisture-wicking technology and mesh ventilation. Ideal for game play, training, and casual fan wear.',
  'Lakers NBA Jersey': 'Official NBA team jersey with authentic design and breathable fabric. Perfect for court play and lifestyle wear.',
  'Paris Basketball': 'FIBA approved basketball kit with performance materials and articulated design. Great for practice, games, and active wear.',
  
  // Footwear & Shoes
  'Running Shoes': 'Advanced running footwear with cushioned sole and breathable upper construction. Designed for road running, training, and active daily use.',
  'Adidas Predator': 'Professional soccer boot with control zone technology and supportive soleplate. Perfect for match play and intensive training sessions.',
  'Nike Slides': 'Lightweight recovery slides with soft cushioning and durable outsole. Ideal for post-workout comfort and casual wear.',
  
  // Athletic Apparel
  'Nike Tracksuit': 'Premium athletic tracksuit with lightweight fabric and ergonomic construction. Designed for warm-up routines and outdoor training.',
  'Nike NBA Shorts': 'Official NBA athletic shorts with mesh lining and flexible waistband. Perfect for basketball play and active workouts.',
  'Nike Football Shin Guard': 'Protective shin guard with foam padding and secure attachment system. Essential for soccer matches and intensive practice.',
  'Goalkeepers Gloves': 'Professional goalkeeper gloves with grip technology and wrist support. Designed for optimal control and injury prevention during matches.',
  'Men\'s Gym Shirt': 'Performance athletic shirt with moisture-wicking fabric and ergonomic fit. Ideal for gym training, cardio, and active recovery.',
  'Under Armor Gym Wear': 'Technical gym apparel with compression technology and breathable materials. Perfect for strength training and high-intensity workouts.',
  'Basketball': 'Competition-grade basketball with cushioned composite covering and consistent bounce. Suitable for professional matches and intense training.',
  'Mikasa Volleyball': 'International volleyball standard with durable synthetic leather and balanced weight. Ideal for matches, training, and recreational play.',
  'Sports Grip Socks': 'Non-slip athletic socks with reinforced grip pattern and moisture control. Perfect for soccer, basketball, and active sports.',
  'Adidas Socks': 'Premium performance socks with arch support and moisture-wicking technology. Great for all-day comfort during athletic activities.',
  'Los Angeles Shorts': 'Athletic performance shorts with quick-dry fabric and comfortable fit. Designed for basketball, training, and casual active wear.'
};

function generateRealWorldDescription(productName) {
  // Find matching product in database
  for (const [key, description] of Object.entries(productDatabase)) {
    if (productName.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(productName.toLowerCase())) {
      return description;
    }
  }
  
  // Smart fallback based on product type
  if (productName.toLowerCase().includes('jersey') || productName.toLowerCase().includes('kit')) {
    return 'Premium athletic apparel with high-quality construction and comfortable fit. Designed for competitive play and everyday wear.';
  }
  if (productName.toLowerCase().includes('shoe') || productName.toLowerCase().includes('boot')) {
    return 'Performance footwear with advanced cushioning and durable construction. Perfect for athletic activities and active daily use.';
  }
  if (productName.toLowerCase().includes('short')) {
    return 'Athletic shorts with breathable fabric and ergonomic design. Ideal for sports, training, and active lifestyle.';
  }
  if (productName.toLowerCase().includes('sock')) {
    return 'Premium performance socks with moisture control and comfort technology. Perfect for sports and everyday wear.';
  }
  if (productName.toLowerCase().includes('glove')) {
    return 'Professional protective gloves with superior grip and support technology. Essential for sports performance and safety.';
  }
  
  return 'Premium athletic product with quality construction and performance features. Designed for active use and sports activities.';
}

async function run() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB\n');

    const products = await Product.find({});
    console.log(`Found ${products.length} products\n`);

    let updated = 0;

    for (const product of products) {
      const realWorldDesc = generateRealWorldDescription(product.name);
      
      product.description = realWorldDesc;
      await product.save();
      updated++;
      
      console.log(`✓ ${product.name}`);
      console.log(`  ${realWorldDesc}\n`);
    }

    console.log(`Completed: ${updated} products updated with 2-line real-world descriptions`);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run();
