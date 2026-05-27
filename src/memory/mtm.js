const { pool } = require('../database/pool');
const { chatWithTools, getResponseText } = require('../api/gemini');
const activeGenerationLocks = new Set();

const DIARY_TRIGGER_MESSAGES = 20; // Every 20 messages total (user + model)
const MAX_DIARY_AGE_HOURS = 24;

/**
 * Check if we should generate a diary entry for this session.
 * Uses message_range to track which messages were already summarized.
 */
async function shouldGenerateDiary(sessionId) {
  const lastDiary = await pool.query(
    `SELECT message_range FROM diary_entries 
     WHERE message_range LIKE $1 
     ORDER BY created_at DESC LIMIT 1`,
    [`%${sessionId}%`]
  );

  // Parse the last message ID from the range: "sessionId#start-end"
  let lastMessageId = 0;
  if (lastDiary.rows.length > 0) {
    const range = lastDiary.rows[0].message_range;
    const match = range.match(/#(\d+)-(\d+)$/);
    if (match) {
      lastMessageId = parseInt(match[2]);
    }
  }

  const msgCount = await pool.query(
    `SELECT COUNT(*) as count FROM messages 
     WHERE session_id = $1 
     AND id > $2`,
    [sessionId, lastMessageId]
  );

  const count = parseInt(msgCount.rows[0].count);

  // Time-based trigger
  let timeTriggered = false;
  if (lastDiary.rows.length > 0) {
    const lastDiaryTime = await pool.query(
      `SELECT created_at FROM diary_entries 
       WHERE message_range = $1`,
      [lastDiary.rows[0].message_range]
    );
    if (lastDiaryTime.rows.length > 0) {
      const hoursSince = (Date.now() - new Date(lastDiaryTime.rows[0].created_at)) / 3600000;
      timeTriggered = hoursSince > MAX_DIARY_AGE_HOURS && count > 0;
    }
  }

  return { should: count >= DIARY_TRIGGER_MESSAGES || timeTriggered, count, timeTriggered, lastMessageId };
}

/**
 * Fetch raw messages to summarize
 */
async function getMessagesToSummarize(sessionId, afterId) {
  const result = await pool.query(
    `SELECT id, role, content, created_at 
     FROM messages 
     WHERE session_id = $1 
     AND id > $2
     ORDER BY id ASC`,
    [sessionId, afterId]
  );
  return result.rows;
}

/**
 * Call Gemini to summarize a conversation batch
 */
async function summarizeMessages(messages, userId) {
  const transcript = messages.map(m => `${m.role}: ${m.content}`).join('\n');

  const prompt = [
    {
      role: 'user',
      parts: [{
        text: `Summarize the following conversation transcript into a diary entry. Extract key facts, note the mood/energy level, and keep it concise (3-5 sentences).

Return ONLY a JSON object with this exact structure. Do not wrap the JSON in Markdown code blocks:
{
  "summary": "Brief narrative summary",
  "key_facts": ["fact 1", "fact 2"],
  "mood": "user's apparent mood",
  "energy_level": 7
}

Transcript:
${transcript}`
      }]
    }
  ];

  const response = await chatWithTools(prompt);
  const text = getResponseText(response);

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to extract JSON from summary');
  }

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    summary: parsed.summary || 'No summary generated.',
    key_facts: Array.isArray(parsed.key_facts) ? parsed.key_facts : [],
    mood: parsed.mood || 'neutral',
    energy_level: typeof parsed.energy_level === 'number' ? parsed.energy_level : 5,
  };
}

/**
 * Main entry: check and generate diary if needed.
 * If Gemini fails (503, etc.), messages stay in pool for next trigger.
 */
async function checkAndGenerate(sessionId, userId) {
  // Prevent parallel summarization for the same session
  if (activeGenerationLocks.has(sessionId)) return null;

  const { should, count, timeTriggered, lastMessageId } = await shouldGenerateDiary(sessionId);
  
  if (!should) return null;

  const messages = await getMessagesToSummarize(sessionId, lastMessageId);
  if (messages.length === 0) return null;

  // Lock the session
  activeGenerationLocks.add(sessionId);

  console.log(`[MTM] Generating diary for ${sessionId} (${messages.length} messages, timeTriggered=${timeTriggered})`);

  try {
    const summary = await summarizeMessages(messages, userId);

    const messageRange = `${sessionId}#${messages[0].id}-${messages[messages.length - 1].id}`;
    const result = await pool.query(
      `INSERT INTO diary_entries (user_id, summary, key_facts, mood, user_energy_level, message_range)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        userId,
        summary.summary,
        JSON.stringify(summary.key_facts),
        summary.mood,
        summary.energy_level,
        messageRange,
      ]
    );

    console.log(`[MTM] Diary entry #${result.rows[0].id} created`);
    return {
      id: result.rows[0].id,
      ...summary,
      messageRange,
    };

  } catch (err) {
    console.error(`[MTM] Diary generation failed (will retry later): ${err.message}`);
    return null;
  } finally {
    // ALWAYS release the lock
    activeGenerationLocks.delete(sessionId);
  }
}

/**
 * Get recent diary entries for prompt building
 */
async function getRecentDiaries(userId, limit = 5) {
  const result = await pool.query(
    `SELECT id, summary, key_facts, mood, user_energy_level, created_at 
     FROM diary_entries 
     WHERE user_id = $1 
     ORDER BY created_at DESC 
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}

module.exports = {
  checkAndGenerate,
  getRecentDiaries,
  shouldGenerateDiary,
  DIARY_TRIGGER_MESSAGES,
  MAX_DIARY_AGE_HOURS,
};