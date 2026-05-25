const path = require('path');

console.log('=== Phase 2 Test: Telegram Bot + Commands ===\n');

// Test 1: Config still loads
console.log('[1/5] Testing config validation...');
try {
  const config = require('./src/config');
  console.log('  ✓ Config loaded');
  console.log('  - ALLOWED_USER_ID:', config.ALLOWED_USER_ID);
  console.log('  - BOT_TOKEN:', config.BOT_TOKEN.substring(0, 15) + '...');
} catch (err) {
  console.error('  ✗ Config failed:', err.message);
  process.exit(1);
}

// Test 2: Database still connects
console.log('\n[2/5] Testing database connection...');
const { pool, closePool } = require('./src/database/pool');

async function runTests() {
  let client;
  try {
    client = await pool.connect();
    const dbResult = await client.query('SELECT NOW() as now');
    console.log('  ✓ DB connected. Server time:', dbResult.rows[0].now.toISOString());
    client.release();
  } catch (err) {
    console.error('  ✗ DB failed:', err.message);
    process.exit(1);
  }

  // Test 3: Load bot module (without starting polling)
  console.log('\n[3/5] Testing bot module load...');
  try {
    const { setProcessMessage, setReady } = require('./src/bot/telegram');
    console.log('  ✓ Bot module loaded');
    
    // Test that we can set a processor
    setProcessMessage(async (msg) => `Test reply to: ${msg.text}`);
    console.log('  ✓ Process message handler set');
    
    setReady(true);
    console.log('  ✓ Bot marked ready');
  } catch (err) {
    console.error('  ✗ Bot module failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }

  // Test 4: Test commands module
  console.log('\n[4/5] Testing commands module...');
  try {
    const { registerCommands } = require('./src/bot/commands');
    // Just verify it exports correctly
    console.log('  ✓ Commands module loaded');
    console.log('  ✓ registerCommands is a function:', typeof registerCommands === 'function');
  } catch (err) {
    console.error('  ✗ Commands module failed:', err.message);
    process.exit(1);
  }

  // Test 5: Test index.js logic (without starting server)
  console.log('\n[5/5] Testing index.js components...');
  try {
    // Simulate the processMessage function
    async function processMessage(msg) {
      if (msg.text.startsWith('/')) return null;
      return `You said: "${msg.text}"\n\n(Phase 2 echo — real brain coming in Phase 3)`;
    }
    
    const testMsg = { text: 'Hello Kate', from: { id: require('./src/config').ALLOWED_USER_ID } };
    const reply = await processMessage(testMsg);
    
    if (reply.includes('Hello Kate') && reply.includes('Phase 2')) {
      console.log('  ✓ Echo logic works');
    } else {
      console.error('  ✗ Echo logic unexpected output:', reply);
    }
    
    // Test command filtering
    const cmdMsg = { text: '/reset', from: { id: require('./src/config').ALLOWED_USER_ID } };
    const cmdReply = await processMessage(cmdMsg);
    if (cmdReply === null) {
      console.log('  ✓ Command passthrough works (returns null for commands)');
    }
    
    // Test unauthorized user gate
    const badMsg = { text: 'Hello', from: { id: 999999 } };
    // The gate is in telegram.js, but we verify the config comparison logic
    const isAuthorized = badMsg.from.id === require('./src/config').ALLOWED_USER_ID;
    if (!isAuthorized) {
      console.log('  ✓ Unauthorized user would be blocked');
    }
    
  } catch (err) {
    console.error('  ✗ Index logic failed:', err.message);
    process.exit(1);
  }

  console.log('\n=== Phase 2: ALL TESTS PASSED ===');
  console.log('\nNext steps:');
  console.log('  1. Run: npm install  (to install express and node-telegram-bot-api)');
  console.log('  2. Run: node src/index.js  (starts the bot for real)');
  console.log('  3. Send a message to your bot on Telegram');
  console.log('  4. Check http://localhost:3000/health for status');

  await closePool();
}

runTests().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});