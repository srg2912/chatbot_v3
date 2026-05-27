const path = require('path');

console.log('=== Phase 11 Test: Memory Replay & Relationship Evolution ===\n');

try { require('./src/config'); } catch (err) { console.error('✗ Config failed:', err.message); process.exit(1); }

const { pool, closePool } = require('./src/database/pool');
const habits = require('./src/memory/habits');
const companionState = require('./src/memory/companionState');
const config = require('./src/config');

async function runTests() {
  const testUserId = config.ALLOWED_USER_ID;

  console.log('[1/4] Seeding Core Memories & Diaries...');
  await pool.query('DELETE FROM habit_insights WHERE user_id = $1', [testUserId]);
  await pool.query('DELETE FROM companion_self_state WHERE user_id = $1', [testUserId]);
  await pool.query('DELETE FROM vector_memories WHERE user_id = $1', [testUserId]);
  await pool.query('DELETE FROM diary_entries WHERE user_id = $1', [testUserId]);

  // Seed high-importance long-term memories
  await pool.query(
    `INSERT INTO vector_memories (user_id, content, importance) VALUES 
    ($1, 'User mentioned they have severe anxiety about public speaking.', 0.9),
    ($1, 'User always drinks chamomile tea when they are stressed.', 0.8)`
    , [testUserId]
  );

  // Seed recent diaries
  await pool.query(
    `INSERT INTO diary_entries (user_id, summary, mood) VALUES 
    ($1, 'User has a big presentation tomorrow and is freaking out.', 'anxious'),
    ($1, 'User bought 3 boxes of chamomile tea at the store today.', 'stressed')`
    , [testUserId]
  );
  console.log('  ✓ Seeded past traumas (LTM) and recent events (MTM).');

  console.log('\n[2/4] Running Memory Consolidation (Replaying)...');
  const insights = await habits.consolidatePatterns(testUserId);
  
  if (insights.length > 0) {
    console.log(`  ✓ Successfully extracted ${insights.length} deep patterns!`);
    insights.forEach(i => {
      console.log(`    - [${i.insight_type.toUpperCase()}] ${i.pattern_description}`);
    });
  } else {
    console.log('  ✗ Failed to consolidate patterns.');
    process.exit(1);
  }

  console.log('\n[3/4] Testing Companion State Initialization...');
  const initState = await companionState.getCompanionState(testUserId);
  console.log(`  ✓ Initial Depth: ${initState.relationship_depth}, Mood: ${initState.companion_mood_toward_user}`);

  console.log('\n[4/4] Evolving Relationship based on Reflection...');
  const fakeReflection = "The user is facing a massive trigger right now with their presentation. I feel very protective of them and want to help them stay calm.";
  
  const evolved = await companionState.evolveState(testUserId, fakeReflection);
  console.log('  ✓ Relationship Evolved!');
  console.log(`    - New Depth: ${evolved.relationship_depth} (was ${initState.relationship_depth})`);
  console.log(`    - New Mood: ${evolved.companion_mood_toward_user}`);

  // Cleanup
  await pool.query('DELETE FROM habit_insights WHERE user_id = $1', [testUserId]);
  await pool.query('DELETE FROM companion_self_state WHERE user_id = $1', [testUserId]);
  await pool.query('DELETE FROM vector_memories WHERE user_id = $1', [testUserId]);
  await pool.query('DELETE FROM diary_entries WHERE user_id = $1', [testUserId]);
  await closePool();
  
  console.log('\n=== Phase 11: TESTS COMPLETE ===');
}

runTests().catch(err => { console.error('Unexpected error:', err); process.exit(1); });