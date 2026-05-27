const { pool } = require('../database/pool');
const { chatWithTools, getResponseText } = require('../api/llm');

const MOOD_CHECK_INTERVAL = 10; // Check every 4 messages

/**
 * Checks if it's time to detect the mood based on message count in this session.
 */
async function shouldDetectMood(sessionId) {
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM messages WHERE session_id = $1`,
    [sessionId]
  );
  const count = parseInt(result.rows[0].count);
  
  // Trigger mood detection every MOOD_CHECK_INTERVAL messages
  // We use > 0 to prevent triggering on the very first message
  return count > 0 && (count % MOOD_CHECK_INTERVAL === 0);
}

/**
 * Analyzes the recent conversation to detect the user's mood.
 */
async function detectAndSaveMood(sessionId, userId, recentMessages) {
  const transcript = recentMessages.map(m => `${m.role}: ${m.content}`).join('\n');

  const prompt = `Analyze the user's emotional state based on this recent conversation.
Identify:
1. The user's mood (e.g., happy, stressed, sad, excited, tired, neutral).
2. The user's energy level (1-10).
3. The main topic/anchor of their emotion.
4. How the AI companion should adjust its tone (e.g., "be gentle and supportive", "match their excitement").

Return ONLY a JSON object with keys: "mood", "energy_level", "topic_anchor", "companion_adjustment".
Do not wrap the JSON in Markdown code blocks.

Transcript:
${transcript}`;

  const history = [{ role: 'user', content: prompt }];

  try {
    const response = await chatWithTools(history);
    const responseText = getResponseText(response);
    
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Failed to parse JSON");
    
    const parsed = JSON.parse(jsonMatch[0]);

    // Save to database
    const res = await pool.query(
      `INSERT INTO conversation_states (user_id, session_id, detected_mood, user_energy_level, topic_anchor, companion_adjustment)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        userId, 
        sessionId, 
        parsed.mood || 'neutral', 
        parsed.energy_level || 5, 
        parsed.topic_anchor || 'general conversation', 
        parsed.companion_adjustment || 'maintain casual tone'
      ]
    );

    return res.rows[0];
  } catch (err) {
    console.error('[Mood] Failed to detect mood:', err.message);
    return null;
  }
}

/**
 * Retrieves the latest conversation state (mood) for the prompt.
 */
async function getLatestMood(sessionId) {
  const result = await pool.query(
    `SELECT detected_mood, user_energy_level, topic_anchor, companion_adjustment 
     FROM conversation_states 
     WHERE session_id = $1 
     ORDER BY created_at DESC 
     LIMIT 1`,
    [sessionId]
  );
  return result.rows[0] || null;
}

module.exports = {
  shouldDetectMood,
  detectAndSaveMood,
  getLatestMood,
  MOOD_CHECK_INTERVAL
};