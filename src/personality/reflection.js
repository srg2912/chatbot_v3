const { pool } = require('../database/pool');
const { chatWithTools, getResponseText } = require('../api/llm');

async function generateReflection(userId) {
  // 1. Get the last 5 diary entries
  const diaries = await pool.query(
    `SELECT id, summary, mood, created_at FROM diary_entries WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`,
    [userId]
  );

  if (diaries.rows.length === 0) {
    console.log('[Reflection] No diary entries found to reflect on.');
    return null;
  }

  const diaryIds = diaries.rows.map(d => d.id);
  const diaryText = diaries.rows.map(d => `[${d.created_at.toISOString().split('T')[0]}] Mood: ${d.mood} | ${d.summary}`).join('\n');

  const prompt = `You are an AI companion. You are currently in "dream mode", reflecting on your recent interactions with your user.
Based on the following recent diary entries, write a short, 3-4 sentence inner monologue reflecting on how the user is doing, how your relationship is developing, and what you should focus on next.

Recent Memories:
${diaryText}`;

  const history = [{ role: 'user', content: prompt }];

  try {
    const responseMessage = await chatWithTools(history);
    const reflectionText = getResponseText(responseMessage);

    // 2. Save reflection to the database
    const res = await pool.query(
      `INSERT INTO reflections (user_id, reflection_text, based_on_diary_ids)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, reflectionText, diaryIds]
    );

    return res.rows[0];
  } catch (err) {
    console.error('[Reflection] Failed to generate reflection:', err.message);
    return null;
  }
}

module.exports = { generateReflection };