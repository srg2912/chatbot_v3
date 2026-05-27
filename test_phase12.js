const path = require('path');

console.log('=== Phase 12 Test: The Nightly Cron Job ===\n');

try { require('./src/config'); } catch (err) { console.error('✗ Config failed:', err.message); process.exit(1); }

const { pool, closePool } = require('./src/database/pool');
const { runNightlyMaintenance } = require('./src/jobs/nightly');
const config = require('./src/config');

async function runTests() {
  const userId = config.ALLOWED_USER_ID;

  console.log('[1/3] Verifying database connection...');
  try {
    const client = await pool.connect();
    client.release();
    console.log('  ✓ Database ready.');
  } catch (err) {
    console.error('✗ DB failed:', err.message);
    process.exit(1);
  }

  console.log('\n[2/3] Seeding dummy data (Past 3 weeks of simulated time)...');
  
  // Clean slate for the test
  await pool.query('DELETE FROM messages WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM user_facts WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM diary_entries WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM vector_memories WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM companion_self_state WHERE user_id = $1', [userId]);

  // 1. Seed an OLD message (>14 days) to test STM cleanup
  await pool.query(
    `INSERT INTO messages (user_id, role, content, session_id, created_at) 
     VALUES ($1, 'user', 'This is a very old message from 20 days ago.', 'test_session', NOW() - INTERVAL '20 days')`,
    [userId]
  );

  // 2. Seed an OLD fact (>7 days) to test Confidence Decay
  await pool.query(
    `INSERT INTO user_facts (user_id, category, fact_text, confidence, last_mentioned) 
     VALUES ($1, 'preference', 'Loves drinking matcha lattes.', 0.8, NOW() - INTERVAL '10 days')`,
    [userId]
  );

  // 3. Seed an important memory and a recent diary for Habits & Reflection
  await pool.query(
    `INSERT INTO vector_memories (user_id, content, importance) 
     VALUES ($1, 'User mentioned they want to write a sci-fi novel this year.', 0.9)`,
    [userId]
  );
  
  await pool.query(
    `INSERT INTO diary_entries (user_id, summary, mood, created_at) 
     VALUES ($1, 'User spent 3 hours writing the first chapter of their sci-fi book today and felt amazing.', 'inspired', NOW() - INTERVAL '1 day')`,
    [userId]
  );

  // 4. Seed initial companion state
  await pool.query(
    `INSERT INTO companion_self_state (user_id, companion_mood_toward_user, relationship_depth) 
     VALUES ($1, 'neutral and observing', 5)`,
    [userId]
  );

  console.log('  ✓ Dummy data injected.\n');

  console.log('[3/3] Manually triggering 3:00 AM Nightly Maintenance...');
  console.log('--------------------------------------------------');
  
  // This will take 10-30 seconds depending on LLM latency
  await runNightlyMaintenance();
  
  console.log('--------------------------------------------------\n');

  // Verify the aftermath!
  console.log('=== VERIFYING RESULTS ===');
  
  const msgCheck = await pool.query('SELECT count(*) FROM messages WHERE user_id = $1', [userId]);
  console.log(`  - Old STM messages remaining: ${msgCheck.rows[0].count} (Should be 0)`);

  const factCheck = await pool.query('SELECT fact_text, confidence FROM user_facts WHERE user_id = $1', [userId]);
  if (factCheck.rows.length > 0) {
    console.log(`  - Fact "${factCheck.rows[0].fact_text}" confidence decayed to: ${factCheck.rows[0].confidence} (Should be 0.75)`);
  }

  const embedCheck = await pool.query(`SELECT count(*) FROM vector_memories WHERE user_id = $1 AND source = 'diary'`, [userId]);
  console.log(`  - Unprocessed diaries embedded to LTM: ${embedCheck.rows[0].count} (Should be 1)`);

  const stateCheck = await pool.query('SELECT companion_mood_toward_user FROM companion_self_state WHERE user_id = $1', [userId]);
  if (stateCheck.rows.length > 0) {
    console.log(`  - New Companion Mood: "${stateCheck.rows[0].companion_mood_toward_user}"`);
  }

  // Final Cleanup
  await pool.query('DELETE FROM messages WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM user_facts WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM diary_entries WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM vector_memories WHERE user_id = $1', [userId]);
  
  await closePool();
  console.log('\n=== Phase 12: TESTS COMPLETE ===');
}

runTests().catch(err => { console.error('Unexpected error:', err); process.exit(1); });