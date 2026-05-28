const cron = require('node-cron');
const config = require('../config');
const { pool } = require('../database/pool');
const { chatWithTools, getResponseText } = require('../api/llm');
const { bot } = require('../bot/telegram');
const { addMessage, persistMessage } = require('../memory/stm');
const { getCompanionState } = require('../memory/companionState');
const { getRecentDiaries } = require('../memory/mtm');
const { getActiveFacts } = require('../memory/facts');
const { renderPersonality } = require('../personality/engine');
const { estimateTokens } = require('../utils/tokenizer');

async function checkAndSendProactiveMessage(force = false) {
  const userId = config.ALLOWED_USER_ID;
  const chatId = userId;
  const sessionId = `tg_${userId}`;

  // 1. Time Safeguard
  if (!force) {
    const currentHour = new Date().getHours();
    if (currentHour < 10 || currentHour > 22) {
      console.log('[Proactive] Skipped: Outside of waking hours (10 AM - 10 PM).');
      return;
    }
  }

  try {
    // 2. Cooldown Safeguard
    if (!force) {
      const lastMsgRes = await pool.query(
        `SELECT created_at FROM messages 
         WHERE user_id = $1 
         ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );

      if (lastMsgRes.rows.length > 0) {
        const lastMsgTime = new Date(lastMsgRes.rows[0].created_at);
        const hoursSince = (Date.now() - lastMsgTime) / 3600000;

        if (hoursSince < config.PROACTIVE_COOLDOWN_HOURS) {
          console.log(`[Proactive] Skipped: Cooldown active. Last message was only ${hoursSince.toFixed(1)} hours ago.`);
          return;
        }
      }
    }

    console.log('[Proactive] Triggering autonomous check-in diagnostics...');

    // 3. Compile context for Kate
    console.log('[Proactive Debug] Loading Companion State...');
    const companionState = await getCompanionState(userId);
    console.log('[Proactive Debug] Companion State loaded:', JSON.stringify(companionState));

    console.log('[Proactive Debug] Rendering Personality...');
    const personality = await renderPersonality(userId, companionState);
    console.log('[Proactive Debug] Personality template rendered successfully.');

    console.log('[Proactive Debug] Fetching recent diaries...');
    const recentDiaries = await getRecentDiaries(userId, 3);
    console.log(`[Proactive Debug] Found ${recentDiaries.length} recent diaries.`);

    console.log('[Proactive Debug] Fetching active facts...');
    const activeFacts = await getActiveFacts(userId);
    console.log(`[Proactive Debug] Found ${activeFacts.length} active facts.`);

    let context = `--- YOUR PERSONALITY ---\n${personality}\n\n`;
    if (activeFacts.length > 0) {
      context += `--- USER PROFILE ---\n` + activeFacts.map(f => `- ${f.fact_text}`).join('\n') + '\n\n';
    }
    if (recentDiaries.length > 0) {
      context += `--- RECENT DIARIES ---\n` + recentDiaries.map(d => `- ${d.summary}`).join('\n') + '\n\n';
    }

    const prompt = `${context}
Based on your personality, current relationship depth, and your recent memories of the user, write a short, extremely casual texting-style message to check in on them. 

GUIDELINES:
- Ask about a specific recent event, book chapter, goal, or detail from their profile.
- Write ONLY 1 or 2 short sentences. No robotic greetings.
- Do not use generic assistant phrases (e.g., "How can I help you today?"). Be a close friend checking in.`;

    const history = [{ role: 'user', content: prompt }];

    console.log('[Proactive Debug] Dispatching prompt to LLM...');
    console.log('---------------- PROMPT SENT TO LLM ----------------');
    console.log(prompt);
    console.log('----------------------------------------------------');

    // 4. Generate the message
    const response = await chatWithTools(history);
    console.log('[Proactive Debug] Raw LLM Response received:', JSON.stringify(response));

    const text = getResponseText(response);
    console.log(`[Proactive Debug] Extracted response text: "${text}"`);

    if (!text) {
      console.log('[Proactive Warning] LLM returned empty or invalid text content. Returning early.');
      return;
    }

    // 5. Send message to Telegram
    console.log(`[Proactive Debug] Attempting to send Telegram message to Chat ID: ${chatId}...`);
    await bot.sendMessage(chatId, text);
    console.log(`[Proactive] Message successfully delivered to Telegram: "${text}"`);

    // 6. Save to STM & DB
    const tokens = estimateTokens(text);
    addMessage(sessionId, { role: 'model', content: text, tokens, created_at: new Date() });
    await persistMessage(pool, { user_id: userId, role: 'model', content: text, tokens, session_id: sessionId });
    console.log('[Proactive Debug] Message successfully persisted to STM and Database.');

  } catch (err) {
    console.error('[Proactive] Autonomous check-in failed:', err.message);
    console.error(err.stack);
  }
}

// Check every hour on the hour
cron.schedule('0 * * * *', () => checkAndSendProactiveMessage(false));

module.exports = { checkAndSendProactiveMessage };