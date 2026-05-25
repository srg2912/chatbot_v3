const path = require('path');

console.log('=== Phase 3 Test: Gemini API (New SDK) ===\n');

// Test 1: Config loads
console.log('[1/6] Testing config validation...');
try {
  const config = require('./src/config');
  console.log('  ✓ Config loaded');
  console.log('  - LLM_MODEL:', config.LLM_MODEL);
  console.log('  - EMBEDDING_MODEL:', config.EMBEDDING_MODEL);
} catch (err) {
  console.error('  ✗ Config failed:', err.message);
  process.exit(1);
}

// Test 2: Database connects
console.log('\n[2/6] Testing database connection...');
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

  // Test 3: Load Gemini module
  console.log('\n[3/6] Testing Gemini module load...');
  let gemini;
  try {
    gemini = require('./src/api/gemini');
    console.log('  ✓ Gemini module loaded');
    console.log('  - chatWithTools:', typeof gemini.chatWithTools);
    console.log('  - embedText:', typeof gemini.embedText);
    console.log('  - getResponseText:', typeof gemini.getResponseText);
  } catch (err) {
    console.error('  ✗ Gemini module failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }

  // Test 4: Basic chat with Gemma 4
  console.log('\n[4/6] Testing Gemini chat (Gemma 4)...');
  let chatWorked = false;
  try {
    const history = [
      { role: 'user', parts: [{ text: 'Say exactly "Phase 3 test passed" and nothing else.' }] }
    ];
    const response = await gemini.chatWithTools(history);
    const text = gemini.getResponseText(response);
    
    if (text && text.toLowerCase().includes('phase 3')) {
      console.log('  ✓ Gemma 4 responded:', text.substring(0, 80));
      chatWorked = true;
    } else {
      console.log('  ⚠ Response unexpected:', text.substring(0, 80));
    }
  } catch (err) {
    console.error('  ✗ Gemini chat failed:', err.message);
    console.log('    If this is a 500 error, Gemma 4 may be temporarily unavailable.');
    console.log('    Try switching LLM_MODEL to gemini-1.5-flash in .env as a fallback.');
  }

  // Test 5: Embedding
  console.log('\n[5/6] Testing Gemini embedding...');
  let embedWorked = false;
  try {
    const embedding = await gemini.embedText('Test embedding for Phase 3');
    console.log('  ✓ Embedding generated, dimensions:', embedding.length);
    if (embedding.length === 3072) {
      console.log('  ✓ Dimension count matches gemini-embedding-2 (3072)');
    } else {
      console.log('  ⚠ Expected 3072 dims, got', embedding.length);
    }
    embedWorked = true;
  } catch (err) {
    console.error('  ✗ Embedding failed:', err.message);
  }

  // Test 6: Verify API calls were logged
  console.log('\n[6/6] Checking API call logs in database...');
  try {
    client = await pool.connect();
    const logs = await client.query(
      `SELECT api_name, model, latency_ms, created_at 
       FROM api_calls 
       WHERE api_name IN ('gemini_chat', 'gemini_embedding')
       ORDER BY created_at DESC 
       LIMIT 5`
    );
    
    console.log('  ✓ Found', logs.rows.length, 'logged API calls:');
    logs.rows.forEach(r => {
      console.log(`    - ${r.api_name} | ${r.model} | ${r.latency_ms}ms`);
    });
    
    if (chatWorked && !logs.rows.some(r => r.api_name === 'gemini_chat')) {
      console.log('  ⚠ Chat worked but no chat log found');
    }
    if (embedWorked && !logs.rows.some(r => r.api_name === 'gemini_embedding')) {
      console.log('  ⚠ Embedding worked but no embedding log found');
    }
    
    client.release();
  } catch (err) {
    console.error('  ✗ Failed to read API logs:', err.message);
  }

  await closePool();

  console.log('\n=== Phase 3 TESTS COMPLETE ===');
  if (!chatWorked) {
    console.log('\n⚠ Gemma 4 chat failed. Fallback option:');
    console.log('  1. Set LLM_MODEL=gemini-1.5-flash in .env (more reliable)');
    console.log('  2. Retry later — Gemma 4 via API is sometimes unstable');
  }
  if (!embedWorked) {
    console.log('\n⚠ Embedding failed. Check EMBEDDING_MODEL name.');
  }
  if (chatWorked && embedWorked) {
    console.log('\n✅ All Gemini functionality verified! Ready for Phase 4.');
  }
}

runTests().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});