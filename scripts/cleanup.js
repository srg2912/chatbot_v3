require('dotenv').config();
const { pool } = require('../src/database/pool');

async function cleanup() {
  console.log('=== Companion DB Cleanup ===\n');

  const tables = [
    'api_calls',
    'companion_self_state',
    'conversation_states',
    'diary_entries',
    'habit_insights',
    'messages',
    'personality_versions',
    'reflections',
    'shared_references',
    'user_facts',
    'vector_memories'
  ];

  for (const table of tables) {
    try {
      const result = await pool.query(`DELETE FROM ${table}`);
      console.log(`  ✓ ${table}: ${result.rowCount} rows deleted`);
    } catch (err) {
      console.error(`  ✗ ${table}: ${err.message}`);
    }
  }

  // Reset sequences if you want IDs to start from 1 again (optional)
  const sequences = ['messages_id_seq', 'diary_entries_id_seq', 'api_calls_id_seq'];
  for (const seq of sequences) {
    try {
      await pool.query(`ALTER SEQUENCE IF EXISTS ${seq} RESTART WITH 1`);
      console.log(`  ✓ ${seq} reset to 1`);
    } catch (err) {
      // Sequence might not exist yet, ignore
    }
  }

  console.log('\n=== Cleanup complete ===');
  await pool.end();
}

cleanup().catch(err => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});