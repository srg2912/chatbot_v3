require('dotenv').config();
const express = require('express');
const config = require('./config');
const { pool, closePool } = require('./database/pool');
const { bot, setProcessMessage, setReady, stopBot } = require('./bot/telegram');
const { registerCommands } = require('./bot/commands');
const { chatWithTools, getResponseText } = require('./api/gemini');

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

// Phase 3: In-memory conversation history (will evolve into STM in Phase 4)
const conversations = new Map(); // sessionId -> Array<{role, parts}>

async function processMessage(msg) {
  stats.messagesHandled++;

  const text = msg.text;
  const sessionId = `tg_${msg.from.id}`;

  // Commands are handled by bot.onText
  if (text.startsWith('/')) {
    return null;
  }

  // Get or create history
  if (!conversations.has(sessionId)) {
    conversations.set(sessionId, []);
  }
  const history = conversations.get(sessionId);

  // Add user message
  history.push({ role: 'user', parts: [{ text }] });

  // Hard cap: keep last 20 turns to avoid token overflow until STM is built
  while (history.length > 20) {
    history.shift();
  }

  try {
    // Call Gemini (sequential, no tools yet — those come in Phase 9)
    const response = await chatWithTools(history);
    const replyText = getResponseText(response);

    // Store model response in history
    if (replyText) {
      history.push({ role: 'model', parts: [{ text: replyText }] });
    }

    return replyText || "I thought about that but came up blank.";
  } catch (err) {
    console.error('[Index] Gemini error:', err.message);
    return "My brain's a bit foggy right now. Try again in a sec?";
  }
}

// Register commands
registerCommands({
  resetSession: (sessionId) => {
    console.log(`[Commands] Reset session ${sessionId}`);
    conversations.delete(sessionId);
  },
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
    // Verify DB connection
    const client = await pool.connect();
    const dbResult = await client.query('SELECT NOW() as now');
    console.log(`[DB] Connected. Server time: ${dbResult.rows[0].now}`);
    client.release();

    // Start Express
    app.listen(config.PORT, () => {
      console.log(`[HTTP] Health check on http://localhost:${config.PORT}/health`);
    });

    // Mark bot ready
    setReady(true);
    console.log('[Bot] Ready and polling for messages...');
    console.log(`[Bot] Authorized user ID: ${config.ALLOWED_USER_ID}`);
    console.log(`[Bot] LLM: ${config.LLM_MODEL} | Embedding: ${config.EMBEDDING_MODEL}`);

  } catch (err) {
    console.error('[Startup] Failed:', err.message);
    process.exit(1);
  }
})();