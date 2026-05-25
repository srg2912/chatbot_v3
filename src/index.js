require('dotenv').config();
const express = require('express');
const config = require('./config');
const { pool, closePool } = require('./database/pool');
const { bot, setProcessMessage, setReady, stopBot } = require('./bot/telegram');
const { registerCommands } = require('./bot/commands');
const { chatWithTools, getResponseText } = require('./api/gemini');
const { addMessage, getMessages, resetSession, popLastMessage, persistMessage } = require('./memory/stm');
const { estimateTokens } = require('./utils/tokenizer');

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

// Convert STM messages to Gemini SDK format
function toGeminiHistory(messages) {
  return messages.map(m => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));
}

async function processMessage(msg) {
  stats.messagesHandled++;

  const text = msg.text;
  const sessionId = `tg_${msg.from.id}`;

  // Commands are handled by bot.onText — return null so telegram.js skips sending
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

  // 2. Retry Gemini up to 3 times with backoff
  let replyText = null;
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const recentHistory = getMessages(sessionId, 4000);
      const geminiHistory = toGeminiHistory(recentHistory);
      const response = await chatWithTools(geminiHistory);
      replyText = getResponseText(response);
      break; // Success — exit retry loop
    } catch (err) {
      lastError = err;
      console.error(`[Index] Gemini attempt ${attempt}/3 failed:`, err.message);
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 1000 * attempt)); // 1s, 2s backoff
      }
    }
  }

  // 3. All retries failed — remove user message from STM to prevent duplication
  if (!replyText) {
    popLastMessage(sessionId);
    console.log(`[Index] Removed failed message from STM (session ${sessionId})`);
    return "My brain's a bit foggy right now. Try again in a sec?";
  }

  // 4. Success: add model response to STM
  const modelTokens = estimateTokens(replyText);
  addMessage(sessionId, {
    role: 'model',
    content: replyText,
    tokens: modelTokens,
    created_at: new Date(),
  });

  // 5. Fire-and-forget persistence to PSQL
  persistMessage(pool, {
    user_id: msg.from.id,
    role: 'user',
    content: text,
    tokens: userTokens,
    session_id: sessionId,
  }).catch(e => console.error('[STM] Persist user failed:', e.message));

  persistMessage(pool, {
    user_id: msg.from.id,
    role: 'model',
    content: replyText,
    tokens: modelTokens,
    session_id: sessionId,
  }).catch(e => console.error('[STM] Persist model failed:', e.message));

  return replyText;
}

// Register commands — wire /reset to STM
registerCommands({
  resetSession,
  getStatus,
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
    console.log(`[Bot] STM budget: 6000 tokens | Prompt budget: 4000 tokens | Max retries: 3`);

  } catch (err) {
    console.error('[Startup] Failed:', err.message);
    process.exit(1);
  }
})();