const path = require('path');

console.log('=== Phase 8 Test: Mood Detection ===\n');

try {
  require('./src/config');
} catch (err) {
  console.error('✗ Config failed:', err.message);
  process.exit(1);
}

const { pool, closePool } = require('./src/database/pool');

async function runTests() {
  const mood = require('./src/memory/mood');
  const testUserId = 999992;
  const testSession = 'test_session_mood';

  console.log('[1/3] Testing Mood Check Logic...');
  // Clean up
  await pool.query('DELETE FROM messages WHERE session_id = $1', [testSession]);
  await pool.query('DELETE FROM conversation_states WHERE session_id = $1', [testSession]);

  // Insert 4 messages to trigger the interval (MOOD_CHECK_INTERVAL = 4)
  for (let i = 0; i < 4; i++) {
    await pool.query(
      `INSERT INTO messages (user_id, role, content, tokens, session_id) VALUES ($1, $2, $3, $4, $5)`,
      [testUserId, 'user', 'test', 1, testSession]
    );
  }

  const shouldDetect = await mood.shouldDetectMood(testSession);
  if (shouldDetect) {
    console.log('  ✓ successfully triggered mood check at 4 messages.');
  } else {
    console.error('  ✗ Mood check logic failed (should be true at 4).');
  }

  console.log('\n[2/3] Testing LLM Mood Extraction...');
  const fakeTranscript = [
    { role: 'user', content: 'Man, my boss yelled at me today in front of everyone. I just feel so embarrassed and exhausted.' },
    { role: 'model', content: 'That sounds awful, I am so sorry. You must be feeling totally drained.' },
    { role: 'user', content: 'Yeah. I just want to crawl into bed and forget this week happened.' }
  ];

  const state = await mood.detectAndSaveMood(testSession, testUserId, fakeTranscript);
  if (state) {
    console.log('  ✓ Mood State detected:');
    console.log(`    - Mood: ${state.detected_mood}`);
    console.log(`    - Energy: ${state.user_energy_level}/10`);
    console.log(`    - Anchor: ${state.topic_anchor}`);
    console.log(`    - Companion Adjustment: ${state.companion_adjustment}`);
  } else {
    console.error('  ✗ Failed to extract mood state.');
  }

  console.log('\n[3/3] Testing Mood Retrieval...');
  const retrieved = await mood.getLatestMood(testSession);
  if (retrieved && retrieved.detected_mood === state.detected_mood) {
    console.log('  ✓ Successfully retrieved latest mood from DB.');
  } else {
    console.error('  ✗ Failed to retrieve mood.');
  }

  // Cleanup
  await pool.query('DELETE FROM messages WHERE session_id = $1', [testSession]);
  await pool.query('DELETE FROM conversation_states WHERE session_id = $1', [testSession]);
  await closePool();
  console.log('\n=== Phase 8: TESTS COMPLETE ===');
}

runTests().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});