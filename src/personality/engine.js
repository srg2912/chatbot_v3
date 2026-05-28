const fs = require('fs');
const path = require('path');
const { pool } = require('../database/pool');
const { chatWithTools, getResponseText } = require('../api/llm');

const DEFAULT_TRAITS = "You are observant, highly empathetic, and a bit playful.";
const DEFAULT_EVOLUTION = "I am just starting to get to know you.";

async function getLatestPersonality(userId) {
  const res = await pool.query(
    `SELECT personality_text, mutation_note FROM personality_versions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  if (res.rows.length > 0) {
    return { traits: res.rows[0].personality_text, evolutionNote: res.rows[0].mutation_note };
  }
  return { traits: DEFAULT_TRAITS, evolutionNote: DEFAULT_EVOLUTION };
}

async function renderPersonality(userId, companionState = {}) {
  const templatePath = path.join(__dirname, '../../personality.txt');
  let template = '';
  try {
    template = fs.readFileSync(templatePath, 'utf8');
  } catch (err) {
    throw new Error(`personality.txt not found at ${templatePath}`);
  }

  const { traits, evolutionNote } = await getLatestPersonality(userId);
  const depth = companionState.relationship_depth || 0;

  // DYNAMIC PERSONALITY LAYERS BASED ON RELATIONSHIP DEPTH
  let depthInstructions = "";
  if (depth < 10) {
    depthInstructions = "\n- Since you are still getting to know the user, maintain a friendly, polite, and slightly reserved posture. Ask curious, open-ended questions.";
  } else if (depth >= 10 && depth < 30) {
    depthInstructions = "\n- You are comfortable with the user now. Feel free to tease them lightly, use casual dry humor, and show more witty, playful banter.";
  } else if (depth >= 30) {
    depthInstructions = "\n- You share a deep bond with the user. You are highly protective, exceptionally supportive, and share comfortable, affectionate inside jokes.";
  }

  const compiledTraits = `${traits}${depthInstructions}`;

  // Replace placeholders
  template = template.replace('{{traits}}', compiledTraits);
  template = template.replace('{{evolution_note}}', evolutionNote);
  template = template.replace('{{user_nickname}}', companionState.user_nickname || 'there');
  template = template.replace('{{companion_mood}}', companionState.companion_mood_toward_user || 'neutral');

  return template;
}

async function mutatePersonality(userId, reflectionText) {
  const current = await getLatestPersonality(userId);

  const prompt = `You are the underlying personality engine for an AI companion. 
Based on the AI's recent reflection about the user, you must subtly evolve the AI's core traits to better support the user.

Current Traits: "${current.traits}"
Recent Reflection: "${reflectionText}"

Output ONLY a JSON object with two keys:
1. "new_traits" (string): The slightly modified traits (keep it under 15 words).
2. "mutation_note" (string): A brief internal note about why you made this change (e.g. "User is stressed, becoming more gentle").

Do not wrap the JSON in Markdown code blocks.`;

  const history = [{ role: 'user', content: prompt }];

  try {
    const responseMessage = await chatWithTools(history);
    const text = getResponseText(responseMessage);
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Failed to parse JSON");
    
    const parsed = JSON.parse(jsonMatch[0]);

    const res = await pool.query(
      `INSERT INTO personality_versions (user_id, personality_text, mutation_note)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, parsed.new_traits, parsed.mutation_note]
    );

    return res.rows[0];
  } catch (err) {
    console.error('[Engine] Failed to mutate personality:', err.message);
    return null;
  }
}

module.exports = { getLatestPersonality, renderPersonality, mutatePersonality };