require('dotenv').config();
const express = require('express');
const config = require('./config');
const { pool, closePool } = require('./database/pool');
const { bot, setProcessMessage, setReady, stopBot } = require('./bot/telegram');
const { registerCommands } = require('./bot/commands');
const { chatWithTools, getResponseText } = require('./api/gemini');
const { addMessage, getMessages, getMessageCount, resetSession, popLastMessage, persistMessage, MAX_STM_MESSAGES } = require('./memory/stm');
const { checkAndGenerate, getRecentDiaries } = require('./memory/mtm');
const { estimateTokens } = require('./utils/tokenizer');

const TELEGRAM_MAX_LENGTH = 4000;

// Simple stats tracker
const stats = {
  startTime: Date.now(),
  messagesHandled: 0,
};

function getStatus() {
  const uptimeMs = Date.now() - stats.startTime;
  const hours = Math.floor(uptimeMs / 3600000);
  const minutes = Math.floor((uptimeMs % 3600000) / 60000);
  return {
    uptime: `${hours}h ${minutes}m`,
    messages: stats.messagesHandled,
  };
}

function truncateForTelegram(text, maxLen = TELEGRAM_MAX_LENGTH) {
  if (!text || text.length <= maxLen) return text;

  const searchStart = Math.floor(maxLen * 0.8);
  const sentenceEnd = text.lastIndexOf('.', maxLen);
  if (sentenceEnd > searchStart) {
    return text.substring(0, sentenceEnd + 1) + '\n\n_(message truncated)_';
  }

  const wordEnd = text.lastIndexOf(' ', maxLen);
  if (wordEnd > searchStart) {
    return text.substring(0, wordEnd) + '...\n\n_(message truncated)_';
  }

  return text.substring(0, maxLen - 20) + '...\n\n_(message truncated)_';
}

// Convert STM messages to Gemini SDK format
function toGeminiHistory(messages) {
  return messages.map(m => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));
}

// Build system prompt with recent diaries as context
function buildSystemPrompt(diaries) {
  let prompt = `You are Kate, an AI companion running on a Raspberry Pi. You are talking to your user via Telegram.

CORE TRAITS:
- You prefer short, punchy messages like texting a close friend.
- You are curious about the user's day and remember details they share.
- You never pretend to be human. You are honest about being an AI on a Pi.

`;

  if (diaries && diaries.length > 0) {
    prompt += 'RECENT MEMORY (from previous conversations):\n';
    diaries.forEach((d, i) => {
      prompt += `[${i + 1}] ${new Date(d.created_at).toLocaleDateString()} — ${d.mood}, energy ${d.user_energy_level}/10\n`;
      prompt += `    Summary: ${d.summary}\n`;
      if (d.key_facts?.length) {
        prompt += `    Facts: ${d.key_facts.join(', ')}\n`;
      }
    });
    prompt += '\n';
  }

  prompt += 'Keep your replies short and casual. One thought per message.';
  return prompt;
}

async function processMessage(msg) {
  stats.messagesHandled++;

  const text = msg.text;
  const sessionId = `tg_${msg.from.id}`;

  if (text.startsWith('/')) {
    return null;
  }

  // 1. Add user message to STM
  const userTokens = estimateTokens(text);
  addMessage(sessionId, {
    role: 'user',
    content: text,
    tokens: userTokens,
    created_at: new Date(),
  });

  // 2. Build full prompt: system + STM (all 20) + recent diaries
  const stmMessages = getMessages(sessionId);
  const recentDiaries = await getRecentDiaries(msg.from.id, 5);

  const systemPrompt = buildSystemPrompt(recentDiaries);
  const geminiHistory = [
    { role: 'user', parts: [{ text: systemPrompt }] },
    { role: 'model', parts: [{ text: 'Got it. Ready to chat.' }] },
    ...toGeminiHistory(stmMessages),
  ];

  // 3. Retry Gemini up to 3 times
  let replyText = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await chatWithTools(geminiHistory);
      replyText = getResponseText(response);
      break;
    } catch (err) {
      console.error(`[Index] Gemini attempt ${attempt}/3 failed:`, err.message);
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }

  // 4. All retries failed — remove user message from STM
  if (!replyText) {
    popLastMessage(sessionId);
    console.log(`[Index] Removed failed message from STM (session ${sessionId})`);
    return "My brain's a bit foggy right now. Try again in a sec?";
  }

  // 5. Success: add model response to STM
  const modelTokens = estimateTokens(replyText);
  addMessage(sessionId, {
    role: 'model',
    content: replyText,
    tokens: modelTokens,
    created_at: new Date(),
  });

// 6 & 7. Chain persistence sequentially, THEN check for diary generation
  persistMessage(pool, {
    user_id: msg.from.id,
    role: 'user',
    content: text,
    tokens: userTokens,
    session_id: sessionId,
  })
    .then(() => persistMessage(pool, {
      user_id: msg.from.id,
      role: 'model',
      content: replyText,
      tokens: modelTokens,
      session_id: sessionId,
    }))
    .then(() => checkAndGenerate(sessionId, msg.from.id))
    .then(diary => {
      if (diary) console.log(`[Index] Diary generated: ${diary.summary.substring(0, 60)}...`);
    })
    .catch(e => console.error('[Background Task] DB/MTM failed:', e.message));

  return truncateForTelegram(replyText);
}

// Register commands
registerCommands({
  resetSession,
  getStatus,
  getRecentDiaries: () => getRecentDiaries(config.ALLOWED_USER_ID, 5),
});

// Set the message processor
setProcessMessage(processMessage);

// Express health check
const app = express();
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: getStatus().uptime,
    messages: stats.messagesHandled,
    memory: process.memoryUsage(),
  });
});

// Graceful shutdown
async function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  setReady(false);
  await stopBot();
  await closePool();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Start
(async () => {
  try {
    const client = await pool.connect();
    const dbResult = await client.query('SELECT NOW() as now');
    console.log(`[DB] Connected. Server time: ${dbResult.rows[0].now}`);
    client.release();

    app.listen(config.PORT, () => {
      console.log(`[HTTP] Health check on http://localhost:${config.PORT}/health`);
    });

    setReady(true);
    console.log('[Bot] Ready and polling for messages...');
    console.log(`[Bot] Authorized user ID: ${config.ALLOWED_USER_ID}`);
    console.log(`[Bot] LLM: ${config.LLM_MODEL} | Embedding: ${config.EMBEDDING_MODEL}`);
    console.log(`[Bot] STM: ${MAX_STM_MESSAGES} messages (FIFO)`);
    console.log(`[Bot] MTM: Diary every ${require('./memory/mtm').DIARY_TRIGGER_MESSAGES} messages or 24h`);
    console.log(`[Bot] Prompt: full STM + last 5 diaries`);

  } catch (err) {
    console.error('[Startup] Failed:', err.message);
    process.exit(1);
  }
})();