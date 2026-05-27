require('dotenv').config();
require('./jobs/nightly'); // Start cron jobs

const express = require('express');
const config = require('./config');
const { pool, closePool } = require('./database/pool');
const { bot, setProcessMessage, setReady, stopBot } = require('./bot/telegram');
const { registerCommands } = require('./bot/commands');

const { addMessage, getMessages, resetSession, popLastMessage, persistMessage, MAX_STM_MESSAGES } = require('./memory/stm');
const { checkAndGenerate, getRecentDiaries } = require('./memory/mtm');
const { estimateTokens } = require('./utils/tokenizer');

// Import Cognitive Engines
const { getActiveFacts } = require('./memory/facts');
const { shouldDetectMood, detectAndSaveMood, getLatestMood } = require('./memory/mood');
const { getCompanionState } = require('./memory/companionState');
const { renderPersonality } = require('./personality/engine');
const { runAgenticLoop } = require('./agent/loop');

const stats = { startTime: Date.now(), messagesHandled: 0 };
const getStatus = () => ({
  uptime: `${Math.floor((Date.now() - stats.startTime) / 3600000)}h ${Math.floor(((Date.now() - stats.startTime) % 3600000) / 60000)}m`,
  messages: stats.messagesHandled,
});

// --- NEW: Typing Keep-Alive Helpers ---
function startTypingIndicator(chatId) {
  // Send immediately
  bot.sendChatAction(chatId, 'typing').catch(() => {});
  // Repeatedly send every 4 seconds
  return setInterval(() => {
    bot.sendChatAction(chatId, 'typing').catch(() => {});
  }, 4000);
}

function stopTypingIndicator(intervalId) {
  if (intervalId) clearInterval(intervalId);
}
// --------------------------------------

// Build the Ultimate System Prompt
async function buildSystemPrompt(userId, diaries) {
  const companionState = await getCompanionState(userId);
  let prompt = await renderPersonality(userId, companionState);

  const activeFacts = await getActiveFacts(userId);
  if (activeFacts.length > 0) {
    prompt += '\n\nUSER SOUL MAP (Permanent Facts):\n';
    activeFacts.forEach(f => prompt += `- [${f.category}] ${f.fact_text}\n`);
  }

  const mood = await getLatestMood(`tg_${userId}`);
  if (mood) {
    prompt += '\n\nCURRENT CONVERSATION STATE:\n';
    prompt += `- User Mood: ${mood.detected_mood} (Energy: ${mood.user_energy_level}/10)\n`;
    prompt += `- Current Topic: ${mood.topic_anchor}\n`;
    prompt += `- Self-Correction Note: ${mood.companion_adjustment}\n`;
  }

  if (diaries && diaries.length > 0) {
    prompt += '\n\nRECENT MEMORY (MTM Summaries):\n';
    diaries.forEach((d, i) => {
      prompt += `[${new Date(d.created_at).toLocaleDateString()}] Mood: ${d.mood} | ${d.summary}\n`;
    });
  }

  return { prompt, toolsEnabled: companionState.tools_enabled };
}

function toOpenAiHistory(messages) {
  return messages.map(m => ({
    role: m.role === 'model' ? 'assistant' : m.role,
    content: m.content,
  }));
}

async function processMessage(msg) {
  stats.messagesHandled++;
  const text = msg.text;
  const sessionId = `tg_${msg.from.id}`;
  const userId = msg.from.id;
  const chatId = msg.chat.id;

  if (text.startsWith('/')) return null;

  // Start the typing keep-alive loop!
  const typingInterval = startTypingIndicator(chatId);

  try {
    // 1. STM
    const userTokens = estimateTokens(text);
    addMessage(sessionId, { role: 'user', content: text, tokens: userTokens, created_at: new Date() });

    // 2. Build Prompt
    const stmMessages = getMessages(sessionId);
    const recentDiaries = await getRecentDiaries(userId, 5);
    const { prompt, toolsEnabled } = await buildSystemPrompt(userId, recentDiaries);

    const openAiHistory = [
      { role: 'system', content: prompt },
      ...toOpenAiHistory(stmMessages),
    ];

    // 3. Agentic Loop
    let replyText = null;
    try {
      replyText = await runAgenticLoop(openAiHistory, toolsEnabled);
    } catch (err) {
      console.error(`[Index] Agent Loop failed:`, err.message);
    }

    if (!replyText) {
      popLastMessage(sessionId);
      return "My brain's a bit foggy right now. Try again in a sec?";
    }

    const modelTokens = estimateTokens(replyText);
    addMessage(sessionId, { role: 'model', content: replyText, tokens: modelTokens, created_at: new Date() });

    // 4. Background Tasks Sequence
    persistMessage(pool, { user_id: userId, role: 'user', content: text, tokens: userTokens, session_id: sessionId })
      .then(() => persistMessage(pool, { user_id: userId, role: 'model', content: replyText, tokens: modelTokens, session_id: sessionId }))
      .then(() => checkAndGenerate(sessionId, userId))
      .then(diary => { if (diary) console.log(`[MTM] Diary generated.`); })
      .then(async () => {
        if (await shouldDetectMood(sessionId)) {
          console.log('[Mood] Triggering mood detection...');
          await detectAndSaveMood(sessionId, userId, getMessages(sessionId).slice(-6));
        }
      })
      .catch(e => console.error('[Background Task] Failed:', e.message));

    return replyText;

  } finally {
    // ALWAYS stop the typing loop, even if the code crashes or errors out!
    stopTypingIndicator(typingInterval);
  }
}

registerCommands({ resetSession, getStatus, getRecentDiaries: () => getRecentDiaries(config.ALLOWED_USER_ID, 5), processMessage });
setProcessMessage(processMessage);

const app = express();
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: getStatus().uptime, messages: stats.messagesHandled, memory: process.memoryUsage() });
});

async function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  setReady(false);
  await stopBot();
  await closePool();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

(async () => {
  try {
    const client = await pool.connect();
    client.release();

    app.listen(config.PORT, () => console.log(`[HTTP] Health check on port ${config.PORT}`));
    
    await getCompanionState(config.ALLOWED_USER_ID);

    setReady(true);
    console.log('[Bot] Kate is online and listening.');
  } catch (err) {
    console.error('[Startup] Failed:', err.message);
    process.exit(1);
  }
})();