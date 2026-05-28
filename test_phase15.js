const path = require('path');

console.log('=== Phase 15 Test: Proactive Pulse & Depth System ===\n');

try { require('./src/config'); } catch (err) { console.error('✗ Config failed:', err.message); process.exit(1); }

const { pool, closePool } = require('./src/database/pool');
const { checkAndSendProactiveMessage } = require('./src/jobs/proactive');
const config = require('./src/config');

async function runTests() {
  const userId = config.ALLOWED_USER_ID;

  console.log('[1/2] Seeding mock data showing a deep bond...');
  await pool.query('DELETE FROM companion_self_state WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM diary_entries WHERE user_id = $1', [userId]);

  // Seed relationship depth = 35
  await pool.query(
    `INSERT INTO companion_self_state (user_id, companion_mood_toward_user, relationship_depth) 
     VALUES ($1, 'fond and deeply connected', 35)`,
    [userId]
  );

  // Seed recent diary entry
  await pool.query(
    `INSERT INTO diary_entries (user_id, summary, mood) 
     VALUES ($1, 'User stayed up late learning Python to write an automated home server script.', 'excited')`,
    [userId]
  );

  console.log('  ✓ Relationship data seeded.');

  console.log('\n[2/2] Triggering Proactive Check-in manually (FORCED)...');
  console.log('--------------------------------------------------');
  
  // Call with force=true to override cooldowns and hours checks
  await checkAndSendProactiveMessage(true);
  
  console.log('--------------------------------------------------');

  // Cleanup
  await pool.query('DELETE FROM companion_self_state WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM diary_entries WHERE user_id = $1', [userId]);
  await closePool();

  console.log('\n=== Phase 15: TESTS COMPLETE ===');
}

runTests().catch(err => { console.error('Unexpected error:', err); process.exit(1); });