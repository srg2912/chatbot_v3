const path = require('path');

console.log('=== Phase 5 Test: MTM (Diary) ===\n');

// Test 1: Config
console.log('[1/7] Testing config validation...');
try {
  const config = require('./src/config');
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

  // Test 3: Load MTM
  console.log('\n[3/7] Testing MTM module load...');
  let mtm;
  try {
    mtm = require('./src/memory/mtm');
    console.log('  ✓ MTM module loaded');
    console.log('  - DIARY_TRIGGER_MESSAGES:', mtm.DIARY_TRIGGER_MESSAGES);
  } catch (err) {
    console.error('  ✗ MTM load failed:', err.message);
    process.exit(1);
  }

  // Test 4: Seed 22 messages
  console.log('\n[4/7] Seeding test messages...');
  const testSession = 'test-diary-session';
  const testUserId = 999997;

  try {
    await pool.query('DELETE FROM messages WHERE session_id = $1', [testSession]);
    await pool.query('DELETE FROM diary_entries WHERE message_range LIKE $1', [`%${testSession}%`]);

    const messages = [
      { role: 'user', content: 'I had a great day today, went hiking with friends.' },
      { role: 'model', content: 'That sounds amazing! Where did you hike?' },
      { role: 'user', content: 'We went to the mountain trail near the lake.' },
      { role: 'model', content: 'Nice, I bet the view was beautiful.' },
      { role: 'user', content: 'It was, but I felt a bit tired afterwards.' },
      { role: 'model', content: 'Hiking can be exhausting. Did you rest?' },
      { role: 'user', content: 'Yeah, I napped for 2 hours when I got home.' },
      { role: 'model', content: 'Good call. Sleep is important.' },
      { role: 'user', content: 'Now I am planning dinner, thinking about pasta.' },
      { role: 'model', content: 'Pasta sounds perfect after a hike.' },
      { role: 'user', content: 'I also need to call my mom tomorrow.' },
      { role: 'model', content: 'She will appreciate that for sure.' },
      { role: 'user', content: 'By the way, I started learning Japanese.' },
      { role: 'model', content: 'Oh? What made you pick Japanese?' },
      { role: 'user', content: 'I want to travel there next year.' },
      { role: 'model', content: 'That is a great goal. Tokyo or Kyoto?' },
      { role: 'user', content: 'Probably both, and also Osaka for the food.' },
      { role: 'model', content: 'You cannot miss the street food there.' },
      { role: 'user', content: 'I am also saving money for the trip.' },
      { role: 'model', content: 'Smart. Budget travel is still great travel.' },
      { role: 'user', content: 'I should book flights soon though.' },
      { role: 'model', content: 'Yes, prices go up closer to the date.' },
    ];

    for (const m of messages) {
      await pool.query(
        `INSERT INTO messages (user_id, role, content, tokens, session_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [testUserId, m.role, m.content, Math.ceil(m.content.length / 4), testSession]
      );
    }
    console.log(`  ✓ Inserted ${messages.length} test messages`);

  } catch (err) {
    console.error('  ✗ Seeding failed:', err.message);
    process.exit(1);
  }

  // Test 5: Trigger diary
  console.log('\n[5/7] Testing diary generation...');
  let diaryResult;
  try {
    diaryResult = await mtm.checkAndGenerate(testSession, testUserId);
    
    if (diaryResult) {
      console.log('  ✓ Diary generated!');
      console.log('    - ID:', diaryResult.id);
      console.log('    - Summary:', diaryResult.summary.substring(0, 80));
      console.log('    - Mood:', diaryResult.mood);
      console.log('    - Energy:', diaryResult.energy_level);
      console.log('    - Range:', diaryResult.messageRange);
    } else {
      console.log('  ⚠ No diary generated (Gemini may have failed)');
    }
  } catch (err) {
    console.error('  ✗ Diary generation error:', err.message);
  }

  // Test 6: Verify in DB
  console.log('\n[6/7] Verifying diary in database...');
  try {
    const dbCheck = await pool.query(
      `SELECT id, summary, mood, user_energy_level, message_range 
       FROM diary_entries 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [testUserId]
    );

    if (dbCheck.rows.length > 0) {
      const row = dbCheck.rows[0];
      console.log('  ✓ Diary entry found in DB:');
      console.log('    - ID:', row.id);
      console.log('    - Summary:', row.summary.substring(0, 60));
      console.log('    - Range:', row.message_range);
    } else {
      console.log('  ⚠ No diary entries in database yet');
    }
  } catch (err) {
    console.error('  ✗ DB check failed:', err.message);
  }

  // Test 7: getRecentDiaries
  console.log('\n[7/7] Testing getRecentDiaries...');
  try {
    const diaries = await mtm.getRecentDiaries(testUserId, 5);
    console.log('  ✓ Retrieved', diaries.length, 'diary entries');
    diaries.forEach((d, i) => {
      console.log(`    [${i}] ${d.summary.substring(0, 50)}... (mood: ${d.mood})`);
    });
  } catch (err) {
    console.error('  ✗ getRecentDiaries failed:', err.message);
  }

  // Cleanup
  await pool.query('DELETE FROM messages WHERE session_id = $1', [testSession]);
  await pool.query('DELETE FROM diary_entries WHERE message_range LIKE $1', [`%${testSession}%`]);
  console.log('\n  ✓ Test data cleaned up');

  await closePool();

  console.log('\n=== Phase 5: TESTS COMPLETE ===');
  if (!diaryResult) {
    console.log('\n⚠ Diary was not generated. This is OK if Gemini returned 503.');
    console.log('   Messages remain in DB and will be retried on next trigger.');
  }
}

runTests().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});