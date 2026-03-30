const https = require('https');

const url = 'https://global-sports-backend.onrender.com/api/products';

https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Content-Type:', res.headers['content-type']);
    try {
      const products = JSON.parse(data);
      console.log('Products count:', Array.isArray(products) ? products.length : 'not an array');
      console.log('First product:', products[0] || 'no products');
    } catch (e) {
      console.log('Response:', data.slice(0, 200));
    }
  });
}).on('error', err => {
  console.log('Connection Error:', err.message);
});
