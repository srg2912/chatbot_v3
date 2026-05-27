const path = require('path');

console.log('=== Phase 10 Test: Reflection & Personality Mutation ===\n');

try { require('./src/config'); } catch (err) { console.error('✗ Config failed:', err.message); process.exit(1); }

const { pool, closePool } = require('./src/database/pool');
const reflection = require('./src/personality/reflection');
const engine = require('./src/personality/engine');
const config = require('./src/config');

async function runTests() {
  const testUserId = config.ALLOWED_USER_ID;
  const testSession = 'phase10_test_session';

  console.log('[1/4] Seeding fake diary entries...');
  await pool.query('DELETE FROM reflections WHERE user_id = $1', [testUserId]);
  await pool.query('DELETE FROM diary_entries WHERE message_range LIKE $1', [`%${testSession}%`]);
  await pool.query('DELETE FROM personality_versions WHERE user_id = $1', [testUserId]);

  // Seed two diaries showing the user is extremely stressed
  await pool.query(
    `INSERT INTO diary_entries (user_id, summary, mood, user_energy_level, message_range) VALUES 
    ($1, 'User is overwhelmed with finals week and running on zero sleep.', 'stressed', 2, $2),
    ($1, 'User cried today because their computer crashed and they lost an essay.', 'sad', 1, $3)`,
    [testUserId, `${testSession}#1-10`, `${testSession}#11-20`]
  );
  console.log('  ✓ Seeded stressed diary entries.');

  console.log('\n[2/4] Generating Nightly Reflection (Dream Mode)...');
  const dream = await reflection.generateReflection(testUserId);
  if (dream) {
    console.log('  ✓ Dream generated:');
    console.log(`    "${dream.reflection_text}"`);
  } else {
    console.error('  ✗ Failed to generate reflection.');
    process.exit(1);
  }

  console.log('\n[3/4] Mutating Personality...');
  const mutation = await engine.mutatePersonality(testUserId, dream.reflection_text);
  if (mutation) {
    console.log('  ✓ Personality Mutated!');
    console.log(`    - New Traits: "${mutation.personality_text}"`);
    console.log(`    - Reason: "${mutation.mutation_note}"`);
  } else {
    console.error('  ✗ Failed to mutate personality.');
    process.exit(1);
  }

  console.log('\n[4/4] Rendering Final personality.txt...');
  try {
    const rendered = await engine.renderPersonality(testUserId, {
      user_nickname: 'Captain',
      companion_mood_toward_user: 'highly protective and soothing'
    });
    console.log('\n--- COMPILED SYSTEM PROMPT PREVIEW ---');
    console.log(rendered);
    console.log('--------------------------------------');
  } catch (err) {
    console.error('  ✗ Rendering failed:', err.message);
  }

  // Cleanup
  await pool.query('DELETE FROM reflections WHERE user_id = $1', [testUserId]);
  await pool.query('DELETE FROM diary_entries WHERE message_range LIKE $1', [`%${testSession}%`]);
  await pool.query('DELETE FROM personality_versions WHERE user_id = $1', [testUserId]);
  await closePool();
  
  console.log('\n=== Phase 10: TESTS COMPLETE ===');
}

runTests().catch(err => { console.error('Unexpected error:', err); process.exit(1); });