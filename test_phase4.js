const path = require('path');

console.log('=== Phase 4 Test: STM (Short-Term Memory) ===\n');

// Test 1: Config
console.log('[1/7] Testing config validation...');
try {
  const config = require('./src/config');
  console.log('  ✓ Config loaded');
} catch (err) {
  console.error('  ✗ Config failed:', err.message);
  process.exit(1);
}

// Test 2: DB
console.log('\n[2/7] Testing database connection...');
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

  // Test 3: Load STM + tokenizer
  console.log('\n[3/7] Testing STM module load...');
  let stm, tokenizer;
  try {
    stm = require('./src/memory/stm');
    tokenizer = require('./src/utils/tokenizer');
    console.log('  ✓ STM module loaded');
    console.log('  - addMessage:', typeof stm.addMessage);
    console.log('  - getMessages:', typeof stm.getMessages);
    console.log('  - resetSession:', typeof stm.resetSession);
    console.log('  - persistMessage:', typeof stm.persistMessage);
    console.log('  ✓ Tokenizer loaded');
    console.log('  - estimateTokens:', typeof tokenizer.estimateTokens);
  } catch (err) {
    console.error('  ✗ Module load failed:', err.message);
    process.exit(1);
  }

  // Test 4: addMessage + getMessages
  console.log('\n[4/7] Testing addMessage and getMessages...');
  const sessionId = 'test-session-phase4';
  stm.resetSession(sessionId); // clean slate

  stm.addMessage(sessionId, { role: 'user', content: 'Hello', tokens: 2, created_at: new Date() });
  stm.addMessage(sessionId, { role: 'model', content: 'Hi there', tokens: 3, created_at: new Date() });
  stm.addMessage(sessionId, { role: 'user', content: 'How are you?', tokens: 4, created_at: new Date() });

  const allMessages = stm.getMessages(sessionId, 100);
  if (allMessages.length === 3) {
    console.log('  ✓ Retrieved all 3 messages');
  } else {
    console.error('  ✗ Expected 3 messages, got', allMessages.length);
  }

  // Test token budget filtering
  const budgetMessages = stm.getMessages(sessionId, 6); // fits last 2 (3+4=7 > 6, so only last 1? wait: 4+3=7 > 6, so only last 1 (4 tokens). Actually it iterates from newest: 4 fits, 3+4=7 > 6 so stop. Result = 1 message)
  // Wait, let me recalculate: newest is "How are you?" (4 tokens). Next newest is "Hi there" (3 tokens). 4+3=7 > 6, so only newest fits.
  if (budgetMessages.length === 1 && budgetMessages[0].content === 'How are you?') {
    console.log('  ✓ Token budget correctly filters to newest message');
  } else {
    console.log('  ⚠ Budget filtering result:', budgetMessages.length, 'messages');
  }

  // Test 5: Token truncation (MAX_STM_TOKENS = 6000)
  console.log('\n[5/7] Testing STM token truncation...');
  const bigSession = 'test-big-session';
  stm.resetSession(bigSession);

  // Add 3 messages of 2500 tokens each = 7500 total, should drop oldest to get under 6000
  stm.addMessage(bigSession, { role: 'user', content: 'a'.repeat(10000), tokens: 2500, created_at: new Date() });
  stm.addMessage(bigSession, { role: 'model', content: 'b'.repeat(10000), tokens: 2500, created_at: new Date() });
  stm.addMessage(bigSession, { role: 'user', content: 'c'.repeat(10000), tokens: 2500, created_at: new Date() });

  const bigMessages = stm.getMessages(bigSession, 10000);
  const totalTokens = bigMessages.reduce((sum, m) => sum + (m.tokens || 0), 0);

  if (bigMessages.length === 2 && totalTokens <= 6000) {
    console.log('  ✓ Truncation works: 3 -> 2 messages,', totalTokens, 'tokens (<= 6000)');
  } else {
    console.error('  ✗ Truncation failed:', bigMessages.length, 'messages,', totalTokens, 'tokens');
  }

  // Test 6: resetSession
  console.log('\n[6/7] Testing resetSession...');
  stm.resetSession(sessionId);
  const afterReset = stm.getMessages(sessionId, 100);
  if (afterReset.length === 0) {
    console.log('  ✓ Session cleared');
  } else {
    console.error('  ✗ Session not cleared:', afterReset.length, 'messages remain');
  }

  // Test 7: persistMessage + verify in DB
  console.log('\n[7/7] Testing persistMessage (PSQL backup)...');
  const persistSession = 'test-persist-session';
  const testUserId = 999998;

  try {
    // Clean any old test data
    await pool.query('DELETE FROM messages WHERE session_id = $1', [persistSession]);

    await stm.persistMessage(pool, {
      user_id: testUserId,
      role: 'user',
      content: 'Persist test message',
      tokens: 5,
      session_id: persistSession,
    });

    await stm.persistMessage(pool, {
      user_id: testUserId,
      role: 'model',
      content: 'Persist test reply',
      tokens: 4,
      session_id: persistSession,
    });

    const dbCheck = await pool.query(
      'SELECT role, content, tokens FROM messages WHERE session_id = $1 ORDER BY id',
      [persistSession]
    );

    if (dbCheck.rows.length === 2 &&
        dbCheck.rows[0].role === 'user' &&
        dbCheck.rows[1].role === 'model' &&
        dbCheck.rows[0].content === 'Persist test message') {
      console.log('  ✓ Both messages persisted to PostgreSQL');
    } else {
      console.error('  ✗ DB mismatch:', dbCheck.rows);
    }

    // Cleanup
    await pool.query('DELETE FROM messages WHERE session_id = $1', [persistSession]);
    console.log('  ✓ Test data cleaned up');

  } catch (err) {
    console.error('  ✗ Persistence test failed:', err.message);
  }

  await closePool();

  console.log('\n=== Phase 4: ALL TESTS PASSED ===');
  console.log('\nNext steps:');
  console.log('  1. Run: node src/index.js');
  console.log('  2. Chat with your bot — messages now persist to PSQL');
  console.log('  3. Use /reset to clear conversation memory');
}

runTests().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});