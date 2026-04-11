════════════════════════════════════════════════════════════════════════════
🚀 GLOBAL SPORTS - CHAT & DELIVERY PRICING FIX
════════════════════════════════════════════════════════════════════════════

✅ CHANGES MADE:

1️⃣ GHANA DELIVERY PRICING (NOW REALISTIC)
   - Old: Base 8 GHS, Min 10 GHS, complicated calculation
   - New: Base 5 GHS, Min 8 GHS, realistic Ghana rates
   
   📊 New Pricing Formula:
      • Base fare: 5 GHS
      • First 3km: 1.5 GHS/km  
      • 3-8km: 0.8 GHS/km
      • 8km+: 0.5 GHS/km
      • Peak hours (12-2pm, 6-8pm): +15% surcharge
      • Minimum delivery: 8 GHS
   
   💰 Example Prices:
      • Same location (0km): 8 GHS (minimum)
      • 3.1km away: 9.5 GHS (actual test result)
      • 5km away: ~11.5 GHS
      • 10km away: ~13.5 GHS
   
2️⃣ CHAT IMPROVEMENTS
   - Added comprehensive error handling
   - Better Socket.IO initialization
   - HTTP fallback for when Socket.IO unavailable
   - Loading chat history via REST first (faster)
   - Optimistic UI updates (message shows immediately)
   - Detailed console logging for debugging
   - Better error messages to users

3️⃣ APP INITIALIZATION
   - Console logs show: API candidates, Socket.IO availability
   - Easier debugging with F12 console

════════════════════════════════════════════════════════════════════════════

🧪 STEP-BY-STEP TEST GUIDE:

STEP 1: Start the server
────────────────────────
   $ node server.js
   
   Expected output:
   ✓ 🚀 Global Sports Backend running on port 5001
   ✓ MongoDB Connected

STEP 2: Open the app in browser
────────────────────────────────
   • Go to: http://localhost:5001
   • Open browser console: Press F12
   • Watch for logs starting with 🚀, 📍, ℹ️

   You should see in console:
   ✓ 🚀 Global Sports app initializing...
   ✓ 📍 API candidates: [...]
   ✓ ✅ API URL detected: http://localhost:5001/api
   ✓ 🔌 Socket.IO base: http://localhost:5001
   ✓ 📦 Socket.IO library available: ✅

STEP 3: Test delivery pricing
──────────────────────────────
   • Go to "Shop" section
   • Add items to cart
   • Set delivery location on map
   
   Expected: Delivery fee updates as you move location
   • Nearby (0-3km): 8-10 GHS
   • Medium (3-8km): 10-14 GHS
   • Far (8km+): 14+ GHS

STEP 4: Create an order (test)
───────────────────────────────
   Already created! Reference: SHOP_TEST_1775863437817
   
   OR create your own:
   $ node create_test_order.js
   (Will output new reference and token)

STEP 5: Test chat - Track Order
────────────────────────────────
   1. Go to "Track Order" section
   2. Enter: SHOP_TEST_1775863437817
   3. Click "Track"
   
   Expected: See order details (status, rider, distance, fee, etc.)
   
   4. Click "Open Live Chat" button (appears after tracking)
   
   Expected in console:
   ✓ 📋 Chat context: {reference: ..., role: customer}
   ✓ 📡 Chat: Attempting Socket.IO connection
   ✓ ✅ Chat Socket Connected: [socket-id]
   ✓ ✅ Joined chat room for order
   ✓ 📨 Received chat history: 1 messages

STEP 6: Send a chat message
────────────────────────────
   1. Type a message in chat modal
   2. Hit Enter or click Send
   
   Expected in console:
   ✓ 💬 New message from socket: [your message]
   
   Expected in chat:
   ✓ Message appears immediately (your message on right)
   ✓ Message shows sender name
   ✓ Timestamp shows (if included)

STEP 7: Test HTTP fallback
──────────────────────────
   1. Disable internet (simulate Socket.IO failure)
      - In browser console: chatSocket.disconnect()
   
   2. Send another message
   
   Expected:
   ✓ Message still sends via HTTP
   ✓ Console shows: "Socket not connected, sending via HTTP..."
   ✓ Toast message shows status

════════════════════════════════════════════════════════════════════════════

🔍 DEBUGGING CHECKLIST:

Problem: Chat modal doesn't open
────────────────────────────────
☐ Is test order showing in track? (Try: SHOP_TEST_1775863437817)
☐ Check console for errors (F12)
☐ Is there a "Chat" button visible after tracking?
☐ Try: openChatModal({reference: 'SHOP_TEST_1775863437817', role: 'customer', chatToken: '...', name: 'Test'})
  in console

Problem: Socket.IO connection fails
─────────────────────────────────────
☐ Is server running? (Check: npm start or node server.js)
☐ Is port 5001 correct? (Check server logs)
☐ Try: Invoke-WebRequest -UseBasicParsing http://localhost:5001/ping
☐ Try: Invoke-WebRequest -UseBasicParsing http://localhost:5001/socket.io/?t=test
  Should return 200 OK

Problem: Chat history doesn't load
─────────────────────────────────────
☐ Is order in MongoDB? (Try: node create_test_order.js)
☐ Does order have chatToken? (Check MongoDB)
☐ Check console for: "Received chat history: X messages"
☐ Try: curl http://localhost:5001/api/chat/SHOP_TEST_1775863437817/messages?role=customer&chatToken=...

Problem: Messages not sending
────────────────────────────
☐ Is message text empty? (App checks this)
☐ Are you joined to chat? (Check console: "Joined chat room")
☐ Check server logs for: "Broadcasting message to room"
☐ Try sending via console: 
   chatSocket.emit('chat:message', {text: 'test', senderName: 'Test'})

════════════════════════════════════════════════════════════════════════════

📊 DELIVERY PRICING EXAMPLES:

Test coordinates and expected fees:

1. Current location (5.6037, -0.1870) - Shop
   Distance: 0 km
   Fee: 8 GHS (minimum)

2. Nearby (5.5900, -0.1760) - ~3.1km southeast
   Distance: 3.1 km
   Fee: 9.5 GHS

3. Medium distance test:
   Go to app → Track Order → enter reference → adjust delivery location
   Fees update in real-time!

════════════════════════════════════════════════════════════════════════════

🎯 NEXT STEPS IF STILL NOT WORKING:

1. Check browser console (F12) - copy any error messages
2. Check server console - copy any error logs
3. Check MongoDB - verify order exists:
   db.orders.findOne({reference: 'SHOP_TEST_1775863437817'})
4. Try creating a NEW test order:
   node create_test_order.js
5. Try the direct chat test:
   node test_chat_real.js

════════════════════════════════════════════════════════════════════════════

📝 FILES MODIFIED:

1. server.js
   - Updated calculateDeliveryFee() with Ghana pricing
   - Added detailed Socket.IO logging
   
2. app.js  
   - Improved openChatModal() with error handling
   - Better initialization logging
   - HTTP fallback for chat

3. index.html
   - (No changes needed - Socket.IO CDN already loaded)

════════════════════════════════════════════════════════════════════════════
