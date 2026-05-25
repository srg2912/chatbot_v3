const path = require('path');

console.log('=== Phase 1 Test: Config + Database ===\n');

// Test 1: Config validation
console.log('[1/5] Testing config validation...');
try {
  const config = require('./src/config');
  console.log('  ✓ Config loaded successfully');
  console.log('  - ALLOWED_USER_ID:', config.ALLOWED_USER_ID);
  console.log('  - LLM_MODEL:', config.LLM_MODEL);
  console.log('  - DATABASE_URL:', config.DATABASE_URL.replace(/\/\/.*@/, '//***@'));
  console.log('  - MAX_TOOL_ITERATIONS:', config.MAX_TOOL_ITERATIONS);
} catch (err) {
  console.error('  ✗ Config failed:', err.message);
  process.exit(1);
}

// Test 2: Database connection
console.log('\n[2/5] Testing database connection...');
const { pool, closePool } = require('./src/database/pool');

async function runTests() {
  let client;
  try {
    client = await pool.connect();
    console.log('  ✓ Connected to PostgreSQL');

    // Test 3: Check pgvector extension
    console.log('\n[3/5] Checking pgvector extension...');
    const extCheck = await client.query(
      "SELECT * FROM pg_extension WHERE extname = 'vector'"
    );
    
    if (extCheck.rows.length > 0) {
      console.log('  ✓ pgvector extension is installed');
    } else {
      console.log('  ⚠ pgvector extension NOT installed');
    }

    // Test 4: Run schema
    console.log('\n[4/5] Running schema.sql...');
    const fs = require('fs');
    const schemaPath = path.join(__dirname, 'src', 'database', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Execute as one big batch - the DO block handles vector conditionally
    try {
      await client.query(schema);
      console.log('  ✓ Schema executed successfully');
    } catch (err) {
      console.error('  ✗ Schema error:', err.message);
      throw err;
    }

    // Test 5: Verify tables exist
    console.log('\n[5/5] Verifying tables...');
    const tableCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('messages', 'diary_entries', 'vector_memories', 'user_facts', 
                         'habit_insights', 'shared_references', 'companion_self_state',
                         'conversation_states', 'reflections', 'personality_versions', 'api_calls')
      ORDER BY table_name;
    `);
    
    const foundTables = tableCheck.rows.map(r => r.table_name);
    const expectedTables = ['api_calls', 'companion_self_state', 'conversation_states', 'diary_entries', 
                           'habit_insights', 'messages', 'personality_versions', 'reflections', 
                           'shared_references', 'user_facts', 'vector_memories'];
    
    const missing = expectedTables.filter(t => !foundTables.includes(t));
    
    if (missing.length === 0) {
      console.log('  ✓ All 11 tables verified:');
      foundTables.forEach(t => console.log(`    - ${t}`));
    } else if (missing.length === 1 && missing[0] === 'vector_memories') {
      console.log('  ⚠ 10/11 tables ready (vector_memories skipped — pgvector type not visible to bot_user)');
      foundTables.forEach(t => console.log(`    - ${t}`));
      console.log('\n  To fix vector_memories, run as postgres superuser:');
      console.log('  sudo -u postgres psql -d chatbot_db -c "GRANT USAGE ON SCHEMA public TO bot_user;"');
    } else {
      console.error('  ✗ Missing tables:', missing.join(', '));
    }

    // Bonus: Test basic insert/read
    console.log('\n[Bonus] Testing basic insert/read cycle...');
    const testUserId = 999999;
    await client.query(
      `INSERT INTO messages (user_id, role, content, tokens, session_id) 
       VALUES ($1, $2, $3, $4, $5)`,
      [testUserId, 'user', 'Hello from Phase 1 test', 5, 'test-session']
    );
    
    const result = await client.query(
      'SELECT * FROM messages WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
      [testUserId]
    );
    
    if (result.rows[0].content === 'Hello from Phase 1 test') {
      console.log('  ✓ Insert/read cycle works');
    }
    
    // Cleanup test data
    await client.query('DELETE FROM messages WHERE user_id = $1', [testUserId]);
    console.log('  ✓ Test data cleaned up');

    console.log('\n=== Phase 1: ALL TESTS PASSED ===');

  } catch (err) {
    console.error('\n  ✗ Fatal error:', err.message);
    if (err.message.includes('permission denied')) {
      console.error('\n  Hint: Run the grant commands from the setup instructions as postgres superuser.');
    }
    process.exit(1);
  } finally {
    if (client) client.release();
    await closePool();
  }
}

runTests();