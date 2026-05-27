const { pool } = require('../database/pool');
const { chatWithTools, getResponseText } = require('../api/llm');

const VALID_CATEGORIES = ['preference', 'biography', 'goal', 'boundary', 'relationship', 'routine'];

/**
 * Extracts facts from text using Gemini and saves them to the database.
 * @param {string} text - The text to analyze (e.g., diary summary)
 * @param {number} userId - The user's Telegram ID
 * @param {number|null} sourceMessageId - Optional ID of the source message
 */
async function extractAndSaveFacts(text, userId, sourceMessageId = null) {
  const prompt = `Extract long-term, permanent facts about the user from the text below. 
Categorize each fact into EXACTLY ONE of these categories: ${VALID_CATEGORIES.join(', ')}.
Only extract permanent or semi-permanent facts (e.g., "likes coffee", "has a dog", "wants to learn piano"), DO NOT extract temporary states (e.g., "is tired today", "went to the store").

Return ONLY a JSON array of objects with "category" and "fact_text" keys. Do not wrap the JSON in Markdown code blocks. 
If no permanent facts are found, return an empty array: []

Text to analyze:
"${text}"`;

  const history = [{ role: 'user', content: prompt }];
  
  // 1. Call Gemini to extract facts
  const response = await chatWithTools(history);
  const responseText = getResponseText(response);

  let facts = [];
  try {
    // Extract JSON array robustly
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      facts = JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    console.error('[Facts] Failed to parse facts JSON from Gemini:', err.message);
    console.error('[Facts] Raw response was:', responseText);
    return [];
  }

  const savedFacts = [];
  
  // 2. Sequentially insert into PSQL (No Promise.all!)
  for (const item of facts) {
    if (VALID_CATEGORIES.includes(item.category) && item.fact_text) {
      try {
        const res = await pool.query(
          `INSERT INTO user_facts (user_id, category, fact_text, source_message_id, confidence, is_still_true)
           VALUES ($1, $2, $3, $4, 0.9, true)
           RETURNING id, category, fact_text`,
          [userId, item.category, item.fact_text, sourceMessageId]
        );
        savedFacts.push(res.rows[0]);
      } catch (dbErr) {
        console.error(`[Facts] Failed to save fact "${item.fact_text}":`, dbErr.message);
      }
    } else {
      console.log(`[Facts] Skipped invalid fact/category: ${JSON.stringify(item)}`);
    }
  }

  return savedFacts;
}

/**
 * Retrieves all currently true facts for the user (useful for system prompts later)
 */
async function getActiveFacts(userId) {
  const result = await pool.query(
    `SELECT category, fact_text, confidence 
     FROM user_facts 
     WHERE user_id = $1 AND is_still_true = true 
     ORDER BY category ASC, confidence DESC`,
    [userId]
  );
  return result.rows;
}

async function decayConfidence(userId) {
  // 1. Reduce confidence by 0.05 for facts older than 7 days
  await pool.query(
    `UPDATE user_facts SET confidence = GREATEST(0, confidence - 0.05) 
     WHERE user_id = $1 AND last_mentioned < NOW() - INTERVAL '7 days' AND is_still_true = true`,
    [userId]
  );
  // 2. Mark facts as false if confidence drops below 0.3
  await pool.query(
    `UPDATE user_facts SET is_still_true = false 
     WHERE user_id = $1 AND confidence < 0.3`,
    [userId]
  );
}
// Don't forget to add decayConfidence to your module.exports!

module.exports = {
  extractAndSaveFacts,
  getActiveFacts,
  decayConfidence,
  VALID_CATEGORIES
};