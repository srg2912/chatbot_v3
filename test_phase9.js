const path = require('path');

console.log('=== Phase 9 Test: Agentic Tool Loop ===\n');

try { require('./src/config'); } catch (err) { console.error('✗ Config failed:', err.message); process.exit(1); }

const { pool, closePool } = require('./src/database/pool');
const { runAgenticLoop } = require('./src/agent/loop');
const ltm = require('./src/memory/ltm');
const config = require('./src/config');

async function runTests() {
  let client;
  try {
    client = await pool.connect();
    client.release();
  } catch (err) {
    console.error('✗ DB failed:', err.message);
    process.exit(1);
  }

  console.log('[1/2] Seeding LTM with a secret code...');
  const testSecret = "The secret password is PINEAPPLE-42.";
  await pool.query('DELETE FROM vector_memories WHERE user_id = $1', [config.ALLOWED_USER_ID]);
  await ltm.addMemory(config.ALLOWED_USER_ID, testSecret, 'forced', null, 1.0);
  console.log('  ✓ Secret seeded in database.');

  console.log('\n[2/2] Running Agentic Loop...');
  console.log('  Prompting Kate: "What is the secret password?"\n');
  
  const history = [
    { role: 'user', parts: [{ text: "You are Kate, an AI with access to tools. If you don't know something, use your search_memory tool to find out." }] },
    { role: 'model', parts: [{ text: "Understood. I will use tools when needed." }] },
    { role: 'user', parts: [{ text: "What is the secret password? Please look it up." }] }
  ];

  try {
    const finalReply = await runAgenticLoop(history);
    console.log('\n  ============================');
    console.log('  Kate\'s Final Reply:');
    console.log(`  "${finalReply}"`);
    console.log('  ============================\n');

    if (finalReply.includes('PINEAPPLE')) {
      console.log('  ✓ SUCCESS! Kate successfully paused, used the search_memory tool, read the result, and answered!');
    } else {
      console.log('  ✗ FAIL. Kate did not find or return the secret code.');
    }
  } catch (err) {
    console.error('  ✗ Loop failed:', err.message);
  }

  // Cleanup
  await pool.query('DELETE FROM vector_memories WHERE user_id = $1', [config.ALLOWED_USER_ID]);
  await closePool();
  console.log('\n=== Phase 9: TESTS COMPLETE ===');
}

runTests().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});