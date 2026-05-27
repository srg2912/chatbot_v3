const { pool } = require('../database/pool');
const { chatWithTools, getResponseText } = require('../api/llm');

const VALID_INSIGHT_TYPES = ['temporal', 'topical', 'emotional', 'social'];

/**
 * Replays important memories and recent diaries to extract deep patterns
 */
async function consolidatePatterns(userId) {
  // 1. Fetch the 5 most "important" vector memories (Spaced Repetition)
  const importantMemories = await pool.query(
    `SELECT content, importance FROM vector_memories 
     WHERE user_id = $1 AND importance >= 0.7 
     ORDER BY importance DESC LIMIT 5`,
    [userId]
  );

  // 2. Fetch the last 7 days of diaries
  const recentDiaries = await pool.query(
    `SELECT summary, mood FROM diary_entries 
     WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '7 days'`,
    [userId]
  );

  if (importantMemories.rows.length === 0 && recentDiaries.rows.length === 0) {
    console.log('[Habits] Not enough data to consolidate patterns yet.');
    return [];
  }

  // Build the "Replay" text
  let replayText = "--- HIGH IMPORTANCE CORE MEMORIES ---\n";
  importantMemories.rows.forEach(m => replayText += `- ${m.content}\n`);
  
  replayText += "\n--- RECENT WEEKLY DIARIES ---\n";
  recentDiaries.rows.forEach(d => replayText += `- [Mood: ${d.mood}] ${d.summary}\n`);

  const prompt = `You are an AI cognitive engine. Replay the following core memories and recent diaries in your mind. 
By connecting these events, identify deep, underlying patterns or habits in the user's behavior.

Categorize each pattern into exactly one of these types: ${VALID_INSIGHT_TYPES.join(', ')}.
- temporal: time-based routines (e.g., "Stays up late on weekends")
- topical: recurring interests/topics (e.g., "Constantly researching AI")
- emotional: triggers and reactions (e.g., "Gets stressed when deadlines approach")
- social: relationship dynamics (e.g., "Relying heavily on Alex for support")

Return ONLY a JSON array of objects with keys: "insight_type" and "pattern_description". 
Do not wrap the JSON in Markdown code blocks.

Data to Replay:
${replayText}`;

  const history = [{ role: 'user', content: prompt }];

  try {
    const responseMessage = await chatWithTools(history);
    const text = getResponseText(responseMessage);
    
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("Failed to parse JSON array");
    
    const patterns = JSON.parse(jsonMatch[0]);
    const savedPatterns = [];

    // Sequentially insert new insights
    for (const p of patterns) {
      if (VALID_INSIGHT_TYPES.includes(p.insight_type)) {
        const res = await pool.query(
          `INSERT INTO habit_insights (user_id, insight_type, pattern_description, first_observed, last_observed)
           VALUES ($1, $2, $3, NOW(), NOW())
           RETURNING *`,
          [userId, p.insight_type, p.pattern_description]
        );
        savedPatterns.push(res.rows[0]);
      }
    }
    
    return savedPatterns;
  } catch (err) {
    console.error('[Habits] Consolidation failed:', err.message);
    return [];
  }
}

module.exports = { consolidatePatterns };