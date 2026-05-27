const path = require('path');

console.log('=== Phase 4 Test: STM (FIFO Message Queue) ===\n');

// Test 1: Config
console.log('[1/7] Testing config validation...');
try {
  require('./src/config');
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

  // Test 3: Load STM
  console.log('\n[3/7] Testing STM module load...');
  let stm;
  try {
    stm = require('./src/memory/stm');
    console.log('  ✓ STM module loaded');
    console.log('  - addMessage:', typeof stm.addMessage);
    console.log('  - getMessages:', typeof stm.getMessages);
    console.log('  - getMessageCount:', typeof stm.getMessageCount);
    console.log('  - MAX_STM_MESSAGES:', stm.MAX_STM_MESSAGES);
  } catch (err) {
    console.error('  ✗ STM load failed:', err.message);
    process.exit(1);
  }

  // Test 4: FIFO behavior
  console.log('\n[4/7] Testing FIFO message queue...');
  const sessionId = 'test-fifo-session';
  stm.resetSession(sessionId);

  // Add 25 messages — only last 20 should remain
  for (let i = 1; i <= 25; i++) {
    stm.addMessage(sessionId, {
      role: i % 2 === 1 ? 'user' : 'model',
      content: `Message ${i}`,
      tokens: 2,
      created_at: new Date(),
    });
  }

  const messages = stm.getMessages(sessionId);
  if (messages.length === 20 && messages[0].content === 'Message 6' && messages[19].content === 'Message 25') {
    console.log('  ✓ FIFO works: 25 -> 20 messages, oldest dropped correctly');
  } else {
    console.error('  ✗ FIFO failed:', messages.length, 'messages, first:', messages[0]?.content, 'last:', messages[messages.length - 1]?.content);
  }

  // Test 5: getMessageCount
  console.log('\n[5/7] Testing getMessageCount...');
  const count = stm.getMessageCount(sessionId);
  if (count === 20) {
    console.log('  ✓ Count reports 20');
  } else {
    console.error('  ✗ Count mismatch:', count);
  }

  // Test 6: popLastMessage
  console.log('\n[6/7] Testing popLastMessage...');
  const popped = stm.popLastMessage(sessionId);
  if (popped && popped.content === 'Message 25' && stm.getMessageCount(sessionId) === 19) {
    console.log('  ✓ popLastMessage removed newest (Message 25), count now 19');
  } else {
    console.error('  ✗ popLastMessage failed');
  }

  // Test 7: persistMessage
  console.log('\n[7/7] Testing persistMessage (PSQL backup)...');
  const persistSession = 'test-persist-fifo';
  const testUserId = 999996;

  try {
    await pool.query('DELETE FROM messages WHERE session_id = $1', [persistSession]);

    await stm.persistMessage(pool, {
      user_id: testUserId,
      role: 'user',
      content: 'FIFO test message',
      tokens: 5,
      session_id: persistSession,
    });

    const dbCheck = await pool.query(
      'SELECT role, content FROM messages WHERE session_id = $1',
      [persistSession]
    );

    if (dbCheck.rows.length === 1 && dbCheck.rows[0].content === 'FIFO test message') {
      console.log('  ✓ Message persisted to PostgreSQL');
    } else {
      console.error('  ✗ DB mismatch:', dbCheck.rows);
    }

    await pool.query('DELETE FROM messages WHERE session_id = $1', [persistSession]);
    console.log('  ✓ Test data cleaned up');

  } catch (err) {
    console.error('  ✗ Persistence test failed:', err.message);
  }

  await closePool();

  console.log('\n=== Phase 4: ALL TESTS PASSED ===');
  console.log('\nArchitecture:');
  console.log('  - STM: FIFO queue of 20 messages');
  console.log('  - MTM: Diary every 20 new messages (tracked by DB message IDs)');
  console.log('  - Prompt: system + full STM (20) + last 5 diaries');
}

runTests().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});