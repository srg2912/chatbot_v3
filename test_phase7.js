const path = require('path');

console.log('=== Phase 7 Test: Facts Extraction ("Soul Map") ===\n');

// Test 1: Config
console.log('[1/4] Testing config validation...');
try {
  require('./src/config');
  console.log('  ✓ Config loaded');
} catch (err) {
  console.error('  ✗ Config failed:', err.message);
  process.exit(1);
}

const { pool, closePool } = require('./src/database/pool');

async function runTests() {
  let client;
  try {
    client = await pool.connect();
    const dbResult = await client.query('SELECT NOW() as now');
    console.log('\n[2/4] ✓ DB connected. Server time:', dbResult.rows[0].now.toISOString());
    client.release();
  } catch (err) {
    console.error('  ✗ DB failed:', err.message);
    process.exit(1);
  }

  // Load Facts module
  let facts;
  try {
    facts = require('./src/memory/facts');
    console.log('  ✓ Facts module loaded');
  } catch (err) {
    console.error('  ✗ Facts load failed:', err.message);
    process.exit(1);
  }

  const testUserId = 999993;
  const sampleDiaryText = "I started a new job as a software engineer today. I am trying to learn Rust because my goal is to build faster tools. Also, I really hate waking up before 7 AM, it ruins my mood. I currently live with my partner, Alex.";

  // Test 3: Extract and Save Facts
  console.log('\n[3/4] Testing LLM Fact Extraction...');
  console.log(`  Analyzing text: "${sampleDiaryText}"`);
  
  try {
    // Cleanup any previous run
    await pool.query('DELETE FROM user_facts WHERE user_id = $1', [testUserId]);

    const extractedFacts = await facts.extractAndSaveFacts(sampleDiaryText, testUserId, null);
    
    if (extractedFacts.length > 0) {
      console.log(`  ✓ Successfully extracted ${extractedFacts.length} facts:`);
      extractedFacts.forEach(f => {
        console.log(`    - [${f.category}] ${f.fact_text}`);
      });
    } else {
      console.log('  ⚠ No facts were extracted. Gemini may have misunderstood the prompt or failed.');
    }
  } catch (err) {
    console.error('  ✗ Fact extraction failed:', err.message);
    process.exit(1);
  }

  // Test 4: Retrieve Facts
  console.log('\n[4/4] Testing Fact Retrieval...');
  try {
    const activeFacts = await facts.getActiveFacts(testUserId);
    if (activeFacts.length > 0) {
      console.log('  ✓ Retrieved active facts from DB:');
      activeFacts.forEach(f => {
        console.log(`    - [${f.category}] (Conf: ${f.confidence}) ${f.fact_text}`);
      });
    } else {
      console.error('  ✗ No active facts found in DB.');
    }
  } catch (err) {
    console.error('  ✗ Fact retrieval failed:', err.message);
  }

  // Cleanup
  await pool.query('DELETE FROM user_facts WHERE user_id = $1', [testUserId]);
  console.log('\n  ✓ Test data cleaned up');

  await closePool();
  console.log('\n=== Phase 7: TESTS COMPLETE ===');
}

runTests().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});