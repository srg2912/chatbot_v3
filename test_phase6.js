const path = require('path');

console.log('=== Phase 6 Test: Long Term Memory (LTM) & Vector Search ===\n');

// Test 1: Config
console.log('[1/5] Testing config validation...');
try {
  require('./src/config');
  console.log('  ✓ Config loaded');
} catch (err) {
  console.error('  ✗ Config failed:', err.message);
  process.exit(1);
}

// Test 2: Database and Table Check
console.log('\n[2/5] Testing database and vector_memories table...');
const { pool, closePool } = require('./src/database/pool');

async function runTests() {
  let client;
  try {
    client = await pool.connect();
    const tableCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'vector_memories';
    `);
    
    if (tableCheck.rows.length > 0) {
      console.log('  ✓ vector_memories table exists');
    } else {
      console.error('  ✗ vector_memories table NOT FOUND.');
      console.error('    Check your schema.txt to see if your pgvector version supports halfvec.');
      process.exit(1);
    }
    client.release();
  } catch (err) {
    console.error('  ✗ DB failed:', err.message);
    process.exit(1);
  }

  // Test 3: Load LTM Module
  console.log('\n[3/5] Testing LTM module load...');
  let ltm;
  try {
    ltm = require('./src/memory/ltm');
    console.log('  ✓ LTM module loaded');
  } catch (err) {
    console.error('  ✗ LTM load failed:', err.message);
    process.exit(1);
  }

  // Test 4: Sequential Insertions
  console.log('\n[4/5] Testing sequential embedding and insertion...');
  const testUserId = 999994;

  const testFacts = [
    "My favorite color is neon green, it reminds me of old terminal screens.",
    "I have a pet iguana named Lizzy, she loves eating lettuce.",
    "I love eating spicy ramen on rainy days.",
    "I am currently studying astrophysics at the local university."
  ];

  try {
    // Clean up past tests just in case
    await pool.query('DELETE FROM vector_memories WHERE user_id = $1', [testUserId]);

    // Notice we use a strict sequential loop (for...of) to avoid RAM spikes / Gemini rate limits
    for (const fact of testFacts) {
      const memoryId = await ltm.addMemory(testUserId, fact, 'forced', null, 0.8);
      console.log(`  ✓ Inserted memory ID ${memoryId}: "${fact.substring(0, 30)}..."`);
    }
  } catch (err) {
    console.error('  ✗ Embedding/Insertion failed:', err.message);
    process.exit(1);
  }

  // Test 5: Vector Similarity Search
  console.log('\n[5/5] Testing Vector Search (Cosine Similarity)...');
  try {
    // We are asking a question that doesn't share exact words, forcing semantic matching
    const query = "What kind of animal do I own as a pet?";
    console.log(`  Query: "${query}"`);

    const results = await ltm.searchMemories(testUserId, query, 3);
    
    console.log('  Results:');
    results.forEach((row, index) => {
      console.log(`    ${index + 1}. [Sim: ${row.similarity.toFixed(3)}] ${row.content}`);
    });

    if (results.length > 0 && results[0].content.includes('Lizzy')) {
      console.log('\n  ✓ SUCCESS! The vector search correctly identified the iguana fact as the top match.');
    } else {
      console.log('\n  ⚠ Warning: The expected fact was not the top result. Check embeddings.');
    }

  } catch (err) {
    console.error('  ✗ Search failed:', err.message);
  }

  // Cleanup
  await pool.query('DELETE FROM vector_memories WHERE user_id = $1', [testUserId]);
  console.log('\n  ✓ Test data cleaned up');

  await closePool();
  console.log('\n=== Phase 6: TESTS COMPLETE ===');
}

runTests().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});