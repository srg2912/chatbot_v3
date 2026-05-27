const { pool } = require('../database/pool');
const { chatWithTools, getResponseText } = require('../api/llm');

async function getCompanionState(userId) {
  const res = await pool.query(
    `SELECT * FROM companion_self_state WHERE user_id = $1`,
    [userId]
  );
  
  if (res.rows.length === 0) {
    // Initialize if not exists
    const init = await pool.query(
      `INSERT INTO companion_self_state (user_id, companion_mood_toward_user, relationship_depth)
       VALUES ($1, 'curious and welcoming', 0)
       RETURNING *`,
      [userId]
    );
    return init.rows[0];
  }
  return res.rows[0];
}

async function evolveState(userId, reflectionText) {
  const currentState = await getCompanionState(userId);

  const prompt = `You are the core logic for an AI companion. Based on your recent internal reflection, how should your relationship with the user evolve?

Current State:
- Mood toward user: ${currentState.companion_mood_toward_user}
- Relationship Depth Level (0-100): ${currentState.relationship_depth}

Recent Reflection: "${reflectionText}"

Output ONLY a JSON object with two keys:
1. "new_mood" (string): How you feel toward the user now (e.g., "deeply affectionate", "concerned and protective").
2. "depth_increase" (integer): How much the relationship depth should increase based on this reflection (usually 1 or 2, 0 if nothing significant happened).

Do not wrap the JSON in Markdown code blocks.`;

  const history = [{ role: 'user', content: prompt }];

  try {
    const responseMessage = await chatWithTools(history);
    const text = getResponseText(responseMessage);
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Failed to parse JSON");
    
    const parsed = JSON.parse(jsonMatch[0]);
    const newDepth = Math.min(100, currentState.relationship_depth + (parsed.depth_increase || 0));

    const res = await pool.query(
      `UPDATE companion_self_state 
       SET companion_mood_toward_user = $1, relationship_depth = $2, updated_at = NOW()
       WHERE user_id = $3
       RETURNING *`,
      [parsed.new_mood || currentState.companion_mood_toward_user, newDepth, userId]
    );

    return res.rows[0];
  } catch (err) {
    console.error('[CompanionState] Failed to evolve:', err.message);
    return currentState;
  }
}

module.exports = { getCompanionState, evolveState };